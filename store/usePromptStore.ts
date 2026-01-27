import { create } from 'zustand';
import { PromptPreset, BaseMetadata } from '../types';
import { loadPresets, savePreset, deletePreset } from '../services/promptLibraryStorage';

interface PromptStoreState {
  presets: PromptPreset[];
  isLoading: boolean;
  isLibraryOpen: boolean;
  isSaveModalOpen: boolean;
  pendingSaveMetadata: BaseMetadata | null; // Metadata to pre-fill the save modal
  onSelect: ((preset: PromptPreset) => void) | null;

  // Actions
  loadPresets: () => Promise<void>;
  addPreset: (preset: PromptPreset) => Promise<void>;
  removePreset: (id: string) => Promise<void>;
  updatePreset: (preset: PromptPreset) => Promise<void>;
  
  openLibrary: (options?: { onSelect?: (preset: PromptPreset) => void }) => void;
  closeLibrary: () => void;
  
  openSaveModal: (metadata?: BaseMetadata) => void;
  closeSaveModal: () => void;
}

export const usePromptStore = create<PromptStoreState>((set, get) => ({
  presets: [],
  isLoading: false,
  isLibraryOpen: false,
  isSaveModalOpen: false,
  pendingSaveMetadata: null,
  onSelect: null,

  loadPresets: async () => {
    set({ isLoading: true });
    try {
      const presets = await loadPresets();
      // Sort by newest first
      presets.sort((a, b) => b.createdAt - a.createdAt);
      set({ presets, isLoading: false });
    } catch (error) {
      console.error('Failed to load presets:', error);
      set({ isLoading: false });
    }
  },

  addPreset: async (preset) => {
    // Optimistic update
    set(state => ({ presets: [preset, ...state.presets] }));
    try {
      await savePreset(preset);
    } catch (error) {
      console.error('Failed to save preset:', error);
      // Revert on failure
      set(state => ({ presets: state.presets.filter(p => p.id !== preset.id) }));
    }
  },

  removePreset: async (id) => {
    const previousPresets = get().presets;
    set(state => ({ presets: state.presets.filter(p => p.id !== id) }));
    try {
      await deletePreset(id);
    } catch (error) {
      console.error('Failed to delete preset:', error);
      set({ presets: previousPresets });
    }
  },

  updatePreset: async (preset) => {
    set(state => ({
      presets: state.presets.map(p => p.id === preset.id ? preset : p)
    }));
    try {
      await savePreset(preset);
    } catch (error) {
      console.error('Failed to update preset:', error);
    }
  },

  openLibrary: (options) => {
    set({ isLibraryOpen: true, onSelect: options?.onSelect || null });
    // Reload to ensure freshness
    get().loadPresets();
  },
  
  closeLibrary: () => set({ isLibraryOpen: false, onSelect: null }),

  openSaveModal: (metadata) => set({ isSaveModalOpen: true, pendingSaveMetadata: metadata || null }),
  closeSaveModal: () => set({ isSaveModalOpen: false, pendingSaveMetadata: null }),
}));
