import { create } from 'zustand';
import { IndexedImage, Directory, ThumbnailStatus, ImageAnnotations, TagInfo } from '../types';
import { loadFolderSelection, saveFolderSelection, StoredSelectionState } from '../services/folderSelectionStorage';
import {
  loadAllAnnotations,
  saveAnnotation,
  bulkSaveAnnotations,
  getAllTags,
} from '../services/imageAnnotationsStorage';

type SelectionState = StoredSelectionState;

type FolderSelectionMap = Map<string, SelectionState>;

const normalizePath = (path: string) => {
    if (!path) return '';
    return path.replace(/[\\/]+$/, '');
};

const getParentPath = (path: string): string | null => {
    const normalized = normalizePath(path);
    if (!normalized) return null;
    const lastSlash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
    if (lastSlash === -1) {
        return '';
    }
    return normalized.slice(0, lastSlash);
};

const isDescendantPath = (child: string, parent: string) => {
    const normalizedChild = normalizePath(child);
    const normalizedParent = normalizePath(parent);
    if (!normalizedParent) {
        return normalizedChild !== '';
    }
    if (normalizedChild === normalizedParent) {
        return false;
    }
    const separator = normalizedParent.includes('\\') ? '\\' : '/';
    return normalizedChild.startsWith(normalizedParent + separator);
};

const isSameOrDescendantPath = (child: string, parent: string) => {
    const normalizedChild = normalizePath(child);
    const normalizedParent = normalizePath(parent);
    if (normalizedChild === normalizedParent) {
        return true;
    }
    return isDescendantPath(normalizedChild, normalizedParent);
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

const detectSeparator = (path: string) => (path.includes('\\') && !path.includes('/')) ? '\\' : '/';

const joinPath = (base: string, relative: string) => {
    if (!relative) {
        return normalizePath(base);
    }
    const separator = detectSeparator(base);
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

const mapToRecord = (selection: FolderSelectionMap): Record<string, SelectionState> => {
    const record: Record<string, SelectionState> = {};
    for (const [key, value] of selection.entries()) {
        record[key] = value;
    }
    return record;
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
        segments.push(image.metadataString.toLowerCase());
    }
    if (image.prompt) {
        segments.push(image.prompt.toLowerCase());
    }
    if (image.negativePrompt) {
        segments.push(image.negativePrompt.toLowerCase());
    }
    if (image.models?.length) {
        segments.push(image.models.filter(model => typeof model === 'string').map(model => model.toLowerCase()).join(' '));
    }
    if (image.loras?.length) {
        segments.push(image.loras.filter(lora => typeof lora === 'string').map(lora => lora.toLowerCase()).join(' '));
    }
    if (image.scheduler) {
        segments.push(image.scheduler.toLowerCase());
    }
    if (image.board) {
        segments.push(image.board.toLowerCase());
    }

    return segments.join(' ');
};

interface ImageState {
  // Core Data
  images: IndexedImage[];
  filteredImages: IndexedImage[];
  selectionTotalImages: number;
  selectionDirectoryCount: number;
  directories: Directory[];
  folderSelection: FolderSelectionMap;
  isFolderSelectionLoaded: boolean;

  // UI State
  isLoading: boolean;
  progress: { current: number; total: number } | null;
  enrichmentProgress: { processed: number; total: number } | null;
  indexingState: 'idle' | 'indexing' | 'paused' | 'completed';
  error: string | null;
  success: string | null;
  selectedImage: IndexedImage | null;
  selectedImages: Set<string>;
  previewImage: IndexedImage | null;
  focusedImageIndex: number | null;
  scanSubfolders: boolean;
  isFullscreenMode: boolean;

  // Comparison State
  comparisonImages: [IndexedImage | null, IndexedImage | null];
  isComparisonModalOpen: boolean;

  // Filter & Sort State
  searchQuery: string;
  availableModels: string[];
  availableLoras: string[];
  availableSchedulers: string[];
  availableDimensions: string[];
  selectedModels: string[];
  selectedLoras: string[];
  selectedSchedulers: string[];
  sortOrder: 'asc' | 'desc' | 'date-asc' | 'date-desc';
  advancedFilters: any;

  // Annotations State
  annotations: Map<string, ImageAnnotations>;
  availableTags: TagInfo[];
  selectedTags: string[];
  showFavoritesOnly: boolean;
  isAnnotationsLoaded: boolean;

  // Actions
  addDirectory: (directory: Directory) => void;
  removeDirectory: (directoryId: string) => void;
  toggleDirectoryVisibility: (directoryId: string) => void;
  initializeFolderSelection: () => Promise<void>;
  setFolderSelectionState: (
    path: string,
    state: SelectionState,
    options?: { applyToDescendants?: boolean; clearDescendantOverrides?: boolean }
  ) => void;
  getFolderSelectionState: (path: string) => SelectionState;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: { current: number; total: number } | null) => void;
  setEnrichmentProgress: (progress: { processed: number; total: number } | null) => void;
  setIndexingState: (indexingState: 'idle' | 'indexing' | 'paused' | 'completed') => void;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
  setImages: (images: IndexedImage[]) => void;
  addImages: (newImages: IndexedImage[]) => void;
  replaceDirectoryImages: (directoryId: string, newImages: IndexedImage[]) => void;
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
  setFilterOptions: (options: { models: string[]; loras: string[]; schedulers: string[]; dimensions: string[] }) => void;
  setSelectedFilters: (filters: { models?: string[]; loras?: string[]; schedulers?: string[] }) => void;
  setSortOrder: (order: 'asc' | 'desc' | 'date-asc' | 'date-desc') => void;
  setAdvancedFilters: (filters: any) => void;
  filterAndSortImages: () => void;

  // Selection Actions
  setPreviewImage: (image: IndexedImage | null) => void;
  setSelectedImage: (image: IndexedImage | null) => void;
  toggleImageSelection: (imageId: string) => void;
  selectAllImages: () => void;
  clearImageSelection: () => void;
  deleteSelectedImages: () => Promise<void>; // This will require file operations logic
  setScanSubfolders: (scan: boolean) => void;
  setFocusedImageIndex: (index: number | null) => void;
  setFullscreenMode: (isFullscreen: boolean) => void;

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
  bulkAddTag: (imageIds: string[], tag: string) => Promise<void>;
  bulkRemoveTag: (imageIds: string[], tag: string) => Promise<void>;
  setSelectedTags: (tags: string[]) => void;
  setShowFavoritesOnly: (show: boolean) => void;
  getImageAnnotations: (imageId: string) => ImageAnnotations | null;
  refreshAvailableTags: () => Promise<void>;
  flushPendingImages: () => void;

  // Navigation Actions
  handleNavigateNext: () => void;
  handleNavigatePrevious: () => void;

  // Cleanup invalid images
  cleanupInvalidImages: () => void;

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

    const clearPendingQueue = () => {
        pendingImagesQueue = [];
        if (pendingFlushTimer) {
            clearTimeout(pendingFlushTimer);
            pendingFlushTimer = null;
        }
    };

    const flushPendingImages = () => {
        if (pendingImagesQueue.length === 0) {
            return;
        }

        const imagesToAdd = pendingImagesQueue;
        pendingImagesQueue = [];
        if (pendingFlushTimer) {
            clearTimeout(pendingFlushTimer);
            pendingFlushTimer = null;
        }

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
            const allImages = [...state.images, ...uniqueNewImages];
            return _updateState(state, allImages);
        });
    };

    const scheduleFlush = () => {
        if (pendingFlushTimer) {
            return;
        }
        pendingFlushTimer = setTimeout(() => {
            flushPendingImages();
        }, FLUSH_INTERVAL_MS);
    };

    const getImageById = (state: ImageState, imageId: string): IndexedImage | undefined => {
        return state.images.find(img => img.id === imageId) || state.filteredImages.find(img => img.id === imageId);
    };

    // --- Helper function to recalculate available filters from visible images ---
    const recalculateAvailableFilters = (visibleImages: IndexedImage[]) => {
        const models = new Set<string>();
        const loras = new Set<string>();
        const schedulers = new Set<string>();
        const dimensions = new Set<string>();

        for (const image of visibleImages) {
            image.models?.forEach(model => { if(typeof model === 'string' && model) models.add(model) });
            image.loras?.forEach(lora => { if(typeof lora === 'string' && lora) loras.add(lora) });
            if (image.scheduler) schedulers.add(image.scheduler);
            if (image.dimensions && image.dimensions !== '0x0') dimensions.add(image.dimensions);
        }

        // Case-insensitive alphabetical comparator
        const caseInsensitiveSort = (a: string, b: string) => {
            return a.toLowerCase().localeCompare(b.toLowerCase());
        };

        return {
            availableModels: Array.from(models).sort(caseInsensitiveSort),
            availableLoras: Array.from(loras).sort(caseInsensitiveSort),
            availableSchedulers: Array.from(schedulers).sort(caseInsensitiveSort),
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

                if (isFavoriteChanged || tagsChanged) {
                    hasChanges = true;
                    return {
                        ...img,
                        isFavorite: annotation.isFavorite,
                        tags: annotation.tags,
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
        // Apply annotations to new images
        const imagesWithAnnotations = applyAnnotationsToImages(newImages, currentState.annotations);

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
        };
    };

    // --- Helper function for basic filtering and sorting ---
    const filterAndSort = (state: ImageState) => {
        const { images, searchQuery, selectedModels, selectedLoras, selectedSchedulers, sortOrder, advancedFilters, directories, folderSelection } = state;

        const visibleDirectoryIds = new Set(
            directories.filter(dir => dir.visible ?? true).map(dir => dir.id)
        );

        const normalizedSelection = new Map<string, SelectionState>();
        for (const [path, value] of folderSelection.entries()) {
            normalizedSelection.set(normalizePath(path), value);
        }

        const directoryPathMap = new Map<string, string>();
        const rootPaths: string[] = [];
        directories.forEach(dir => {
            const normalized = normalizePath(dir.path);
            directoryPathMap.set(dir.id, normalized);
            rootPaths.push(normalized);
        });

        const rootCoverage = new Map<string, boolean>();
        rootPaths.forEach(rootPath => {
            const storedState = normalizedSelection.get(rootPath);
            rootCoverage.set(rootPath, storedState ? storedState === 'checked' : true);
        });

        for (const [path, stateValue] of normalizedSelection.entries()) {
            if (stateValue !== 'checked') {
                continue;
            }
            const matchedRoot = rootPaths.find(rootPath => isSameOrDescendantPath(path, rootPath));
            if (matchedRoot) {
                rootCoverage.set(matchedRoot, true);
            }
        }

        const selectionFiltered = images.filter((img) => {
            if (!visibleDirectoryIds.has(img.directoryId || '')) {
                return false;
            }

            const parentPath = directoryPathMap.get(img.directoryId || '');
            if (!parentPath) {
                return false;
            }

            const folderPath = getImageFolderPath(img, parentPath);
            if (folderPath === parentPath) {
                const rootState = normalizedSelection.get(parentPath);
                return rootState ? rootState === 'checked' : true;
            }

            let current: string | null = folderPath;
            while (current && current !== parentPath) {
                const entry = normalizedSelection.get(current);
                if (entry === 'checked') {
                    return true;
                }
                if (entry === 'unchecked') {
                    return false;
                }
                current = getParentPath(current);
            }

            return false;
        });

        let results = selectionFiltered;

        // Step 2: Favorites filter
        if (state.showFavoritesOnly) {
            results = results.filter(img => img.isFavorite === true);
        }

        // Step 3: Tags filter
        if (state.selectedTags && state.selectedTags.length > 0) {
            results = results.filter(img => {
                if (!img.tags || img.tags.length === 0) return false;
                // Match ANY selected tag (OR logic)
                return state.selectedTags.some(tag => img.tags!.includes(tag));
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

        if (selectedLoras.length > 0) {
            results = results.filter(image =>
                image.loras?.length > 0 && selectedLoras.some(sl => image.loras.includes(sl))
            );
        }

        if (selectedSchedulers.length > 0) {
            results = results.filter(image =>
                selectedSchedulers.includes(image.scheduler)
            );
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
                        return steps >= advancedFilters.steps.min && steps <= advancedFilters.steps.max;
                    }
                    return false;
                });
            }
            if (advancedFilters.cfg) {
                 results = results.filter(image => {
                    const cfg = image.cfgScale;
                    if (cfg !== null && cfg !== undefined) {
                        return cfg >= advancedFilters.cfg.min && cfg <= advancedFilters.cfg.max;
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
        }

        const totalInScope = images.length; // Total absoluto de imagens indexadas
        const selectionDirectoryCount = Array.from(rootCoverage.entries())
            .filter(([, selected]) => selected)
            .length;

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

        const sorted = [...results].sort((a, b) => {
            if (sortOrder === 'asc') return compareByNameAsc(a, b);
            if (sortOrder === 'desc') return compareByNameDesc(a, b);
            if (sortOrder === 'date-asc') return compareByDateAsc(a, b);
            if (sortOrder === 'date-desc') return compareByDateDesc(a, b);
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
        selectionTotalImages: 0,
        selectionDirectoryCount: 0,
        directories: [],
        folderSelection: new Map(),
        isFolderSelectionLoaded: false,
        isLoading: false,
        progress: null,
        enrichmentProgress: null,
        indexingState: 'idle',
        error: null,
        success: null,
        selectedImage: null,
        previewImage: null,
        selectedImages: new Set(),
        focusedImageIndex: null,
        searchQuery: '',
        availableModels: [],
        availableLoras: [],
        availableSchedulers: [],
        availableDimensions: [],
        selectedModels: [],
        selectedLoras: [],
        selectedSchedulers: [],
        sortOrder: 'date-desc',
        advancedFilters: {},
        scanSubfolders: localStorage.getItem('image-metahub-scan-subfolders') !== 'false', // Default to true
        isFullscreenMode: false,
        comparisonImages: [null, null],
        isComparisonModalOpen: false,

        // Annotations initial values
        annotations: new Map(),
        availableTags: [],
        selectedTags: [],
        showFavoritesOnly: false,
        isAnnotationsLoaded: false,

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

        initializeFolderSelection: async () => {
            const persisted = await loadFolderSelection();
            set(state => {
                const selectionMap: FolderSelectionMap = new Map();
                Object.entries(persisted || {}).forEach(([key, value]) => {
                    selectionMap.set(normalizePath(key), value as SelectionState);
                });
                const newState = { ...state, folderSelection: selectionMap, isFolderSelectionLoaded: true };
                return { ...newState, ...filterAndSort(newState) };
            });
        },

        setFolderSelectionState: (path, selectionState, options) => {
            const normalizedPath = normalizePath(path);
            set(state => {
                const selection = new Map(state.folderSelection);
                selection.set(normalizedPath, selectionState);

                const shouldApplyDescendants = selectionState === 'unchecked' && options?.applyToDescendants;
                const shouldClearOverrides = selectionState === 'checked' && options?.clearDescendantOverrides;

                if (shouldApplyDescendants || shouldClearOverrides) {
                    const directoryPathMap = new Map(state.directories.map(dir => [dir.id, normalizePath(dir.path)]));
                    const descendantPaths = new Set<string>();
                    descendantPaths.add(normalizedPath);

                    for (const image of state.images) {
                        const rootPath = directoryPathMap.get(image.directoryId || '');
                        if (!rootPath) {
                            continue;
                        }
                        const folderPath = getImageFolderPath(image, rootPath);
                        if (isSameOrDescendantPath(folderPath, normalizedPath)) {
                            descendantPaths.add(folderPath);
                        }
                    }

                    if (shouldClearOverrides) {
                        descendantPaths.forEach(descPath => {
                            selection.set(descPath, 'checked');
                        });
                    }

                    if (shouldApplyDescendants) {
                        descendantPaths.forEach(descPath => {
                            selection.set(descPath, 'unchecked');
                        });
                    }
                }

                const newState = { ...state, folderSelection: selection };
                const resultState = { ...newState, ...filterAndSort(newState) };
                
                // Recalculate available filters based on the new filtered images
                const availableFilters = recalculateAvailableFilters(resultState.filteredImages);
                const finalState = { ...resultState, ...availableFilters };

                saveFolderSelection(mapToRecord(selection)).catch((error) => {
                    console.error('Failed to persist folder selection state', error);
                });

                return finalState;
            });
        },

        getFolderSelectionState: (path) => {
            const selection = get().folderSelection;
            const directories = get().directories;
            const normalizedPath = normalizePath(path);

            if (selection.has(normalizedPath)) {
                return selection.get(normalizedPath)!;
            }

            const rootPaths = new Set(directories.map(dir => normalizePath(dir.path)));
            if (rootPaths.has(normalizedPath)) {
                return 'checked';
            }

            return 'unchecked';
        },

        removeDirectory: (directoryId) => {
            const { directories, images, folderSelection } = get();
            const targetDirectory = directories.find(d => d.id === directoryId);
            const newDirectories = directories.filter(d => d.id !== directoryId);
            if (window.electronAPI) {
                localStorage.setItem('image-metahub-directories', JSON.stringify(newDirectories.map(d => d.path)));
            }
            const newImages = images.filter(img => img.directoryId !== directoryId);

            const updatedSelection = new Map(folderSelection);
            if (targetDirectory) {
                const normalizedPath = normalizePath(targetDirectory.path);
                for (const key of Array.from(updatedSelection.keys())) {
                    if (normalizePath(key) === normalizedPath || isDescendantPath(key, normalizedPath)) {
                        updatedSelection.delete(key);
                    }
                }
            }

            set(state => {
                const baseState = { ...state, directories: newDirectories, folderSelection: updatedSelection };
                return _updateState(baseState, newImages);
            });

            saveFolderSelection(mapToRecord(updatedSelection)).catch((error) => {
                console.error('Failed to persist folder selection state', error);
            });
        },

        setLoading: (loading) => set({ isLoading: loading }),
        setProgress: (progress) => set({ progress }),
        setEnrichmentProgress: (progress) => set({ enrichmentProgress: progress }),
        setIndexingState: (indexingState) => set({ indexingState }),
        setError: (error) => set({ error, success: null }),
        setSuccess: (success) => set({ success, error: null }),

        filterAndSortImages: () => set(state => filterAndSort(state)),

        setImages: (images) => {
            clearPendingQueue();
            set(state => _updateState(state, images));
        },

        addImages: (newImages) => {
            if (!newImages || newImages.length === 0) {
                return;
            }
            pendingImagesQueue.push(...newImages);
            scheduleFlush();
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
        },

        mergeImages: (updatedImages) => {
            flushPendingImages();
            set(state => {
                if (!updatedImages || updatedImages.length === 0) {
                    return state;
                }
                const updates = new Map(updatedImages.map(img => [img.id, img]));
                const merged = state.images.map(img => updates.get(img.id) ?? img);
                return _updateState(state, merged);
            });
        },

        clearImages: (directoryId?: string) => set(state => {
            clearPendingQueue();
            if (directoryId) {
                const newImages = state.images.filter(img => img.directoryId !== directoryId);
                return _updateState(state, newImages);
            } else {
                return _updateState(state, []);
            }
        }),

        removeImages: (imageIds) => {
            const idsToRemove = new Set(imageIds);
            clearPendingQueue();
            set(state => {
                const remainingImages = state.images.filter(img => !idsToRemove.has(img.id));
                return _updateState(state, remainingImages);
            });
        },

        removeImage: (imageId) => {
            clearPendingQueue();
            set(state => {
                const remainingImages = state.images.filter(img => img.id !== imageId);
                return _updateState(state, remainingImages);
            });
        },

        updateImage: (imageId, newName) => {
            set(state => {
                const updatedImages = state.images.map(img => img.id === imageId ? { ...img, name: newName } : img);
                // No need to recalculate filters for a simple name change
                return { ...state, ...filterAndSort({ ...state, images: updatedImages }), images: updatedImages };
            });
        },

        setImageThumbnail: (imageId, data) => {
            const preState = get();
            const preImage = getImageById(preState, imageId);

            if (!preImage) {
                return;
            }

            const nextThumbnailUrl = data.thumbnailUrl ?? preImage.thumbnailUrl;
            const nextThumbnailHandle = data.thumbnailHandle ?? preImage.thumbnailHandle;
            const nextThumbnailStatus = data.status;
            const nextThumbnailError = data.error ?? (data.status === 'error'
                ? 'Failed to load thumbnail'
                : preImage.thumbnailError);

            const lastState = lastThumbnailState.get(imageId);
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
                preImage.thumbnailUrl === nextThumbnailUrl &&
                preImage.thumbnailHandle === nextThumbnailHandle &&
                preImage.thumbnailStatus === nextThumbnailStatus &&
                preImage.thumbnailError === nextThumbnailError
            ) {
                lastThumbnailState.set(imageId, {
                    url: nextThumbnailUrl,
                    handle: nextThumbnailHandle,
                    status: nextThumbnailStatus,
                    error: nextThumbnailError,
                });
                return;
            }

            if (thumbnailUpdateInProgress.has(imageId)) {
                return;
            }

            thumbnailUpdateInProgress.add(imageId);

            try {
                set(state => {
                    // CIRCUIT BREAKER: Prevent excessive updates
                    const now = Date.now();
                    const stats = thumbnailUpdateTimestamps.get(imageId) || { count: 0, lastUpdate: now };

                    if (now - stats.lastUpdate > 1000) {
                        stats.count = 0;
                        stats.lastUpdate = now;
                    }

                    stats.count++;
                    thumbnailUpdateTimestamps.set(imageId, stats);

                    if (stats.count > 10) {
                        console.warn(`⚠️ Circuit breaker activated: ${imageId} received ${stats.count} updates in 1s. Blocking update.`);
                        return state;
                    }

                    const currentImage = getImageById(state, imageId);

                    if (!currentImage) {
                        return state;
                    }

                    const nextThumbnailUrl = data.thumbnailUrl ?? currentImage.thumbnailUrl;
                    const nextThumbnailHandle = data.thumbnailHandle ?? currentImage.thumbnailHandle;
                    const nextThumbnailStatus = data.status;
                    const nextThumbnailError = data.error ?? (data.status === 'error'
                        ? 'Failed to load thumbnail'
                        : currentImage.thumbnailError);

                    if (
                        currentImage.thumbnailUrl === nextThumbnailUrl &&
                        currentImage.thumbnailHandle === nextThumbnailHandle &&
                        currentImage.thumbnailStatus === nextThumbnailStatus &&
                        currentImage.thumbnailError === nextThumbnailError
                    ) {
                        return state;
                    }

                    const updateList = (list: IndexedImage[]) => {
                        const index = list.findIndex(img => img.id === imageId);
                        if (index === -1) {
                            return list;
                        }

                        const current = list[index];

                        if (
                            current.thumbnailUrl === nextThumbnailUrl &&
                            current.thumbnailHandle === nextThumbnailHandle &&
                            current.thumbnailStatus === nextThumbnailStatus &&
                            current.thumbnailError === nextThumbnailError
                        ) {
                            return list;
                        }

                        const newList = [...list];
                        newList[index] = {
                            ...list[index],
                            thumbnailUrl: nextThumbnailUrl,
                            thumbnailHandle: nextThumbnailHandle,
                            thumbnailStatus: nextThumbnailStatus,
                            thumbnailError: nextThumbnailError,
                        };
                        return newList;
                    };

                    const updatedImages = updateList(state.images);
                    const updatedFilteredImages = updateList(state.filteredImages);

                    if (updatedImages === state.images && updatedFilteredImages === state.filteredImages) {
                        return state;
                    }

                    lastThumbnailState.set(imageId, {
                        url: nextThumbnailUrl,
                        handle: nextThumbnailHandle,
                        status: nextThumbnailStatus,
                        error: nextThumbnailError,
                    });

                    return {
                        ...state,
                        images: updatedImages,
                        filteredImages: updatedFilteredImages,
                    };
                });
            } finally {
                thumbnailUpdateInProgress.delete(imageId);
            }
        },

        setSearchQuery: (query) => set(state => ({ ...filterAndSort({ ...state, searchQuery: query }), searchQuery: query })),

        setFilterOptions: (options) => set({
            availableModels: options.models,
            availableLoras: options.loras,
            availableSchedulers: options.schedulers,
            availableDimensions: options.dimensions,
        }),

        setSelectedFilters: (filters) => set(state => ({
            ...filterAndSort({
                ...state,
                selectedModels: filters.models ?? state.selectedModels,
                selectedLoras: filters.loras ?? state.selectedLoras,
                selectedSchedulers: filters.schedulers ?? state.selectedSchedulers,
            }),
            selectedModels: filters.models ?? state.selectedModels,
            selectedLoras: filters.loras ?? state.selectedLoras,
            selectedSchedulers: filters.schedulers ?? state.selectedSchedulers,
        })),

        setAdvancedFilters: (filters) => set(state => ({
            ...filterAndSort({ ...state, advancedFilters: filters }),
            advancedFilters: filters,
        })),

        setSortOrder: (order) => set(state => ({ ...filterAndSort({ ...state, sortOrder: order }), sortOrder: order })),

        setPreviewImage: (image) => set({ previewImage: image }),
        setSelectedImage: (image) => set({ selectedImage: image }),
        setFocusedImageIndex: (index) => set({ focusedImageIndex: index }),
        setFullscreenMode: (isFullscreen) => set({ isFullscreenMode: isFullscreen }),

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
        },

        toggleFavorite: async (imageId) => {
            const { annotations, images } = get();

            const currentAnnotation = annotations.get(imageId);
            const newIsFavorite = !(currentAnnotation?.isFavorite ?? false);

            const updatedAnnotation: ImageAnnotations = {
                imageId,
                isFavorite: newIsFavorite,
                tags: currentAnnotation?.tags ?? [],
                addedAt: currentAnnotation?.addedAt ?? Date.now(),
                updatedAt: Date.now(),
            };

            // Update in-memory state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                newAnnotations.set(imageId, updatedAnnotation);

                const updatedImages = state.images.map(img =>
                    img.id === imageId ? { ...img, isFavorite: newIsFavorite } : img
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
                updatedAnnotations.push({
                    imageId,
                    isFavorite,
                    tags: current?.tags ?? [],
                    addedAt: current?.addedAt ?? Date.now(),
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
                        return { ...img, isFavorite: annotation.isFavorite };
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

        addTagToImage: async (imageId, tag) => {
            const normalizedTag = tag.trim().toLowerCase();
            if (!normalizedTag) return;

            const { annotations } = get();
            const currentAnnotation = annotations.get(imageId);

            // Don't add duplicate
            if (currentAnnotation?.tags.includes(normalizedTag)) {
                return;
            }

            const updatedAnnotation: ImageAnnotations = {
                imageId,
                isFavorite: currentAnnotation?.isFavorite ?? false,
                tags: [...(currentAnnotation?.tags ?? []), normalizedTag],
                addedAt: currentAnnotation?.addedAt ?? Date.now(),
                updatedAt: Date.now(),
            };

            // Update state
            set(state => {
                const newAnnotations = new Map(state.annotations);
                newAnnotations.set(imageId, updatedAnnotation);

                const updatedImages = state.images.map(img =>
                    img.id === imageId ? { ...img, tags: updatedAnnotation.tags } : img
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
                    img.id === imageId ? { ...img, tags: updatedAnnotation.tags } : img
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

        bulkAddTag: async (imageIds, tag) => {
            const normalizedTag = tag.trim().toLowerCase();
            if (!normalizedTag || imageIds.length === 0) return;

            const { annotations } = get();
            const updatedAnnotations: ImageAnnotations[] = [];

            for (const imageId of imageIds) {
                const current = annotations.get(imageId);
                if (current?.tags.includes(normalizedTag)) {
                    continue; // Skip if already tagged
                }

                updatedAnnotations.push({
                    imageId,
                    isFavorite: current?.isFavorite ?? false,
                    tags: [...(current?.tags ?? []), normalizedTag],
                    addedAt: current?.addedAt ?? Date.now(),
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
                        return { ...img, tags: annotation.tags };
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
            bulkSaveAnnotations(updatedAnnotations).catch(error => {
                console.error('Failed to bulk save annotations:', error);
            });
            get().refreshAvailableTags();
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
                        return { ...img, tags: annotation.tags };
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
            bulkSaveAnnotations(updatedAnnotations).catch(error => {
                console.error('Failed to bulk save annotations:', error);
            });
            get().refreshAvailableTags();
        },

        setSelectedTags: (tags) => set(state => {
            const newState = { ...state, selectedTags: tags };
            return { ...newState, ...filterAndSort(newState) };
        }),

        setShowFavoritesOnly: (show) => set(state => {
            const newState = { ...state, showFavoritesOnly: show };
            return { ...newState, ...filterAndSort(newState) };
        }),

        getImageAnnotations: (imageId) => {
            return get().annotations.get(imageId) || null;
        },

        refreshAvailableTags: async () => {
            const tags = await getAllTags();
            set({ availableTags: tags });
        },

        flushPendingImages: () => {
            flushPendingImages();
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
            const allImageIds = new Set(state.filteredImages.map(img => img.id));
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
            const currentIndex = state.filteredImages.findIndex(img => img.id === state.selectedImage!.id);
            if (currentIndex < state.filteredImages.length - 1) {
                const nextImage = state.filteredImages[currentIndex + 1];
                set({ selectedImage: nextImage });
            }
        },

        handleNavigatePrevious: () => {
            const state = get();
            if (!state.selectedImage) return;
            const currentIndex = state.filteredImages.findIndex(img => img.id === state.selectedImage!.id);
            if (currentIndex > 0) {
                const prevImage = state.filteredImages[currentIndex - 1];
                set({ selectedImage: prevImage });
            }
        },

        resetState: () => set({
            images: [],
            filteredImages: [],
            selectionTotalImages: 0,
            selectionDirectoryCount: 0,
            directories: [],
            folderSelection: new Map(),
            isFolderSelectionLoaded: false,
            isLoading: false,
            progress: { current: 0, total: 0 },
            enrichmentProgress: null,
            error: null,
            success: null,
            selectedImage: null,
            selectedImages: new Set(),
            searchQuery: '',
            availableModels: [],
            availableLoras: [],
            availableSchedulers: [],
            availableDimensions: [],
            selectedModels: [],
            selectedLoras: [],
            selectedSchedulers: [],
            advancedFilters: {},
            indexingState: 'idle',
            previewImage: null,
            focusedImageIndex: null,
            scanSubfolders: true,
            sortOrder: 'desc',
            isFullscreenMode: false,
            comparisonImages: [null, null],
            isComparisonModalOpen: false,
            annotations: new Map(),
            availableTags: [],
            selectedTags: [],
            showFavoritesOnly: false,
            isAnnotationsLoaded: false,
        }),

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
        }
    }
});
