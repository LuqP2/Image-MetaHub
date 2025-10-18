import { create } from 'zustand';
import { IndexedImage, Directory } from '../types';

interface ImageState {
  // Core Data
  images: IndexedImage[];
  filteredImages: IndexedImage[];
  directories: Directory[];
  visibleSubfolders: Set<string>; // Track which subfolder paths are visible

  // UI State
  isLoading: boolean;
  progress: { current: number; total: number } | null;
  indexingState: 'idle' | 'indexing' | 'paused' | 'completed';
  error: string | null;
  success: string | null;
  selectedImage: IndexedImage | null;
  selectedImages: Set<string>;
  previewImage: IndexedImage | null;
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
  toggleSubfolderVisibility: (subfolderPath: string) => void;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: { current: number; total: number } | null) => void;
  setIndexingState: (indexingState: 'idle' | 'indexing' | 'paused' | 'completed') => void;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
  setImages: (images: IndexedImage[]) => void;
  addImages: (newImages: IndexedImage[]) => void;
  removeImage: (imageId: string) => void;
  removeImages: (imageIds: string[]) => void;
  updateImage: (imageId: string, newName: string) => void;
  clearImages: (directoryId?: string) => void;

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
        const { images, searchQuery, selectedModels, selectedLoras, selectedSchedulers, sortOrder, advancedFilters, directories, visibleSubfolders } = state;

        const visibleDirectoryIds = new Set(
            directories.filter(dir => dir.visible ?? true).map(dir => dir.id)
        );
        
        // Filter by directory visibility and subfolder visibility
        let results = images.filter(img => {
            // First check if the directory is visible
            if (!visibleDirectoryIds.has(img.directoryId || '')) {
                return false;
            }
            
            // If we have subfolder visibility controls, check them
            // Only filter out if the image is in a subfolder that's been explicitly hidden
            if (visibleSubfolders.size > 0 && img.id) {
                // Extract the directory path from the image's directory
                const parentDir = directories.find(d => d.id === img.directoryId);
                if (parentDir) {
                    const parentPath = parentDir.path;
                    const imagePath = img.id; // id is the file path
                    
                    // Check if image is in a subfolder
                    if (imagePath.startsWith(parentPath)) {
                        const relativePath = imagePath.substring(parentPath.length);
                        const pathParts = relativePath.split(/[/\\]/).filter(p => p);
                        
                        // If there's more than just the filename (meaning it's in a subfolder)
                        if (pathParts.length > 1) {
                            const subfolderName = pathParts[0];
                            const subfolderPath = parentPath + (parentPath.endsWith('/') || parentPath.endsWith('\\') ? '' : '\\') + subfolderName;
                            
                            // Check if this specific subfolder exists in visibility set
                            // If it exists and is not in the set, filter it out
                            // We only filter if the subfolder has been registered (clicked)
                            return visibleSubfolders.has(subfolderPath);
                        }
                    }
                }
            }
            
            return true;
        });

        if (searchQuery) {
            const searchTerms = searchQuery.toLowerCase().split(' ').filter(term => term.trim() !== '');
            if (searchTerms.length > 0) {
                results = results.filter(image => {
                    const metadata = image.metadataString.toLowerCase();
                    return searchTerms.every(term => metadata.includes(term));
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

        const sorted = [...results].sort((a, b) => {
            if (sortOrder === 'asc') return a.name.localeCompare(b.name);
            if (sortOrder === 'desc') return b.name.localeCompare(a.name);
            if (sortOrder === 'date-asc') return a.lastModified - b.lastModified;
            if (sortOrder === 'date-desc') return b.lastModified - a.lastModified;
            return 0;
        });

        return { filteredImages: sorted };
    };


    return {
        // Initial State
        images: [],
        filteredImages: [],
        directories: [],
        visibleSubfolders: new Set(),
        isLoading: false,
        progress: null,
        indexingState: 'idle',
        error: null,
        success: null,
        selectedImage: null,
        previewImage: null,
        selectedImages: new Set(),
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
            return {
                directories: [...state.directories, { ...directory, visible: directory.visible ?? true }]
            };
        }),

        toggleDirectoryVisibility: (directoryId) => set(state => {
            const updatedDirectories = state.directories.map(dir =>
                dir.id === directoryId ? { ...dir, visible: !(dir.visible ?? true) } : dir
            );
            const newState = { ...state, directories: updatedDirectories };
            return { ...newState, ...filterAndSort(newState) };
        }),

        toggleSubfolderVisibility: (subfolderPath) => set(state => {
            const newVisibleSubfolders = new Set(state.visibleSubfolders);
            if (newVisibleSubfolders.has(subfolderPath)) {
                newVisibleSubfolders.delete(subfolderPath);
            } else {
                newVisibleSubfolders.add(subfolderPath);
            }
            const newState = { ...state, visibleSubfolders: newVisibleSubfolders };
            return { ...newState, ...filterAndSort(newState) };
        }),

        removeDirectory: (directoryId) => {
            const { directories, images } = get();
            const newDirectories = directories.filter(d => d.id !== directoryId);
            if (window.electronAPI) {
                localStorage.setItem('image-metahub-directories', JSON.stringify(newDirectories.map(d => d.path)));
            }
            const newImages = images.filter(img => img.directoryId !== directoryId);
            set(state => _updateState({ ...state, directories: newDirectories }, newImages));
        },

        setLoading: (loading) => set({ isLoading: loading }),
        setProgress: (progress) => set({ progress }),
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
            directories: [],
            isLoading: false,
            progress: { current: 0, total: 0 },
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