import { create } from 'zustand';
import { IndexedImage, Directory } from '../types';

interface ImageState {
  // Core Data
  images: IndexedImage[];
  filteredImages: IndexedImage[];
  directories: Directory[];

  // UI State
  isLoading: boolean;
  progress: { current: number; total: number };
  error: string | null;
  success: string | null;
  selectedImage: IndexedImage | null;
  selectedImages: Set<string>;
  scanSubfolders: boolean;

  // Filter & Sort State
  searchQuery: string;
  availableModels: string[];
  availableLoras: string[];
  availableSchedulers: string[];
  selectedModels: string[];
  selectedLoras: string[];
  selectedSchedulers: string[];
  sortOrder: 'asc' | 'desc' | 'date-asc' | 'date-desc';
  advancedFilters: any;

  // Actions
  addDirectory: (directory: Directory) => void;
  removeDirectory: (directoryId: string) => void;
  toggleDirectoryVisibility: (directoryId: string) => void;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: { current: number; total: number }) => void;
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
  setFilterOptions: (options: { models: string[]; loras: string[]; schedulers: string[] }) => void;
  setSelectedFilters: (filters: { models?: string[]; loras?: string[]; schedulers?: string[] }) => void;
  setSortOrder: (order: 'asc' | 'desc' | 'date-asc' | 'date-desc') => void;
  setAdvancedFilters: (filters: any) => void;
  filterAndSortImages: () => void;

  // Selection Actions
  setSelectedImage: (image: IndexedImage | null) => void;
  toggleImageSelection: (imageId: string) => void;
  clearImageSelection: () => void;
  deleteSelectedImages: () => Promise<void>; // This will require file operations logic
  setScanSubfolders: (scan: boolean) => void;

  // Reset Actions
  resetState: () => void;
}

export const useImageStore = create<ImageState>((set, get) => {
    // --- Helper function for filtering and sorting ---
    const filterAndSort = (state: ImageState) => {
        const { images, searchQuery, selectedModels, selectedLoras, selectedSchedulers, sortOrder, advancedFilters, directories } = state;

        // First, filter by directory visibility
        const visibleDirectoryIds = new Set(
            directories.filter(dir => dir.visible ?? true).map(dir => dir.id)
        );
        let results = images.filter(img => visibleDirectoryIds.has(img.directoryId || ''));

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

        // --- ADVANCED FILTERS ---
        if (advancedFilters) {
            // Dimension Filter
            if (advancedFilters.dimension) {
                results = results.filter(image => image.dimensions === advancedFilters.dimension);
            }

            // Steps Filter
            if (advancedFilters.steps) {
                 results = results.filter(image => {
                    const steps = image.steps;
                    // Only apply filter to images that have steps defined
                    if (steps !== null && steps !== undefined) {
                        return steps >= advancedFilters.steps.min && steps <= advancedFilters.steps.max;
                    }
                    // If image has no steps defined, exclude it from filtered results
                    return false;
                });
            }

            // CFG Scale Filter
            if (advancedFilters.cfg) {
                 results = results.filter(image => {
                    const cfg = image.cfgScale;
                    // Only apply filter to images that have cfg scale defined
                    if (cfg !== null && cfg !== undefined) {
                        return cfg >= advancedFilters.cfg.min && cfg <= advancedFilters.cfg.max;
                    }
                    // If image has no cfg scale defined, exclude it from filtered results
                    return false;
                });
            }
            
            // Date Filter
            if (advancedFilters.date && advancedFilters.date.from && advancedFilters.date.to) {
                // Add 1 day to the 'to' date to make the range inclusive
                const toDate = new Date(advancedFilters.date.to);
                toDate.setDate(toDate.getDate() + 1);
                const fromTime = new Date(advancedFilters.date.from).getTime();
                const toTime = toDate.getTime();
                results = results.filter(image => {
                    return image.lastModified >= fromTime && image.lastModified < toTime;
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
    return {
      ...filterAndSort({ ...state, directories: updatedDirectories }),
      directories: updatedDirectories,
    };
  }),

  removeDirectory: (directoryId) => {
    const { directories } = get();
    const newDirectories = directories.filter(d => d.id !== directoryId);
    if (window.electronAPI) { // Only persist in Electron environment
      localStorage.setItem('image-metahub-directories', JSON.stringify(newDirectories.map(d => d.path)));
    }

    set(state => {
      const newImages = state.images.filter(img => img.directoryId !== directoryId);
      return {
        ...filterAndSort({ ...state, images: newImages }),
        images: newImages,
        directories: newDirectories,
      };
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error, success: null }),
  setSuccess: (success) => set({ success, error: null }),

  filterAndSortImages: () => set(state => filterAndSort(state)),

  setImages: (images) => set(state => ({ ...filterAndSort({ ...state, images }), images })),

  addImages: (newImages) => {
    set(state => {
      const existingIds = new Set(state.images.map(img => img.id));
      const uniqueNewImages = newImages.filter(img => !existingIds.has(img.id));
      const allImages = [...state.images, ...uniqueNewImages];
      return { ...filterAndSort({ ...state, images: allImages }), images: allImages };
    });
  },

  clearImages: (directoryId?: string) => set(state => {
    if (directoryId) {
      const newImages = state.images.filter(img => img.directoryId !== directoryId);
      return { ...filterAndSort({ ...state, images: newImages }), images: newImages };
    } else {
      return { images: [], filteredImages: [] };
    }
  }),

  removeImages: (imageIds) => {
    const idsToRemove = new Set(imageIds);
    set(state => {
        const remainingImages = state.images.filter(img => !idsToRemove.has(img.id));
        return { ...filterAndSort({ ...state, images: remainingImages }), images: remainingImages };
    });
  },

  removeImage: (imageId) => {
    set(state => {
        const remainingImages = state.images.filter(img => img.id !== imageId);
        return { ...filterAndSort({ ...state, images: remainingImages }), images: remainingImages };
    });
  },

  updateImage: (imageId, newName) => {
      set(state => {
          const updatedImages = state.images.map(img => img.id === imageId ? { ...img, name: newName } : img);
          return { ...filterAndSort({ ...state, images: updatedImages }), images: updatedImages };
      });
  },

  setSearchQuery: (query) => set(state => ({ ...filterAndSort({ ...state, searchQuery: query }), searchQuery: query })),

  setFilterOptions: (options) => set({
    availableModels: options.models,
    availableLoras: options.loras,
    availableSchedulers: options.schedulers,
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

  clearImageSelection: () => set({ selectedImages: new Set() }),

  // Placeholder for async action
  deleteSelectedImages: async () => {
    // This logic will be implemented later, likely in a dedicated hook
    // that uses this store. For now, it just clears the selection.
    console.log("Deleting selected images...");
    get().clearImageSelection();
  },

  setScanSubfolders: (scan) => {
    localStorage.setItem('image-metahub-scan-subfolders', String(scan));
    set({ scanSubfolders: scan });
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
    selectedModels: [],
    selectedLoras: [],
    selectedSchedulers: [],
    advancedFilters: {},
  })
}});