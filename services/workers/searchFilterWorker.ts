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

const collator = new Intl.Collator(undefined, { sensitivity: 'accent' });

const normalizePath = (path: string): string => path.replace(/\\/g, '/');

const joinPath = (base: string, relative: string) => {
  if (!relative) {
    return normalizePath(base);
  }

  const normalizedBase = normalizePath(base);
  const normalizedRelative = relative.replace(/\\/g, '/').replace(/^\/+/, '');

  if (!normalizedBase) {
    return normalizedRelative;
  }

  return normalizedBase.endsWith('/')
    ? `${normalizedBase}${normalizedRelative}`
    : `${normalizedBase}/${normalizedRelative}`;
};

const getFolderPath = (image: SearchWorkerImage, parentDirectory: string) => {
  const relativePath = image.relativePath;
  const lastSlash = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'));

  if (lastSlash <= 0) {
    return normalizePath(parentDirectory);
  }

  return joinPath(parentDirectory, relativePath.slice(0, lastSlash));
};

const caseInsensitiveSort = (a: string, b: string) =>
  collator.compare(a, b);

const stringHash = (str: string) => {
  let hash = 0;
  for (let index = 0; index < str.length; index += 1) {
    const char = str.charCodeAt(index);
    hash = ((hash << 5) - hash) + char;
    hash &= hash;
  }
  return hash;
};

const compareById = (a: SearchWorkerImage, b: SearchWorkerImage) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const compareByNameAsc = (a: SearchWorkerImage, b: SearchWorkerImage) => {
  const nameComparison = collator.compare(a.name || '', b.name || '');
  return nameComparison !== 0 ? nameComparison : compareById(a, b);
};

const compareByNameDesc = (a: SearchWorkerImage, b: SearchWorkerImage) => {
  const nameComparison = collator.compare(b.name || '', a.name || '');
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

const compareRandom = (a: SearchWorkerImage, b: SearchWorkerImage, randomHashes: Map<string, number>) => {
  const hashA = randomHashes.get(a.id) ?? 0;
  const hashB = randomHashes.get(b.id) ?? 0;
  return hashA !== hashB ? hashA - hashB : compareById(a, b);
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

  const excludedFolders = criteria.excludedFolders.length > 0 ? criteria.excludedFolders.map(normalizePath) : [];
  const selectedFolders = criteria.selectedFolders.length > 0 ? criteria.selectedFolders.map(normalizePath) : [];
  const hasSelectedFolders = selectedFolders.length > 0;
  const hasExcludedFolders = excludedFolders.length > 0;

  const selectedRatings = criteria.selectedRatings.length > 0 ? new Set(criteria.selectedRatings) : null;
  const selectedModels = criteria.selectedModels.length > 0 ? new Set(criteria.selectedModels) : null;
  const excludedModels = criteria.excludedModels.length > 0 ? new Set(criteria.excludedModels) : null;
  const selectedLoras = criteria.selectedLoras.length > 0 ? new Set(criteria.selectedLoras) : null;
  const excludedLoras = criteria.excludedLoras.length > 0 ? new Set(criteria.excludedLoras) : null;
  const selectedSamplers = criteria.selectedSamplers.length > 0 ? new Set(criteria.selectedSamplers) : null;
  const excludedSamplers = criteria.excludedSamplers.length > 0 ? new Set(criteria.excludedSamplers) : null;
  const selectedSchedulers = criteria.selectedSchedulers.length > 0 ? new Set(criteria.selectedSchedulers) : null;
  const excludedSchedulers = criteria.excludedSchedulers.length > 0 ? new Set(criteria.excludedSchedulers) : null;
  const selectedGenerators = criteria.selectedGenerators.length > 0 ? new Set(criteria.selectedGenerators) : null;
  const excludedGenerators = criteria.excludedGenerators.length > 0 ? new Set(criteria.excludedGenerators) : null;
  const selectedGpuDevices = criteria.selectedGpuDevices.length > 0 ? new Set(criteria.selectedGpuDevices) : null;
  const excludedGpuDevices = criteria.excludedGpuDevices.length > 0 ? new Set(criteria.excludedGpuDevices) : null;
  const selectedTags = criteria.selectedTags.length > 0 ? new Set(criteria.selectedTags) : null;
  const excludedTags = criteria.excludedTags.length > 0 ? new Set(criteria.excludedTags) : null;
  const selectedAutoTags = criteria.selectedAutoTags.length > 0 ? new Set(criteria.selectedAutoTags) : null;
  const excludedAutoTags = criteria.excludedAutoTags.length > 0 ? new Set(criteria.excludedAutoTags) : null;
  const sensitiveTags = criteria.safeMode.sensitiveTags.length > 0 ? new Set(criteria.safeMode.sensitiveTags) : null;
  const searchTerms = criteria.searchQuery
    ? criteria.searchQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    : [];

  const { advancedFilters } = criteria;
  const filterDimension = advancedFilters.dimension ? advancedFilters.dimension.replace(/\s+/g, '') : null;
  const dateFrom = advancedFilters.date?.from ? parseLocalDateFilterStart(advancedFilters.date.from) : null;
  const dateTo = advancedFilters.date?.to ? parseLocalDateFilterEndExclusive(advancedFilters.date.to) : null;
  const generationModes = advancedFilters.generationModes && advancedFilters.generationModes.length > 0 ? new Set(advancedFilters.generationModes) : null;
  const mediaTypes = advancedFilters.mediaTypes && advancedFilters.mediaTypes.length > 0 ? new Set(advancedFilters.mediaTypes) : null;

  const shouldFilterSensitive =
    criteria.safeMode.enableSafeMode &&
    !criteria.safeMode.blurSensitiveImages &&
    sensitiveTags !== null;

  const results: SearchWorkerImage[] = [];

  // Facet collection variables
  const generatorsFacet = new Set<string>();
  const gpuDevicesFacet = new Set<string>();
  const dimensionsFacet = new Set<string>();
  const modelFacetCounts = new Map<string, number>();
  const loraFacetCounts = new Map<string, number>();
  const samplerFacetCounts = new Map<string, number>();
  const schedulerFacetCounts = new Map<string, number>();

  const folderPathCache = new Map<string, string>();

  for (let i = 0; i < workerImages.length; i++) {
    const image = workerImages[i];

    // --- PHASE 1: CHEAPEST CHECKS FIRST ---

    // 1. Basic Directory and Visibility check
    if (!visibleDirectoryIds.has(image.directoryId)) continue;

    // 2. Favorite Filter
    if (criteria.favoriteFilterMode === 'include' && !image.isFavorite) continue;
    if (criteria.favoriteFilterMode === 'exclude' && image.isFavorite) continue;

    // 3. Rating Filter
    if (selectedRatings !== null && (image.rating === null || !selectedRatings.has(image.rating))) continue;

    // 4. Parameter Filters (Sampler, Scheduler, Generator, GPU)
    if (selectedSamplers !== null && (!image.sampler || !selectedSamplers.has(image.sampler))) continue;
    if (excludedSamplers !== null && image.sampler && excludedSamplers.has(image.sampler)) continue;
    if (selectedSchedulers !== null && !selectedSchedulers.has(image.scheduler)) continue;
    if (excludedSchedulers !== null && excludedSchedulers.has(image.scheduler)) continue;
    if (selectedGenerators !== null && !selectedGenerators.has(image.generator)) continue;
    if (excludedGenerators !== null && excludedGenerators.has(image.generator)) continue;
    if (selectedGpuDevices !== null && (image.gpuDevice === null || !selectedGpuDevices.has(image.gpuDevice))) continue;
    if (excludedGpuDevices !== null && image.gpuDevice !== null && excludedGpuDevices.has(image.gpuDevice)) continue;

    // 5. Basic Metadata Filters
    if (filterDimension && image.dimensions.replace(/\s+/g, '') !== filterDimension) continue;
    if (dateFrom !== null && image.lastModified < dateFrom) continue;
    if (dateTo !== null && image.lastModified >= dateTo) continue;

    // --- PHASE 2: MEDIUM COST CHECKS ---

    const parentPath = directoryPathMap.get(image.directoryId);
    if (!parentPath) continue;

    // 6. Folder Filters (with caching)
    if (hasExcludedFolders || hasSelectedFolders) {
      const relativePath = image.relativePath;
      const lastSlash = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'));
      const folderKey = `${image.directoryId}:${lastSlash > 0 ? relativePath.slice(0, lastSlash) : ''}`;

      let folderPath = folderPathCache.get(folderKey);
      if (folderPath === undefined) {
        folderPath = getFolderPath(image, parentPath);
        folderPathCache.set(folderKey, folderPath);
      }

      if (hasExcludedFolders) {
        let isFolderExcluded = false;
        for (let j = 0; j < excludedFolders.length; j++) {
          const excludedFolder = excludedFolders[j];
          if (folderPath === excludedFolder || folderPath.startsWith(`${excludedFolder}/`)) {
            isFolderExcluded = true;
            break;
          }
        }
        if (isFolderExcluded) continue;
      }

      if (hasSelectedFolders) {
        let isMatch = false;
        for (let j = 0; j < selectedFolders.length; j++) {
          const selectedFolder = selectedFolders[j];
          if (folderPath === selectedFolder || (criteria.includeSubfolders && folderPath.startsWith(`${selectedFolder}/`))) {
            isMatch = true;
            break;
          }
        }
        if (!isMatch) continue;
      }
    }

    // 7. Sensitive Filter
    if (shouldFilterSensitive) {
      let hasSensitiveTag = false;
      for (let j = 0; j < image.tags.length; j++) {
        if (sensitiveTags!.has(image.tags[j])) {
          hasSensitiveTag = true;
          break;
        }
      }
      if (hasSensitiveTag) continue;
    }

    // 8. Tags Filter
    if (selectedTags !== null) {
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
    if (excludedTags !== null) {
      let hasExcludedTag = false;
      for (let j = 0; j < image.tags.length; j++) {
        if (excludedTags.has(image.tags[j])) {
          hasExcludedTag = true;
          break;
        }
      }
      if (hasExcludedTag) continue;
    }

    // 9. Auto-Tags Filter
    if (selectedAutoTags !== null) {
      let someAutoMatch = false;
      for (let j = 0; j < image.autoTags.length; j++) {
        if (selectedAutoTags.has(image.autoTags[j])) {
          someAutoMatch = true;
          break;
        }
      }
      if (!someAutoMatch) continue;
    }
    if (excludedAutoTags !== null) {
      let hasExcludedAutoTag = false;
      for (let j = 0; j < image.autoTags.length; j++) {
        if (excludedAutoTags.has(image.autoTags[j])) {
          hasExcludedAutoTag = true;
          break;
        }
      }
      if (hasExcludedAutoTag) continue;
    }

    // 10. Resource Filters (Models, Loras)
    if (selectedModels !== null) {
      let someModelMatch = false;
      for (let j = 0; j < image.models.length; j++) {
        if (selectedModels.has(image.models[j])) {
          someModelMatch = true;
          break;
        }
      }
      if (!someModelMatch) continue;
    }
    if (excludedModels !== null) {
      let hasExcludedModel = false;
      for (let j = 0; j < image.models.length; j++) {
        if (excludedModels.has(image.models[j])) {
          hasExcludedModel = true;
          break;
        }
      }
      if (hasExcludedModel) continue;
    }
    if (selectedLoras !== null) {
      let someLoraMatch = false;
      for (let j = 0; j < image.loraNames.length; j++) {
        if (selectedLoras.has(image.loraNames[j])) {
          someLoraMatch = true;
          break;
        }
      }
      if (!someLoraMatch) continue;
    }
    if (excludedLoras !== null) {
      let hasExcludedLora = false;
      for (let j = 0; j < image.loraNames.length; j++) {
        if (excludedLoras.has(image.loraNames[j])) {
          hasExcludedLora = true;
          break;
        }
      }
      if (hasExcludedLora) continue;
    }

    // --- PHASE 3: EXPENSIVE CHECKS ---

    // 11. Search Query
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

    // 12. Advanced Range and Telemetry Filters
    if (advancedFilters.steps && !numericRangeMatch(image.steps, advancedFilters.steps)) continue;
    if (advancedFilters.cfg && !numericRangeMatch(image.cfgScale, advancedFilters.cfg)) continue;

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

    // --- ALL FILTERS PASSED ---
    results.push(image);

    // Update Facets
    for (let j = 0; j < image.models.length; j++) {
      const model = image.models[j];
      modelFacetCounts.set(model, (modelFacetCounts.get(model) ?? 0) + 1);
    }
    for (let j = 0; j < image.loraNames.length; j++) {
      const lora = image.loraNames[j];
      loraFacetCounts.set(lora, (loraFacetCounts.get(lora) ?? 0) + 1);
    }
    if (image.sampler) {
      samplerFacetCounts.set(image.sampler, (samplerFacetCounts.get(image.sampler) ?? 0) + 1);
    }
    if (image.scheduler) {
      schedulerFacetCounts.set(image.scheduler, (schedulerFacetCounts.get(image.scheduler) ?? 0) + 1);
    }
    generatorsFacet.add(image.generator);
    if (image.gpuDevice) gpuDevicesFacet.add(image.gpuDevice);
    if (image.dimensions && image.dimensions !== '0x0') dimensionsFacet.add(image.dimensions);
  }

  // Final sorting
  if (criteria.sortOrder === 'random') {
    const randomHashes = new Map<string, number>();
    const seedStr = criteria.randomSeed.toString();
    for (let i = 0; i < results.length; i++) {
      const img = results[i];
      randomHashes.set(img.id, stringHash(img.id + seedStr));
    }
    results.sort((left, right) => compareRandom(left, right, randomHashes));
  } else {
    const comparator =
      criteria.sortOrder === 'asc' ? compareByNameAsc :
      criteria.sortOrder === 'desc' ? compareByNameDesc :
      criteria.sortOrder === 'date-asc' ? compareByDateAsc :
      criteria.sortOrder === 'date-desc' ? compareByDateDesc :
      compareById;
    results.sort(comparator);
  }

  return {
    filteredIds: results.map(img => img.id),
    facets: {
      availableModels: Array.from(modelFacetCounts.keys()).sort(caseInsensitiveSort),
      availableLoras: Array.from(loraFacetCounts.keys()).sort(caseInsensitiveSort),
      availableSamplers: Array.from(samplerFacetCounts.keys()).sort(caseInsensitiveSort),
      availableSchedulers: Array.from(schedulerFacetCounts.keys()).sort(caseInsensitiveSort),
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
