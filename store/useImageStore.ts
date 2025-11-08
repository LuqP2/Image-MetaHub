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
  focusedImageIndex: number | null;
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
  toggleImageSelection: (imageId: string) => void;
  selectAllImages: () => void;
  clearImageSelection: () => void;
  deleteSelectedImages: () => Promise<void>; // This will require file operations logic
  setScanSubfolders: (scan: boolean) => void;
  setFocusedImageIndex: (index: number | null) => void;

  // Navigation Actions
  handleNavigateNext: () => void;
  handleNavigatePrevious: () => void;

  // Cleanup invalid images
  cleanupInvalidImages: () => void;

  // Reset Actions
  resetState: () => void;
}

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

        setPreviewImage: (image) => set({ previewImage: image }),
        setSelectedImage: (image) => set({ selectedImage: image }),
        setFocusedImageIndex: (index) => set({ focusedImageIndex: index }),

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