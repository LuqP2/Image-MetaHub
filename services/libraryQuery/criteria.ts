import type { LibraryQueryCriteria } from './types';

/** Return detached criteria so editing a frame cannot change another query. */
export function normalizeLibraryQueryCriteria(input: Partial<LibraryQueryCriteria> = {}): LibraryQueryCriteria {
  return structuredClone({
    searchQuery: '', selectedModels: [], excludedModels: [], selectedLoras: [], excludedLoras: [],
    selectedSamplers: [], excludedSamplers: [], selectedSchedulers: [], excludedSchedulers: [],
    selectedGenerators: [], excludedGenerators: [], selectedGpuDevices: [], excludedGpuDevices: [],
    selectedTags: [], excludedTags: [], selectedAutoTags: [], excludedAutoTags: [], selectedTagsMatchMode: 'any',
    favoriteFilterMode: 'neutral', selectedRatings: [], advancedFilters: {}, sortOrder: 'date-desc', randomSeed: 42,
    selectedFolders: [], excludedFolders: [], includeSubfolders: true,
    ...input,
  });
}

export function createLibraryQueryKey(criteria: LibraryQueryCriteria): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
  };
  return JSON.stringify(canonical(normalizeLibraryQueryCriteria(criteria)));
}
