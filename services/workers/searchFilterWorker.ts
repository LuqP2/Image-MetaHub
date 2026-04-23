import type { AdvancedFilters, ImageRating, InclusionFilterMode, TagMatchMode } from '../../types';
import { parseLocalDateFilterEndExclusive, parseLocalDateFilterStart } from '../../utils/dateFilterUtils';

type SearchWorkerImage = {
  id: string;
  name: string;
  catalogText: string;
  searchText: string;
  relativePath: string;
  directoryId: string;
  directoryName: string;
  models: string[];
  loraNames: string[];
  sampler: string;
  scheduler: string;
  board: string;
  dimensions: string;
  lastModified: number;
  steps: number | null;
  cfgScale: number | null;
  generationType: 'txt2img' | 'img2img' | null;
  mediaType: 'image' | 'video' | 'audio';
  generator: string;
  gpuDevice: string | null;
  hasTelemetry: boolean;
  hasVerifiedTelemetry: boolean;
  generationTimeMs: number | null;
  stepsPerSecond: number | null;
  vramPeakMb: number | null;
  isFavorite: boolean;
  rating: ImageRating | null;
  tags: string[];
  autoTags: string[];
};

type SearchWorkerCriteria = {
  searchQuery: string;
  selectedModels: string[];
  excludedModels: string[];
  selectedLoras: string[];
  excludedLoras: string[];
  selectedSamplers: string[];
  excludedSamplers: string[];
  selectedSchedulers: string[];
  excludedSchedulers: string[];
  selectedGenerators: string[];
  excludedGenerators: string[];
  selectedGpuDevices: string[];
  excludedGpuDevices: string[];
  selectedTags: string[];
  selectedTagsMatchMode: TagMatchMode;
  excludedTags: string[];
  selectedAutoTags: string[];
  excludedAutoTags: string[];
  favoriteFilterMode: InclusionFilterMode;
  selectedRatings: ImageRating[];
  advancedFilters: AdvancedFilters;
  sortOrder: 'asc' | 'desc' | 'date-asc' | 'date-desc' | 'random';
  randomSeed: number;
  selectedFolders: string[];
  excludedFolders: string[];
  includeSubfolders: boolean;
  visibleDirectories: Array<{ id: string; path: string }>;
  safeMode: {
    enableSafeMode: boolean;
    blurSensitiveImages: boolean;
    sensitiveTags: string[];
  };
};

type WorkerMessage =
  | {
      type: 'syncDataset';
      payload: {
        datasetVersion: number;
        images: SearchWorkerImage[];
      };
    }
  | {
      type: 'compute';
      payload: {
        criteriaKey: string;
        datasetVersion: number;
        criteria: SearchWorkerCriteria;
      };
    };

type WorkerResponse =
  | {
      type: 'complete';
      payload: {
        criteriaKey: string;
        filteredIds: string[];
        facets: {
          availableModels: string[];
          availableLoras: string[];
          availableSamplers: string[];
          availableSchedulers: string[];
          availableGenerators: string[];
          availableGpuDevices: string[];
          availableDimensions: string[];
          modelFacetCounts: Array<[string, number]>;
          loraFacetCounts: Array<[string, number]>;
          samplerFacetCounts: Array<[string, number]>;
          schedulerFacetCounts: Array<[string, number]>;
        };
      };
    }
  | {
      type: 'error';
      payload: {
        error: string;
      };
    };

type CompletePayload = Extract<WorkerResponse, { type: 'complete' }>['payload'];

let datasetVersion = -1;
let workerImages: SearchWorkerImage[] = [];

const normalizePath = (path: string): string => path.replace(/\\/g, '/');

const joinPath = (base: string, relative: string) => {
  if (!relative) {
    return normalizePath(base);
  }

  const normalizedBase = normalizePath(base);
  const normalizedRelative = relative
    .split(/[/\\]/)
    .filter(Boolean)
    .join('/');

  return normalizedBase ? `${normalizedBase}/${normalizedRelative}` : normalizedRelative;
};

const getFolderPath = (image: SearchWorkerImage, parentDirectory: string) => {
  const segments = image.relativePath.split(/[/\\]/).filter(Boolean);
  if (segments.length <= 1) {
    return normalizePath(parentDirectory);
  }

  return joinPath(parentDirectory, segments.slice(0, -1).join('/'));
};

const caseInsensitiveSort = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'accent' });

const stringHash = (str: string) => {
  let hash = 0;
  for (let index = 0; index < str.length; index += 1) {
    const char = str.charCodeAt(index);
    hash = ((hash << 5) - hash) + char;
    hash &= hash;
  }
  return hash;
};

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  try {
    if (message.type === 'syncDataset') {
      workerImages = message.payload.images;
      datasetVersion = message.payload.datasetVersion;
      return;
    }

    if (message.type === 'compute') {
      if (message.payload.datasetVersion !== datasetVersion) {
        postError('Search dataset is out of sync.');
        return;
      }

      postComplete(message.payload.criteriaKey, computeResults(message.payload.criteria));
    }
  } catch (error) {
    postError(error instanceof Error ? error.message : String(error));
  }
};

function computeResults(criteria: SearchWorkerCriteria): Omit<CompletePayload, 'criteriaKey'> {
  const visibleDirectoryIds = new Set(criteria.visibleDirectories.map(directory => directory.id));
  const directoryPathMap = new Map(
    criteria.visibleDirectories.map(directory => [directory.id, normalizePath(directory.path)])
  );
  const excludedFolders = criteria.excludedFolders.map(normalizePath);
  const selectedFolders = criteria.selectedFolders.map(normalizePath);
  const selectedRatings = new Set(criteria.selectedRatings);
  const selectedModels = new Set(criteria.selectedModels);
  const excludedModels = new Set(criteria.excludedModels);
  const selectedLoras = new Set(criteria.selectedLoras);
  const excludedLoras = new Set(criteria.excludedLoras);
  const selectedSamplers = new Set(criteria.selectedSamplers);
  const excludedSamplers = new Set(criteria.excludedSamplers);
  const selectedSchedulers = new Set(criteria.selectedSchedulers);
  const excludedSchedulers = new Set(criteria.excludedSchedulers);
  const selectedGenerators = new Set(criteria.selectedGenerators);
  const excludedGenerators = new Set(criteria.excludedGenerators);
  const selectedGpuDevices = new Set(criteria.selectedGpuDevices);
  const excludedGpuDevices = new Set(criteria.excludedGpuDevices);
  const selectedTags = new Set(criteria.selectedTags);
  const excludedTags = new Set(criteria.excludedTags);
  const selectedAutoTags = new Set(criteria.selectedAutoTags);
  const excludedAutoTags = new Set(criteria.excludedAutoTags);
  const sensitiveTags = new Set(criteria.safeMode.sensitiveTags);
  const searchTerms = criteria.searchQuery
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  let results = workerImages.filter((image) => {
    if (!visibleDirectoryIds.has(image.directoryId)) {
      return false;
    }

    const parentPath = directoryPathMap.get(image.directoryId);
    if (!parentPath) {
      return false;
    }

    const folderPath = getFolderPath(image, parentPath);

    for (const excludedFolder of excludedFolders) {
      if (
        folderPath === excludedFolder ||
        folderPath.startsWith(`${excludedFolder}/`) ||
        folderPath.startsWith(`${excludedFolder}\\`)
      ) {
        return false;
      }
    }

    if (selectedFolders.length > 0) {
      const isDirectMatch = selectedFolders.includes(folderPath);
      const isSubfolderMatch = criteria.includeSubfolders && selectedFolders.some((selectedFolder) =>
        folderPath.startsWith(`${selectedFolder}/`) || folderPath.startsWith(`${selectedFolder}\\`)
      );

      if (!isDirectMatch && !isSubfolderMatch) {
        return false;
      }
    }

    return true;
  });

  if (criteria.favoriteFilterMode === 'include') {
    results = results.filter(image => image.isFavorite === true);
  } else if (criteria.favoriteFilterMode === 'exclude') {
    results = results.filter(image => image.isFavorite !== true);
  }

  if (selectedRatings.size > 0) {
    results = results.filter(image => image.rating !== null && selectedRatings.has(image.rating));
  }

  const shouldFilterSensitive =
    criteria.safeMode.enableSafeMode &&
    !criteria.safeMode.blurSensitiveImages &&
    sensitiveTags.size > 0;

  if (shouldFilterSensitive) {
    results = results.filter(image => !image.tags.some(tag => sensitiveTags.has(tag)));
  }

  if (selectedTags.size > 0) {
    results = results.filter(image => {
      if (image.tags.length === 0) {
        return false;
      }

      if (criteria.selectedTagsMatchMode === 'all') {
        return Array.from(selectedTags).every(tag => image.tags.includes(tag));
      }

      return image.tags.some(tag => selectedTags.has(tag));
    });
  }

  if (excludedTags.size > 0) {
    results = results.filter(image => !image.tags.some(tag => excludedTags.has(tag)));
  }

  if (selectedAutoTags.size > 0) {
    results = results.filter(image => image.autoTags.some(tag => selectedAutoTags.has(tag)));
  }

  if (excludedAutoTags.size > 0) {
    results = results.filter(image => !image.autoTags.some(tag => excludedAutoTags.has(tag)));
  }

  if (searchTerms.length > 0) {
    results = results.filter((image) => {
      const catalogMatch = searchTerms.every(term => image.catalogText.includes(term));
      if (catalogMatch) {
        return true;
      }

      if (!image.searchText) {
        return false;
      }

      return searchTerms.every(term => image.searchText.includes(term));
    });
  }

  if (selectedModels.size > 0) {
    results = results.filter(image => image.models.some(model => selectedModels.has(model)));
  }

  if (excludedModels.size > 0) {
    results = results.filter(image => !image.models.some(model => excludedModels.has(model)));
  }

  if (selectedLoras.size > 0) {
    results = results.filter(image => image.loraNames.some(lora => selectedLoras.has(lora)));
  }

  if (excludedLoras.size > 0) {
    results = results.filter(image => !image.loraNames.some(lora => excludedLoras.has(lora)));
  }

  if (selectedSamplers.size > 0) {
    results = results.filter(image => Boolean(image.sampler) && selectedSamplers.has(image.sampler));
  }

  if (excludedSamplers.size > 0) {
    results = results.filter(image => !image.sampler || !excludedSamplers.has(image.sampler));
  }

  if (selectedSchedulers.size > 0) {
    results = results.filter(image => selectedSchedulers.has(image.scheduler));
  }

  if (excludedSchedulers.size > 0) {
    results = results.filter(image => !excludedSchedulers.has(image.scheduler));
  }

  if (selectedGenerators.size > 0) {
    results = results.filter(image => selectedGenerators.has(image.generator));
  }

  if (excludedGenerators.size > 0) {
    results = results.filter(image => !excludedGenerators.has(image.generator));
  }

  if (selectedGpuDevices.size > 0) {
    results = results.filter(image => image.gpuDevice !== null && selectedGpuDevices.has(image.gpuDevice));
  }

  if (excludedGpuDevices.size > 0) {
    results = results.filter(image => image.gpuDevice === null || !excludedGpuDevices.has(image.gpuDevice));
  }

  const { advancedFilters } = criteria;

  if (advancedFilters.dimension) {
    const filterDimension = advancedFilters.dimension.replace(/\s+/g, '');
    results = results.filter(image => image.dimensions.replace(/\s+/g, '') === filterDimension);
  }

  if (advancedFilters.steps) {
    results = results.filter((image) => {
      if (image.steps === null) {
        return false;
      }

      const hasMin = advancedFilters.steps?.min !== null && advancedFilters.steps?.min !== undefined;
      const hasMax = advancedFilters.steps?.max !== null && advancedFilters.steps?.max !== undefined;
      if (hasMin && image.steps < advancedFilters.steps!.min!) return false;
      if (hasMax && image.steps > advancedFilters.steps!.max!) return false;
      return true;
    });
  }

  if (advancedFilters.cfg) {
    results = results.filter((image) => {
      if (image.cfgScale === null) {
        return false;
      }

      const hasMin = advancedFilters.cfg?.min !== null && advancedFilters.cfg?.min !== undefined;
      const hasMax = advancedFilters.cfg?.max !== null && advancedFilters.cfg?.max !== undefined;
      if (hasMin && image.cfgScale < advancedFilters.cfg!.min!) return false;
      if (hasMax && image.cfgScale > advancedFilters.cfg!.max!) return false;
      return true;
    });
  }

  if (advancedFilters.date?.from || advancedFilters.date?.to) {
    results = results.filter((image) => {
      if (advancedFilters.date?.from) {
        const fromTime = parseLocalDateFilterStart(advancedFilters.date.from);
        if (image.lastModified < fromTime) {
          return false;
        }
      }

      if (advancedFilters.date?.to) {
        const toTime = parseLocalDateFilterEndExclusive(advancedFilters.date.to);
        if (image.lastModified >= toTime) {
          return false;
        }
      }

      return true;
    });
  }

  if (Array.isArray(advancedFilters.generationModes) && advancedFilters.generationModes.length > 0) {
    results = results.filter((image) => {
      if (image.generationType === 'txt2img' || image.generationType === 'img2img') {
        return advancedFilters.generationModes!.includes(image.generationType);
      }

      const isGeneratedImageCandidate = image.mediaType !== 'video' && image.mediaType !== 'audio';
      return isGeneratedImageCandidate && advancedFilters.generationModes!.includes('txt2img');
    });
  }

  if (Array.isArray(advancedFilters.mediaTypes) && advancedFilters.mediaTypes.length > 0) {
    results = results.filter(image => advancedFilters.mediaTypes!.includes(image.mediaType));
  }

  if (advancedFilters.telemetryState === 'present') {
    results = results.filter(image => image.hasTelemetry);
  }

  if (advancedFilters.telemetryState === 'missing') {
    results = results.filter(image => !image.hasTelemetry);
  }

  if (advancedFilters.hasVerifiedTelemetry === true) {
    results = results.filter(image => image.hasVerifiedTelemetry);
  }

  if (advancedFilters.generationTimeMs) {
    results = results.filter((image) => numericRangeMatch(image.generationTimeMs, advancedFilters.generationTimeMs));
  }

  if (advancedFilters.stepsPerSecond) {
    results = results.filter((image) => numericRangeMatch(image.stepsPerSecond, advancedFilters.stepsPerSecond));
  }

  if (advancedFilters.vramPeakMb) {
    results = results.filter((image) => numericRangeMatch(image.vramPeakMb, advancedFilters.vramPeakMb));
  }

  const sorted = [...results].sort((left, right) => compareImages(left, right, criteria.sortOrder, criteria.randomSeed));

  return {
    filteredIds: sorted.map(image => image.id),
    facets: collectFacets(sorted),
  };
}

function numericRangeMatch(
  value: number | null,
  range: NonNullable<AdvancedFilters['steps'] | AdvancedFilters['cfg'] | AdvancedFilters['generationTimeMs'] | AdvancedFilters['stepsPerSecond'] | AdvancedFilters['vramPeakMb']>
): boolean {
  if (typeof value !== 'number') {
    return false;
  }

  const hasMin = range.min !== null && range.min !== undefined;
  const hasMax = range.max !== null && range.max !== undefined;
  if (hasMin && value < range.min!) return false;
  if (hasMax && range.maxExclusive === true && value >= range.max!) return false;
  if (hasMax && range.maxExclusive !== true && value > range.max!) return false;
  return true;
}

function compareImages(
  left: SearchWorkerImage,
  right: SearchWorkerImage,
  sortOrder: SearchWorkerCriteria['sortOrder'],
  randomSeed: number
): number {
  const compareById = (a: SearchWorkerImage, b: SearchWorkerImage) => a.id.localeCompare(b.id);
  const compareByNameAsc = (a: SearchWorkerImage, b: SearchWorkerImage) => {
    const nameComparison = (a.name || '').localeCompare(b.name || '');
    return nameComparison !== 0 ? nameComparison : compareById(a, b);
  };
  const compareByNameDesc = (a: SearchWorkerImage, b: SearchWorkerImage) => {
    const nameComparison = (b.name || '').localeCompare(a.name || '');
    return nameComparison !== 0 ? nameComparison : compareById(a, b);
  };
  const compareByDateAsc = (a: SearchWorkerImage, b: SearchWorkerImage) => {
    const dateComparison = a.lastModified - b.lastModified;
    return dateComparison !== 0 ? dateComparison : compareByNameAsc(a, b);
  };
  const compareByDateDesc = (a: SearchWorkerImage, b: SearchWorkerImage) => {
    const dateComparison = b.lastModified - a.lastModified;
    return dateComparison !== 0 ? dateComparison : compareByNameAsc(a, b);
  };
  const compareRandom = (a: SearchWorkerImage, b: SearchWorkerImage) => {
    const hashA = stringHash(`${a.id}${randomSeed}`);
    const hashB = stringHash(`${b.id}${randomSeed}`);
    return hashA !== hashB ? hashA - hashB : a.id.localeCompare(b.id);
  };

  if (sortOrder === 'asc') return compareByNameAsc(left, right);
  if (sortOrder === 'desc') return compareByNameDesc(left, right);
  if (sortOrder === 'date-asc') return compareByDateAsc(left, right);
  if (sortOrder === 'date-desc') return compareByDateDesc(left, right);
  if (sortOrder === 'random') return compareRandom(left, right);
  return compareById(left, right);
}

function collectFacets(images: SearchWorkerImage[]) {
  const models = new Set<string>();
  const loras = new Set<string>();
  const samplers = new Set<string>();
  const schedulers = new Set<string>();
  const generators = new Set<string>();
  const gpuDevices = new Set<string>();
  const dimensions = new Set<string>();
  const modelFacetCounts = new Map<string, number>();
  const loraFacetCounts = new Map<string, number>();
  const samplerFacetCounts = new Map<string, number>();
  const schedulerFacetCounts = new Map<string, number>();

  for (const image of images) {
    image.models.forEach((model) => {
      models.add(model);
      modelFacetCounts.set(model, (modelFacetCounts.get(model) ?? 0) + 1);
    });

    image.loraNames.forEach((lora) => {
      loras.add(lora);
      loraFacetCounts.set(lora, (loraFacetCounts.get(lora) ?? 0) + 1);
    });

    if (image.sampler) {
      samplers.add(image.sampler);
      samplerFacetCounts.set(image.sampler, (samplerFacetCounts.get(image.sampler) ?? 0) + 1);
    }

    if (image.scheduler) {
      schedulers.add(image.scheduler);
      schedulerFacetCounts.set(image.scheduler, (schedulerFacetCounts.get(image.scheduler) ?? 0) + 1);
    }

    generators.add(image.generator);
    if (image.gpuDevice) {
      gpuDevices.add(image.gpuDevice);
    }
    if (image.dimensions && image.dimensions !== '0x0') {
      dimensions.add(image.dimensions);
    }
  }

  return {
    availableModels: Array.from(models).sort(caseInsensitiveSort),
    availableLoras: Array.from(loras).sort(caseInsensitiveSort),
    availableSamplers: Array.from(samplers).sort(caseInsensitiveSort),
    availableSchedulers: Array.from(schedulers).sort(caseInsensitiveSort),
    availableGenerators: Array.from(generators).sort(caseInsensitiveSort),
    availableGpuDevices: Array.from(gpuDevices).sort(caseInsensitiveSort),
    availableDimensions: Array.from(dimensions).sort((a, b) => {
      const [aWidth, aHeight] = a.split('x').map(Number);
      const [bWidth, bHeight] = b.split('x').map(Number);
      return (aWidth * aHeight) - (bWidth * bHeight);
    }),
    modelFacetCounts: Array.from(modelFacetCounts.entries()),
    loraFacetCounts: Array.from(loraFacetCounts.entries()),
    samplerFacetCounts: Array.from(samplerFacetCounts.entries()),
    schedulerFacetCounts: Array.from(schedulerFacetCounts.entries()),
  };
}

function postComplete(
  criteriaKey: string,
  payload: Omit<CompletePayload, 'criteriaKey'>
): void {
  const response: WorkerResponse = {
    type: 'complete',
    payload: {
      ...payload,
      criteriaKey,
    },
  };
  self.postMessage(response);
}

function postError(error: string): void {
  const response: WorkerResponse = {
    type: 'error',
    payload: { error },
  };
  self.postMessage(response);
}
