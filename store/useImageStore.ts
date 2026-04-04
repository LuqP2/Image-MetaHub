import { create } from 'zustand';
import { IndexedImage, Directory, ThumbnailStatus, ImageAnnotations, TagInfo, ImageCluster, TFIDFModel, AutoTag, IndexedImageTransferProgress, InclusionFilterMode, ImageRating, type AdvancedFilters, type FilterOptions, type SelectedFiltersUpdate } from '../types';
import { loadSelectedFolders, saveSelectedFolders, loadExcludedFolders, saveExcludedFolders } from '../services/folderSelectionStorage';
import {
  loadAllAnnotations,
  saveAnnotation,
  bulkSaveAnnotations,
  getAllTags,
  ensureManualTagExists,
  renameManualTag,
  deleteManualTag,
} from '../services/imageAnnotationsStorage';
import { normalizeFacetValue, sanitizeIndexedImageFacets } from '../utils/facetNormalization';
import { hasVerifiedTelemetry } from '../utils/telemetryDetection';
import { getImageGenerator, getImageGpuDevice, hasTelemetryData } from '../utils/analyticsUtils';
import { useLicenseStore } from './useLicenseStore';
import { useSettingsStore } from './useSettingsStore';
import { CLUSTERING_FREE_TIER_LIMIT, CLUSTERING_PREVIEW_LIMIT } from '../hooks/useFeatureAccess';
import {
    type LineageBuildState,
    type LineageDirectorySignature,
    type LineageRegistrySnapshot,
    type ResolvedLineageEntry,
    buildLineageLibrarySignature,
    createLineageDirectoryPathMap,
    toLightweightLineageImage,
} from '../services/lineageRegistry';
import { loadLineageRegistrySnapshot, saveLineageRegistrySnapshot } from '../services/lineageRegistryCache';

const RECENT_TAGS_STORAGE_KEY = 'image-metahub-recent-tags';
const MAX_RECENT_TAGS = 12;

type ThumbnailEntryState = {
    lastModified: number;
    thumbnailUrl?: string | null;
    thumbnailHandle?: FileSystemFileHandle | null;
    thumbnailStatus: ThumbnailStatus;
    thumbnailError?: string | null;
};

type DirectoryProgressState = {
    current: number;
    total: number;
};

const DEFAULT_LINEAGE_BUILD_STATE: LineageBuildState = {
    status: 'idle',
    processed: 0,
    total: 0,
    message: '',
    dirty: false,
    source: 'none',
    lastBuiltAt: null,
};

const markLineageBuildStateDirty = (state: LineageBuildState): LineageBuildState => ({
    ...state,
    dirty: true,
    status: state.status === 'building' ? 'building' : 'scheduled',
    message: state.status === 'building'
        ? state.message
        : 'Lineage registry needs refresh.',
});

const loadRecentTags = (): string[] => {
    if (typeof window === 'undefined') {
        return [];
    }

    try {
        const raw = localStorage.getItem(RECENT_TAGS_STORAGE_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .map(tag => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
            .filter(Boolean)
            .slice(0, MAX_RECENT_TAGS);
    } catch (error) {
        console.warn('Failed to load recent tags:', error);
        return [];
    }
};

const persistRecentTags = (tags: string[]) => {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        localStorage.setItem(RECENT_TAGS_STORAGE_KEY, JSON.stringify(tags));
    } catch (error) {
        console.warn('Failed to persist recent tags:', error);
    }
};

const updateRecentTags = (currentTags: string[], tag: string): string[] => {
    const normalizedTag = tag.trim().toLowerCase();
    if (!normalizedTag) {
        return currentTags;
    }

    const next = [normalizedTag, ...currentTags.filter(existing => existing !== normalizedTag)];
    return next.slice(0, MAX_RECENT_TAGS);
};

const removeRecentTag = (currentTags: string[], tag: string): string[] => {
    const normalizedTag = tag.trim().toLowerCase();
    if (!normalizedTag) {
        return currentTags;
    }

    return currentTags.filter(existing => existing !== normalizedTag);
};

const replaceRecentTag = (currentTags: string[], sourceTag: string, targetTag: string): string[] => {
    const normalizedSource = sourceTag.trim().toLowerCase();
    const normalizedTarget = targetTag.trim().toLowerCase();

    if (!normalizedSource || !normalizedTarget) {
        return currentTags;
    }

    const mapped = currentTags.map(tag => tag === normalizedSource ? normalizedTarget : tag);
    return Array.from(new Set(mapped));
};

const normalizeTagName = (tag: string) => tag.trim().toLowerCase();
const pendingMetadataTagImportMap = new Map<string, IndexedImage>();

const queueMetadataTagImports = (images: IndexedImage[]) => {
    for (const image of images) {
        if (image?.id) {
            pendingMetadataTagImportMap.set(image.id, image);
        }
    }
};

const drainPendingMetadataTagImports = (): IndexedImage[] => {
    const images = Array.from(pendingMetadataTagImportMap.values());
    pendingMetadataTagImportMap.clear();
    return images;
};

const buildAnnotationRecord = (
    imageId: string,
    currentAnnotation: ImageAnnotations | undefined,
    overrides: Partial<Pick<ImageAnnotations, 'isFavorite' | 'tags' | 'rating'>>,
): ImageAnnotations => {
    const hasFavoriteOverride = Object.prototype.hasOwnProperty.call(overrides, 'isFavorite');
    const hasTagsOverride = Object.prototype.hasOwnProperty.call(overrides, 'tags');
    const hasRatingOverride = Object.prototype.hasOwnProperty.call(overrides, 'rating');

    return {
        imageId,
        isFavorite: hasFavoriteOverride ? overrides.isFavorite ?? false : currentAnnotation?.isFavorite ?? false,
        tags: hasTagsOverride ? overrides.tags ?? [] : currentAnnotation?.tags ?? [],
        rating: hasRatingOverride ? overrides.rating : currentAnnotation?.rating,
        addedAt: currentAnnotation?.addedAt ?? Date.now(),
        updatedAt: Date.now(),
    };
};

type ManualTagFilterState = Pick<ImageState, 'selectedTags' | 'excludedTags'>;

const removeTagFromManualFilters = <T extends ManualTagFilterState>(state: T, tag: string): T => {
    const normalizedTag = normalizeTagName(tag);
    return {
        ...state,
        selectedTags: state.selectedTags.filter(existing => existing !== normalizedTag),
        excludedTags: state.excludedTags.filter(existing => existing !== normalizedTag),
    };
};

const transferManualTagFilters = <T extends ManualTagFilterState>(state: T, sourceTag: string, targetTag: string): T => {
    const normalizedSource = normalizeTagName(sourceTag);
    const normalizedTarget = normalizeTagName(targetTag);
    const sourceMode =
        state.selectedTags.includes(normalizedSource) ? 'include' :
        state.excludedTags.includes(normalizedSource) ? 'exclude' :
        'neutral';
    const targetAlreadyFiltered =
        state.selectedTags.includes(normalizedTarget) || state.excludedTags.includes(normalizedTarget);

    const nextState = removeTagFromManualFilters(state, normalizedSource);

    if (sourceMode === 'neutral' || targetAlreadyFiltered) {
        return nextState;
    }

    if (sourceMode === 'include') {
        return {
            ...nextState,
            selectedTags: [...nextState.selectedTags, normalizedTarget],
        };
    }

    return {
        ...nextState,
        excludedTags: [...nextState.excludedTags, normalizedTarget],
    };
};

const renameAnnotationTag = (tags: string[], sourceTag: string, targetTag: string): string[] => {
    const normalizedSource = normalizeTagName(sourceTag);
    const normalizedTarget = normalizeTagName(targetTag);
    if (!normalizedSource || !normalizedTarget) {
        return tags;
    }

    return Array.from(new Set(tags.map(tag => tag === normalizedSource ? normalizedTarget : tag)));
};

const normalizePath = (path: string) => {
    if (!path) return '';
    return path.replace(/\\/g, '/').replace(/[\\/]+$/, '');
};

const getImageFolderPath = (image: IndexedImage, directoryPath: string): string => {
    const normalizedDirectory = normalizePath(directoryPath);
    const idParts = image.id.split('::');
    if (idParts.length !== 2) {
        return normalizedDirectory;
    }

    const relativePath = idParts[1];
    const segments = relativePath.split(/[/\\]/).filter(Boolean);
    if (segments.length <= 1) {
        return normalizedDirectory;
    }

    const folderSegments = segments.slice(0, -1);
    const folderRelativePath = folderSegments.join('/');
    return joinPath(normalizedDirectory, folderRelativePath);
};

const joinPath = (base: string, relative: string) => {
    if (!relative) {
        return normalizePath(base);
    }
    const separator = '/';
    const normalizedBase = normalizePath(base);
    const normalizedRelative = relative
        .split(/[/\\]/)
        .filter(segment => segment.length > 0)
        .join(separator);
    if (!normalizedBase) {
        return normalizedRelative;
    }
    return `${normalizedBase}${separator}${normalizedRelative}`;
};

const getRelativeImagePath = (image: IndexedImage): string => {
    if (!image?.id) return image?.name ?? '';
    const [, relative = ''] = image.id.split('::');
    return relative || image.name;
};

const buildCatalogSearchText = (image: IndexedImage): string => {
    const relativePath = getRelativeImagePath(image).replace(/\\/g, '/').toLowerCase();
    const name = (image.name || '').toLowerCase();
    const directory = (image.directoryName || '').replace(/\\/g, '/').toLowerCase();
    return [name, relativePath, directory].filter(Boolean).join(' ');
};

const buildEnrichedSearchText = (image: IndexedImage): string => {
    if (image.enrichmentState !== 'enriched') {
        return '';
    }

    const segments: string[] = [];
    if (image.metadataString) {
        segments.push(String(image.metadataString).toLowerCase());
    }
    if (image.prompt) {
        segments.push(String(image.prompt).toLowerCase());
    }
    if (image.negativePrompt) {
        segments.push(String(image.negativePrompt).toLowerCase());
    }
    if (image.models?.length) {
        segments.push(
            image.models
                .map(model => normalizeFacetValue(model))
                .filter((model): model is string => Boolean(model))
                .map(model => model.toLowerCase())
                .join(' ')
        );
    }
    if (image.loras?.length) {
        const loraNames = image.loras.map(lora => {
            const normalized = normalizeFacetValue(lora);
            return normalized ? normalized.toLowerCase() : '';
        }).filter(Boolean);
        if (loraNames.length > 0) {
            segments.push(loraNames.join(' '));
        }
    }
    if (image.scheduler) {
        const normalized = normalizeFacetValue(image.scheduler);
        if (normalized) {
            segments.push(normalized.toLowerCase());
        }
    }
    if (image.board) {
        segments.push(String(image.board).toLowerCase());
    }

    return segments.join(' ');
};

interface ImageState {
  // Core Data
  images: IndexedImage[];
  filteredImages: IndexedImage[];
  lineageResolvedByImageId: Record<string, ResolvedLineageEntry>;
  lineageDerivedIdsBySourceId: Record<string, string[]>;
  lineageBuildState: LineageBuildState;
  lineageDirectorySignatures: Record<string, LineageDirectorySignature>;
  thumbnailEntries: Record<string, ThumbnailEntryState>;
  selectionTotalImages: number;
  selectionDirectoryCount: number;
  directories: Directory[];
  selectedFolders: Set<string>;
  excludedFolders: Set<string>;
  isFolderSelectionLoaded: boolean;
  includeSubfolders: boolean;

  // UI State
  isLoading: boolean;
  progress: { current: number; total: number } | null;
  directoryProgress: Record<string, DirectoryProgressState>;
  enrichmentProgress: { processed: number; total: number } | null;
  indexingState: 'idle' | 'indexing' | 'paused' | 'completed';
  error: string | null;
  success: string | null;
  transferProgress: IndexedImageTransferProgress | null;
  selectedImage: IndexedImage | null;
  selectedImages: Set<string>;
  activeImageScope: IndexedImage[] | null;
  previewImage: IndexedImage | null;
  focusedImageIndex: number | null;
  isStackingEnabled: boolean;
  scanSubfolders: boolean;
  viewingStackPrompt: string | null;  // For Back to Stacks navigation
  isFullscreenMode: boolean;

  // Comparison State
  comparisonImages: [IndexedImage | null, IndexedImage | null];
  isComparisonModalOpen: boolean;

  // Filter & Sort State
  searchQuery: string;
  availableModels: string[];
  availableLoras: string[];
  availableSamplers: string[];
  availableSchedulers: string[];
  availableGenerators: string[];
  availableGpuDevices: string[];
  availableDimensions: string[];
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
  sortOrder: 'asc' | 'desc' | 'date-asc' | 'date-desc' | 'random';
  randomSeed: number;
  advancedFilters: AdvancedFilters;

  // Annotations State
  annotations: Map<string, ImageAnnotations>;
  availableTags: TagInfo[];
  availableAutoTags: TagInfo[]; // Top auto-tags by frequency
  recentTags: string[];
  selectedTags: string[];
  excludedTags: string[];
  selectedAutoTags: string[]; // Filter by auto-tags
  excludedAutoTags: string[];
  favoriteFilterMode: InclusionFilterMode;
  selectedRatings: ImageRating[];
  isAnnotationsLoaded: boolean;
  activeWatchers: Set<string>; // IDs das pastas sendo monitoradas
  refreshingDirectories: Set<string>;

  // Smart Clustering State (Phase 2)
  clusters: ImageCluster[];
  clusteringProgress: { current: number; total: number; message: string } | null;
  clusteringWorker: Worker | null;
  isClustering: boolean;
  clusterNavigationContext: IndexedImage[] | null; // Images from currently opened cluster for modal navigation
  clusteringMetadata: {
    processedCount: number;
    remainingCount: number;
    isLimited: boolean;
    lockedImageIds: Set<string>; // IDs of images in the "preview locked" range
  } | null;

  // Auto-Tagging State (Phase 3)
  tfidfModel: TFIDFModel | null;
  autoTaggingProgress: { current: number; total: number; message: string } | null;
  autoTaggingWorker: Worker | null;
  isAutoTagging: boolean;
  lineageWorker: Worker | null;
  isLineageRebuildSuspended: boolean;

  // Actions
  addDirectory: (directory: Directory) => void;
  removeDirectory: (directoryId: string) => void;
  toggleDirectoryVisibility: (directoryId: string) => void;
  toggleAutoWatch: (directoryId: string) => void;
  initializeFolderSelection: () => Promise<void>;
  toggleFolderSelection: (path: string, ctrlKey: boolean) => void;
  clearFolderSelection: () => void;
  // Excluded Folders Actions
  addExcludedFolder: (path: string) => void;
  removeExcludedFolder: (path: string) => void;
  isFolderSelected: (path: string) => boolean;
  toggleIncludeSubfolders: () => void;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: { current: number; total: number } | null) => void;
  setDirectoryProgress: (directoryId: string, progress: DirectoryProgressState | null) => void;
  setEnrichmentProgress: (progress: { processed: number; total: number } | null) => void;
  setIndexingState: (indexingState: 'idle' | 'indexing' | 'paused' | 'completed') => void;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
  setTransferProgress: (progress: IndexedImageTransferProgress | null) => void;
  setImages: (images: IndexedImage[]) => void;
  addImages: (newImages: IndexedImage[]) => void;
  appendImagesSilently: (newImages: IndexedImage[]) => void;
  appendImagesRaw: (newImages: IndexedImage[]) => void;
  replaceDirectoryImages: (directoryId: string, newImages: IndexedImage[]) => void;
  replaceDirectoryImagesRaw: (directoryId: string, newImages: IndexedImage[]) => void;
  mergeImages: (updatedImages: IndexedImage[]) => void;
  removeImage: (imageId: string) => void;
  removeImages: (imageIds: string[]) => void;
  updateImage: (imageId: string, newName: string) => void;
  clearImages: (directoryId?: string) => void;
  setImageThumbnail: (
    imageId: string,
    data: {
      thumbnailUrl?: string | null;
      thumbnailHandle?: FileSystemFileHandle | null;
      status: ThumbnailStatus;
      error?: string | null;
    }
  ) => void;

  // Filter & Sort Actions
  setSearchQuery: (query: string) => void;
  setFilterOptions: (options: Pick<FilterOptions, 'models' | 'loras' | 'samplers' | 'schedulers' | 'generators' | 'gpuDevices' | 'dimensions'>) => void;
  setSelectedFilters: (filters: SelectedFiltersUpdate) => void;
  setSortOrder: (order: 'asc' | 'desc' | 'date-asc' | 'date-desc' | 'random') => void;
  reshuffle: () => void;
  setAdvancedFilters: (filters: AdvancedFilters) => void;
  filterAndSortImages: () => void;
  recomputeDerivedState: () => void;

  // Selection Actions
  setPreviewImage: (image: IndexedImage | null) => void;
  setSelectedImage: (image: IndexedImage | null) => void;
  setActiveImageScope: (images: IndexedImage[] | null) => void;
  toggleImageSelection: (imageId: string) => void;
  selectAllImages: () => void;
  clearImageSelection: () => void;
  deleteSelectedImages: () => Promise<void>; // This will require file operations logic
  setScanSubfolders: (scan: boolean) => void;
  setFocusedImageIndex: (index: number | null) => void;
  setViewingStackPrompt: (prompt: string | null) => void;
  setFullscreenMode: (isFullscreen: boolean) => void;

  // Clustering Actions (Phase 2)
  startClustering: (directoryPath: string, scanSubfolders: boolean, threshold: number) => Promise<void>;
  cancelClustering: () => void;
  setClusters: (clusters: ImageCluster[]) => void;
  setClusteringProgress: (progress: { current: number; total: number; message: string } | null) => void;
  handleClusterImageDeletion: (deletedImageIds: string[]) => void;
  setClusterNavigationContext: (images: IndexedImage[] | null) => void;

  // Auto-Tagging Actions (Phase 3)
  startAutoTagging: (
    directoryPath: string,
    scanSubfolders: boolean,
    options?: { topN?: number; minScore?: number }
  ) => Promise<void>;
  cancelAutoTagging: () => void;
  setAutoTaggingProgress: (progress: { current: number; total: number; message: string } | null) => void;

  // Comparison Actions
  setComparisonImages: (images: [IndexedImage | null, IndexedImage | null]) => void;
  addImageToComparison: (image: IndexedImage) => void;
  removeImageFromComparison: (index: 0 | 1) => void;
  swapComparisonImages: () => void;
  clearComparison: () => void;
  openComparisonModal: () => void;
  closeComparisonModal: () => void;

  // Annotations Actions
  loadAnnotations: () => Promise<void>;
  toggleFavorite: (imageId: string) => Promise<void>;
  bulkToggleFavorite: (imageIds: string[], isFavorite: boolean) => Promise<void>;
  addTagToImage: (imageId: string, tag: string) => Promise<void>;
  removeTagFromImage: (imageId: string, tag: string) => Promise<void>;
  removeAutoTagFromImage: (imageId: string, tag: string) => void;
  bulkAddTag: (imageIds: string[], tag: string) => Promise<void>;
  bulkRemoveTag: (imageIds: string[], tag: string) => Promise<void>;
  renameTag: (sourceTag: string, targetTag: string) => Promise<void>;
  clearTag: (tag: string) => Promise<void>;
  deleteTag: (tag: string) => Promise<void>;
  purgeTag: (tag: string) => Promise<void>;
  setSelectedTags: (tags: string[]) => void;
  setExcludedTags: (tags: string[]) => void;
  setSelectedAutoTags: (tags: string[]) => void;
  setExcludedAutoTags: (tags: string[]) => void;
  setFavoriteFilterMode: (mode: InclusionFilterMode) => void;
  setSelectedRatings: (ratings: ImageRating[]) => void;
  getImageAnnotations: (imageId: string) => ImageAnnotations | null;
  refreshAvailableTags: () => Promise<void>;
  refreshAvailableAutoTags: () => void;
  importMetadataTags: (images: IndexedImage[]) => Promise<void>;
  flushPendingImages: () => void;
  setDirectoryRefreshing: (directoryId: string, isRefreshing: boolean) => void;
  setImageRating: (imageId: string, rating: ImageRating | null) => Promise<void>;
  bulkSetImageRating: (imageIds: string[], rating: ImageRating | null) => Promise<void>;
  setLineageDirectorySignature: (directoryId: string, signature: LineageDirectorySignature | null) => void;
  setLineageRebuildSuspended: (suspended: boolean) => void;
  hydratePersistedLineageSnapshot: () => Promise<boolean>;
  scheduleLineageRebuild: (delayMs?: number) => void;
  getResolvedLineage: (imageId: string) => ResolvedLineageEntry | null;
  getDerivedImages: (imageId: string, limit?: number) => IndexedImage[];

  // Navigation Actions
  handleNavigateNext: () => void;
  handleNavigatePrevious: () => void;

  // Cleanup invalid images
  cleanupInvalidImages: () => void;
  setStackingEnabled: (enabled: boolean) => void;

  // Reset Actions
  resetState: () => void;
}

export const useImageStore = create<ImageState>((set, get) => {
    // --- Throttle map to prevent excessive setImageThumbnail calls ---
    const thumbnailUpdateTimestamps = new Map<string, { count: number; lastUpdate: number }>();
    const thumbnailUpdateInProgress = new Set<string>();
    const lastThumbnailState = new Map<string, {
        url: string | undefined;
        handle: FileSystemFileHandle | undefined;
        status: ThumbnailStatus;
        error: string | null | undefined;
    }>();
    let pendingImagesQueue: IndexedImage[] = [];
    let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_INTERVAL_MS = 100;
    const MAX_PENDING_IMAGES_PER_FLUSH = 1200;
    const FORCE_FLUSH_PENDING_IMAGES_THRESHOLD = 2400;
    let pendingMergeQueue: IndexedImage[] = [];
    let pendingMergeTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingFilterRecomputeTimer: ReturnType<typeof setTimeout> | null = null;
    const MERGE_FLUSH_INTERVAL_MS = 250;
    const MERGE_FLUSH_INTERVAL_INDEXING_MS = 3000;
    const MERGE_FLUSH_INTERVAL_INDEXING_LARGE_MS = 15000;
    const MERGE_FLUSH_LARGE_THRESHOLD = 8000;
    const FILTER_RECOMPUTE_INDEXING_MS = 5000;

    const clearPendingQueue = () => {
        pendingImagesQueue = [];
        if (pendingFlushTimer) {
            clearTimeout(pendingFlushTimer);
            pendingFlushTimer = null;
        }
        pendingMergeQueue = [];
        if (pendingMergeTimer) {
            clearTimeout(pendingMergeTimer);
            pendingMergeTimer = null;
        }
        if (pendingFilterRecomputeTimer) {
            clearTimeout(pendingFilterRecomputeTimer);
            pendingFilterRecomputeTimer = null;
        }
    };

    const flushPendingImages = (drainAll: boolean = false) => {
        if (pendingImagesQueue.length === 0) {
            return;
        }

        const imagesToAdd = drainAll
            ? pendingImagesQueue
            : pendingImagesQueue.slice(0, MAX_PENDING_IMAGES_PER_FLUSH);
        pendingImagesQueue = drainAll
            ? []
            : pendingImagesQueue.slice(imagesToAdd.length);
        if (pendingFlushTimer) {
            clearTimeout(pendingFlushTimer);
            pendingFlushTimer = null;
        }

        let addedImages: IndexedImage[] = [];
        set(state => {
            const deduped = new Map<string, IndexedImage>();
            for (const img of imagesToAdd) {
                if (img?.id && !deduped.has(img.id)) {
                    deduped.set(img.id, img);
                }
            }
            const queuedUnique = Array.from(deduped.values());
            const existingIds = new Set(state.images.map(img => img.id));
            const uniqueNewImages = queuedUnique.filter(img => !existingIds.has(img.id));
            if (uniqueNewImages.length === 0) {
                return state;
            }
            addedImages = uniqueNewImages;
            const allImages = [...state.images, ...uniqueNewImages];
            return _updateState(state, allImages);
        });

        // Import tags from metadata only after annotations are available.
        if (addedImages.length > 0) {
            if (get().isAnnotationsLoaded) {
                void get().importMetadataTags(addedImages);
            } else {
                queueMetadataTagImports(addedImages);
            }
            maybeQueueLineageBuild(700);
        }

        if (pendingImagesQueue.length > 0) {
            scheduleFlush();
        }
    };

    const scheduleFlush = () => {
        if (pendingFlushTimer) {
            return;
        }
        pendingFlushTimer = setTimeout(() => {
            flushPendingImages();
        }, FLUSH_INTERVAL_MS);
    };

    const flushPendingMerges = (forceFullRecompute: boolean = false) => {
        if (pendingMergeQueue.length === 0) {
            return;
        }

        const updatesToMerge = pendingMergeQueue;
        pendingMergeQueue = [];
        if (pendingMergeTimer) {
            clearTimeout(pendingMergeTimer);
            pendingMergeTimer = null;
        }

        set(state => {
            const updates = new Map<string, IndexedImage>();
            for (const img of updatesToMerge) {
                if (img?.id) {
                    updates.set(img.id, img);
                }
            }
            if (updates.size === 0) {
                return state;
            }

            let hasChanges = false;
            const merged = state.images.map(img => {
                const updated = updates.get(img.id);
                if (updated) {
                    hasChanges = true;
                    return updated;
                }
                return img;
            });

            if (!hasChanges) {
                return state;
            }

            const isIndexing = state.indexingState === 'indexing';
            if (isIndexing && !forceFullRecompute) {
                const filtersActive = isFilteringActive(state);
                let nextFilteredImages = state.filteredImages;
                let availableFiltersUpdate: Partial<ImageState> = {};

                if (!filtersActive) {
                    nextFilteredImages = merged;
                    const models = new Set(state.availableModels);
                    const loras = new Set(state.availableLoras);
                    const samplers = new Set(state.availableSamplers);
                    const schedulers = new Set(state.availableSchedulers);
                    const generators = new Set(state.availableGenerators);
                    const gpuDevices = new Set(state.availableGpuDevices);
                    const dimensions = new Set(state.availableDimensions);

                    for (const img of updates.values()) {
                        img.models?.forEach(model => { if (typeof model === 'string' && model) models.add(model); });
                        img.loras?.forEach(lora => {
                            if (typeof lora === 'string' && lora) {
                                loras.add(lora);
                            } else if (lora && typeof lora === 'object' && lora.name) {
                                loras.add(lora.name);
                            }
                        });
                        if (img.sampler) {
                            samplers.add(img.sampler);
                        }
                        if (img.scheduler) {
                            schedulers.add(img.scheduler);
                        }
                        generators.add(getImageGenerator(img));
                        const gpuDevice = getImageGpuDevice(img);
                        if (gpuDevice) {
                            gpuDevices.add(gpuDevice);
                        }
                        if (img.dimensions) {
                            dimensions.add(img.dimensions);
                        }
                    }

                    availableFiltersUpdate = {
                        availableModels: Array.from(models),
                        availableLoras: Array.from(loras),
                        availableSamplers: Array.from(samplers),
                        availableSchedulers: Array.from(schedulers),
                        availableGenerators: Array.from(generators),
                        availableGpuDevices: Array.from(gpuDevices),
                        availableDimensions: Array.from(dimensions),
                    };
                } else {
                    nextFilteredImages = state.filteredImages.map(img => updates.get(img.id) ?? img);
                    scheduleFilterRecompute();
                }

                return {
                    ...state,
                    images: merged,
                    filteredImages: nextFilteredImages,
                    selectionTotalImages: merged.length,
                    selectionDirectoryCount: state.directories.length,
                    lineageBuildState: markLineageBuildStateDirty(state.lineageBuildState),
                    ...availableFiltersUpdate,
                };
            }

            return _updateState(state, merged);
        });

        maybeQueueLineageBuild(700);
    };

    const scheduleMergeFlush = () => {
        if (pendingMergeTimer) {
            return;
        }
        const isIndexing = get().indexingState === 'indexing';
        const interval = isIndexing
            ? (get().images.length >= MERGE_FLUSH_LARGE_THRESHOLD
                ? MERGE_FLUSH_INTERVAL_INDEXING_LARGE_MS
                : MERGE_FLUSH_INTERVAL_INDEXING_MS)
            : MERGE_FLUSH_INTERVAL_MS;
        pendingMergeTimer = setTimeout(() => {
            flushPendingMerges();
        }, interval);
    };

    const isFilteringActive = (state: ImageState) => {
        if (state.searchQuery) return true;
        if (state.favoriteFilterMode !== 'neutral') return true;
        if (state.selectedRatings?.length) return true;
        if (state.selectedTags?.length) return true;
        if (state.excludedTags?.length) return true;
        if (state.selectedAutoTags?.length) return true;
        if (state.excludedAutoTags?.length) return true;
        if (state.selectedModels?.length || state.excludedModels?.length) return true;
        if (state.selectedLoras?.length || state.excludedLoras?.length) return true;
        if (state.selectedSamplers?.length || state.excludedSamplers?.length) return true;
        if (state.selectedSchedulers?.length || state.excludedSchedulers?.length) return true;
        if (state.selectedGenerators?.length || state.excludedGenerators?.length) return true;
        if (state.selectedGpuDevices?.length || state.excludedGpuDevices?.length) return true;
        if (state.advancedFilters && Object.keys(state.advancedFilters).length > 0) return true;
        if (state.selectedFolders && state.selectedFolders.size > 0) return true;
        if (state.directories.some(dir => dir.visible === false)) return true;
        return false;
    };

    const scheduleFilterRecompute = () => {
        if (pendingFilterRecomputeTimer) {
            return;
        }
        pendingFilterRecomputeTimer = setTimeout(() => {
            pendingFilterRecomputeTimer = null;
            set(state => {
                const filteredResult = filterAndSort(state);
                const availableFilters = recalculateAvailableFilters(filteredResult.filteredImages);
                return { ...state, ...filteredResult, ...availableFilters };
            });
        }, FILTER_RECOMPUTE_INDEXING_MS);
    };

    const getImageById = (state: ImageState, imageId: string): IndexedImage | undefined => {
        return state.images.find(img => img.id === imageId) || state.filteredImages.find(img => img.id === imageId);
    };

    let lineageBuildTimer: ReturnType<typeof setTimeout> | null = null;

    const clearLineageBuildTimer = () => {
        if (lineageBuildTimer) {
            clearTimeout(lineageBuildTimer);
            lineageBuildTimer = null;
        }
    };

    const getCurrentLineageLibrarySignature = (state: ImageState): string | null => {
        if (state.directories.length === 0) {
            return null;
        }

        const signatures = state.directories
            .map(directory => state.lineageDirectorySignatures[directory.id])
            .filter((signature): signature is LineageDirectorySignature => Boolean(signature));

        if (signatures.length !== state.directories.length) {
            return null;
        }

        return buildLineageLibrarySignature(signatures, state.scanSubfolders);
    };

    const persistLineageSnapshot = async (
        snapshot: LineageRegistrySnapshot,
        state: ImageState
    ): Promise<void> => {
        const directoryPaths = state.directories.map(directory => directory.path);
        if (!snapshot.librarySignature || directoryPaths.length === 0) {
            return;
        }

        await saveLineageRegistrySnapshot(directoryPaths, state.scanSubfolders, snapshot);
    };

    const scheduleLineageBuildInternal = (delayMs: number = 600) => {
        if (typeof Worker === 'undefined') {
            return;
        }

        const state = get();
        if (!state.lineageBuildState.dirty || state.isLineageRebuildSuspended) {
            return;
        }

        if (state.indexingState === 'indexing' || state.indexingState === 'paused') {
            return;
        }

        clearLineageBuildTimer();
        lineageBuildTimer = setTimeout(() => {
            lineageBuildTimer = null;
            void startLineageBuildInternal();
        }, delayMs);

        set(currentState => ({
            lineageBuildState: {
                ...currentState.lineageBuildState,
                status: 'scheduled',
                message: currentState.lineageBuildState.message || 'Lineage registry queued.',
            },
        }));
    };

    const maybeQueueLineageBuild = (delayMs: number = 600) => {
        const state = get();
        if (!state.lineageBuildState.dirty || state.isLineageRebuildSuspended) {
            return;
        }

        if (state.indexingState === 'indexing' || state.indexingState === 'paused') {
            return;
        }

        scheduleLineageBuildInternal(delayMs);
    };

    const startLineageBuildInternal = async () => {
        clearLineageBuildTimer();

        const state = get();
        if (state.isLineageRebuildSuspended || (state.indexingState === 'indexing' || state.indexingState === 'paused')) {
            return;
        }

        if (!state.lineageBuildState.dirty && state.lineageBuildState.status === 'ready') {
            return;
        }

        if (state.images.length === 0) {
            state.lineageWorker?.terminate();
            set({
                lineageWorker: null,
                lineageResolvedByImageId: {},
                lineageDerivedIdsBySourceId: {},
                lineageBuildState: { ...DEFAULT_LINEAGE_BUILD_STATE },
            });
            return;
        }

        if (typeof Worker === 'undefined') {
            set(currentState => ({
                lineageBuildState: {
                    ...currentState.lineageBuildState,
                    status: 'scheduled',
                    message: 'Lineage registry scheduled.',
                    dirty: true,
                },
            }));
            return;
        }

        const existingWorker = state.lineageWorker;
        if (existingWorker) {
            existingWorker.terminate();
        }

        const directoryPathMap = createLineageDirectoryPathMap(state.directories);
        const lightweightImages = state.images.map(image => toLightweightLineageImage(image, directoryPathMap));
        const librarySignature = getCurrentLineageLibrarySignature(state) || '';
        const worker = new Worker(
            new URL('../services/workers/lineageWorker.ts', import.meta.url),
            { type: 'module' }
        );

        set(currentState => ({
            lineageWorker: worker,
            lineageBuildState: {
                ...currentState.lineageBuildState,
                status: 'building',
                processed: 0,
                total: Math.max(lightweightImages.length * 2, 1),
                message: 'Building lineage registry...',
                dirty: true,
                source: 'worker',
            },
        }));

        worker.onmessage = (event: MessageEvent) => {
            const { type, payload } = event.data;

            switch (type) {
                case 'progress':
                    set(currentState => ({
                        lineageBuildState: {
                            ...currentState.lineageBuildState,
                            status: 'building',
                            processed: payload.current,
                            total: payload.total,
                            message: payload.message,
                            source: 'worker',
                        },
                    }));
                    break;

                case 'complete':
                    worker.terminate();
                    set(currentState => ({
                        lineageWorker: null,
                        lineageResolvedByImageId: payload.snapshot.resolvedByImageId,
                        lineageDerivedIdsBySourceId: payload.snapshot.derivedIdsBySourceId,
                        lineageBuildState: {
                            status: 'ready',
                            processed: payload.snapshot.imageCount,
                            total: payload.snapshot.imageCount,
                            message: 'Lineage registry ready.',
                            dirty: false,
                            source: 'worker',
                            lastBuiltAt: payload.snapshot.builtAt,
                        },
                    }));

                    void persistLineageSnapshot(payload.snapshot, get());
                    break;

                case 'error':
                    worker.terminate();
                    console.error('Lineage build failed:', payload.error);
                    set(currentState => ({
                        lineageWorker: null,
                        lineageBuildState: {
                            ...currentState.lineageBuildState,
                            status: 'error',
                            message: `Lineage build failed: ${payload.error}`,
                            source: 'worker',
                            dirty: true,
                        },
                    }));
                    break;
            }
        };

        worker.postMessage({
            type: 'build',
            payload: {
                images: lightweightImages,
                librarySignature,
            },
        });
    };

    // --- Helper function to recalculate available filters from visible images ---
    const recalculateAvailableFilters = (visibleImages: IndexedImage[]) => {
        const models = new Set<string>();
        const loras = new Set<string>();
        const samplers = new Set<string>();
        const schedulers = new Set<string>();
        const generators = new Set<string>();
        const gpuDevices = new Set<string>();
        const dimensions = new Set<string>();

        for (const image of visibleImages) {
            image.models?.forEach(model => {
                const normalized = normalizeFacetValue(model);
                if (normalized) {
                    models.add(normalized);
                }
            });
            image.loras?.forEach(lora => {
                const normalized = normalizeFacetValue(lora);
                if (normalized) {
                    loras.add(normalized);
                }
            });
            const sampler = normalizeFacetValue(image.sampler);
            if (sampler) samplers.add(sampler);
            const scheduler = normalizeFacetValue(image.scheduler);
            if (scheduler) schedulers.add(scheduler);
            generators.add(getImageGenerator(image));
            const gpuDevice = getImageGpuDevice(image);
            if (gpuDevice) gpuDevices.add(gpuDevice);
            const dimension = normalizeFacetValue(image.dimensions);
            if (dimension && dimension !== '0x0') dimensions.add(dimension);
        }

        // Case-insensitive alphabetical comparator
        const caseInsensitiveSort = (a: string, b: string) => {
            return a.localeCompare(b, undefined, { sensitivity: 'accent' });
        };

        return {
            availableModels: Array.from(models).sort(caseInsensitiveSort),
            availableLoras: Array.from(loras).sort(caseInsensitiveSort),
            availableSamplers: Array.from(samplers).sort(caseInsensitiveSort),
            availableSchedulers: Array.from(schedulers).sort(caseInsensitiveSort),
            availableGenerators: Array.from(generators).sort(caseInsensitiveSort),
            availableGpuDevices: Array.from(gpuDevices).sort(caseInsensitiveSort),
            availableDimensions: Array.from(dimensions).sort((a, b) => {
                // Sort dimensions by total pixels (width * height)
                const [aWidth, aHeight] = a.split('x').map(Number);
                const [bWidth, bHeight] = b.split('x').map(Number);
                return (aWidth * aHeight) - (bWidth * bHeight);
            }),
        };
    };

    // --- Helper function to apply annotations to images ---
    const applyAnnotationsToImages = (images: IndexedImage[], annotations: Map<string, ImageAnnotations>): IndexedImage[] => {
        let hasChanges = false;
        const result = images.map(img => {
            const annotation = annotations.get(img.id);
            if (annotation) {
                // Check if annotation values are different from current image values
                const isFavoriteChanged = img.isFavorite !== annotation.isFavorite;
                const tagsChanged = JSON.stringify(img.tags || []) !== JSON.stringify(annotation.tags);
                const ratingChanged = img.rating !== annotation.rating;

                if (isFavoriteChanged || tagsChanged || ratingChanged) {
                    hasChanges = true;
                    return {
                        ...img,
                        isFavorite: annotation.isFavorite,
                        tags: annotation.tags,
                        rating: annotation.rating,
                    };
                }
            }
            return img;
        });

        // Only return new array if there were actual changes
        return hasChanges ? result : images;
    };

    // --- Helper function for recalculating all derived state ---
    const _updateState = (currentState: ImageState, newImages: IndexedImage[]) => {
        const sanitizedImages = newImages.map(sanitizeIndexedImageFacets);

        // Apply annotations to new images
        const imagesWithAnnotations = applyAnnotationsToImages(sanitizedImages, currentState.annotations);

        // Early return if images didn't change (prevents unnecessary recalculations)
        if (imagesWithAnnotations === currentState.images) {
            return currentState;
        }

        const newState: Partial<ImageState> = {
            images: imagesWithAnnotations,
        };

        const combinedState = { ...currentState, ...newState };

        // First, get filtered images based on folder selection
        const filteredResult = filterAndSort(combinedState);

        // Then, recalculate available filters based on the filtered images (after folder selection)
        const availableFilters = recalculateAvailableFilters(filteredResult.filteredImages);

        return {
            ...combinedState,
            ...filteredResult,
            ...availableFilters,
            ...(imagesWithAnnotations.length === 0
                ? {
                    lineageResolvedByImageId: {},
                    lineageDerivedIdsBySourceId: {},
                    lineageBuildState: { ...DEFAULT_LINEAGE_BUILD_STATE },
                }
                : {
                    lineageBuildState: markLineageBuildStateDirty(combinedState.lineageBuildState),
                }),
        };
    };

    // --- Helper function for basic filtering and sorting ---
    const filterAndSort = (state: ImageState) => {
        const {
            images,
            searchQuery,
            selectedModels,
            selectedLoras,
            selectedSamplers,
            selectedSchedulers,
            selectedGenerators,
            selectedGpuDevices,
            sortOrder,
            advancedFilters,
            directories,
            selectedFolders,
            excludedFolders,
            includeSubfolders,
        } = state;

        const visibleDirectoryIds = new Set(
            directories.filter(dir => dir.visible ?? true).map(dir => dir.id)
        );

        const directoryPathMap = new Map<string, string>();
        directories.forEach(dir => {
            const normalized = normalizePath(dir.path);
            directoryPathMap.set(dir.id, normalized);
        });

        // Filter images based on folder selection and exclusion
        const selectionFiltered = images.filter((img) => {
            if (!visibleDirectoryIds.has(img.directoryId || '')) {
                return false;
            }

            const parentPath = directoryPathMap.get(img.directoryId || '');
            if (!parentPath) {
                return false;
            }

            const folderPath = normalizePath(getImageFolderPath(img, parentPath));

            // EXCLUSION CHECK: If folder is excluded, hide image
            if (excludedFolders && excludedFolders.size > 0) {
                for (const excludedFolder of excludedFolders) {
                    const normalizedExcluded = normalizePath(excludedFolder);
                    // Check if folderPath IS the excluded folder or IS A CHILD of the excluded folder
                    if (folderPath === normalizedExcluded ||
                        folderPath.startsWith(normalizedExcluded + '/') ||
                        folderPath.startsWith(normalizedExcluded + '\\')) {
                        return false;
                    }
                }
            }

            // If no folders are selected, show all images from visible directories (unless excluded)
            if (selectedFolders.size === 0) {
                return true;
            }

            // Direct matching - check if folder is explicitly selected
            if (selectedFolders.has(folderPath)) {
                return true;
            }

            // If includeSubfolders is enabled, check if any parent folder is selected
            if (includeSubfolders) {
                for (const selectedFolder of selectedFolders) {
                    const normalizedSelected = normalizePath(selectedFolder);
                    // Check if folderPath is a subfolder of selectedFolder
                    if (folderPath.startsWith(normalizedSelected + '/') || folderPath.startsWith(normalizedSelected + '\\')) {
                        return true;
                    }
                }
            }

            return false;
        });

        let results = selectionFiltered;

        // Step 2: Favorites filter
        if (state.favoriteFilterMode === 'include') {
            results = results.filter(img => img.isFavorite === true);
        } else if (state.favoriteFilterMode === 'exclude') {
            results = results.filter(img => img.isFavorite !== true);
        }

        if (state.selectedRatings && state.selectedRatings.length > 0) {
            const selectedRatings = new Set(state.selectedRatings);
            results = results.filter(img => img.rating !== undefined && selectedRatings.has(img.rating));
        }

        // Step 3: Sensitive tags filter (safe mode)
        const { sensitiveTags, blurSensitiveImages, enableSafeMode } = useSettingsStore.getState();
        const normalizedSensitiveTags = (sensitiveTags ?? [])
            .map(tag => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
            .filter(Boolean);
        const sensitiveTagSet = new Set(normalizedSensitiveTags);
        const shouldFilterSensitive = enableSafeMode && !blurSensitiveImages && sensitiveTagSet.size > 0;
        if (shouldFilterSensitive) {
            results = results.filter(img => {
                if (!img.tags || img.tags.length === 0) return true;
                return !img.tags.some(tag => sensitiveTagSet.has(tag.toLowerCase()));
            });
        }

        // Step 4: Tags filter
        if (state.selectedTags && state.selectedTags.length > 0) {
            results = results.filter(img => {
                if (!img.tags || img.tags.length === 0) return false;
                // Match ANY selected tag (OR logic)
                return state.selectedTags.some(tag => img.tags!.includes(tag));
            });
        }

        if (state.excludedTags && state.excludedTags.length > 0) {
            results = results.filter(img => {
                if (!img.tags || img.tags.length === 0) return true;
                return !state.excludedTags.some(tag => img.tags!.includes(tag));
            });
        }

        // Step 5: Auto-tags filter
        if (state.selectedAutoTags && state.selectedAutoTags.length > 0) {
            results = results.filter(img => {
                if (!img.autoTags || img.autoTags.length === 0) return false;
                // Match ANY selected auto-tag (OR logic)
                return state.selectedAutoTags.some(tag => img.autoTags!.includes(tag));
            });
        }

        if (state.excludedAutoTags && state.excludedAutoTags.length > 0) {
            results = results.filter(img => {
                if (!img.autoTags || img.autoTags.length === 0) return true;
                return !state.excludedAutoTags.some(tag => img.autoTags!.includes(tag));
            });
        }

        if (searchQuery) {
            const searchTerms = searchQuery
                .toLowerCase()
                .split(/\s+/)
                .filter(Boolean);

            if (searchTerms.length > 0) {
                results = results.filter(image => {
                    const catalogText = buildCatalogSearchText(image);
                    const catalogMatch = searchTerms.every(term => catalogText.includes(term));
                    if (catalogMatch) {
                        return true;
                    }

                    const enrichedText = buildEnrichedSearchText(image);
                    if (!enrichedText) {
                        return false;
                    }

                    return searchTerms.every(term => enrichedText.includes(term));
                });
            }
        }

        if (selectedModels.length > 0) {
            results = results.filter(image =>
                image.models?.length > 0 && selectedModels.some(sm => image.models.includes(sm))
            );
        }

        if (state.excludedModels.length > 0) {
            results = results.filter(image =>
                !image.models?.length || !state.excludedModels.some(sm => image.models.includes(sm))
            );
        }

        if (selectedLoras.length > 0) {
            results = results.filter(image => {
                if (!image.loras || image.loras.length === 0) return false;

                // Extract LoRA names from both strings and LoRAInfo objects
                const loraNames = image.loras.map(lora =>
                    typeof lora === 'string' ? lora : (lora?.name || '')
                ).filter(Boolean);

                return selectedLoras.some(sl => loraNames.includes(sl));
            });
        }

        if (state.excludedLoras.length > 0) {
            results = results.filter(image => {
                if (!image.loras || image.loras.length === 0) return true;

                const loraNames = image.loras.map(lora =>
                    typeof lora === 'string' ? lora : (lora?.name || '')
                ).filter(Boolean);

                return !state.excludedLoras.some(sl => loraNames.includes(sl));
            });
        }

        if (selectedSamplers.length > 0) {
            results = results.filter(image =>
                Boolean(image.sampler) && selectedSamplers.includes(image.sampler)
            );
        }

        if (state.excludedSamplers.length > 0) {
            results = results.filter(image =>
                !image.sampler || !state.excludedSamplers.includes(image.sampler)
            );
        }

        if (selectedSchedulers.length > 0) {
            results = results.filter(image =>
                selectedSchedulers.includes(image.scheduler)
            );
        }

        if (state.excludedSchedulers.length > 0) {
            results = results.filter(image =>
                !state.excludedSchedulers.includes(image.scheduler)
            );
        }

        if (selectedGenerators.length > 0) {
            results = results.filter(image =>
                selectedGenerators.includes(getImageGenerator(image))
            );
        }

        if (state.excludedGenerators.length > 0) {
            results = results.filter(image =>
                !state.excludedGenerators.includes(getImageGenerator(image))
            );
        }

        if (selectedGpuDevices.length > 0) {
            results = results.filter(image => {
                const gpuDevice = getImageGpuDevice(image);
                return gpuDevice !== null && selectedGpuDevices.includes(gpuDevice);
            });
        }

        if (state.excludedGpuDevices.length > 0) {
            results = results.filter(image => {
                const gpuDevice = getImageGpuDevice(image);
                return gpuDevice === null || !state.excludedGpuDevices.includes(gpuDevice);
            });
        }

        if (advancedFilters) {
            if (advancedFilters.dimension) {
                results = results.filter(image => {
                    if (!image.dimensions) return false;
                    // Normalize dimensions format (handle both "512x512" and "512 x 512")
                    const imageDim = image.dimensions.replace(/\s+/g, '');
                    const filterDim = advancedFilters.dimension.replace(/\s+/g, '');
                    return imageDim === filterDim;
                });
            }
            if (advancedFilters.steps) {
                 results = results.filter(image => {
                    const steps = image.steps;
                    if (steps !== null && steps !== undefined) {
                        const hasMin = advancedFilters.steps.min !== null && advancedFilters.steps.min !== undefined;
                        const hasMax = advancedFilters.steps.max !== null && advancedFilters.steps.max !== undefined;
                        if (hasMin && steps < advancedFilters.steps.min) return false;
                        if (hasMax && steps > advancedFilters.steps.max) return false;
                        return true;
                    }
                    return false;
                });
            }
            if (advancedFilters.cfg) {
                 results = results.filter(image => {
                    const cfg = image.cfgScale;
                    if (cfg !== null && cfg !== undefined) {
                        const hasMin = advancedFilters.cfg.min !== null && advancedFilters.cfg.min !== undefined;
                        const hasMax = advancedFilters.cfg.max !== null && advancedFilters.cfg.max !== undefined;
                        if (hasMin && cfg < advancedFilters.cfg.min) return false;
                        if (hasMax && cfg > advancedFilters.cfg.max) return false;
                        return true;
                    }
                    return false;
                });
            }
            if (advancedFilters.date && (advancedFilters.date.from || advancedFilters.date.to)) {
                results = results.filter(image => {
                    const imageTime = image.lastModified;
                    
                    // Check "from" date if provided
                    if (advancedFilters.date!.from) {
                        const fromTime = new Date(advancedFilters.date!.from).getTime();
                        if (imageTime < fromTime) return false;
                    }
                    
                    // Check "to" date if provided
                    if (advancedFilters.date!.to) {
                        const toDate = new Date(advancedFilters.date!.to);
                        toDate.setDate(toDate.getDate() + 1); // Include full end date
                        const toTime = toDate.getTime();
                        if (imageTime >= toTime) return false;
                    }
                    
                    return true;
                });
            }
            if (Array.isArray(advancedFilters.generationModes) && advancedFilters.generationModes.length > 0) {
                results = results.filter(image => {
                    const normalizedMetadata = image.metadata?.normalizedMetadata;
                    const explicitGenerationType = normalizedMetadata?.generationType;
                    if (typeof explicitGenerationType === 'string') {
                        return advancedFilters.generationModes.includes(explicitGenerationType);
                    }

                    const isVideo =
                        normalizedMetadata?.media_type === 'video' ||
                        (image.fileType ?? '').startsWith('video/');

                    return !isVideo && advancedFilters.generationModes.includes('txt2img');
                });
            }
            if (Array.isArray(advancedFilters.mediaTypes) && advancedFilters.mediaTypes.length > 0) {
                results = results.filter(image => {
                    const metadataMediaType = image.metadata?.normalizedMetadata?.media_type;
                    const fileType = image.fileType ?? '';
                    const resolvedMediaType =
                        metadataMediaType === 'video' || fileType.startsWith('video/')
                            ? 'video'
                            : 'image';
                    return advancedFilters.mediaTypes.includes(resolvedMediaType);
                });
            }
            if (advancedFilters.telemetryState === 'present') {
                results = results.filter(image => hasTelemetryData(image));
            }
            if (advancedFilters.telemetryState === 'missing') {
                results = results.filter(image => !hasTelemetryData(image));
            }
            if (advancedFilters.hasVerifiedTelemetry === true) {
                results = results.filter(image => hasVerifiedTelemetry(image));
            }
            if (advancedFilters.generationTimeMs) {
                 results = results.filter(image => {
                    const generationTimeMs =
                        image.metadata?.normalizedMetadata?.analytics?.generation_time_ms ??
                        (image.metadata?.normalizedMetadata as { _analytics?: { generation_time_ms?: number } } | undefined)?._analytics?.generation_time_ms;
                    if (typeof generationTimeMs === 'number') {
                        const hasMin = advancedFilters.generationTimeMs?.min !== null && advancedFilters.generationTimeMs?.min !== undefined;
                        const hasMax = advancedFilters.generationTimeMs?.max !== null && advancedFilters.generationTimeMs?.max !== undefined;
                        if (hasMin && generationTimeMs < advancedFilters.generationTimeMs!.min!) return false;
                        if (hasMax && advancedFilters.generationTimeMs?.maxExclusive === true && generationTimeMs >= advancedFilters.generationTimeMs!.max!) return false;
                        if (hasMax && advancedFilters.generationTimeMs?.maxExclusive !== true && generationTimeMs > advancedFilters.generationTimeMs!.max!) return false;
                        return true;
                    }
                    return false;
                });
            }
            if (advancedFilters.stepsPerSecond) {
                 results = results.filter(image => {
                    const stepsPerSecond =
                        image.metadata?.normalizedMetadata?.analytics?.steps_per_second ??
                        (image.metadata?.normalizedMetadata as { _analytics?: { steps_per_second?: number } } | undefined)?._analytics?.steps_per_second;
                    if (typeof stepsPerSecond === 'number') {
                        const hasMin = advancedFilters.stepsPerSecond?.min !== null && advancedFilters.stepsPerSecond?.min !== undefined;
                        const hasMax = advancedFilters.stepsPerSecond?.max !== null && advancedFilters.stepsPerSecond?.max !== undefined;
                        if (hasMin && stepsPerSecond < advancedFilters.stepsPerSecond!.min!) return false;
                        if (hasMax && advancedFilters.stepsPerSecond?.maxExclusive === true && stepsPerSecond >= advancedFilters.stepsPerSecond!.max!) return false;
                        if (hasMax && advancedFilters.stepsPerSecond?.maxExclusive !== true && stepsPerSecond > advancedFilters.stepsPerSecond!.max!) return false;
                        return true;
                    }
                    return false;
                });
            }
            if (advancedFilters.vramPeakMb) {
                 results = results.filter(image => {
                    const vramPeakMb =
                        image.metadata?.normalizedMetadata?.analytics?.vram_peak_mb ??
                        (image.metadata?.normalizedMetadata as { _analytics?: { vram_peak_mb?: number } } | undefined)?._analytics?.vram_peak_mb;
                    if (typeof vramPeakMb === 'number') {
                        const hasMin = advancedFilters.vramPeakMb?.min !== null && advancedFilters.vramPeakMb?.min !== undefined;
                        const hasMax = advancedFilters.vramPeakMb?.max !== null && advancedFilters.vramPeakMb?.max !== undefined;
                        if (hasMin && vramPeakMb < advancedFilters.vramPeakMb!.min!) return false;
                        if (hasMax && advancedFilters.vramPeakMb?.maxExclusive === true && vramPeakMb >= advancedFilters.vramPeakMb!.max!) return false;
                        if (hasMax && advancedFilters.vramPeakMb?.maxExclusive !== true && vramPeakMb > advancedFilters.vramPeakMb!.max!) return false;
                        return true;
                    }
                    return false;
                });
            }
        }

        const totalInScope = images.length; // Total absoluto de imagens indexadas
        const selectionDirectoryCount = state.directories.length;

        const compareById = (a: IndexedImage, b: IndexedImage) => a.id.localeCompare(b.id);
        const compareByNameAsc = (a: IndexedImage, b: IndexedImage) => {
            const nameComparison = (a.name || '').localeCompare(b.name || '');
            if (nameComparison !== 0) {
                return nameComparison;
            }
            return compareById(a, b);
        };
        const compareByNameDesc = (a: IndexedImage, b: IndexedImage) => {
            const nameComparison = (b.name || '').localeCompare(a.name || '');
            if (nameComparison !== 0) {
                return nameComparison;
            }
            return compareById(a, b);
        };
        const compareByDateAsc = (a: IndexedImage, b: IndexedImage) => {
            const dateComparison = a.lastModified - b.lastModified;
            if (dateComparison !== 0) {
                return dateComparison;
            }
            return compareByNameAsc(a, b);
        };
        const compareByDateDesc = (a: IndexedImage, b: IndexedImage) => {
            const dateComparison = b.lastModified - a.lastModified;
            if (dateComparison !== 0) {
                return dateComparison;
            }
            return compareByNameAsc(a, b);
        };

        // Seeded random number generator helper
        const seededRandom = (seed: number) => {
            const x = Math.sin(seed) * 10000;
            return x - Math.floor(x);
        };

        // Simple string hash function
        const stringHash = (str: string) => {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return hash;
        };

        const compareRandom = (a: IndexedImage, b: IndexedImage) => {
            // Combine image ID with state.randomSeed to create a stable sort key for this seed
            // We use the stringHash of the ID + seed to get a pseudo-random value fixed for this session/seed
            const seed = state.randomSeed || 0;
            const hashA = stringHash(a.id + seed.toString());
            const hashB = stringHash(b.id + seed.toString());
            
            if (hashA !== hashB) {
                return hashA - hashB;
            }
            return a.id.localeCompare(b.id);
        };

        const sorted = [...results].sort((a, b) => {
            if (sortOrder === 'asc') return compareByNameAsc(a, b);
            if (sortOrder === 'desc') return compareByNameDesc(a, b);
            if (sortOrder === 'date-asc') return compareByDateAsc(a, b);
            if (sortOrder === 'date-desc') return compareByDateDesc(a, b);
            if (sortOrder === 'random') return compareRandom(a, b);
            return compareById(a, b);
        });

        return {
            filteredImages: sorted,
            selectionTotalImages: totalInScope,
            selectionDirectoryCount
        };
    };


    return {
        // Initial State
        images: [],
        filteredImages: [],
        lineageResolvedByImageId: {},
        lineageDerivedIdsBySourceId: {},
        lineageBuildState: { ...DEFAULT_LINEAGE_BUILD_STATE },
        lineageDirectorySignatures: {},
        thumbnailEntries: {},
        selectionTotalImages: 0,
        selectionDirectoryCount: 0,
        directories: [],
        selectedFolders: new Set(),
        excludedFolders: new Set(),
        isFolderSelectionLoaded: false,
        includeSubfolders: localStorage.getItem('image-metahub-include-subfolders') !== 'false', // Default to true
        isLoading: false,
        progress: null,
        directoryProgress: {},
        enrichmentProgress: null,
        indexingState: 'idle',
        error: null,
        success: null,
        transferProgress: null,
        selectedImage: null,
        previewImage: null,
        selectedImages: new Set(),
        activeImageScope: null,
        focusedImageIndex: null,
        isStackingEnabled: false,
        searchQuery: '',
        availableModels: [],
        availableLoras: [],
        availableSamplers: [],
        availableSchedulers: [],
        availableGenerators: [],
        availableGpuDevices: [],
        availableDimensions: [],
        selectedModels: [],
        excludedModels: [],
        selectedLoras: [],
        excludedLoras: [],
        selectedSamplers: [],
        excludedSamplers: [],
        selectedSchedulers: [],
        excludedSchedulers: [],
        selectedGenerators: [],
        excludedGenerators: [],
        selectedGpuDevices: [],
        excludedGpuDevices: [],
        sortOrder: 'date-desc',
        randomSeed: Date.now(),
        advancedFilters: {},
        scanSubfolders: localStorage.getItem('image-metahub-scan-subfolders') !== 'false', // Default to true
        viewingStackPrompt: null,
        isFullscreenMode: false,
        comparisonImages: [null, null],
        isComparisonModalOpen: false,

        // Annotations initial values
        annotations: new Map(),
        availableTags: [],
        availableAutoTags: [],
        recentTags: loadRecentTags(),
        selectedTags: [],
        excludedTags: [],
        selectedAutoTags: [],
        excludedAutoTags: [],
        favoriteFilterMode: 'neutral',
        selectedRatings: [],
        isAnnotationsLoaded: false,
        activeWatchers: new Set(),
        refreshingDirectories: new Set(),

        // Smart Clustering initial values (Phase 2)
        clusters: [],
        clusteringProgress: null,
        clusteringWorker: null,
        isClustering: false,
        clusterNavigationContext: null,
        clusteringMetadata: null,

        // Auto-Tagging initial values (Phase 3)
        tfidfModel: null,
        autoTaggingProgress: null,
        autoTaggingWorker: null,
        isAutoTagging: false,
        lineageWorker: null,
        isLineageRebuildSuspended: false,

        // --- ACTIONS ---

        addDirectory: (directory) => set(state => {
            if (state.directories.some(d => d.id === directory.id)) {
                return state; // Prevent adding duplicates
            }
            const newDirectories = [...state.directories, { ...directory, visible: directory.visible ?? true }];
            const newState = { ...state, directories: newDirectories };
            return { ...newState, ...filterAndSort(newState) };
        }),

        toggleDirectoryVisibility: (directoryId) => set(state => {
            const updatedDirectories = state.directories.map(dir =>
                dir.id === directoryId ? { ...dir, visible: !(dir.visible ?? true) } : dir
            );
            const newState = { ...state, directories: updatedDirectories };
            return { ...newState, ...filterAndSort(newState) };
        }),

        toggleAutoWatch: (directoryId) => {
            set((state) => {
                const directories = state.directories.map((dir) =>
                    dir.id === directoryId
                        ? { ...dir, autoWatch: !dir.autoWatch }
                        : dir
                );

                // Persistir directories no localStorage
                if (typeof window !== 'undefined') {
                    const paths = directories.map(d => d.path);
                    localStorage.setItem('image-metahub-directories', JSON.stringify(paths));

                    // Persistir estado de autoWatch separadamente para manter sincronizado
                    const watchStates = Object.fromEntries(
                        directories.map(d => [d.id, { enabled: !!d.autoWatch, path: d.path }])
                    );
                    localStorage.setItem('image-metahub-directory-watchers', JSON.stringify(watchStates));
                }

                return { directories };
            });
        },

        initializeFolderSelection: async () => {
            Promise.all([
                loadSelectedFolders(),
                loadExcludedFolders()
            ]).then(([selectedPaths, excludedPaths]) => {
                set(state => {
                    // Only update if not already loaded to avoid overwriting current selection during re-renders
                    if (state.isFolderSelectionLoaded) {
                        return state;
                    }

                    const newState = {
                        ...state,
                        selectedFolders: new Set(selectedPaths),
                        excludedFolders: new Set(excludedPaths),
                        isFolderSelectionLoaded: true
                    };
                    
                    const resultState = { ...newState, ...filterAndSort(newState) };
                    const availableFilters = recalculateAvailableFilters(resultState.filteredImages);
                    return { ...resultState, ...availableFilters };
                });
            });
        },

        addExcludedFolder: (path: string) => {
            set(state => {
                const newExcluded = new Set(state.excludedFolders);
                newExcluded.add(path);
                
                // If the folder was selected, deselect it
                const newSelected = new Set(state.selectedFolders);
                if (newSelected.has(path)) {
                    newSelected.delete(path);
                }

                saveExcludedFolders(Array.from(newExcluded));
                saveSelectedFolders(Array.from(newSelected));

                const newState = { ...state, excludedFolders: newExcluded, selectedFolders: newSelected };
                const resultState = { ...newState, ...filterAndSort(newState) };
                const availableFilters = recalculateAvailableFilters(resultState.filteredImages);
                return { ...resultState, ...availableFilters };
            });
        },

        removeExcludedFolder: (path: string) => {
            set(state => {
                const newExcluded = new Set(state.excludedFolders);
                newExcluded.delete(path);
                saveExcludedFolders(Array.from(newExcluded));
                
                const newState = { ...state, excludedFolders: newExcluded };
                const resultState = { ...newState, ...filterAndSort(newState) };
                const availableFilters = recalculateAvailableFilters(resultState.filteredImages);
                return { ...resultState, ...availableFilters };
            });
        },

        toggleFolderSelection: (path: string, ctrlKey: boolean) => {
            const normalizedPath = normalizePath(path);
            set(state => {
                const selection = new Set(state.selectedFolders);

                if (ctrlKey) {
                    // Multi-select: toggle this folder
                    if (selection.has(normalizedPath)) {
                        selection.delete(normalizedPath);
                    } else {
                        selection.add(normalizedPath);
                    }
                } else {
                    // Single select: replace all with this folder
                    // If clicking the same folder that's already the only selection, clear it
                    if (selection.size === 1 && selection.has(normalizedPath)) {
                        selection.clear();
                    } else {
                        selection.clear();
                        selection.add(normalizedPath);
                    }
                }

                const newState = { ...state, selectedFolders: selection };
                const resultState = { ...newState, ...filterAndSort(newState) };

                // Recalculate available filters based on the new filtered images
                const availableFilters = recalculateAvailableFilters(resultState.filteredImages);
                const finalState = { ...resultState, ...availableFilters };

                // Persist to IndexedDB
                saveSelectedFolders(Array.from(selection)).catch((error) => {
                    console.error('Failed to persist folder selection state', error);
                });

                return finalState;
            });
        },

        clearFolderSelection: () => {
            set(state => {
                const selection = new Set<string>();

                const newState = { ...state, selectedFolders: selection };
                const resultState = { ...newState, ...filterAndSort(newState) };

                // Recalculate available filters based on the new filtered images
                const availableFilters = recalculateAvailableFilters(resultState.filteredImages);
                const finalState = { ...resultState, ...availableFilters };

                // Persist to IndexedDB
                saveSelectedFolders([]).catch((error) => {
                    console.error('Failed to persist folder selection state', error);
                });

                return finalState;
            });
        },

        isFolderSelected: (path) => {
            const normalizedPath = normalizePath(path);
            return get().selectedFolders.has(normalizedPath);
        },

        toggleIncludeSubfolders: () => {
            set(state => {
                const newValue = !state.includeSubfolders;
                localStorage.setItem('image-metahub-include-subfolders', String(newValue));
                const newState = { ...state, includeSubfolders: newValue };
                return { ...newState, ...filterAndSort(newState) };
            });
        },

        removeDirectory: (directoryId) => {
            const { directories, images, selectedFolders } = get();
            const targetDirectory = directories.find(d => d.id === directoryId);
            const newDirectories = directories.filter(d => d.id !== directoryId);
            if (window.electronAPI) {
                localStorage.setItem('image-metahub-directories', JSON.stringify(newDirectories.map(d => d.path)));
            }
            const newImages = images.filter(img => img.directoryId !== directoryId);

            // Remove all selected folders belonging to this directory
            const updatedSelection = new Set(selectedFolders);
            if (targetDirectory) {
                const normalizedPath = normalizePath(targetDirectory.path);
                for (const folderPath of Array.from(updatedSelection)) {
                    const normalizedFolder = normalizePath(folderPath);
                    // Remove if it's the directory itself or starts with the directory path
                    if (normalizedFolder === normalizedPath || normalizedFolder.startsWith(normalizedPath + '/') || normalizedFolder.startsWith(normalizedPath + '\\')) {
                        updatedSelection.delete(folderPath);
                    }
                }
            }

            set(state => {
                const nextDirectoryProgress = { ...state.directoryProgress };
                delete nextDirectoryProgress[directoryId];
                const nextLineageSignatures = { ...state.lineageDirectorySignatures };
                delete nextLineageSignatures[directoryId];
                const baseState = {
                    ...state,
                    directories: newDirectories,
                    selectedFolders: updatedSelection,
                    directoryProgress: nextDirectoryProgress,
                    lineageDirectorySignatures: nextLineageSignatures,
                };
                return _updateState(baseState, newImages);
            });

            saveSelectedFolders(Array.from(updatedSelection)).catch((error) => {
                console.error('Failed to persist folder selection state', error);
            });

            maybeQueueLineageBuild(500);
        },

        setLoading: (loading) => set({ isLoading: loading }),
        setProgress: (progress) => set({ progress }),
        setDirectoryProgress: (directoryId, progress) => set(state => {
            const nextDirectoryProgress = { ...state.directoryProgress };
            if (progress) {
                nextDirectoryProgress[directoryId] = progress;
            } else {
                delete nextDirectoryProgress[directoryId];
            }
            return { directoryProgress: nextDirectoryProgress };
        }),
        setEnrichmentProgress: (progress) => set((state) => {
            const current = state.enrichmentProgress;
            if (current === progress) {
                return state;
            }

            if (
                current?.processed === progress?.processed &&
                current?.total === progress?.total
            ) {
                return state;
            }

            return { enrichmentProgress: progress };
        }),
        setIndexingState: (indexingState) => {
            if (indexingState !== 'indexing') {
                flushPendingMerges(true);
            }
            set({ indexingState });
            if (indexingState !== 'indexing' && indexingState !== 'paused') {
                maybeQueueLineageBuild(800);
            }
        },
        setError: (error) => set({ error, success: null }),
        setSuccess: (success) => set({ success, error: null }),
        setTransferProgress: (transferProgress) => set({ transferProgress }),
        setLineageDirectorySignature: (directoryId, signature) => set(state => {
            const nextSignatures = { ...state.lineageDirectorySignatures };
            if (signature) {
                nextSignatures[directoryId] = signature;
            } else {
                delete nextSignatures[directoryId];
            }

            return {
                lineageDirectorySignatures: nextSignatures,
            };
        }),
        setLineageRebuildSuspended: (suspended) => {
            if (suspended) {
                clearLineageBuildTimer();
            }

            set({ isLineageRebuildSuspended: suspended });
        },
        hydratePersistedLineageSnapshot: async () => {
            const state = get();
            const librarySignature = getCurrentLineageLibrarySignature(state);
            if (!librarySignature) {
                return false;
            }

            const directoryPaths = state.directories.map(directory => directory.path);
            const snapshot = await loadLineageRegistrySnapshot(directoryPaths, state.scanSubfolders, librarySignature);
            if (!snapshot) {
                return false;
            }

            set({
                lineageResolvedByImageId: snapshot.resolvedByImageId,
                lineageDerivedIdsBySourceId: snapshot.derivedIdsBySourceId,
                lineageBuildState: {
                    status: 'ready',
                    processed: snapshot.imageCount,
                    total: snapshot.imageCount,
                    message: 'Lineage loaded from cache.',
                    dirty: false,
                    source: 'cache',
                    lastBuiltAt: snapshot.builtAt,
                },
            });
            return true;
        },
        scheduleLineageRebuild: (delayMs = 600) => {
            scheduleLineageBuildInternal(delayMs);
        },
        getResolvedLineage: (imageId) => {
            return get().lineageResolvedByImageId[imageId] ?? null;
        },
        getDerivedImages: (imageId, limit = 4) => {
            const state = get();
            const derivedIds = state.lineageDerivedIdsBySourceId[imageId] || [];
            if (derivedIds.length === 0) {
                return [];
            }

            const neededIds = new Set(derivedIds.slice(0, limit));
            const matches: IndexedImage[] = [];
            const order = new Map(Array.from(neededIds).map((id, index) => [id, index]));

            for (const candidate of state.images) {
                if (neededIds.has(candidate.id)) {
                    matches.push(candidate);
                    if (matches.length >= neededIds.size) {
                        break;
                    }
                }
            }

            if (matches.length < neededIds.size) {
                for (const candidate of state.filteredImages) {
                    if (neededIds.has(candidate.id) && !matches.some(match => match.id === candidate.id)) {
                        matches.push(candidate);
                    }
                    if (matches.length >= neededIds.size) {
                        break;
                    }
                }
            }

            return matches.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
        },

        filterAndSortImages: () => set(state => filterAndSort(state)),
        recomputeDerivedState: () => set(state => _updateState(state, state.images)),

        setImages: (images) => {
            clearPendingQueue();
            set(state => _updateState(state, images));
            maybeQueueLineageBuild(500);
        },

        addImages: (newImages) => {
            if (!newImages || newImages.length === 0) {
                return;
            }
            pendingImagesQueue.push(...newImages);
            if (pendingImagesQueue.length >= FORCE_FLUSH_PENDING_IMAGES_THRESHOLD) {
                flushPendingImages();
                return;
            }
            scheduleFlush();
        },

        appendImagesSilently: (newImages) => {
            if (!newImages || newImages.length === 0) {
                return;
            }

            set(state => {
                const deduped = new Map<string, IndexedImage>();
                for (const img of newImages) {
                    if (img?.id && !deduped.has(img.id)) {
                        deduped.set(img.id, img);
                    }
                }

                const queuedUnique = Array.from(deduped.values());
                const existingIds = new Set(state.images.map(img => img.id));
                const uniqueNewImages = queuedUnique.filter(img => !existingIds.has(img.id));
                if (uniqueNewImages.length === 0) {
                    return state;
                }

                const allImages = [...state.images, ...uniqueNewImages];
                return _updateState(state, allImages);
            });

            maybeQueueLineageBuild(700);
        },

        appendImagesRaw: (newImages) => {
            if (!newImages || newImages.length === 0) {
                return;
            }

            set(state => {
                const deduped = new Map<string, IndexedImage>();
                for (const img of newImages) {
                    if (img?.id && !deduped.has(img.id)) {
                        deduped.set(img.id, img);
                    }
                }

                const queuedUnique = Array.from(deduped.values());
                const existingIds = new Set(state.images.map(img => img.id));
                const uniqueNewImages = queuedUnique.filter(img => !existingIds.has(img.id));
                if (uniqueNewImages.length === 0) {
                    return state;
                }

                return {
                    images: [...state.images, ...uniqueNewImages],
                };
            });
        },

        replaceDirectoryImages: (directoryId, newImages) => {
            clearPendingQueue();
            set(state => {
                // Remove all images from this directory
                const otherImages = state.images.filter(img => img.directoryId !== directoryId);
                // Add new images for this directory
                const allImages = [...otherImages, ...newImages];
                return _updateState(state, allImages);
            });

            maybeQueueLineageBuild(700);
        },

        replaceDirectoryImagesRaw: (directoryId, newImages) => {
            clearPendingQueue();
            set(state => {
                const otherImages = state.images.filter(img => img.directoryId !== directoryId);
                return {
                    images: [...otherImages, ...newImages],
                };
            });
        },

        mergeImages: (updatedImages) => {
            if (!updatedImages || updatedImages.length === 0) {
                return;
            }

            const isIndexing = get().indexingState === 'indexing';
            if (isIndexing) {
                pendingMergeQueue.push(...updatedImages);
                scheduleMergeFlush();
                return;
            }

            flushPendingImages(true);
            flushPendingMerges();
            set(state => {
                const updates = new Map(updatedImages.map(img => [img.id, img]));
                const merged = state.images.map(img => updates.get(img.id) ?? img);
                return _updateState(state, merged);
            });

            maybeQueueLineageBuild(700);
        },

        clearImages: (directoryId?: string) => {
            set(state => {
            clearPendingQueue();
            if (directoryId) {
                const newImages = state.images.filter(img => img.directoryId !== directoryId);
                return _updateState(state, newImages);
            } else {
                return _updateState(state, []);
            }
            });

            maybeQueueLineageBuild(500);
        },

        removeImages: (imageIds) => {
            const idsToRemove = new Set(imageIds);
            flushPendingImages(true);
            set(state => {
                const remainingImages = state.images.filter(img => !idsToRemove.has(img.id));
                return _updateState(state, remainingImages);
            });
            maybeQueueLineageBuild(500);
        },

        removeImage: (imageId) => {
            flushPendingImages(true);
            set(state => {
                const remainingImages = state.images.filter(img => img.id !== imageId);
                return _updateState(state, remainingImages);
            });
            maybeQueueLineageBuild(500);
        },

        updateImage: (imageId, newName) => {
            set(state => {
                const updatedImages = state.images.map(img => img.id === imageId ? { ...img, name: newName } : img);
                // No need to recalculate filters for a simple name change
                return {
                    ...state,
                    ...filterAndSort({ ...state, images: updatedImages }),
                    images: updatedImages,
                    lineageBuildState: markLineageBuildStateDirty(state.lineageBuildState),
                };
            });
            maybeQueueLineageBuild(500);
        },

        setImageThumbnail: (imageId, data) => {
            const preState = get();
            const preImage = getImageById(preState, imageId);

            if (!preImage) {
                return;
            }

            const versionKey = `${imageId}:${preImage.lastModified}`;
            const preEntry = preState.thumbnailEntries[imageId];
            const activePreEntry = preEntry && preEntry.lastModified === preImage.lastModified ? preEntry : undefined;

            const nextThumbnailUrl = data.thumbnailUrl ?? activePreEntry?.thumbnailUrl ?? preImage.thumbnailUrl;
            const nextThumbnailHandle = data.thumbnailHandle ?? activePreEntry?.thumbnailHandle ?? preImage.thumbnailHandle;
            const nextThumbnailStatus = data.status;
            const nextThumbnailError = data.error ?? (data.status === 'error'
                ? 'Failed to load thumbnail'
                : activePreEntry?.thumbnailError ?? preImage.thumbnailError);

            const lastState = lastThumbnailState.get(versionKey);
            if (
                lastState &&
                lastState.url === nextThumbnailUrl &&
                lastState.handle === nextThumbnailHandle &&
                lastState.status === nextThumbnailStatus &&
                lastState.error === nextThumbnailError
            ) {
                return; // Identical to last applied payload
            }

            if (
                activePreEntry &&
                activePreEntry.thumbnailUrl === nextThumbnailUrl &&
                activePreEntry.thumbnailHandle === nextThumbnailHandle &&
                activePreEntry.thumbnailStatus === nextThumbnailStatus &&
                activePreEntry.thumbnailError === nextThumbnailError
            ) {
                lastThumbnailState.set(versionKey, {
                    url: nextThumbnailUrl,
                    handle: nextThumbnailHandle,
                    status: nextThumbnailStatus,
                    error: nextThumbnailError,
                });
                return;
            }

            if (thumbnailUpdateInProgress.has(versionKey)) {
                return;
            }

            thumbnailUpdateInProgress.add(versionKey);

            try {
                set(state => {
                    // CIRCUIT BREAKER: Prevent excessive updates
                    const now = Date.now();
                    const currentImage = getImageById(state, imageId);

                    if (!currentImage) {
                        return state;
                    }

                    const currentVersionKey = `${imageId}:${currentImage.lastModified}`;
                    const stats = thumbnailUpdateTimestamps.get(currentVersionKey) || { count: 0, lastUpdate: now };

                    if (now - stats.lastUpdate > 1000) {
                        stats.count = 0;
                        stats.lastUpdate = now;
                    }

                    stats.count++;
                    thumbnailUpdateTimestamps.set(currentVersionKey, stats);

                    if (stats.count > 10) {
                        console.warn(`⚠️ Circuit breaker activated: ${imageId} received ${stats.count} updates in 1s. Blocking update.`);
                        return state;
                    }

                    const currentEntry = state.thumbnailEntries[imageId];
                    const activeCurrentEntry = currentEntry && currentEntry.lastModified === currentImage.lastModified
                        ? currentEntry
                        : undefined;

                    const nextThumbnailUrl = data.thumbnailUrl ?? activeCurrentEntry?.thumbnailUrl ?? currentImage.thumbnailUrl;
                    const nextThumbnailHandle = data.thumbnailHandle ?? activeCurrentEntry?.thumbnailHandle ?? currentImage.thumbnailHandle;
                    const nextThumbnailStatus = data.status;
                    const nextThumbnailError = data.error ?? (data.status === 'error'
                        ? 'Failed to load thumbnail'
                        : activeCurrentEntry?.thumbnailError ?? currentImage.thumbnailError);

                    if (
                        activeCurrentEntry &&
                        activeCurrentEntry.thumbnailUrl === nextThumbnailUrl &&
                        activeCurrentEntry.thumbnailHandle === nextThumbnailHandle &&
                        activeCurrentEntry.thumbnailStatus === nextThumbnailStatus &&
                        activeCurrentEntry.thumbnailError === nextThumbnailError
                    ) {
                        return state;
                    }

                    lastThumbnailState.set(currentVersionKey, {
                        url: nextThumbnailUrl,
                        handle: nextThumbnailHandle,
                        status: nextThumbnailStatus,
                        error: nextThumbnailError,
                    });

                    return {
                        ...state,
                        thumbnailEntries: {
                            ...state.thumbnailEntries,
                            [imageId]: {
                                lastModified: currentImage.lastModified,
                                thumbnailUrl: nextThumbnailUrl,
                                thumbnailHandle: nextThumbnailHandle,
                                thumbnailStatus: nextThumbnailStatus,
                                thumbnailError: nextThumbnailError,
                            },
                        },
                    };
                });
            } finally {
                thumbnailUpdateInProgress.delete(versionKey);
            }
        },

        setSearchQuery: (query) => set(state => ({ ...filterAndSort({ ...state, searchQuery: query }), searchQuery: query })),

        setFilterOptions: (options) => set({
            availableModels: options.models,
            availableLoras: options.loras,
            availableSamplers: options.samplers,
            availableSchedulers: options.schedulers,
            availableGenerators: options.generators,
            availableGpuDevices: options.gpuDevices,
            availableDimensions: options.dimensions,
        }),

        setSelectedFilters: (filters) => set(state => ({
            ...filterAndSort({
                ...state,
                selectedModels: filters.models ?? state.selectedModels,
                excludedModels: filters.excludedModels ?? state.excludedModels,
                selectedLoras: filters.loras ?? state.selectedLoras,
                excludedLoras: filters.excludedLoras ?? state.excludedLoras,
                selectedSamplers: filters.samplers ?? state.selectedSamplers,
                excludedSamplers: filters.excludedSamplers ?? state.excludedSamplers,
                selectedSchedulers: filters.schedulers ?? state.selectedSchedulers,
                excludedSchedulers: filters.excludedSchedulers ?? state.excludedSchedulers,
                selectedGenerators: filters.generators ?? state.selectedGenerators,
                excludedGenerators: filters.excludedGenerators ?? state.excludedGenerators,
                selectedGpuDevices: filters.gpuDevices ?? state.selectedGpuDevices,
                excludedGpuDevices: filters.excludedGpuDevices ?? state.excludedGpuDevices,
            }),
            selectedModels: filters.models ?? state.selectedModels,
            excludedModels: filters.excludedModels ?? state.excludedModels,
            selectedLoras: filters.loras ?? state.selectedLoras,
            excludedLoras: filters.excludedLoras ?? state.excludedLoras,
            selectedSamplers: filters.samplers ?? state.selectedSamplers,
            excludedSamplers: filters.excludedSamplers ?? state.excludedSamplers,
            selectedSchedulers: filters.schedulers ?? state.selectedSchedulers,
            excludedSchedulers: filters.excludedSchedulers ?? state.excludedSchedulers,
            selectedGenerators: filters.generators ?? state.selectedGenerators,
            excludedGenerators: filters.excludedGenerators ?? state.excludedGenerators,
            selectedGpuDevices: filters.gpuDevices ?? state.selectedGpuDevices,
            excludedGpuDevices: filters.excludedGpuDevices ?? state.excludedGpuDevices,
        })),

        setAdvancedFilters: (filters) => set(state => ({
            ...filterAndSort({ ...state, advancedFilters: filters }),
            advancedFilters: filters,
        })),

        setSortOrder: (order) => set(state => ({ ...filterAndSort({ ...state, sortOrder: order }), sortOrder: order })),
        
        reshuffle: () => set(state => {
            const newSeed = Date.now();
            return {
                ...filterAndSort({ ...state, randomSeed: newSeed }),
                randomSeed: newSeed
            };
        }),

        setPreviewImage: (image) => set({ previewImage: image }),
        setSelectedImage: (image) => set({ selectedImage: image }),
        setActiveImageScope: (images) => set((state) => {
            if (state.activeImageScope === images) {
                return state;
            }
            return { activeImageScope: images };
        }),
        setFocusedImageIndex: (index) => set({ focusedImageIndex: index }),
        setFullscreenMode: (isFullscreen) => set({ isFullscreenMode: isFullscreen }),

        // Clustering Actions (Phase 2)
        startClustering: async (directoryPath: string, scanSubfolders: boolean, threshold: number) => {
            const { images, clusteringWorker: existingWorker } = get();

            // Cancel existing worker if running
            if (existingWorker) {
                existingWorker.terminate();
            }

            // Get clustering limits from license store directly (can't use hooks in Zustand actions)
            const licenseStore = useLicenseStore.getState();
            const isPro = licenseStore.licenseStatus === 'pro' || licenseStore.licenseStatus === 'lifetime';
            const isTrialActive = licenseStore.licenseStatus === 'trial';

            // Filter images with prompts
            const imagesWithPrompts = images.filter(img => img.prompt && img.prompt.trim().length > 0);

            // For free users: process CLUSTERING_PREVIEW_LIMIT (1500) images
            // - First 1000: shown normally
            // - Next 500: shown blurred (locked preview)
            const processingLimit = (isPro || isTrialActive) ? Infinity : CLUSTERING_PREVIEW_LIMIT;
            const limitedImages = imagesWithPrompts.slice(0, processingLimit);
            const remainingCount = Math.max(0, imagesWithPrompts.length - processingLimit);

            // Track which images are in the "locked preview" range (1001-1500)
            const lockedImageIds = new Set<string>();
            if (!isPro && !isTrialActive && imagesWithPrompts.length > CLUSTERING_FREE_TIER_LIMIT) {
                const lockedImages = imagesWithPrompts.slice(CLUSTERING_FREE_TIER_LIMIT, processingLimit);
                lockedImages.forEach(img => lockedImageIds.add(img.id));
            }

            // Store metadata for banner display and locked preview
            set({
                clusteringMetadata: {
                    processedCount: Math.min(limitedImages.length, CLUSTERING_FREE_TIER_LIMIT),
                    remainingCount: remainingCount,
                    isLimited: remainingCount > 0,
                    lockedImageIds,
                }
            });

            // Create new worker
            const worker = new Worker(
                new URL('../services/workers/clusteringWorker.ts', import.meta.url),
                { type: 'module' }
            );

            set({ clusteringWorker: worker, isClustering: true, clusteringProgress: { current: 0, total: limitedImages.length, message: 'Initializing...' } });

            // Handle worker messages
            worker.onmessage = (e: MessageEvent) => {
                const { type, payload } = e.data;

                switch (type) {
                    case 'progress':
                        set({ clusteringProgress: payload });
                        break;

                    case 'complete':
                        set({
                            clusters: payload.clusters,
                            clusteringProgress: null,
                            isClustering: false,
                        });
                        worker.terminate();
                        set({ clusteringWorker: null });
                        console.log(`Clustering complete: ${payload.clusters.length} clusters created`);
                        break;

                    case 'error':
                        console.error('Clustering error:', payload.error);
                        set({
                            clusteringProgress: null,
                            isClustering: false,
                            error: `Clustering failed: ${payload.error}`,
                        });
                        worker.terminate();
                        set({ clusteringWorker: null });
                        break;
                }
            };

            // Prepare lightweight data for worker (90% less data)
            const lightweightImages = limitedImages.map(img => ({
                id: img.id,
                prompt: img.prompt!,
                lastModified: img.lastModified,
            }));

            // Start clustering
            worker.postMessage({
                type: 'start',
                payload: {
                    images: lightweightImages,
                    threshold,
                },
            });
        },

        cancelClustering: () => {
            const { clusteringWorker } = get();
            if (clusteringWorker) {
                clusteringWorker.postMessage({ type: 'cancel' });
                clusteringWorker.terminate();
                set({
                    clusteringWorker: null,
                    clusteringProgress: null,
                    isClustering: false,
                });
            }
        },

        setClusters: (clusters) => set({ clusters }),

        setClusteringProgress: (progress) => set({ clusteringProgress: progress }),

        setClusterNavigationContext: (images) => set((state) => {
            const current = state.clusterNavigationContext;
            if (current === images) {
                return state;
            }

            if (current === null || images === null) {
                if (current === images) {
                    return state;
                }
                return { clusterNavigationContext: images };
            }

            if (current.length === images.length) {
                let isSame = true;
                for (let index = 0; index < current.length; index += 1) {
                    if (current[index]?.id !== images[index]?.id) {
                        isSame = false;
                        break;
                    }
                }

                if (isSame) {
                    return state;
                }
            }

            return { clusterNavigationContext: images };
        }),

        handleClusterImageDeletion: (deletedImageIds: string[]) => {
            const { clusters } = get();
            if (clusters.length === 0) return;

            // Import removeImagesFromClusters dynamically to avoid circular deps
            import('../services/clusteringEngine').then(({ removeImagesFromClusters }) => {
                const updatedClusters = removeImagesFromClusters(deletedImageIds, clusters);
                set({ clusters: updatedClusters });
                console.log(`Clusters updated after ${deletedImageIds.length} image deletions`);
            });
        },

        // Auto-Tagging Actions (Phase 3)
        startAutoTagging: async (directoryPath, scanSubfolders, options) => {
            const { images, autoTaggingWorker: existingWorker } = get();

            if (existingWorker) {
                existingWorker.terminate();
            }

            const worker = new Worker(
                new URL('../services/workers/autoTaggingWorker.ts', import.meta.url),
                { type: 'module' }
            );

            set({
                autoTaggingWorker: worker,
                isAutoTagging: true,
                autoTaggingProgress: { current: 0, total: images.length, message: 'Initializing...' }
            });

            worker.onmessage = (e: MessageEvent) => {
                const { type, payload } = e.data;

                switch (type) {
                    case 'progress':
                        set({ autoTaggingProgress: payload });
                        break;
                    case 'complete': {
                        const generatedAt = Date.now();
                        const tagMap = new Map<string, string[]>();
                        Object.entries(payload.autoTags || {}).forEach(([id, tags]: [string, AutoTag[]]) => {
                            const normalizedTags = (tags || []).map((tag) => tag.tag).filter(Boolean);
                            tagMap.set(id, normalizedTags);
                        });

                        set(state => {
                            const updateList = (list: IndexedImage[]) => list.map(img => {
                                if (!tagMap.has(img.id)) {
                                    return img;
                                }
                                const tags = tagMap.get(img.id) ?? [];
                                return {
                                    ...img,
                                    autoTags: tags,
                                    autoTagsGeneratedAt: generatedAt,
                                };
                            });

                            return {
                                ...state,
                                images: updateList(state.images),
                                filteredImages: updateList(state.filteredImages),
                                tfidfModel: payload.tfidfModel ?? null,
                                autoTaggingProgress: null,
                                isAutoTagging: false,
                            };
                        });

                        worker.terminate();
                        set({ autoTaggingWorker: null });
                        console.log(`Auto-tagging complete: ${Object.keys(payload.autoTags || {}).length} images tagged`);

                        if (payload.autoTags && payload.tfidfModel) {
                            import('../services/clusterCacheManager')
                                .then(({ saveAutoTagCache }) => saveAutoTagCache(directoryPath, scanSubfolders, payload.autoTags, payload.tfidfModel))
                                .catch(error => {
                                    console.warn('Failed to save auto-tag cache:', error);
                                });
                        }
                        break;
                    }
                    case 'error':
                        console.error('Auto-tagging error:', payload.error);
                        set({
                            autoTaggingProgress: null,
                            isAutoTagging: false,
                            error: `Auto-tagging failed: ${payload.error}`,
                        });
                        worker.terminate();
                        set({ autoTaggingWorker: null });
                        break;
                }
            };

            const taggingImages = images.map(img => ({
                id: img.id,
                prompt: img.prompt,
                models: img.models,
                loras: img.loras,
            }));

            worker.postMessage({
                type: 'start',
                payload: {
                    images: taggingImages,
                    topN: options?.topN,
                    minScore: options?.minScore,
                },
            });
        },

        cancelAutoTagging: () => {
            const { autoTaggingWorker } = get();
            if (autoTaggingWorker) {
                autoTaggingWorker.postMessage({ type: 'cancel' });
                autoTaggingWorker.terminate();
                set({
                    autoTaggingWorker: null,
                    autoTaggingProgress: null,
                    isAutoTagging: false,
                });
            }
        },

        setAutoTaggingProgress: (progress) => set({ autoTaggingProgress: progress }),

        // Comparison Actions
        setComparisonImages: (images) => set({ comparisonImages: images }),

        addImageToComparison: (image) => set(state => {
            const newImages: [IndexedImage | null, IndexedImage | null] = [...state.comparisonImages];

            // Find first empty slot
            const emptyIndex = newImages.findIndex(img => img === null);
            if (emptyIndex !== -1) {
                newImages[emptyIndex] = image;
            }

            return { comparisonImages: newImages };
        }),

        removeImageFromComparison: (index) => set(state => {
            const newImages: [IndexedImage | null, IndexedImage | null] = [...state.comparisonImages];
            newImages[index] = null;
            return { comparisonImages: newImages };
        }),

        swapComparisonImages: () => set(state => {
            const [left, right] = state.comparisonImages;
            return { comparisonImages: [right, left] };
        }),

        clearComparison: () => set({
            comparisonImages: [null, null],
            isComparisonModalOpen: false
        }),

        openComparisonModal: () => set({ isComparisonModalOpen: true }),

        closeComparisonModal: () => set({ isComparisonModalOpen: false }),

        // Annotations Actions
        loadAnnotations: async () => {
            const annotationsMap = await loadAllAnnotations();
            const tags = await getAllTags();
            const queuedMetadataImports = drainPendingMetadataTagImports();

            set(state => {
                // Denormalize annotations into images array using helper
                const updatedImages = applyAnnotationsToImages(state.images, annotationsMap);

                const newState = {
                    ...state,
                    annotations: annotationsMap,
                    availableTags: tags,
                    isAnnotationsLoaded: true,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            if (queuedMetadataImports.length > 0) {
                await get().importMetadataTags(queuedMetadataImports);
            }
        },

        toggleFavorite: async (imageId) => {
            const { annotations } = get();

            const currentAnnotation = annotations.get(imageId);
            const newIsFavorite = !(currentAnnotation?.isFavorite ?? false);

            const updatedAnnotation = buildAnnotationRecord(imageId, currentAnnotation, {
                isFavorite: newIsFavorite,
            });

            // Update in-memory state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                newAnnotations.set(imageId, updatedAnnotation);

                const updatedImages = state.images.map(img =>
                    img.id === imageId ? { ...img, isFavorite: newIsFavorite, rating: updatedAnnotation.rating } : img
                );

                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            // Persist to IndexedDB (async, don't await)
            saveAnnotation(updatedAnnotation).catch(error => {
                console.error('Failed to save annotation:', error);
            });
        },

        bulkToggleFavorite: async (imageIds, isFavorite) => {
            const { annotations } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            for (const imageId of imageIds) {
                const current = annotations.get(imageId);
                updatedAnnotations.push(buildAnnotationRecord(imageId, current, {
                    isFavorite,
                }));
            }

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                for (const annotation of updatedAnnotations) {
                    newAnnotations.set(annotation.imageId, annotation);
                }

                const updatedImages = state.images.map(img => {
                    const annotation = newAnnotations.get(img.id);
                    if (annotation && imageIds.includes(img.id)) {
                        return { ...img, isFavorite: annotation.isFavorite, rating: annotation.rating };
                    }
                    return img;
                });

                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            // Persist to IndexedDB
            bulkSaveAnnotations(updatedAnnotations).catch(error => {
                console.error('Failed to bulk save annotations:', error);
            });
        },

        setImageRating: async (imageId, rating) => {
            const { annotations } = get();
            const currentAnnotation = annotations.get(imageId);
            const normalizedRating = rating ?? undefined;
            const updatedAnnotation = buildAnnotationRecord(imageId, currentAnnotation, {
                rating: normalizedRating,
            });

            set(state => {
                const newAnnotations = new Map(state.annotations);
                newAnnotations.set(imageId, updatedAnnotation);

                const updatedImages = state.images.map(img =>
                    img.id === imageId ? { ...img, rating: normalizedRating } : img
                );

                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            saveAnnotation(updatedAnnotation).catch(error => {
                console.error('Failed to save image rating:', error);
            });
        },

        bulkSetImageRating: async (imageIds, rating) => {
            if (imageIds.length === 0) {
                return;
            }

            const { annotations } = get();
            const normalizedRating = rating ?? undefined;
            const updatedAnnotations = imageIds.map(imageId =>
                buildAnnotationRecord(imageId, annotations.get(imageId), {
                    rating: normalizedRating,
                })
            );

            set(state => {
                const newAnnotations = new Map(state.annotations);
                for (const annotation of updatedAnnotations) {
                    newAnnotations.set(annotation.imageId, annotation);
                }

                const imageIdsSet = new Set(imageIds);
                const updatedImages = state.images.map(img =>
                    imageIdsSet.has(img.id) ? { ...img, rating: normalizedRating } : img
                );

                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            bulkSaveAnnotations(updatedAnnotations).catch(error => {
                console.error('Failed to bulk save image ratings:', error);
            });
        },

        addTagToImage: async (imageId, tag) => {
            const normalizedTag = normalizeTagName(tag);
            if (!normalizedTag) return;

            const { annotations } = get();
            const currentAnnotation = annotations.get(imageId);

            // Don't add duplicate
            if (currentAnnotation?.tags.includes(normalizedTag)) {
                return;
            }

            const updatedAnnotation = buildAnnotationRecord(imageId, currentAnnotation, {
                tags: [...(currentAnnotation?.tags ?? []), normalizedTag],
            });

            let nextRecentTags = get().recentTags;

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                newAnnotations.set(imageId, updatedAnnotation);

                const updatedImages = state.images.map(img =>
                    img.id === imageId ? { ...img, tags: updatedAnnotation.tags, rating: updatedAnnotation.rating } : img
                );

                nextRecentTags = updateRecentTags(state.recentTags, normalizedTag);
                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                    recentTags: nextRecentTags,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            persistRecentTags(nextRecentTags);

            // Persist and refresh tags
            await Promise.all([
                saveAnnotation(updatedAnnotation),
                ensureManualTagExists(normalizedTag),
            ]).catch(error => {
                console.error('Failed to save annotation:', error);
            });
            await get().refreshAvailableTags();
        },

        removeTagFromImage: async (imageId, tag) => {
            const { annotations } = get();
            const currentAnnotation = annotations.get(imageId);

            if (!currentAnnotation || !currentAnnotation.tags.includes(tag)) {
                return;
            }

            const updatedAnnotation: ImageAnnotations = {
                ...currentAnnotation,
                tags: currentAnnotation.tags.filter(t => t !== tag),
                updatedAt: Date.now(),
            };

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                newAnnotations.set(imageId, updatedAnnotation);

                const updatedImages = state.images.map(img =>
                    img.id === imageId ? { ...img, tags: updatedAnnotation.tags, rating: updatedAnnotation.rating } : img
                );

                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            // Persist and refresh tags
            saveAnnotation(updatedAnnotation).catch(error => {
                console.error('Failed to save annotation:', error);
            });
            get().refreshAvailableTags();
        },

        removeAutoTagFromImage: (imageId, tag) => {
            set(state => {
                const updatedImages = state.images.map(img => {
                    if (img.id === imageId && img.autoTags) {
                        return {
                            ...img,
                            autoTags: img.autoTags.filter(t => t !== tag),
                        };
                    }
                    return img;
                });

                const newState = {
                    ...state,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });
        },

        bulkAddTag: async (imageIds, tag) => {
            const normalizedTag = normalizeTagName(tag);
            if (!normalizedTag || imageIds.length === 0) return;

            const { annotations } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            for (const imageId of imageIds) {
                const current = annotations.get(imageId);
                if (current?.tags.includes(normalizedTag)) {
                    continue; // Skip if already tagged
                }

                updatedAnnotations.push(buildAnnotationRecord(imageId, current, {
                    tags: [...(current?.tags ?? []), normalizedTag],
                }));
            }

            let nextRecentTags = get().recentTags;

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                for (const annotation of updatedAnnotations) {
                    newAnnotations.set(annotation.imageId, annotation);
                }

                const updatedImages = state.images.map(img => {
                    const annotation = newAnnotations.get(img.id);
                    if (annotation && imageIds.includes(img.id)) {
                        return { ...img, tags: annotation.tags, rating: annotation.rating };
                    }
                    return img;
                });

                nextRecentTags = updateRecentTags(state.recentTags, normalizedTag);
                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                    recentTags: nextRecentTags,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            persistRecentTags(nextRecentTags);

            // Persist and refresh tags
            await Promise.all([
                bulkSaveAnnotations(updatedAnnotations),
                ensureManualTagExists(normalizedTag),
            ]).catch(error => {
                console.error('Failed to bulk save annotations:', error);
            });
            await get().refreshAvailableTags();
        },

        bulkRemoveTag: async (imageIds, tag) => {
            const { annotations } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            for (const imageId of imageIds) {
                const current = annotations.get(imageId);
                if (!current || !current.tags.includes(tag)) {
                    continue; // Skip if doesn't have this tag
                }

                updatedAnnotations.push({
                    ...current,
                    tags: current.tags.filter(t => t !== tag),
                    updatedAt: Date.now(),
                });
            }

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                for (const annotation of updatedAnnotations) {
                    newAnnotations.set(annotation.imageId, annotation);
                }

                const updatedImages = state.images.map(img => {
                    const annotation = newAnnotations.get(img.id);
                    if (annotation && imageIds.includes(img.id)) {
                        return { ...img, tags: annotation.tags, rating: annotation.rating };
                    }
                    return img;
                });

                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            // Persist and refresh tags
            await bulkSaveAnnotations(updatedAnnotations).catch(error => {
                console.error('Failed to bulk save annotations:', error);
            });
            await get().refreshAvailableTags();
        },

        renameTag: async (sourceTag, targetTag) => {
            const normalizedSource = normalizeTagName(sourceTag);
            const normalizedTarget = normalizeTagName(targetTag);

            if (!normalizedSource || !normalizedTarget || normalizedSource === normalizedTarget) {
                return;
            }

            const { annotations } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            for (const annotation of annotations.values()) {
                if (!annotation.tags.includes(normalizedSource)) {
                    continue;
                }

                updatedAnnotations.push({
                    ...annotation,
                    tags: renameAnnotationTag(annotation.tags, normalizedSource, normalizedTarget),
                    updatedAt: Date.now(),
                });
            }

            let nextRecentTags = get().recentTags;

            set(state => {
                const newAnnotations = new Map(state.annotations);
                for (const annotation of updatedAnnotations) {
                    newAnnotations.set(annotation.imageId, annotation);
                }

                nextRecentTags = updateRecentTags(
                    replaceRecentTag(state.recentTags, normalizedSource, normalizedTarget),
                    normalizedTarget,
                );

                const filteredState = transferManualTagFilters(state, normalizedSource, normalizedTarget);
                const updatedImages = applyAnnotationsToImages(state.images, newAnnotations);
                const newState = {
                    ...state,
                    ...filteredState,
                    annotations: newAnnotations,
                    images: updatedImages,
                    recentTags: nextRecentTags,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            persistRecentTags(nextRecentTags);

            await Promise.all([
                updatedAnnotations.length > 0 ? bulkSaveAnnotations(updatedAnnotations) : Promise.resolve(),
                renameManualTag(normalizedSource, normalizedTarget),
            ]).catch(error => {
                console.error('Failed to rename tag:', error);
            });
            await get().refreshAvailableTags();
        },

        clearTag: async (tag) => {
            const normalizedTag = normalizeTagName(tag);
            if (!normalizedTag) {
                return;
            }

            const { annotations } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            for (const annotation of annotations.values()) {
                if (!annotation.tags.includes(normalizedTag)) {
                    continue;
                }

                updatedAnnotations.push({
                    ...annotation,
                    tags: annotation.tags.filter(existing => existing !== normalizedTag),
                    updatedAt: Date.now(),
                });
            }

            set(state => {
                const newAnnotations = new Map(state.annotations);
                for (const annotation of updatedAnnotations) {
                    newAnnotations.set(annotation.imageId, annotation);
                }

                const filteredState = removeTagFromManualFilters(state, normalizedTag);
                const updatedImages = applyAnnotationsToImages(state.images, newAnnotations);
                const newState = {
                    ...state,
                    ...filteredState,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            await Promise.all([
                ensureManualTagExists(normalizedTag),
                updatedAnnotations.length > 0 ? bulkSaveAnnotations(updatedAnnotations) : Promise.resolve(),
            ]).catch(error => {
                console.error('Failed to clear tag:', error);
            });
            await get().refreshAvailableTags();
        },

        deleteTag: async (tag) => {
            const normalizedTag = normalizeTagName(tag);
            if (!normalizedTag) {
                return;
            }

            const usageCount = Array.from(get().annotations.values())
                .filter(annotation => annotation.tags.includes(normalizedTag))
                .length;
            if (usageCount > 0) {
                return;
            }

            let nextRecentTags = get().recentTags;

            set(state => {
                nextRecentTags = removeRecentTag(state.recentTags, normalizedTag);
                const filteredState = removeTagFromManualFilters(state, normalizedTag);
                const newState = {
                    ...state,
                    ...filteredState,
                    recentTags: nextRecentTags,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            persistRecentTags(nextRecentTags);

            await deleteManualTag(normalizedTag).catch(error => {
                console.error('Failed to delete tag:', error);
            });
            await get().refreshAvailableTags();
        },

        purgeTag: async (tag) => {
            const normalizedTag = normalizeTagName(tag);
            if (!normalizedTag) {
                return;
            }

            const { annotations } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            for (const annotation of annotations.values()) {
                if (!annotation.tags.includes(normalizedTag)) {
                    continue;
                }

                updatedAnnotations.push({
                    ...annotation,
                    tags: annotation.tags.filter(existing => existing !== normalizedTag),
                    updatedAt: Date.now(),
                });
            }

            let nextRecentTags = get().recentTags;

            set(state => {
                const newAnnotations = new Map(state.annotations);
                for (const annotation of updatedAnnotations) {
                    newAnnotations.set(annotation.imageId, annotation);
                }

                nextRecentTags = removeRecentTag(state.recentTags, normalizedTag);
                const filteredState = removeTagFromManualFilters(state, normalizedTag);
                const updatedImages = applyAnnotationsToImages(state.images, newAnnotations);
                const newState = {
                    ...state,
                    ...filteredState,
                    annotations: newAnnotations,
                    images: updatedImages,
                    recentTags: nextRecentTags,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            persistRecentTags(nextRecentTags);

            await Promise.all([
                updatedAnnotations.length > 0 ? bulkSaveAnnotations(updatedAnnotations) : Promise.resolve(),
                deleteManualTag(normalizedTag),
            ]).catch(error => {
                console.error('Failed to purge tag:', error);
            });
            await get().refreshAvailableTags();
        },

        setSelectedTags: (tags) => set(state => {
            const newState = { ...state, selectedTags: tags };
            return { ...newState, ...filterAndSort(newState) };
        }),

        setExcludedTags: (tags) => set(state => {
            const newState = { ...state, excludedTags: tags };
            return { ...newState, ...filterAndSort(newState) };
        }),

        setFavoriteFilterMode: (mode) => set(state => {
            const newState = { ...state, favoriteFilterMode: mode };
            return { ...newState, ...filterAndSort(newState) };
        }),

        setSelectedRatings: (ratings) => set(state => {
            const normalizedRatings = Array.from(new Set(ratings))
                .filter((rating): rating is ImageRating => [1, 2, 3, 4, 5].includes(rating))
                .sort((a, b) => a - b);
            const newState = {
                ...state,
                selectedRatings: normalizedRatings,
            };
            return { ...newState, ...filterAndSort(newState) };
        }),

        getImageAnnotations: (imageId) => {
            return get().annotations.get(imageId) || null;
        },

        refreshAvailableTags: async () => {
            const tags = await getAllTags();
            set({ availableTags: tags });
        },

        refreshAvailableAutoTags: () => {
            const { images } = get();

            // Count frequency of each auto-tag
            const tagFrequency = new Map<string, number>();

            images.forEach(img => {
                if (img.autoTags && img.autoTags.length > 0) {
                    img.autoTags.forEach(tag => {
                        tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
                    });
                }
            });

            // Convert to TagInfo array and sort by frequency
            const autoTags: TagInfo[] = Array.from(tagFrequency.entries())
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count); // Most used first

            set({ availableAutoTags: autoTags });
        },

        setSelectedAutoTags: (tags) => {
            set(state => ({ ...filterAndSort({ ...state, selectedAutoTags: tags }), selectedAutoTags: tags }));
        },

        setExcludedAutoTags: (tags) => {
            set(state => ({ ...filterAndSort({ ...state, excludedAutoTags: tags }), excludedAutoTags: tags }));
        },

        importMetadataTags: async (images) => {
            if (!images || images.length === 0) return;

            const { annotations } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            // Collect all tags to import from metadata
            for (const image of images) {
                const metadataTags = image.metadata?.normalizedMetadata?.tags;
                if (!metadataTags || metadataTags.length === 0) continue;

                const currentAnnotation = annotations.get(image.id);
                const existingTags = currentAnnotation?.tags ?? [];

                // Normalize and filter out duplicates
                const newTags = metadataTags
                    .map(tag => normalizeTagName(tag))
                    .filter(tag => tag && !existingTags.includes(tag));

                if (newTags.length === 0) continue;

                const updatedAnnotation = buildAnnotationRecord(image.id, currentAnnotation, {
                    tags: [...existingTags, ...newTags],
                });

                updatedAnnotations.push(updatedAnnotation);
            }

            if (updatedAnnotations.length === 0) return;

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                for (const annotation of updatedAnnotations) {
                    newAnnotations.set(annotation.imageId, annotation);
                }

                const updatedImages = state.images.map(img => {
                    const annotation = newAnnotations.get(img.id);
                    return annotation ? { ...img, tags: annotation.tags, rating: annotation.rating } : img;
                });

                const newState = {
                    ...state,
                    annotations: newAnnotations,
                    images: updatedImages,
                };

                return { ...newState, ...filterAndSort(newState) };
            });

            const importedTagNames = Array.from(new Set(
                updatedAnnotations.flatMap(annotation => annotation.tags)
            ));

            // Persist annotations
            await Promise.all([
                bulkSaveAnnotations(updatedAnnotations),
                ...importedTagNames.map(tagName => ensureManualTagExists(tagName)),
            ]).catch(error => {
                console.error('Failed to import metadata tags:', error);
            });

            // Refresh available tags
            await get().refreshAvailableTags();
        },

        flushPendingImages: () => {
            flushPendingImages();
        },

        setDirectoryRefreshing: (directoryId, isRefreshing) => {
            set(state => {
                const next = new Set(state.refreshingDirectories);
                if (isRefreshing) {
                    next.add(directoryId);
                } else {
                    next.delete(directoryId);
                }
                return { refreshingDirectories: next };
            });
        },

        toggleImageSelection: (imageId) => {
            set(state => {
                const newSelection = new Set(state.selectedImages);
                if (newSelection.has(imageId)) {
                    newSelection.delete(imageId);
                } else {
                    newSelection.add(imageId);
                }
                return { selectedImages: newSelection };
            });
        },

        selectAllImages: () => set(state => {
            const selectionScope = state.activeImageScope ?? state.filteredImages;
            const allImageIds = new Set(selectionScope.map(img => img.id));
            return { selectedImages: allImageIds };
        }),

        clearImageSelection: () => set({ selectedImages: new Set() }),

        deleteSelectedImages: async () => {
            get().clearImageSelection();
        },

        setScanSubfolders: (scan) => {
            localStorage.setItem('image-metahub-scan-subfolders', String(scan));
            set({ scanSubfolders: scan });
        },

        handleNavigateNext: () => {
            const state = get();
            if (!state.selectedImage) return;

            const imagesToNavigate = state.clusterNavigationContext || state.activeImageScope || state.filteredImages;
            const currentIndex = imagesToNavigate.findIndex(img => img.id === state.selectedImage!.id);

            if (currentIndex < imagesToNavigate.length - 1) {
                const nextImage = imagesToNavigate[currentIndex + 1];
                set({ selectedImage: nextImage });
            }
        },

        handleNavigatePrevious: () => {
            const state = get();
            if (!state.selectedImage) return;

            const imagesToNavigate = state.clusterNavigationContext || state.activeImageScope || state.filteredImages;
            const currentIndex = imagesToNavigate.findIndex(img => img.id === state.selectedImage!.id);

            if (currentIndex > 0) {
                const prevImage = imagesToNavigate[currentIndex - 1];
                set({ selectedImage: prevImage });
            }
        },

        resetState: () => {
            pendingMetadataTagImportMap.clear();
            clearLineageBuildTimer();
            const { lineageWorker } = get();
            lineageWorker?.terminate();
            set({
            images: [],
            filteredImages: [],
            lineageResolvedByImageId: {},
            lineageDerivedIdsBySourceId: {},
            lineageBuildState: { ...DEFAULT_LINEAGE_BUILD_STATE },
            lineageDirectorySignatures: {},
            thumbnailEntries: {},
            selectionTotalImages: 0,
            selectionDirectoryCount: 0,
            directories: [],
            selectedFolders: new Set(),
            isFolderSelectionLoaded: false,
            isLoading: false,
            progress: { current: 0, total: 0 },
            directoryProgress: {},
            enrichmentProgress: null,
            error: null,
            success: null,
            selectedImage: null,
            selectedImages: new Set(),
            activeImageScope: null,
            searchQuery: '',
            availableModels: [],
            availableLoras: [],
            availableSamplers: [],
            availableSchedulers: [],
            availableGenerators: [],
            availableGpuDevices: [],
            availableDimensions: [],
            selectedModels: [],
            excludedModels: [],
            selectedLoras: [],
            excludedLoras: [],
            selectedSamplers: [],
            excludedSamplers: [],
            selectedSchedulers: [],
            excludedSchedulers: [],
            selectedGenerators: [],
            excludedGenerators: [],
            selectedGpuDevices: [],
            excludedGpuDevices: [],
            advancedFilters: {},
            indexingState: 'idle',
            previewImage: null,
            focusedImageIndex: null,
            scanSubfolders: true,
            viewingStackPrompt: null,
            sortOrder: 'desc',
            isFullscreenMode: false,
            comparisonImages: [null, null],
            isComparisonModalOpen: false,
            annotations: new Map(),
            availableTags: [],
            availableAutoTags: [],
            recentTags: loadRecentTags(),
            selectedTags: [],
            excludedTags: [],
            selectedAutoTags: [],
            excludedAutoTags: [],
            favoriteFilterMode: 'neutral',
            selectedRatings: [],
            isAnnotationsLoaded: false,
            activeWatchers: new Set(),
            refreshingDirectories: new Set(),
            clusters: [],
            clusteringProgress: null,
            clusteringWorker: null,
            isClustering: false,
            clusterNavigationContext: null,
            tfidfModel: null,
            autoTaggingProgress: null,
            autoTaggingWorker: null,
            isAutoTagging: false,
            lineageWorker: null,
            isLineageRebuildSuspended: false,
        });
        },

        cleanupInvalidImages: () => {
            const state = get();
            const isElectron = typeof window !== 'undefined' && window.electronAPI;
            
            const validImages = state.images.filter(image => {
                const fileHandle = image.thumbnailHandle || image.handle;
                return isElectron || (fileHandle && typeof fileHandle.getFile === 'function');
            });
            
            if (validImages.length !== state.images.length) {
                set(state => ({
                    ...state,
                    images: validImages,
                    ...filterAndSort({ ...state, images: validImages })
                }));

            }
        },

        setStackingEnabled: (enabled: boolean) => {
            set({ isStackingEnabled: enabled });
        },

        setViewingStackPrompt: (prompt: string | null) => {
            set({ viewingStackPrompt: prompt });
        }
    }
});
