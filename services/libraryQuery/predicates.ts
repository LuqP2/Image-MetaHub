import type { AdvancedFilters } from '../../types';
import { parseLocalDateFilterEndExclusive, parseLocalDateFilterStart } from '../../utils/dateFilterUtils';
import type { LibraryQueryImage, LibraryWorkerCriteria } from './types';
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

const getFolderPath = (image: LibraryQueryImage, parentDirectory: string) => {
  const relativePath = image.relativePath;
  const lastSlash = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'));

  if (lastSlash <= 0) {
    return normalizePath(parentDirectory);
  }

  return joinPath(parentDirectory, relativePath.slice(0, lastSlash));
};


export function compileWorkerPredicate(criteria: LibraryWorkerCriteria): (image: LibraryQueryImage) => boolean {
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

  const folderPathCache = new Map<string, string>();
  return image => {
    // --- PHASE 1: CHEAPEST CHECKS FIRST ---

    // 1. Basic Directory and Visibility check
    if (!visibleDirectoryIds.has(image.directoryId)) return false;

    // 2. Favorite Filter
    if (criteria.favoriteFilterMode === 'include' && !image.isFavorite) return false;
    if (criteria.favoriteFilterMode === 'exclude' && image.isFavorite) return false;

    // 3. Rating Filter
    if (selectedRatings !== null && (image.rating === null || !selectedRatings.has(image.rating))) return false;

    // 4. Parameter Filters (Sampler, Scheduler, Generator, GPU)
    if (selectedSamplers !== null && (!image.sampler || !selectedSamplers.has(image.sampler))) return false;
    if (excludedSamplers !== null && image.sampler && excludedSamplers.has(image.sampler)) return false;
    if (selectedSchedulers !== null && !selectedSchedulers.has(image.scheduler)) return false;
    if (excludedSchedulers !== null && excludedSchedulers.has(image.scheduler)) return false;
    if (selectedGenerators !== null && !selectedGenerators.has(image.generator)) return false;
    if (excludedGenerators !== null && excludedGenerators.has(image.generator)) return false;
    if (selectedGpuDevices !== null && (image.gpuDevice === null || !selectedGpuDevices.has(image.gpuDevice))) return false;
    if (excludedGpuDevices !== null && image.gpuDevice !== null && excludedGpuDevices.has(image.gpuDevice)) return false;

    // 5. Basic Metadata Filters
    if (filterDimension && image.dimensions.replace(/\s+/g, '') !== filterDimension) return false;
    if (dateFrom !== null && image.lastModified < dateFrom) return false;
    if (dateTo !== null && image.lastModified >= dateTo) return false;

    // --- PHASE 2: MEDIUM COST CHECKS ---

    const parentPath = directoryPathMap.get(image.directoryId);
    if (!parentPath) return false;

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
        if (isFolderExcluded) return false;
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
        if (!isMatch) return false;
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
      if (hasSensitiveTag) return false;
    }

    // 8. Tags Filter
    if (selectedTags !== null) {
      if (image.tags.length === 0) return false;
      if (criteria.selectedTagsMatchMode === 'all') {
        let allMatch = true;
        for (const tag of selectedTags) {
          if (!image.tags.includes(tag)) {
            allMatch = false;
            break;
          }
        }
        if (!allMatch) return false;
      } else {
        let someMatch = false;
        for (let j = 0; j < image.tags.length; j++) {
          if (selectedTags.has(image.tags[j])) {
            someMatch = true;
            break;
          }
        }
        if (!someMatch) return false;
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
      if (hasExcludedTag) return false;
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
      if (!someAutoMatch) return false;
    }
    if (excludedAutoTags !== null) {
      let hasExcludedAutoTag = false;
      for (let j = 0; j < image.autoTags.length; j++) {
        if (excludedAutoTags.has(image.autoTags[j])) {
          hasExcludedAutoTag = true;
          break;
        }
      }
      if (hasExcludedAutoTag) return false;
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
      if (!someModelMatch) return false;
    }
    if (excludedModels !== null) {
      let hasExcludedModel = false;
      for (let j = 0; j < image.models.length; j++) {
        if (excludedModels.has(image.models[j])) {
          hasExcludedModel = true;
          break;
        }
      }
      if (hasExcludedModel) return false;
    }
    if (selectedLoras !== null) {
      let someLoraMatch = false;
      for (let j = 0; j < image.loraNames.length; j++) {
        if (selectedLoras.has(image.loraNames[j])) {
          someLoraMatch = true;
          break;
        }
      }
      if (!someLoraMatch) return false;
    }
    if (excludedLoras !== null) {
      let hasExcludedLora = false;
      for (let j = 0; j < image.loraNames.length; j++) {
        if (excludedLoras.has(image.loraNames[j])) {
          hasExcludedLora = true;
          break;
        }
      }
      if (hasExcludedLora) return false;
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
        if (!image.searchText) return false;
        let searchMatch = true;
        for (let j = 0; j < searchTerms.length; j++) {
          if (!image.searchText.includes(searchTerms[j])) {
            searchMatch = false;
            break;
          }
        }
        if (!searchMatch) return false;
      }
    }

    // 12. Advanced Range and Telemetry Filters
    if (advancedFilters.steps && !numericRangeMatch(image.steps, advancedFilters.steps)) return false;
    if (advancedFilters.cfg && !numericRangeMatch(image.cfgScale, advancedFilters.cfg)) return false;

    if (generationModes) {
      const type = image.generationType || (image.mediaType === 'image' ? 'txt2img' : null);
      if (!type || !generationModes.has(type as 'txt2img' | 'img2img')) return false;
    }
    if (mediaTypes && !mediaTypes.has(image.mediaType)) return false;

    if (advancedFilters.telemetryState === 'present' && !image.hasTelemetry) return false;
    if (advancedFilters.telemetryState === 'missing' && image.hasTelemetry) return false;
    if (advancedFilters.hasVerifiedTelemetry === true && !image.hasVerifiedTelemetry) return false;

    if (advancedFilters.generationTimeMs && !numericRangeMatch(image.generationTimeMs, advancedFilters.generationTimeMs)) return false;
    if (advancedFilters.stepsPerSecond && !numericRangeMatch(image.stepsPerSecond, advancedFilters.stepsPerSecond)) return false;
    if (advancedFilters.vramPeakMb && !numericRangeMatch(image.vramPeakMb, advancedFilters.vramPeakMb)) return false;

    return true;
  };
}
export function numericRangeMatch(
  value: number | null,
  range: NonNullable<AdvancedFilters['steps'] | AdvancedFilters['cfg'] | AdvancedFilters['generationTimeMs'] | AdvancedFilters['stepsPerSecond'] | AdvancedFilters['vramPeakMb']>
): boolean {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return false;
  }

  const hasMin = range.min !== null && range.min !== undefined;
  const hasMax = range.max !== null && range.max !== undefined;
  if (hasMin && value < range.min!) return false;
  if (hasMax && range.maxExclusive === true && value >= range.max!) return false;
  if (hasMax && range.maxExclusive !== true && value > range.max!) return false;
  return true;
}



export function compileLibraryPredicate(
  criteria: import('./types').LibraryQueryCriteria,
  context: import('./types').LibraryQueryExecutionContext,
): (image: LibraryQueryImage) => boolean {
  return compileWorkerPredicate({ ...criteria, ...context });
}
