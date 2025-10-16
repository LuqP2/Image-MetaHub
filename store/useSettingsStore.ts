import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';

// --- Electron IPC-based storage for Zustand ---
// This storage adapter will be used if the app is running in Electron.
const electronStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (window.electronAPI) {
      const settings = await window.electronAPI.getSettings();
      return JSON.stringify({ state: settings });
    }
    return null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (window.electronAPI) {
      const { state } = JSON.parse(value);
      await window.electronAPI.saveSettings(state);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    // This would clear all settings, which is probably not what we want.
    // For now, it's a no-op.
    console.warn('Clearing all settings is not implemented.');
  },
};

// Define the state shape
interface SettingsState {
  // App settings
  sortOrder: 'asc' | 'desc';
  itemsPerPage: number | 'all';
  scanSubfolders: boolean;
  imageSize: number;
  cachePath: string | null;
  autoUpdate: boolean;
  viewMode: 'grid' | 'list';

  // Actions
  setSortOrder: (order: 'asc' | 'desc') => void;
  setItemsPerPage: (count: number | 'all') => void;
  toggleScanSubfolders: () => void;
  setImageSize: (size: number) => void;
  setCachePath: (path: string) => void;
  toggleAutoUpdate: () => void;
  toggleViewMode: () => void;
  resetState: () => void;
}

// Check if running in Electron
const isElectron = !!window.electronAPI;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Initial state
      sortOrder: 'desc',
      itemsPerPage: 20,
      scanSubfolders: true,
      imageSize: 120,
      cachePath: null, // Default cache path, null means use app data dir
      autoUpdate: true, // Check for updates by default
      viewMode: 'grid',

      // Actions
      setSortOrder: (order) => set({ sortOrder: order }),
      setItemsPerPage: (count) => set({ itemsPerPage: count }),
      toggleScanSubfolders: () => set((state) => ({ scanSubfolders: !state.scanSubfolders })),
      setImageSize: (size) => set({ imageSize: size }),
      setCachePath: (path) => set({ cachePath: path }),
      toggleAutoUpdate: () => set((state) => ({ autoUpdate: !state.autoUpdate })),
      toggleViewMode: () => set((state) => ({ viewMode: state.viewMode === 'grid' ? 'list' : 'grid' })),
      resetState: () => set({
        sortOrder: 'desc',
        itemsPerPage: 20,
        scanSubfolders: true,
        imageSize: 120,
        cachePath: null,
        autoUpdate: true,
      }),
    }),
    {
      name: 'image-metahub-settings',
      storage: createJSONStorage(() => isElectron ? electronStorage : localStorage),
    }
  )
);