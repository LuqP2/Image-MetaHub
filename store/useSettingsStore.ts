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

import { Keymap } from '../types';

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
  theme: 'light' | 'dark' | 'system';
  keymap: Keymap;
  lastViewedVersion: string | null;

  // Actions
  setSortOrder: (order: 'asc' | 'desc') => void;
  setItemsPerPage: (count: number | 'all') => void;
  toggleScanSubfolders: () => void;
  setImageSize: (size: number) => void;
  zoomInView: () => void;
  zoomOutView: () => void;
  resetZoom: () => void;
  setCachePath: (path: string) => void;
  toggleAutoUpdate: () => void;
  toggleViewMode: () => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  updateKeybinding: (scope: string, action: string, keybinding: string) => void;
  resetKeymap: () => void;
  setLastViewedVersion: (version: string) => void;
  resetState: () => void;
}

// Check if running in Electron
const isElectron = !!window.electronAPI;

import { getDefaultKeymap } from '../services/hotkeyConfig';

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
      theme: 'system', // Default to system theme
      keymap: getDefaultKeymap(),
      lastViewedVersion: null,

      // Actions
      setSortOrder: (order) => set({ sortOrder: order }),
      setItemsPerPage: (count) => set({ itemsPerPage: count }),
      toggleScanSubfolders: () => set((state) => ({ scanSubfolders: !state.scanSubfolders })),
      setImageSize: (size) => set({ imageSize: size }),
      zoomInView: () => set((state) => ({ imageSize: Math.min(state.imageSize + 10, 300) })),
      zoomOutView: () => set((state) => ({ imageSize: Math.max(state.imageSize - 10, 50) })),
      resetZoom: () => set({ imageSize: 120 }),
      setCachePath: (path) => set({ cachePath: path }),
      toggleAutoUpdate: () => set((state) => ({ autoUpdate: !state.autoUpdate })),
      toggleViewMode: () => set((state) => ({ viewMode: state.viewMode === 'grid' ? 'list' : 'grid' })),
      setTheme: (theme) => set({ theme }),
      setLastViewedVersion: (version) => set({ lastViewedVersion: version }),
      updateKeybinding: (scope, action, keybinding) =>
        set((state) => ({
          keymap: {
            ...state.keymap,
            [scope]: {
              ...(state.keymap[scope] as object),
              [action]: keybinding,
            },
          },
        })),
      resetKeymap: () => set({ keymap: getDefaultKeymap() }),
      resetState: () => set({
        sortOrder: 'desc',
        itemsPerPage: 20,
        scanSubfolders: true,
        imageSize: 120,
        cachePath: null,
        autoUpdate: true,
        viewMode: 'grid',
        theme: 'system',
        keymap: getDefaultKeymap(),
        lastViewedVersion: null,
      }),
    }),
    {
      name: 'image-metahub-settings',
      storage: createJSONStorage(() => isElectron ? electronStorage : localStorage),
    }
  )
);