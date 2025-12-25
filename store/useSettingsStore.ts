import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';

// --- Electron IPC-based storage for Zustand ---
// This storage adapter will be used if the app is running in Electron.
const electronStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (window.electronAPI) {
      const settings = await window.electronAPI.getSettings();

      // If settings is empty (e.g., after cache reset), return null
      // This forces Zustand to use default values instead of merging with {}
      if (!settings || Object.keys(settings).length === 0) {
        console.log('📋 Settings file is empty or missing, using defaults');
        return null;
      }

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

const detectDefaultIndexingConcurrency = (): number => {
  if (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number') {
    const cores = navigator.hardwareConcurrency;
    if (Number.isFinite(cores) && cores > 0) {
      return Math.max(1, Math.min(16, Math.floor(cores)));
    }
  }
  return 8;
};

const defaultIndexingConcurrency = detectDefaultIndexingConcurrency();

// Define the state shape
interface SettingsState {
  // App settings
  sortOrder: 'asc' | 'desc';
  itemsPerPage: number;
  scanSubfolders: boolean;
  imageSize: number;
  cachePath: string | null;
  autoUpdate: boolean;
  viewMode: 'grid' | 'list';
  theme: 'light' | 'dark' | 'system' | 'dracula' | 'nord' | 'ocean';
  keymap: Keymap;
  lastViewedVersion: string | null;
  indexingConcurrency: number;
  disableThumbnails: boolean;
  showFilenames: boolean;

  // A1111 Integration settings
  a1111ServerUrl: string;
  a1111AutoStart: boolean;
  a1111LastConnectionStatus: 'unknown' | 'connected' | 'error';

  // ComfyUI Integration settings
  comfyUIServerUrl: string;
  comfyUILastConnectionStatus: 'unknown' | 'connected' | 'error';

  // Actions
  setSortOrder: (order: 'asc' | 'desc') => void;
  setItemsPerPage: (count: number) => void;
  toggleScanSubfolders: () => void;
  setImageSize: (size: number) => void;
  setCachePath: (path: string) => void;
  toggleAutoUpdate: () => void;
  toggleViewMode: () => void;
  setTheme: (theme: 'light' | 'dark' | 'system' | 'dracula' | 'nord' | 'ocean') => void;
  updateKeybinding: (scope: string, action: string, keybinding: string) => void;
  resetKeymap: () => void;
  setLastViewedVersion: (version: string) => void;
  setIndexingConcurrency: (value: number) => void;
  setDisableThumbnails: (value: boolean) => void;
  setShowFilenames: (value: boolean) => void;
  setA1111ServerUrl: (url: string) => void;
  toggleA1111AutoStart: () => void;
  setA1111ConnectionStatus: (status: 'unknown' | 'connected' | 'error') => void;
  setComfyUIServerUrl: (url: string) => void;
  setComfyUIConnectionStatus: (status: 'unknown' | 'connected' | 'error') => void;
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
      indexingConcurrency: defaultIndexingConcurrency,
      disableThumbnails: false,
      showFilenames: false,

      // A1111 Integration initial state
      a1111ServerUrl: 'http://127.0.0.1:7860',
      a1111AutoStart: false,
      a1111LastConnectionStatus: 'unknown',

      // ComfyUI Integration initial state
      comfyUIServerUrl: 'http://127.0.0.1:8188',
      comfyUILastConnectionStatus: 'unknown',

      // Actions
      setSortOrder: (order) => set({ sortOrder: order }),
      setItemsPerPage: (count) => {
        // Ensure valid number, default to 100 for invalid values
        const validCount = Number.isFinite(count) && count > 0 ? count : 100;
        set({ itemsPerPage: validCount });
      },
      toggleScanSubfolders: () => set((state) => ({ scanSubfolders: !state.scanSubfolders })),
      setImageSize: (size) => set({ imageSize: size }),
      setCachePath: (path) => set({ cachePath: path }),
      toggleAutoUpdate: () => set((state) => ({ autoUpdate: !state.autoUpdate })),
      toggleViewMode: () => set((state) => ({ viewMode: state.viewMode === 'grid' ? 'list' : 'grid' })),
      setTheme: (theme) => set({ theme }),
      setLastViewedVersion: (version) => set({ lastViewedVersion: version }),
      setIndexingConcurrency: (value) =>
        set({
          indexingConcurrency: Number.isFinite(value)
            ? Math.max(1, Math.floor(value))
            : 1,
        }),
      setDisableThumbnails: (value) => set({ disableThumbnails: !!value }),
      setShowFilenames: (value) => set({ showFilenames: !!value }),
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

      // A1111 Integration actions
      setA1111ServerUrl: (url) => set({ a1111ServerUrl: url }),
      toggleA1111AutoStart: () => set((state) => ({ a1111AutoStart: !state.a1111AutoStart })),
      setA1111ConnectionStatus: (status) => set({ a1111LastConnectionStatus: status }),

      // ComfyUI Integration actions
      setComfyUIServerUrl: (url) => set({ comfyUIServerUrl: url }),
      setComfyUIConnectionStatus: (status) => set({ comfyUILastConnectionStatus: status }),

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
        indexingConcurrency: defaultIndexingConcurrency,
        disableThumbnails: false,
        showFilenames: false,
        a1111ServerUrl: 'http://127.0.0.1:7860',
        a1111AutoStart: false,
        a1111LastConnectionStatus: 'unknown',
        comfyUIServerUrl: 'http://127.0.0.1:8188',
        comfyUILastConnectionStatus: 'unknown',
      }),
    }),
    {
      name: 'image-metahub-settings',
      storage: createJSONStorage(() => isElectron ? electronStorage : localStorage),
      onRehydrateStorage: () => (state) => {
        // Migration: Fix invalid itemsPerPage values from older versions
        if (state && (typeof state.itemsPerPage !== 'number' || state.itemsPerPage <= 0 || state.itemsPerPage > 100)) {
          state.itemsPerPage = 100;
        }

        if (state && typeof state.showFilenames !== 'boolean') {
          state.showFilenames = false;
        }
      },
    }
  )
);