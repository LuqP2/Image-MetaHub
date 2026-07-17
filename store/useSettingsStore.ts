import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import {
  DEFAULT_RECENT_TAG_CHIP_LIMIT,
  DEFAULT_TAG_SUGGESTION_LIMIT,
  sanitizeTagUiLimit,
} from '../utils/tagSuggestions';

export const stripLicenseFromSettings = <T extends Record<string, unknown>>(settings: T | null | undefined): Omit<T, 'license'> => {
  if (!settings) {
    return {} as Omit<T, 'license'>;
  }

  const { license: _license, ...appSettings } = settings;
  return appSettings;
};

export const mergeSettingsWithExisting = <
  TState extends Record<string, unknown>,
  TSettings extends Record<string, unknown>,
>(
  currentSettings: TSettings | null | undefined,
  nextState: TState,
): TSettings & TState => ({
  ...(currentSettings ?? {} as TSettings),
  ...nextState,
  ...(currentSettings && 'license' in currentSettings ? { license: currentSettings.license } : {}),
});

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

      return JSON.stringify({ state: stripLicenseFromSettings(settings) });
    }
    return null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (window.electronAPI) {
      const { state } = JSON.parse(value);
      const currentSettings = await window.electronAPI.getSettings();
      const result = await window.electronAPI.saveSettings(mergeSettingsWithExisting(currentSettings, state));
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to persist application settings.');
      }
    }
  },
  removeItem: async (name: string): Promise<void> => {
    // This would clear all settings, which is probably not what we want.
    // For now, it's a no-op.
    console.warn('Clearing all settings is not implemented.');
  },
};

import { Keymap } from '../types';
import type { ImageGroupByMode, ImageGroupingSortOrder } from '../utils/imageGrouping';

const VALID_SORT_ORDERS: ImageGroupingSortOrder[] = ['asc', 'desc', 'date-asc', 'date-desc', 'random'];
const isValidSortOrder = (value: unknown): value is ImageGroupingSortOrder =>
  typeof value === 'string' && (VALID_SORT_ORDERS as string[]).includes(value);
const VALID_GROUP_BY: ImageGroupByMode[] = ['none', 'date', 'name', 'session', 'model', 'cluster'];

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

export type StartupVerificationMode = 'off' | 'idle' | 'strict';

export const DEFAULT_SLIDESHOW_INTERVAL_SECONDS = 5;
export const MIN_SLIDESHOW_INTERVAL_SECONDS = 1;
export const MAX_SLIDESHOW_INTERVAL_SECONDS = 120;

export const sanitizeSlideshowIntervalSeconds = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_SLIDESHOW_INTERVAL_SECONDS;
  }

  return Math.min(
    MAX_SLIDESHOW_INTERVAL_SECONDS,
    Math.max(MIN_SLIDESHOW_INTERVAL_SECONDS, Math.floor(value))
  );
};

// Define the state shape
interface SettingsState {
  // App settings. Unified with useImageStore.sortOrder (the single writer); this copy is
  // persistence-only. Kept as the full union so the two never drift.
  sortOrder: ImageGroupingSortOrder;
  itemsPerPage: number;
  scanSubfolders: boolean;
  imageSize: number;
  cachePath: string | null;
  autoUpdate: boolean;
  viewMode: 'grid' | 'list';
  groupBy: ImageGroupByMode;
  theme: 'light' | 'dark' | 'system' | 'dracula' | 'nord' | 'ocean';
  keymap: Keymap;
  lastViewedVersion: string | null;
  indexingConcurrency: number;
  disableThumbnails: boolean;
  showFilenames: boolean;
  showFullFilePath: boolean;
  globalAutoWatch: boolean;
  startupVerificationMode: StartupVerificationMode;
  doubleClickToOpen: boolean;
  skipDeleteConfirmation: boolean;
  tagSuggestionLimit: number;
  recentTagChipLimit: number;
  sensitiveTags: string[];
  blurSensitiveImages: boolean;
  enableSafeMode: boolean;
  civitaiLookupEnabled: boolean;
  enableAnimations: boolean;
  /** Classic mode: show the legacy tabs (Model View / Smart Library / Collections / Node View)
   *  as deep-links into the unified Explore surface. Off by default. */
  classicMode: boolean;
  performanceDiagnosticsEnabled: boolean;
  slideshowIntervalSeconds: number;
  slideshowShowFilename: boolean;
  creatorAttributionToken: string | null;
  creatorAttributionUpdatedAt: number | null;

  // A1111 Integration settings
  a1111Enabled: boolean;
  a1111ServerUrl: string;
  a1111AutoStart: boolean;
  a1111LastConnectionStatus: 'unknown' | 'connected' | 'error';

  // ComfyUI Integration settings
  comfyUIEnabled: boolean;
  comfyUIServerUrl: string;
  comfyUILastConnectionStatus: 'unknown' | 'connected' | 'error';
  comfyUIQueueMonitoringEnabled: boolean;
  comfyUIWorkspaceLastUrl: string;
  comfyUIWorkspacePanelWidth: number;
  comfyUIWorkspaceAutoOpenSelectedImage: boolean;
  generatorLaunchCommand: string;
  generatorLaunchWorkingDirectory: string;

  // Actions
  setSortOrder: (order: ImageGroupingSortOrder) => void;
  setItemsPerPage: (count: number) => void;
  toggleScanSubfolders: () => void;
  setImageSize: (size: number) => void;
  setCachePath: (path: string) => void;
  toggleAutoUpdate: () => void;
  toggleViewMode: () => void;
  setGroupBy: (value: ImageGroupByMode) => void;
  setTheme: (theme: 'light' | 'dark' | 'system' | 'dracula' | 'nord' | 'ocean') => void;
  updateKeybinding: (scope: string, action: string, keybinding: string) => void;
  resetKeymap: () => void;
  setLastViewedVersion: (version: string) => void;
  setIndexingConcurrency: (value: number) => void;
  setDisableThumbnails: (value: boolean) => void;
  setShowFilenames: (value: boolean) => void;
  setShowFullFilePath: (value: boolean) => void;
  toggleGlobalAutoWatch: () => void;
  setStartupVerificationMode: (value: StartupVerificationMode) => void;
  setDoubleClickToOpen: (value: boolean) => void;
  setSkipDeleteConfirmation: (value: boolean) => void;
  setTagSuggestionLimit: (value: number) => void;
  setRecentTagChipLimit: (value: number) => void;
  setSensitiveTags: (tags: string[]) => void;
  setBlurSensitiveImages: (value: boolean) => void;
  setEnableSafeMode: (value: boolean) => void;
  setCivitaiLookupEnabled: (value: boolean) => void;
  setEnableAnimations: (value: boolean) => void;
  setClassicMode: (value: boolean) => void;
  setPerformanceDiagnosticsEnabled: (value: boolean) => void;
  setSlideshowIntervalSeconds: (value: number) => void;
  setSlideshowShowFilename: (value: boolean) => void;
  setCreatorAttributionToken: (token: string | null) => void;
  setA1111Enabled: (value: boolean) => void;
  setA1111ServerUrl: (url: string) => void;
  toggleA1111AutoStart: () => void;
  setA1111ConnectionStatus: (status: 'unknown' | 'connected' | 'error') => void;
  setComfyUIEnabled: (value: boolean) => void;
  setComfyUIServerUrl: (url: string) => void;
  setComfyUIConnectionStatus: (status: 'unknown' | 'connected' | 'error') => void;
  setComfyUIQueueMonitoringEnabled: (value: boolean) => void;
  setComfyUIWorkspaceLastUrl: (url: string) => void;
  setComfyUIWorkspacePanelWidth: (width: number) => void;
  setComfyUIWorkspaceAutoOpenSelectedImage: (value: boolean) => void;
  setGeneratorLaunchCommand: (command: string) => void;
  setGeneratorLaunchWorkingDirectory: (directory: string) => void;
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
      groupBy: 'none',
      theme: 'system', // Default to system theme
      keymap: getDefaultKeymap(),
      lastViewedVersion: null,
      indexingConcurrency: defaultIndexingConcurrency,
      disableThumbnails: false,
      showFilenames: false,
      showFullFilePath: false,
      globalAutoWatch: true,
      startupVerificationMode: 'off',
      doubleClickToOpen: false,
      skipDeleteConfirmation: false,
      tagSuggestionLimit: DEFAULT_TAG_SUGGESTION_LIMIT,
      recentTagChipLimit: DEFAULT_RECENT_TAG_CHIP_LIMIT,
      sensitiveTags: ['nsfw', 'private', 'hidden'],
      blurSensitiveImages: true,
      enableSafeMode: true,
      civitaiLookupEnabled: true,
      enableAnimations: true,
      classicMode: false,
      performanceDiagnosticsEnabled: false,
      slideshowIntervalSeconds: DEFAULT_SLIDESHOW_INTERVAL_SECONDS,
      slideshowShowFilename: true,
      creatorAttributionToken: null,
      creatorAttributionUpdatedAt: null,

      // A1111 Integration initial state
      a1111Enabled: true,
      a1111ServerUrl: 'http://127.0.0.1:7860',
      a1111AutoStart: false,
      a1111LastConnectionStatus: 'unknown',

      // ComfyUI Integration initial state
      comfyUIEnabled: true,
      comfyUIServerUrl: 'http://127.0.0.1:8188',
      comfyUILastConnectionStatus: 'unknown',
      comfyUIQueueMonitoringEnabled: true,
      comfyUIWorkspaceLastUrl: '',
      comfyUIWorkspacePanelWidth: 360,
      comfyUIWorkspaceAutoOpenSelectedImage: true,
      generatorLaunchCommand: '',
      generatorLaunchWorkingDirectory: '',

      // Actions
      setSortOrder: (order) => set({ sortOrder: order }),
      setItemsPerPage: (count) => {
        // Ensure valid number, allow -1 for infinite, default to 100 for invalid values
        const validCount = Number.isFinite(count) && (count > 0 || count === -1) ? count : 100;
        set({ itemsPerPage: validCount });
      },
      toggleScanSubfolders: () => set((state) => ({ scanSubfolders: !state.scanSubfolders })),
      setImageSize: (size) => set({ imageSize: size }),
      setCachePath: (path) => set({ cachePath: path }),
      toggleAutoUpdate: () => set((state) => ({ autoUpdate: !state.autoUpdate })),
      toggleViewMode: () => set((state) => ({ viewMode: state.viewMode === 'grid' ? 'list' : 'grid' })),
      setGroupBy: (value) => set({ groupBy: value }),
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
      setShowFullFilePath: (value) => set({ showFullFilePath: !!value }),
      toggleGlobalAutoWatch: () => set((state) => ({ globalAutoWatch: !state.globalAutoWatch })),
      setStartupVerificationMode: (value) => set({ startupVerificationMode: value }),
      setDoubleClickToOpen: (value) => set({ doubleClickToOpen: !!value }),
      setSkipDeleteConfirmation: (value) => set({ skipDeleteConfirmation: !!value }),
      setTagSuggestionLimit: (value) => set({ tagSuggestionLimit: sanitizeTagUiLimit(value, DEFAULT_TAG_SUGGESTION_LIMIT) }),
      setRecentTagChipLimit: (value) => set({ recentTagChipLimit: sanitizeTagUiLimit(value, DEFAULT_RECENT_TAG_CHIP_LIMIT) }),
      setSensitiveTags: (tags) => {
        const normalized = (Array.isArray(tags) ? tags : [])
          .map(tag => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
          .filter(Boolean);
        set({ sensitiveTags: normalized });
      },
      setBlurSensitiveImages: (value) => set({ blurSensitiveImages: !!value }),
      setEnableSafeMode: (value) => set({ enableSafeMode: !!value }),
      setCivitaiLookupEnabled: (value) => set({ civitaiLookupEnabled: !!value }),
      setEnableAnimations: (value) => set({ enableAnimations: !!value }),
      setClassicMode: (value) => set({ classicMode: !!value }),
      setPerformanceDiagnosticsEnabled: (value) => set({ performanceDiagnosticsEnabled: !!value }),
      setSlideshowIntervalSeconds: (value) =>
        set({ slideshowIntervalSeconds: sanitizeSlideshowIntervalSeconds(value) }),
      setSlideshowShowFilename: (value) => set({ slideshowShowFilename: !!value }),
      setCreatorAttributionToken: (token) => {
        const normalizedToken = typeof token === 'string' ? token.trim() : '';
        set({
          creatorAttributionToken: normalizedToken || null,
          creatorAttributionUpdatedAt: normalizedToken ? Date.now() : null,
        });
      },
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
      setA1111Enabled: (value) => set({ a1111Enabled: !!value }),
      setA1111ServerUrl: (url) => set({ a1111ServerUrl: url }),
      toggleA1111AutoStart: () => set((state) => ({ a1111AutoStart: !state.a1111AutoStart })),
      setA1111ConnectionStatus: (status) =>
        set((state) =>
          state.a1111LastConnectionStatus === status
            ? state
            : { a1111LastConnectionStatus: status }
        ),

      // ComfyUI Integration actions
      setComfyUIEnabled: (value) => set({ comfyUIEnabled: !!value }),
      setComfyUIServerUrl: (url) => set({ comfyUIServerUrl: url }),
      setComfyUIConnectionStatus: (status) =>
        set((state) =>
          state.comfyUILastConnectionStatus === status
            ? state
            : { comfyUILastConnectionStatus: status }
        ),
      setComfyUIQueueMonitoringEnabled: (value) => set({ comfyUIQueueMonitoringEnabled: !!value }),
      setComfyUIWorkspaceLastUrl: (url) => set({ comfyUIWorkspaceLastUrl: url }),
      setComfyUIWorkspacePanelWidth: (width) => set({ comfyUIWorkspacePanelWidth: Math.min(Math.max(Math.round(width) || 360, 280), 560) }),
      setComfyUIWorkspaceAutoOpenSelectedImage: (value) => set({ comfyUIWorkspaceAutoOpenSelectedImage: !!value }),
      setGeneratorLaunchCommand: (command) => set({ generatorLaunchCommand: command }),
      setGeneratorLaunchWorkingDirectory: (directory) => set({ generatorLaunchWorkingDirectory: directory }),

      resetState: () => set({
        sortOrder: 'desc',
        itemsPerPage: 20,
        scanSubfolders: true,
        imageSize: 120,
        cachePath: null,
        autoUpdate: true,
        viewMode: 'grid',
        groupBy: 'none',
        theme: 'system',
        keymap: getDefaultKeymap(),
        lastViewedVersion: null,
        indexingConcurrency: defaultIndexingConcurrency,
        disableThumbnails: false,
        showFilenames: false,
        showFullFilePath: false,
        globalAutoWatch: true,
        startupVerificationMode: 'off',
        doubleClickToOpen: false,
        skipDeleteConfirmation: false,
        tagSuggestionLimit: DEFAULT_TAG_SUGGESTION_LIMIT,
        recentTagChipLimit: DEFAULT_RECENT_TAG_CHIP_LIMIT,
        sensitiveTags: ['nsfw', 'private', 'hidden'],
        blurSensitiveImages: true,
        enableSafeMode: true,
        civitaiLookupEnabled: true,
        enableAnimations: true,
        classicMode: false,
        performanceDiagnosticsEnabled: false,
        slideshowIntervalSeconds: DEFAULT_SLIDESHOW_INTERVAL_SECONDS,
        slideshowShowFilename: true,
        creatorAttributionToken: null,
        creatorAttributionUpdatedAt: null,
        a1111Enabled: true,
        a1111ServerUrl: 'http://127.0.0.1:7860',
        a1111AutoStart: false,
        a1111LastConnectionStatus: 'unknown',
        comfyUIEnabled: true,
        comfyUIServerUrl: 'http://127.0.0.1:8188',
        comfyUILastConnectionStatus: 'unknown',
        comfyUIQueueMonitoringEnabled: true,
        comfyUIWorkspaceLastUrl: '',
        comfyUIWorkspacePanelWidth: 360,
        comfyUIWorkspaceAutoOpenSelectedImage: true,
        generatorLaunchCommand: '',
        generatorLaunchWorkingDirectory: '',
      }),
    }),
    {
      name: 'image-metahub-settings',
      storage: createJSONStorage(() => isElectron ? electronStorage : localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const defaultKeymap = getDefaultKeymap();
          state.keymap = {
            ...defaultKeymap,
            ...state.keymap,
            global: {
              ...(defaultKeymap.global as Record<string, string>),
              ...((state.keymap?.global as Record<string, string> | undefined) ?? {}),
            },
            preview: {
              ...(defaultKeymap.preview as Record<string, string>),
              ...((state.keymap?.preview as Record<string, string> | undefined) ?? {}),
            },
          };
        }

        // Migration: Fix invalid itemsPerPage values from older versions
        if (state && (typeof state.itemsPerPage !== 'number' || (state.itemsPerPage <= 0 && state.itemsPerPage !== -1) || state.itemsPerPage > 100)) {
          state.itemsPerPage = 100;
        }

        if (state && typeof state.showFilenames !== 'boolean') {
          state.showFilenames = false;
        }

        // Keep a persisted-but-valid sortOrder; only reset corrupted/unknown values so we
        // never destroy a user's preference (D7).
        if (state && !isValidSortOrder(state.sortOrder)) {
          state.sortOrder = 'date-desc';
        }

        if (state && !VALID_GROUP_BY.includes(state.groupBy)) {
          state.groupBy = 'none';
        }

        if (state && typeof state.showFullFilePath !== 'boolean') {
          state.showFullFilePath = false;
        }

        if (state && typeof state.skipDeleteConfirmation !== 'boolean') {
          state.skipDeleteConfirmation = false;
        }

        if (state) {
          state.tagSuggestionLimit = sanitizeTagUiLimit(state.tagSuggestionLimit, DEFAULT_TAG_SUGGESTION_LIMIT);
          state.recentTagChipLimit = sanitizeTagUiLimit(state.recentTagChipLimit, DEFAULT_RECENT_TAG_CHIP_LIMIT);
        }

        if (
          state &&
          state.startupVerificationMode !== 'off' &&
          state.startupVerificationMode !== 'idle' &&
          state.startupVerificationMode !== 'strict'
        ) {
          state.startupVerificationMode = 'off';
        }

        if (state && !Array.isArray(state.sensitiveTags)) {
          state.sensitiveTags = ['nsfw', 'private', 'hidden'];
        }

        if (state && typeof state.blurSensitiveImages !== 'boolean') {
          state.blurSensitiveImages = true;
        }

        if (state && typeof state.enableSafeMode !== 'boolean') {
          state.enableSafeMode = true;
        }

        if (state && typeof state.civitaiLookupEnabled !== 'boolean') {
          state.civitaiLookupEnabled = true;
        }

        if (state && typeof state.enableAnimations !== 'boolean') {
          state.enableAnimations = true;
        }

        if (state && typeof state.performanceDiagnosticsEnabled !== 'boolean') {
          state.performanceDiagnosticsEnabled = false;
        }

        if (state) {
          state.slideshowIntervalSeconds = sanitizeSlideshowIntervalSeconds(state.slideshowIntervalSeconds);
        }

        if (state && typeof state.slideshowShowFilename !== 'boolean') {
          state.slideshowShowFilename = true;
        }

        if (state && typeof state.creatorAttributionToken !== 'string') {
          state.creatorAttributionToken = null;
        } else if (state) {
          state.creatorAttributionToken = state.creatorAttributionToken.trim() || null;
        }

        if (state && typeof state.creatorAttributionUpdatedAt !== 'number') {
          state.creatorAttributionUpdatedAt = null;
        }

        if (state && typeof state.a1111Enabled !== 'boolean') {
          state.a1111Enabled = true;
        }

        if (state && typeof state.comfyUIEnabled !== 'boolean') {
          state.comfyUIEnabled = true;
        }

        if (state && typeof state.comfyUIQueueMonitoringEnabled !== 'boolean') {
          state.comfyUIQueueMonitoringEnabled = true;
        }

        if (state && typeof state.comfyUIWorkspaceLastUrl !== 'string') {
          state.comfyUIWorkspaceLastUrl = '';
        }

        if (
          state &&
          (typeof state.comfyUIWorkspacePanelWidth !== 'number' ||
            !Number.isFinite(state.comfyUIWorkspacePanelWidth))
        ) {
          state.comfyUIWorkspacePanelWidth = 360;
        }

        if (state) {
          state.comfyUIWorkspacePanelWidth = Math.min(Math.max(Math.round(state.comfyUIWorkspacePanelWidth), 280), 560);
        }

        if (state && typeof state.comfyUIWorkspaceAutoOpenSelectedImage !== 'boolean') {
          state.comfyUIWorkspaceAutoOpenSelectedImage = true;
        }

        if (state && typeof state.generatorLaunchCommand !== 'string') {
          state.generatorLaunchCommand = '';
        }

        if (state && typeof state.generatorLaunchWorkingDirectory !== 'string') {
          state.generatorLaunchWorkingDirectory = '';
        }
      },
    }
  )
);
