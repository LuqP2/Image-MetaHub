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
  const visibleDirectoryIds = new Set<string>();
  const directoryPathMap = new Map<string, string>();
  for (let i = 0; i < criteria.visibleDirectories.length; i++) {
    const dir = criteria.visibleDirectories[i];
    visibleDirectoryIds.add(dir.id);
    directoryPathMap.set(dir.id, normalizePath(dir.path));
  }

  const excludedFolders = criteria.excludedFolders.map(normalizePath);
  const selectedFolders = criteria.selectedFolders.map(normalizePath);
  const hasSelectedFolders = selectedFolders.length > 0;

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

  const { advancedFilters } = criteria;
  const filterDimension = advancedFilters.dimension ? advancedFilters.dimension.replace(/\s+/g, '') : null;
  const dateFrom = advancedFilters.date?.from ? parseLocalDateFilterStart(advancedFilters.date.from) : null;
  const dateTo = advancedFilters.date?.to ? parseLocalDateFilterEndExclusive(advancedFilters.date.to) : null;
  const generationModes = advancedFilters.generationModes && advancedFilters.generationModes.length > 0 ? new Set(advancedFilters.generationModes) : null;
  const mediaTypes = advancedFilters.mediaTypes && advancedFilters.mediaTypes.length > 0 ? new Set(advancedFilters.mediaTypes) : null;

  const shouldFilterSensitive =
    criteria.safeMode.enableSafeMode &&
    !criteria.safeMode.blurSensitiveImages &&
    sensitiveTags.size > 0;

  const results: SearchWorkerImage[] = [];

  // Facet collection variables
  const modelsFacet = new Set<string>();
  const lorasFacet = new Set<string>();
  const samplersFacet = new Set<string>();
  const schedulersFacet = new Set<string>();
  const generatorsFacet = new Set<string>();
  const gpuDevicesFacet = new Set<string>();
  const dimensionsFacet = new Set<string>();
  const modelFacetCounts = new Map<string, number>();
  const loraFacetCounts = new Map<string, number>();
  const samplerFacetCounts = new Map<string, number>();
  const schedulerFacetCounts = new Map<string, number>();

  for (let i = 0; i < workerImages.length; i++) {
    const image = workerImages[i];

    // 1. Basic Directory and Visibility check
    if (!visibleDirectoryIds.has(image.directoryId)) continue;
    const parentPath = directoryPathMap.get(image.directoryId);
    if (!parentPath) continue;

    // 2. Folder Filters
    const folderPath = getFolderPath(image, parentPath);
    let isFolderExcluded = false;
    for (let j = 0; j < excludedFolders.length; j++) {
      const excludedFolder = excludedFolders[j];
      if (
        folderPath === excludedFolder ||
        folderPath.startsWith(`${excludedFolder}/`)
      ) {
        isFolderExcluded = true;
        break;
      }
    }
    if (isFolderExcluded) continue;

    if (hasSelectedFolders) {
      let isMatch = false;
      for (let j = 0; j < selectedFolders.length; j++) {
        const selectedFolder = selectedFolders[j];
        if (
          folderPath === selectedFolder ||
          (criteria.includeSubfolders && folderPath.startsWith(`${selectedFolder}/`))
        ) {
          isMatch = true;
          break;
        }
      }
      if (!isMatch) continue;
    }

    // 3. Favorite Filter
    if (criteria.favoriteFilterMode === 'include' && image.isFavorite !== true) continue;
    if (criteria.favoriteFilterMode === 'exclude' && image.isFavorite === true) continue;

    // 4. Rating Filter
    if (selectedRatings.size > 0 && (image.rating === null || !selectedRatings.has(image.rating))) continue;

    // 5. Sensitive Filter
    if (shouldFilterSensitive) {
      let hasSensitiveTag = false;
      for (let j = 0; j < image.tags.length; j++) {
        if (sensitiveTags.has(image.tags[j])) {
          hasSensitiveTag = true;
          break;
        }
      }
      if (hasSensitiveTag) continue;
    }

    // 6. Tags Filter
    if (selectedTags.size > 0) {
      if (image.tags.length === 0) continue;
      if (criteria.selectedTagsMatchMode === 'all') {
        let allMatch = true;
        for (const tag of selectedTags) {
          if (!image.tags.includes(tag)) {
            allMatch = false;
            break;
          }
        }
        if (!allMatch) continue;
      } else {
        let someMatch = false;
        for (let j = 0; j < image.tags.length; j++) {
          if (selectedTags.has(image.tags[j])) {
            someMatch = true;
            break;
          }
        }
        if (!someMatch) continue;
      }
    }
    if (excludedTags.size > 0) {
      let hasExcludedTag = false;
      for (let j = 0; j < image.tags.length; j++) {
        if (excludedTags.has(image.tags[j])) {
          hasExcludedTag = true;
          break;
        }
      }
      if (hasExcludedTag) continue;
    }

    // 7. Auto-Tags Filter
    if (selectedAutoTags.size > 0) {
      let someAutoMatch = false;
      for (let j = 0; j < image.autoTags.length; j++) {
        if (selectedAutoTags.has(image.autoTags[j])) {
          someAutoMatch = true;
          break;
        }
      }
      if (!someAutoMatch) continue;
    }
    if (excludedAutoTags.size > 0) {
      let hasExcludedAutoTag = false;
      for (let j = 0; j < image.autoTags.length; j++) {
        if (excludedAutoTags.has(image.autoTags[j])) {
          hasExcludedAutoTag = true;
          break;
        }
      }
      if (hasExcludedAutoTag) continue;
    }

    // 8. Search Query
    if (searchTerms.length > 0) {
      let catalogMatch = true;
      for (let j = 0; j < searchTerms.length; j++) {
        if (!image.catalogText.includes(searchTerms[j])) {
          catalogMatch = false;
          break;
        }
      }

      if (!catalogMatch) {
        if (!image.searchText) continue;
        let searchMatch = true;
        for (let j = 0; j < searchTerms.length; j++) {
          if (!image.searchText.includes(searchTerms[j])) {
            searchMatch = false;
            break;
          }
        }
        if (!searchMatch) continue;
      }
    }

    // 9. Resource Filters (Models, Loras)
    if (selectedModels.size > 0) {
      let someModelMatch = false;
      for (let j = 0; j < image.models.length; j++) {
        if (selectedModels.has(image.models[j])) {
          someModelMatch = true;
          break;
        }
      }
      if (!someModelMatch) continue;
    }
    if (excludedModels.size > 0) {
      let hasExcludedModel = false;
      for (let j = 0; j < image.models.length; j++) {
        if (excludedModels.has(image.models[j])) {
          hasExcludedModel = true;
          break;
        }
      }
      if (hasExcludedModel) continue;
    }
    if (selectedLoras.size > 0) {
      let someLoraMatch = false;
      for (let j = 0; j < image.loraNames.length; j++) {
        if (selectedLoras.has(image.loraNames[j])) {
          someLoraMatch = true;
          break;
        }
      }
      if (!someLoraMatch) continue;
    }
    if (excludedLoras.size > 0) {
      let hasExcludedLora = false;
      for (let j = 0; j < image.loraNames.length; j++) {
        if (excludedLoras.has(image.loraNames[j])) {
          hasExcludedLora = true;
          break;
        }
      }
      if (hasExcludedLora) continue;
    }

    // 10. Parameters (Sampler, Scheduler, Generator, GPU)
    if (selectedSamplers.size > 0 && (!image.sampler || !selectedSamplers.has(image.sampler))) continue;
    if (excludedSamplers.size > 0 && image.sampler && excludedSamplers.has(image.sampler)) continue;
    if (selectedSchedulers.size > 0 && !selectedSchedulers.has(image.scheduler)) continue;
    if (excludedSchedulers.size > 0 && excludedSchedulers.has(image.scheduler)) continue;
    if (selectedGenerators.size > 0 && !selectedGenerators.has(image.generator)) continue;
    if (excludedGenerators.size > 0 && excludedGenerators.has(image.generator)) continue;
    if (selectedGpuDevices.size > 0 && (image.gpuDevice === null || !selectedGpuDevices.has(image.gpuDevice))) continue;
    if (excludedGpuDevices.size > 0 && image.gpuDevice !== null && excludedGpuDevices.has(image.gpuDevice)) continue;

    // 11. Advanced Filters
    if (filterDimension && image.dimensions.replace(/\s+/g, '') !== filterDimension) continue;
    if (advancedFilters.steps && !numericRangeMatch(image.steps, advancedFilters.steps)) continue;
    if (advancedFilters.cfg && !numericRangeMatch(image.cfgScale, advancedFilters.cfg)) continue;
    if (dateFrom !== null && image.lastModified < dateFrom) continue;
    if (dateTo !== null && image.lastModified >= dateTo) continue;

    if (generationModes) {
      const type = image.generationType || (image.mediaType !== 'video' && image.mediaType !== 'audio' ? 'txt2img' : null);
      if (!type || !generationModes.has(type as 'txt2img' | 'img2img')) continue;
    }
    if (mediaTypes && !mediaTypes.has(image.mediaType)) continue;

    if (advancedFilters.telemetryState === 'present' && !image.hasTelemetry) continue;
    if (advancedFilters.telemetryState === 'missing' && image.hasTelemetry) continue;
    if (advancedFilters.hasVerifiedTelemetry === true && !image.hasVerifiedTelemetry) continue;

    if (advancedFilters.generationTimeMs && !numericRangeMatch(image.generationTimeMs, advancedFilters.generationTimeMs)) continue;
    if (advancedFilters.stepsPerSecond && !numericRangeMatch(image.stepsPerSecond, advancedFilters.stepsPerSecond)) continue;
    if (advancedFilters.vramPeakMb && !numericRangeMatch(image.vramPeakMb, advancedFilters.vramPeakMb)) continue;

    // PASS ALL FILTERS
    results.push(image);

    // Update Facets
    for (let j = 0; j < image.models.length; j++) {
      const model = image.models[j];
      modelsFacet.add(model);
      modelFacetCounts.set(model, (modelFacetCounts.get(model) ?? 0) + 1);
    }
    for (let j = 0; j < image.loraNames.length; j++) {
      const lora = image.loraNames[j];
      lorasFacet.add(lora);
      loraFacetCounts.set(lora, (loraFacetCounts.get(lora) ?? 0) + 1);
    }
    if (image.sampler) {
      samplersFacet.add(image.sampler);
      samplerFacetCounts.set(image.sampler, (samplerFacetCounts.get(image.sampler) ?? 0) + 1);
    }
    if (image.scheduler) {
      schedulersFacet.add(image.scheduler);
      schedulerFacetCounts.set(image.scheduler, (schedulerFacetCounts.get(image.scheduler) ?? 0) + 1);
    }
    generatorsFacet.add(image.generator);
    if (image.gpuDevice) gpuDevicesFacet.add(image.gpuDevice);
    if (image.dimensions && image.dimensions !== '0x0') dimensionsFacet.add(image.dimensions);
  }

  // Final sorting
  results.sort((left, right) => compareImages(left, right, criteria.sortOrder, criteria.randomSeed));

  return {
    filteredIds: results.map(img => img.id),
    facets: {
      availableModels: Array.from(modelsFacet).sort(caseInsensitiveSort),
      availableLoras: Array.from(lorasFacet).sort(caseInsensitiveSort),
      availableSamplers: Array.from(samplersFacet).sort(caseInsensitiveSort),
      availableSchedulers: Array.from(schedulersFacet).sort(caseInsensitiveSort),
      availableGenerators: Array.from(generatorsFacet).sort(caseInsensitiveSort),
      availableGpuDevices: Array.from(gpuDevicesFacet).sort(caseInsensitiveSort),
      availableDimensions: Array.from(dimensionsFacet).sort((a, b) => {
        const [aWidth, aHeight] = a.split('x').map(Number);
        const [bWidth, bHeight] = b.split('x').map(Number);
        return (aWidth * aHeight) - (bWidth * bHeight);
      }),
      modelFacetCounts: Array.from(modelFacetCounts.entries()),
      loraFacetCounts: Array.from(loraFacetCounts.entries()),
      samplerFacetCounts: Array.from(samplerFacetCounts.entries()),
      schedulerFacetCounts: Array.from(schedulerFacetCounts.entries()),
    },
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
