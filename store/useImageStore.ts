import { create } from 'zustand';
import { IndexedImage, Directory, ThumbnailStatus } from '../types';
import { loadFolderSelection, saveFolderSelection, StoredSelectionState } from '../services/folderSelectionStorage';

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
        segments.push(image.models.map(model => model.toLowerCase()).join(' '));
    }
    if (image.loras?.length) {
        segments.push(image.loras.map(lora => lora.toLowerCase()).join(' '));
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
  focusedImageId: string | null;
  selectionAnchorId: string | null;
  lastSelectedImageId: string | null;
  imageOrder: Map<string, number>;
  scanSubfolders: boolean;

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
  setFocusedImageId: (imageId: string | null, options?: { updateAnchor?: boolean }) => void;
  focusAdjacentImage: (offset: number) => void;
  toggleFocusedSelection: () => void;
  selectRangeTo: (imageId: string, options?: { additive?: boolean }) => void;
  setSelectionFromIds: (
    imageIds: string[],
    options?: { focusId?: string | null; anchorId?: string | null; lastSelectedId?: string | null }
  ) => void;
  handlePrimarySelection: (
    image: IndexedImage,
    modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
  ) => void;
  toggleImageSelection: (imageId: string) => void;
  selectAllImages: () => void;
  clearImageSelection: () => void;
  deleteSelectedImages: () => Promise<void>; // This will require file operations logic
  setScanSubfolders: (scan: boolean) => void;

  // Navigation Actions
  handleNavigateNext: () => void;
  handleNavigatePrevious: () => void;

  // Cleanup invalid images
  cleanupInvalidImages: () => void;

  // Reset Actions
  resetState: () => void;
}

const getImageById = (images: IndexedImage[], id?: string | null): IndexedImage | null => {
    if (!id) {
        return null;
    }
    return images.find(img => img.id === id) ?? null;
};

type PreviewSlice = Pick<
    ImageState,
    'images' | 'filteredImages' | 'selectedImages' | 'focusedImageId' | 'lastSelectedImageId' | 'imageOrder'
>;

const getImageFromState = (state: PreviewSlice, id?: string | null): IndexedImage | null => {
    if (!id) {
        return null;
    }
    return getImageById(state.filteredImages, id) ?? getImageById(state.images, id);
};

const computeLastSelectedId = (selection: Set<string>, order: Map<string, number>): string | null => {
    if (selection.size === 0) {
        return null;
    }
    let lastId: string | null = null;
    let lastIndex = -1;
    for (const id of selection) {
        const index = order.get(id) ?? -1;
        if (index > lastIndex) {
            lastIndex = index;
            lastId = id;
        }
    }
    return lastId;
};

const resolvePreviewImage = (
    state: PreviewSlice,
    overrides?: { focusId?: string | null; lastSelectedId?: string | null }
): IndexedImage | null => {
    const focusId = overrides?.focusId ?? state.focusedImageId;
    const lastSelectedId = overrides?.lastSelectedId ?? state.lastSelectedImageId;

    const focused = getImageFromState(state, focusId);
    if (focused) {
        return focused;
    }

    if (lastSelectedId) {
        const lastSelected = getImageFromState(state, lastSelectedId);
        if (lastSelected) {
            return lastSelected;
        }
    }

    if (state.selectedImages.size > 0) {
        const fallbackId = computeLastSelectedId(state.selectedImages, state.imageOrder);
        if (fallbackId) {
            const fallback = getImageFromState(state, fallbackId);
            if (fallback) {
                return fallback;
            }
        }
    }

    return null;
};

export const useImageStore = create<ImageState>((set, get) => {
    // --- Helper function for recalculating all derived state ---
    const _updateState = (currentState: ImageState, newImages: IndexedImage[]) => {
        const models = new Set<string>();
        const loras = new Set<string>();
        const schedulers = new Set<string>();
        const dimensions = new Set<string>();

        for (const image of newImages) {
            image.models?.forEach(model => { if(model) models.add(model) });
            image.loras?.forEach(lora => { if(lora) loras.add(lora) });
            if (image.scheduler) schedulers.add(image.scheduler);
            if (image.dimensions && image.dimensions !== '0x0') dimensions.add(image.dimensions);
        }

        const newState: Partial<ImageState> = {
            images: newImages,
            availableModels: Array.from(models).sort(),
            availableLoras: Array.from(loras).sort(),
            availableSchedulers: Array.from(schedulers).sort(),
            availableDimensions: Array.from(dimensions).sort((a, b) => {
                // Sort dimensions by total pixels (width * height)
                const [aWidth, aHeight] = a.split('x').map(Number);
                const [bWidth, bHeight] = b.split('x').map(Number);
                return (aWidth * aHeight) - (bWidth * bHeight);
            }),
        };

        const combinedState = { ...currentState, ...newState };

        return { ...combinedState, ...filterAndSort(combinedState) };
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
                selectedModels.some(sm => image.models.includes(sm))
            );
        }

        if (selectedLoras.length > 0) {
            results = results.filter(image =>
                selectedLoras.some(sl => image.loras.includes(sl))
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

        const totalInScope = selectionFiltered.length;
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

        const imageOrder = new Map<string, number>();
        const validIds = new Set<string>();
        sorted.forEach((img, index) => {
            imageOrder.set(img.id, index);
            validIds.add(img.id);
        });

        const filteredSelection = new Set(Array.from(state.selectedImages).filter(id => validIds.has(id)));
        const lastSelectedId = computeLastSelectedId(filteredSelection, imageOrder);

        const focusCandidate = state.focusedImageId && getImageById(state.images, state.focusedImageId)
            ? state.focusedImageId
            : lastSelectedId ?? state.focusedImageId ?? null;

        const anchorCandidate = state.selectionAnchorId && getImageById(state.images, state.selectionAnchorId)
            ? state.selectionAnchorId
            : focusCandidate;

        const previewSlice: PreviewSlice = {
            images: state.images,
            filteredImages: sorted,
            selectedImages: filteredSelection,
            focusedImageId: focusCandidate ?? null,
            lastSelectedImageId: lastSelectedId ?? null,
            imageOrder,
        };

        const previewImage = resolvePreviewImage(previewSlice, {
            focusId: previewSlice.focusedImageId,
            lastSelectedId: previewSlice.lastSelectedImageId,
        });

        return {
            filteredImages: sorted,
            selectionTotalImages: totalInScope,
            selectionDirectoryCount,
            imageOrder,
            selectedImages: filteredSelection,
            lastSelectedImageId: lastSelectedId ?? null,
            focusedImageId: previewSlice.focusedImageId,
            selectionAnchorId: anchorCandidate ?? null,
            previewImage,
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
        focusedImageId: null,
        selectionAnchorId: null,
        lastSelectedImageId: null,
        imageOrder: new Map(),
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
        scanSubfolders: localStorage.getItem('image-metahub-scan-subfolders') === 'true',

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

                saveFolderSelection(mapToRecord(selection)).catch((error) => {
                    console.error('Failed to persist folder selection state', error);
                });

                return resultState;
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

        setImages: (images) => set(state => _updateState(state, images)),

        addImages: (newImages) => {
            set(state => {
                const existingIds = new Set(state.images.map(img => img.id));
                const uniqueNewImages = newImages.filter(img => !existingIds.has(img.id));
                if (uniqueNewImages.length === 0) {
                    return state; // No changes
                }
                const allImages = [...state.images, ...uniqueNewImages];
                return _updateState(state, allImages);
            });
        },

        replaceDirectoryImages: (directoryId, newImages) => {
            set(state => {
                // Remove all images from this directory
                const otherImages = state.images.filter(img => img.directoryId !== directoryId);
                // Add new images for this directory
                const allImages = [...otherImages, ...newImages];
                return _updateState(state, allImages);
            });
        },

        mergeImages: (updatedImages) => {
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
            if (directoryId) {
                const newImages = state.images.filter(img => img.directoryId !== directoryId);
                return _updateState(state, newImages);
            } else {
                return _updateState(state, []);
            }
        }),

        removeImages: (imageIds) => {
            const idsToRemove = new Set(imageIds);
            set(state => {
                const remainingImages = state.images.filter(img => !idsToRemove.has(img.id));
                return _updateState(state, remainingImages);
            });
        },

        removeImage: (imageId) => {
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
            set(state => {
                const updateList = (list: IndexedImage[]) => list.map(img => {
                    if (img.id !== imageId) {
                        return img;
                    }
                    return {
                        ...img,
                        thumbnailUrl: data.thumbnailUrl ?? img.thumbnailUrl,
                        thumbnailHandle: data.thumbnailHandle ?? img.thumbnailHandle,
                        thumbnailStatus: data.status,
                        thumbnailError: data.error ?? (data.status === 'error' ? (data.error ?? 'Failed to load thumbnail') : null),
                    };
                });

                return {
                    ...state,
                    images: updateList(state.images),
                    filteredImages: updateList(state.filteredImages),
                };
            });
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

        setPreviewImage: (image) => set(state => {
            if (!image) {
                const emptySelection = new Set<string>();
                return {
                    previewImage: null,
                    selectedImage: null,
                    focusedImageId: null,
                    selectionAnchorId: null,
                    lastSelectedImageId: null,
                    selectedImages: emptySelection,
                };
            }

            const focusId = image.id;
            const nextSelection = state.selectedImages.size === 0
                ? new Set<string>([focusId])
                : new Set(state.selectedImages);
            if (!nextSelection.has(focusId)) {
                nextSelection.add(focusId);
            }

            return {
                previewImage: image,
                selectedImage: image,
                focusedImageId: focusId,
                selectionAnchorId: focusId,
                lastSelectedImageId: focusId,
                selectedImages: nextSelection,
            };
        }),

        setSelectedImage: (image) => set(state => {
            if (!image) {
                const previewSlice: PreviewSlice = {
                    images: state.images,
                    filteredImages: state.filteredImages,
                    selectedImages: state.selectedImages,
                    focusedImageId: null,
                    lastSelectedImageId: state.lastSelectedImageId,
                    imageOrder: state.imageOrder,
                };
                return {
                    selectedImage: null,
                    focusedImageId: null,
                    selectionAnchorId: null,
                    previewImage: resolvePreviewImage(previewSlice, { focusId: null }),
                };
            }

            const focusId = image.id;
            const updatedSelection = state.selectedImages.size > 0 && state.selectedImages.has(focusId)
                ? new Set(state.selectedImages)
                : new Set<string>([focusId]);
            const previewSlice: PreviewSlice = {
                images: state.images,
                filteredImages: state.filteredImages,
                selectedImages: updatedSelection,
                focusedImageId: focusId,
                lastSelectedImageId: focusId,
                imageOrder: state.imageOrder,
            };
            return {
                selectedImage: image,
                focusedImageId: focusId,
                selectionAnchorId: focusId,
                lastSelectedImageId: focusId,
                selectedImages: updatedSelection,
                previewImage: resolvePreviewImage(previewSlice, { focusId, lastSelectedId: focusId }),
            };
        }),

        setFocusedImageId: (imageId, options) => {
            set(state => {
                const focusId = imageId ?? null;
                const anchorId = options?.updateAnchor === false ? state.selectionAnchorId : (focusId ?? state.selectionAnchorId);
                const previewSlice: PreviewSlice = {
                    images: state.images,
                    filteredImages: state.filteredImages,
                    selectedImages: state.selectedImages,
                    focusedImageId: focusId,
                    lastSelectedImageId: state.lastSelectedImageId,
                    imageOrder: state.imageOrder,
                };
                const previewImage = resolvePreviewImage(previewSlice, { focusId });
                const focusedImage = getImageFromState(previewSlice, focusId);
                return {
                    focusedImageId: focusId,
                    selectionAnchorId: anchorId ?? null,
                    previewImage,
                    selectedImage: focusedImage ?? state.selectedImage,
                };
            });
        },

        focusAdjacentImage: (offset) => {
            const state = get();
            if (state.filteredImages.length === 0) {
                return;
            }
            const currentIndex = state.focusedImageId && state.imageOrder.has(state.focusedImageId)
                ? state.imageOrder.get(state.focusedImageId) ?? 0
                : state.lastSelectedImageId && state.imageOrder.has(state.lastSelectedImageId)
                    ? state.imageOrder.get(state.lastSelectedImageId) ?? 0
                    : 0;
            let nextIndex = (currentIndex ?? 0) + offset;
            if (nextIndex < 0) {
                nextIndex = 0;
            }
            if (nextIndex >= state.filteredImages.length) {
                nextIndex = state.filteredImages.length - 1;
            }
            const nextImage = state.filteredImages[nextIndex];
            if (!nextImage) {
                return;
            }

            set(prevState => {
                const previewSlice: PreviewSlice = {
                    images: prevState.images,
                    filteredImages: prevState.filteredImages,
                    selectedImages: prevState.selectedImages,
                    focusedImageId: nextImage.id,
                    lastSelectedImageId: prevState.lastSelectedImageId,
                    imageOrder: prevState.imageOrder,
                };
                return {
                    focusedImageId: nextImage.id,
                    selectionAnchorId: prevState.selectionAnchorId ?? nextImage.id,
                    selectedImage: nextImage,
                    previewImage: resolvePreviewImage(previewSlice, { focusId: nextImage.id }),
                };
            });
        },

        toggleFocusedSelection: () => {
            const focusId = get().focusedImageId;
            if (!focusId) {
                return;
            }
            get().toggleImageSelection(focusId);
        },

        selectRangeTo: (imageId, options) => {
            const state = get();
            const anchorId = state.selectionAnchorId ?? state.focusedImageId ?? imageId;
            const anchorIndex = anchorId ? state.imageOrder.get(anchorId) : undefined;
            const targetIndex = state.imageOrder.get(imageId);
            if (anchorIndex === undefined || targetIndex === undefined) {
                return;
            }
            const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
            const idsInRange = state.filteredImages.slice(start, end + 1).map(img => img.id);

            set(prevState => {
                const newSelection = options?.additive ? new Set(prevState.selectedImages) : new Set<string>();
                idsInRange.forEach(id => newSelection.add(id));
                const lastSelectedId = idsInRange[idsInRange.length - 1] ?? anchorId ?? null;
                const previewSlice: PreviewSlice = {
                    images: prevState.images,
                    filteredImages: prevState.filteredImages,
                    selectedImages: newSelection,
                    focusedImageId: imageId,
                    lastSelectedImageId: lastSelectedId ?? null,
                    imageOrder: prevState.imageOrder,
                };
                return {
                    selectedImages: newSelection,
                    focusedImageId: imageId,
                    selectionAnchorId: anchorId ?? imageId,
                    lastSelectedImageId: lastSelectedId ?? null,
                    previewImage: resolvePreviewImage(previewSlice, { focusId: imageId, lastSelectedId }),
                    selectedImage: getImageFromState(previewSlice, imageId) ?? prevState.selectedImage,
                };
            });
        },

        setSelectionFromIds: (imageIds, options) => {
            set(state => {
                const newSelection = new Set(imageIds);
                const lastSelectedId = options?.lastSelectedId ?? computeLastSelectedId(newSelection, state.imageOrder);
                const focusId = options?.focusId ?? state.focusedImageId ?? lastSelectedId ?? null;
                const anchorId = options?.anchorId ?? focusId ?? lastSelectedId ?? null;
                const previewSlice: PreviewSlice = {
                    images: state.images,
                    filteredImages: state.filteredImages,
                    selectedImages: newSelection,
                    focusedImageId: focusId ?? null,
                    lastSelectedImageId: lastSelectedId ?? null,
                    imageOrder: state.imageOrder,
                };
                return {
                    selectedImages: newSelection,
                    focusedImageId: focusId ?? null,
                    selectionAnchorId: anchorId ?? null,
                    lastSelectedImageId: lastSelectedId ?? null,
                    previewImage: resolvePreviewImage(previewSlice, { focusId: focusId ?? null, lastSelectedId }),
                    selectedImage: getImageFromState(previewSlice, focusId ?? null) ?? state.selectedImage,
                };
            });
        },

        handlePrimarySelection: (image, modifiers) => {
            if (modifiers.shiftKey) {
                get().selectRangeTo(image.id, { additive: modifiers.ctrlKey || modifiers.metaKey });
                return;
            }

            set(state => {
                const additive = modifiers.ctrlKey || modifiers.metaKey;
                let newSelection = additive ? new Set(state.selectedImages) : new Set<string>();
                if (additive) {
                    if (newSelection.has(image.id)) {
                        newSelection.delete(image.id);
                    } else {
                        newSelection.add(image.id);
                    }
                } else {
                    newSelection.add(image.id);
                }

                const lastSelectedId = newSelection.size === 0
                    ? null
                    : (newSelection.has(image.id) ? image.id : computeLastSelectedId(newSelection, state.imageOrder));

                const focusId = image.id;
                const previewSlice: PreviewSlice = {
                    images: state.images,
                    filteredImages: state.filteredImages,
                    selectedImages: newSelection,
                    focusedImageId: focusId,
                    lastSelectedImageId: lastSelectedId ?? null,
                    imageOrder: state.imageOrder,
                };

                return {
                    selectedImages: newSelection,
                    focusedImageId: focusId,
                    selectionAnchorId: focusId,
                    lastSelectedImageId: lastSelectedId ?? null,
                    previewImage: resolvePreviewImage(previewSlice, { focusId, lastSelectedId }),
                    selectedImage: image,
                };
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
                const lastSelectedId = newSelection.size === 0
                    ? null
                    : (newSelection.has(imageId) ? imageId : computeLastSelectedId(newSelection, state.imageOrder));
                const focusId = state.focusedImageId ?? imageId;
                const previewSlice: PreviewSlice = {
                    images: state.images,
                    filteredImages: state.filteredImages,
                    selectedImages: newSelection,
                    focusedImageId: focusId,
                    lastSelectedImageId: lastSelectedId ?? null,
                    imageOrder: state.imageOrder,
                };
                return {
                    selectedImages: newSelection,
                    focusedImageId: focusId,
                    selectionAnchorId: state.selectionAnchorId ?? focusId,
                    lastSelectedImageId: lastSelectedId ?? null,
                    previewImage: resolvePreviewImage(previewSlice, { focusId, lastSelectedId }),
                    selectedImage: getImageFromState(previewSlice, focusId) ?? state.selectedImage,
                };
            });
        },

        selectAllImages: () => set(state => {
            const allIds = state.filteredImages.map(img => img.id);
            const newSelection = new Set(allIds);
            const lastSelectedId = computeLastSelectedId(newSelection, state.imageOrder);
            const focusId = state.focusedImageId ?? (allIds[0] ?? null);
            const previewSlice: PreviewSlice = {
                images: state.images,
                filteredImages: state.filteredImages,
                selectedImages: newSelection,
                focusedImageId: focusId ?? null,
                lastSelectedImageId: lastSelectedId ?? null,
                imageOrder: state.imageOrder,
            };
            return {
                selectedImages: newSelection,
                focusedImageId: focusId ?? null,
                selectionAnchorId: focusId ?? lastSelectedId ?? null,
                lastSelectedImageId: lastSelectedId ?? null,
                previewImage: resolvePreviewImage(previewSlice, { focusId: focusId ?? null, lastSelectedId }),
            };
        }),

        clearImageSelection: () => set(state => {
            const emptySelection = new Set<string>();
            const previewSlice: PreviewSlice = {
                images: state.images,
                filteredImages: state.filteredImages,
                selectedImages: emptySelection,
                focusedImageId: state.focusedImageId,
                lastSelectedImageId: null,
                imageOrder: state.imageOrder,
            };
            return {
                selectedImages: emptySelection,
                lastSelectedImageId: null,
                previewImage: resolvePreviewImage(previewSlice, { focusId: state.focusedImageId, lastSelectedId: null }),
            };
        }),

        deleteSelectedImages: async () => {
            get().clearImageSelection();
        },

        setScanSubfolders: (scan) => {
            localStorage.setItem('image-metahub-scan-subfolders', String(scan));
            set({ scanSubfolders: scan });
        },

        handleNavigateNext: () => {
            get().focusAdjacentImage(1);
        },

        handleNavigatePrevious: () => {
            get().focusAdjacentImage(-1);
        },

        resetState: () => set({
            images: [],
            filteredImages: [],
            selectionTotalImages: 0,
            selectionDirectoryCount: 0,
            directories: [],
            isLoading: false,
            progress: { current: 0, total: 0 },
            enrichmentProgress: null,
            error: null,
            success: null,
            selectedImage: null,
            previewImage: null,
            selectedImages: new Set(),
            focusedImageId: null,
            selectionAnchorId: null,
            lastSelectedImageId: null,
            imageOrder: new Map(),
            searchQuery: '',
            availableModels: [],
            availableLoras: [],
            availableSchedulers: [],
            availableDimensions: [],
            selectedModels: [],
            selectedLoras: [],
            selectedSchedulers: [],
            advancedFilters: {},
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