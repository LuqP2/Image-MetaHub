import { create } from 'zustand';
import { IndexedImage } from '../types';

interface ImageState {
  // Core Data
  images: IndexedImage[];
  filteredImages: IndexedImage[];
  directoryHandle: FileSystemDirectoryHandle | null;
  directoryPath: string;

  // UI State
  isLoading: boolean;
  progress: { current: number; total: number };
  error: string | null;
  success: string | null;
  selectedImage: IndexedImage | null;
  selectedImages: Set<string>;

  // Filter & Sort State
  searchQuery: string;
  availableModels: string[];
  availableLoras: string[];
  availableSchedulers: string[];
  selectedModels: string[];
  selectedLoras: string[];
  selectedSchedulers: string[];
  sortOrder: 'asc' | 'desc' | 'date-asc' | 'date-desc';

  // Actions
  setDirectory: (handle: FileSystemDirectoryHandle | null, path: string) => void;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: { current: number; total: number }) => void;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
  setImages: (images: IndexedImage[]) => void;
  setFilteredImages: (images: IndexedImage[]) => void;
  addImages: (newImages: IndexedImage[]) => void;
  removeImage: (imageId: string) => void;
  removeImages: (imageIds: string[]) => void;
  updateImage: (imageId: string, newName: string) => void;

  // Filter & Sort Actions
  setSearchQuery: (query: string) => void;
  setFilterOptions: (options: { models: string[]; loras: string[]; schedulers: string[] }) => void;
  setSelectedFilters: (filters: { models?: string[]; loras?: string[]; schedulers?: string[] }) => void;
  setSortOrder: (order: 'asc' | 'desc' | 'date-asc' | 'date-desc') => void;

  // Selection Actions
  setSelectedImage: (image: IndexedImage | null) => void;
  toggleImageSelection: (imageId: string) => void;
  clearImageSelection: () => void;
  deleteSelectedImages: () => Promise<void>; // This will require file operations logic

  // Reset Actions
  resetState: () => void;
}

export const useImageStore = create<ImageState>((set, get) => ({
  // Initial State
  images: [],
  filteredImages: [],
  directoryHandle: null,
  directoryPath: '',
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

  // --- ACTIONS ---

  setDirectory: (handle, path) => set({ directoryHandle: handle, directoryPath: path, images: [], filteredImages: [] }),
  setLoading: (loading) => set({ isLoading: loading }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error, success: null }),
  setSuccess: (success) => set({ success, error: null }),
  setImages: (images) => set({ images, filteredImages: images }),
  setFilteredImages: (filteredImages) => set({ filteredImages }),

  addImages: (newImages) => {
    // Logic to add new images without duplicates
    set(state => {
      const existingIds = new Set(state.images.map(img => img.id));
      const uniqueNewImages = newImages.filter(img => !existingIds.has(img.id));
      return { images: [...state.images, ...uniqueNewImages] };
    });
  },

  removeImages: (imageIds) => {
    const idsToRemove = new Set(imageIds);
    set(state => ({
      images: state.images.filter(img => !idsToRemove.has(img.id)),
      filteredImages: state.filteredImages.filter(img => !idsToRemove.has(img.id)),
    }));
  },

  removeImage: (imageId) => {
    set(state => ({
      images: state.images.filter(img => img.id !== imageId),
      filteredImages: state.filteredImages.filter(img => img.id !== imageId),
    }));
  },

  updateImage: (imageId, newName) => {
      set(state => ({
          images: state.images.map(img => img.id === imageId ? { ...img, name: newName } : img),
          filteredImages: state.filteredImages.map(img => img.id === imageId ? { ...img, name: newName } : img),
      }));
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  setFilterOptions: (options) => set({
    availableModels: options.models,
    availableLoras: options.loras,
    availableSchedulers: options.schedulers,
  }),

  setSelectedFilters: (filters) => set(state => ({
    selectedModels: filters.models ?? state.selectedModels,
    selectedLoras: filters.loras ?? state.selectedLoras,
    selectedSchedulers: filters.schedulers ?? state.selectedSchedulers,
  })),

  setSortOrder: (order) => set({ sortOrder: order }),

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

  resetState: () => set({
    images: [],
    filteredImages: [],
    directoryHandle: null,
    directoryPath: '',
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
  })
}));