import type { AdvancedFilters, ImageRating, InclusionFilterMode, TagMatchMode } from '../../types';

export type LibraryQueryImage = {
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
  mediaType: 'image' | 'video' | 'audio' | 'model3d';
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

export type LibraryWorkerCriteria = {
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

export interface LibraryQueryResult {
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
}

/** Persistible query intent; visibility is supplied at execution time. */
export type LibraryQueryCriteria = Omit<LibraryWorkerCriteria, 'visibleDirectories' | 'safeMode'>;
export type LibraryQueryExecutionContext = Pick<LibraryWorkerCriteria, 'visibleDirectories' | 'safeMode'>;
export type LibraryQueryFacets = LibraryQueryResult['facets'];
