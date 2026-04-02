import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useImageStore } from './store/useImageStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useLicenseStore } from './store/useLicenseStore';
import { useImageLoader } from './hooks/useImageLoader';
import { useImageSelection } from './hooks/useImageSelection';
import { useHotkeys } from './hooks/useHotkeys';
import { useFeatureAccess } from './hooks/useFeatureAccess';
import { Directory } from './types';
import { X } from 'lucide-react';

import FolderSelector from './components/FolderSelector';
import ImageGrid from './components/ImageGrid';
import ImageModal from './components/ImageModal';
import Sidebar from './components/Sidebar';
import BrowserCompatibilityWarning from './components/BrowserCompatibilityWarning';
import Header from './components/Header';
import Toast from './components/Toast';
import SettingsModal from './components/SettingsModal';
import ChangelogModal from './components/ChangelogModal';
import ComparisonModal from './components/ComparisonModal';
import Footer from './components/Footer';
import cacheManager from './services/cacheManager';
import DirectoryList from './components/DirectoryList';
import ImagePreviewSidebar from './components/ImagePreviewSidebar';
import GenerationQueueSidebar from './components/GenerationQueueSidebar';
import CommandPalette from './components/CommandPalette';
import HotkeyHelp from './components/HotkeyHelp';
import Analytics from './components/Analytics';
import ProOnlyModal from './components/ProOnlyModal';
import SmartLibrary from './components/SmartLibrary';
import { ModelView } from './components/ModelView';
import GridToolbar from './components/GridToolbar';
import BatchExportModal from './components/BatchExportModal';
import { useA1111ProgressContext } from './contexts/A1111ProgressContext';
import { useGenerationQueueSync } from './hooks/useGenerationQueueSync';
import { useGenerationQueueStore } from './store/useGenerationQueueStore';
// Ensure the correct path to ImageTable
import ImageTable from './components/ImageTable'; // Verify this file exists or adjust the path
import { A1111GenerateModal, type GenerationParams as A1111GenerationParams } from './components/A1111GenerateModal';
import { ComfyUIGenerateModal, type GenerationParams as ComfyUIGenerationParams } from './components/ComfyUIGenerateModal';
import { useGenerateWithA1111 } from './hooks/useGenerateWithA1111';
import { useGenerateWithComfyUI } from './hooks/useGenerateWithComfyUI';
import { type IndexedImage, type BaseMetadata } from './types';
import { type SettingsFocusSection, type SettingsTab, type SettingsTabInput, resolveSettingsTab } from './components/settings/types';

interface OpenImageModalState {
  modalId: string;
  imageId: string;
  navigationImageIds: string[];
  navigationSource: 'filtered' | 'cluster';
  zIndex: number;
  initialWindowOffset: number;
  isMinimized: boolean;
}

const SIDEBAR_WIDTH_STORAGE_KEY = 'image-metahub-sidebar-width';
const RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = 'image-metahub-right-sidebar-width';
const SIDEBAR_DEFAULT_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 640;
const RIGHT_SIDEBAR_DEFAULT_WIDTH = 384;
const RIGHT_SIDEBAR_MIN_WIDTH = 320;
const RIGHT_SIDEBAR_MAX_WIDTH = 640;
const SIDEBAR_COLLAPSED_CONTENT_OFFSET = 48;
const MAIN_CONTENT_MIN_WIDTH = 560;

const sanitizePreferredWidth = (
  width: number,
  fallbackWidth: number,
  minWidth: number,
  maxWidth: number
) => {
  if (!Number.isFinite(width)) {
    return fallbackWidth;
  }

  return Math.min(Math.max(width, minWidth), maxWidth);
};

const clampSidebarWidth = (width: number, viewportWidth: number, reservedRightWidth = 0) => {
  const maxWidthFromViewport = viewportWidth - reservedRightWidth - MAIN_CONTENT_MIN_WIDTH;
  const upperBound = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, maxWidthFromViewport));

  return Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), upperBound);
};

const clampRightSidebarWidth = (width: number, viewportWidth: number, reservedLeftWidth = 0) => {
  const maxWidthFromViewport = viewportWidth - reservedLeftWidth - MAIN_CONTENT_MIN_WIDTH;
  const upperBound = Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.min(RIGHT_SIDEBAR_MAX_WIDTH, maxWidthFromViewport));

  return Math.min(Math.max(width, RIGHT_SIDEBAR_MIN_WIDTH), upperBound);
};

const resolveSidebarWidths = ({
  hasDirectories,
  isSidebarCollapsed,
  hasRightSidebar,
  viewportWidth,
  preferredLeftWidth,
  preferredRightWidth,
}: {
  hasDirectories: boolean;
  isSidebarCollapsed: boolean;
  hasRightSidebar: boolean;
  viewportWidth: number;
  preferredLeftWidth: number;
  preferredRightWidth: number;
}) => {
  let leftWidth = preferredLeftWidth;
  let rightWidth = preferredRightWidth;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const nextLeftWidth =
      hasDirectories && !isSidebarCollapsed
        ? clampSidebarWidth(preferredLeftWidth, viewportWidth, hasRightSidebar ? rightWidth : 0)
        : preferredLeftWidth;
    const reservedLeftWidth = hasDirectories
      ? (isSidebarCollapsed ? SIDEBAR_COLLAPSED_CONTENT_OFFSET : nextLeftWidth)
      : 0;
    const nextRightWidth = hasRightSidebar
      ? clampRightSidebarWidth(preferredRightWidth, viewportWidth, reservedLeftWidth)
      : preferredRightWidth;

    if (nextLeftWidth === leftWidth && nextRightWidth === rightWidth) {
      break;
    }

    leftWidth = nextLeftWidth;
    rightWidth = nextRightWidth;
  }

  return { leftWidth, rightWidth };
};

export default function App() {
  const { progressState: a1111Progress } = useA1111ProgressContext();
  useGenerationQueueSync();

  // --- Hooks ---
  const { handleSelectFolder, handleUpdateFolder, handleLoadFromStorage, handleRemoveDirectory, loadDirectory, processNewWatchedFiles } = useImageLoader();
  const { handleImageSelection, handleDeleteSelectedImages } = useImageSelection();
  const { generateWithA1111, isGenerating: isGeneratingA1111 } = useGenerateWithA1111();
  const { generateWithComfyUI, isGenerating: isGeneratingComfyUI } = useGenerateWithComfyUI();

  // --- Zustand Store State (Granular Selectors for Performance) ---
  // Data selectors
  const filteredImages = useImageStore((state) => state.filteredImages);
  const selectionTotalImages = useImageStore((state) => state.selectionTotalImages);
  const selectionDirectoryCount = useImageStore((state) => state.selectionDirectoryCount);
  const directories = useImageStore((state) => state.directories);
  const selectedImages = useImageStore((state) => state.selectedImages);
  const selectedImage = useImageStore((state) => state.selectedImage);
  const previewImage = useImageStore((state) => state.previewImage);
  const clustersCount = useImageStore((state) => state.clusters.length);
  const clusterNavigationContext = useImageStore((state) => state.clusterNavigationContext);

  // Loading & progress selectors
  const isLoading = useImageStore((state) => state.isLoading);
  const progress = useImageStore((state) => state.progress);
  const indexingState = useImageStore((state) => state.indexingState);
  const enrichmentProgress = useImageStore((state) => state.enrichmentProgress);
  const directoryProgress = useImageStore((state) => state.directoryProgress);

  // Status selectors
  const error = useImageStore((state) => state.error);
  const success = useImageStore((state) => state.success);
  const transferProgress = useImageStore((state) => state.transferProgress);

  // Filter state selectors
  const searchQuery = useImageStore((state) => state.searchQuery);
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const excludedFolders = useImageStore((state) => state.excludedFolders);
  const addExcludedFolder = useImageStore((state) => state.addExcludedFolder);
  const removeExcludedFolder = useImageStore((state) => state.removeExcludedFolder);
  const availableModels = useImageStore((state) => state.availableModels);
  const availableLoras = useImageStore((state) => state.availableLoras);
  const availableSamplers = useImageStore((state) => state.availableSamplers);
  const availableSchedulers = useImageStore((state) => state.availableSchedulers);
  const availableDimensions = useImageStore((state) => state.availableDimensions);
  const selectedModels = useImageStore((state) => state.selectedModels);
  const selectedLoras = useImageStore((state) => state.selectedLoras);
  const selectedSamplers = useImageStore((state) => state.selectedSamplers);
  const selectedSchedulers = useImageStore((state) => state.selectedSchedulers);
  const advancedFilters = useImageStore((state) => state.advancedFilters);
  const selectedRatings = useImageStore((state) => state.selectedRatings);
  const setSelectedTags = useImageStore((state) => state.setSelectedTags);
  const setExcludedTags = useImageStore((state) => state.setExcludedTags);
  const setSelectedAutoTags = useImageStore((state) => state.setSelectedAutoTags);
  const setExcludedAutoTags = useImageStore((state) => state.setExcludedAutoTags);
  const setFavoriteFilterMode = useImageStore((state) => state.setFavoriteFilterMode);
  const setSelectedRatings = useImageStore((state) => state.setSelectedRatings);

  // Folder selection selectors
  const selectedFolders = useImageStore((state) => state.selectedFolders);
  const isFolderSelectionLoaded = useImageStore((state) => state.isFolderSelectionLoaded);
  const includeSubfolders = useImageStore((state) => state.includeSubfolders);

  // Modal state selectors
  const isComparisonModalOpen = useImageStore((state) => state.isComparisonModalOpen);
  const isAnnotationsLoaded = useImageStore((state) => state.isAnnotationsLoaded);
  const refreshingDirectories = useImageStore((state) => state.refreshingDirectories);

  // Action selectors
  const setSearchQuery = useImageStore((state) => state.setSearchQuery);
  const setSelectedFilters = useImageStore((state) => state.setSelectedFilters);
  const setAdvancedFilters = useImageStore((state) => state.setAdvancedFilters);
  const setSelectedImage = useImageStore((state) => state.setSelectedImage);
  const removeImage = useImageStore((state) => state.removeImage);
  const updateImage = useImageStore((state) => state.updateImage);
  const toggleAutoWatch = useImageStore((state) => state.toggleAutoWatch);
  const toggleFolderSelection = useImageStore((state) => state.toggleFolderSelection);
  const clearFolderSelection = useImageStore((state) => state.clearFolderSelection);
  const isFolderSelected = useImageStore((state) => state.isFolderSelected);
  const toggleIncludeSubfolders = useImageStore((state) => state.toggleIncludeSubfolders);
  const resetState = useImageStore((state) => state.resetState);
  const setSuccess = useImageStore((state) => state.setSuccess);
  const setError = useImageStore((state) => state.setError);
  const setTransferProgress = useImageStore((state) => state.setTransferProgress);
  const setClusterNavigationContext = useImageStore((state) => state.setClusterNavigationContext);
  const cleanupInvalidImages = useImageStore((state) => state.cleanupInvalidImages);
  const closeComparisonModal = useImageStore((state) => state.closeComparisonModal);
  const setComparisonImages = useImageStore((state) => state.setComparisonImages);
  const openComparisonModal = useImageStore((state) => state.openComparisonModal);
  const initializeFolderSelection = useImageStore((state) => state.initializeFolderSelection);
  const loadAnnotations = useImageStore((state) => state.loadAnnotations);
  const imageStoreSetSortOrder = useImageStore((state) => state.setSortOrder);
  const sortOrder = useImageStore((state) => state.sortOrder);
  const reshuffle = useImageStore((state) => state.reshuffle);

  const safeFilteredImages = Array.isArray(filteredImages) ? filteredImages : [];
  const safeDirectories = Array.isArray(directories) ? directories : [];
  const safeSelectedImages = selectedImages instanceof Set ? selectedImages : new Set<string>();
  const hasDirectories = safeDirectories.length > 0;

  // --- Settings Store State ---
  const {
    itemsPerPage,
    setItemsPerPage,
    viewMode,
    toggleViewMode,
    theme,
    setLastViewedVersion,
    globalAutoWatch,
  } = useSettingsStore();

  // --- Local UI State ---
  const [currentPage, setCurrentPage] = useState(1);
  const previousSearchQueryRef = useRef(searchQuery);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('library');
  const [settingsSection, setSettingsSection] = useState<SettingsFocusSection>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return 1440;
    }

    return window.innerWidth;
  });
  const [preferredSidebarWidth, setPreferredSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return SIDEBAR_DEFAULT_WIDTH;
    }

    const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));

    return sanitizePreferredWidth(
      storedWidth,
      SIDEBAR_DEFAULT_WIDTH,
      SIDEBAR_MIN_WIDTH,
      SIDEBAR_MAX_WIDTH
    );
  });
  const [preferredRightSidebarWidth, setPreferredRightSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return RIGHT_SIDEBAR_DEFAULT_WIDTH;
    }

    const storedWidth = Number(window.localStorage.getItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY));

    return sanitizePreferredWidth(
      storedWidth,
      RIGHT_SIDEBAR_DEFAULT_WIDTH,
      RIGHT_SIDEBAR_MIN_WIDTH,
      RIGHT_SIDEBAR_MAX_WIDTH
    );
  });
  const [sidebarResizeState, setSidebarResizeState] = useState<{
    side: 'left' | 'right';
    startX: number;
    startWidth: number;
  } | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isHotkeyHelpOpen, setIsHotkeyHelpOpen] = useState(false);
  const [isChangelogModalOpen, setIsChangelogModalOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string>('0.10.0');
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [libraryView, setLibraryView] = useState<'library' | 'smart' | 'model'>('library');
  const [isA1111GenerateModalOpen, setIsA1111GenerateModalOpen] = useState(false);
  const [isComfyUIGenerateModalOpen, setIsComfyUIGenerateModalOpen] = useState(false);
  const [selectedImageForGeneration, setSelectedImageForGeneration] = useState<IndexedImage | null>(null);
  const [newImagesToast, setNewImagesToast] = useState<{ count: number; directoryName: string } | null>(null);
  const [isBatchExportModalOpen, setIsBatchExportModalOpen] = useState(false);
  const [openImageModals, setOpenImageModals] = useState<OpenImageModalState[]>([]);
  const [activeImageModalId, setActiveImageModalId] = useState<string | null>(null);
  const lastOpenedModalImageIdRef = useRef<string | null>(null);

  const queueCount = useGenerationQueueStore((state) =>
    state.items.filter((item) => item.status === 'waiting' || item.status === 'processing').length
  );
  const hasRightSidebar = Boolean(previewImage || isQueueOpen);
  const { leftWidth: sidebarWidth, rightWidth: rightSidebarWidth } = useMemo(
    () =>
      resolveSidebarWidths({
        hasDirectories,
        isSidebarCollapsed,
        hasRightSidebar,
        viewportWidth,
        preferredLeftWidth: preferredSidebarWidth,
        preferredRightWidth: preferredRightSidebarWidth,
      }),
    [
      hasDirectories,
      hasRightSidebar,
      isSidebarCollapsed,
      preferredRightSidebarWidth,
      preferredSidebarWidth,
      viewportWidth,
    ]
  );
  const mainContentMarginLeft = hasDirectories
    ? (isSidebarCollapsed ? SIDEBAR_COLLAPSED_CONTENT_OFFSET : sidebarWidth)
    : 0;
  const mainContentMarginRight = hasRightSidebar ? rightSidebarWidth : 0;
  const isSidebarResizing = sidebarResizeState !== null;
  const isLeftSidebarResizing = sidebarResizeState?.side === 'left';
  const isRightSidebarResizing = sidebarResizeState?.side === 'right';

  const handleSidebarResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    setSidebarResizeState({
      side: 'left',
      startX: event.clientX,
      startWidth: sidebarWidth,
    });
  }, [sidebarWidth]);

  const handleRightSidebarResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    setSidebarResizeState({
      side: 'right',
      startX: event.clientX,
      startWidth: rightSidebarWidth,
    });
  }, [rightSidebarWidth]);

  // --- Hotkeys Hook ---
  const { commands } = useHotkeys({
    isCommandPaletteOpen,
    setIsCommandPaletteOpen,
    isHotkeyHelpOpen,
    setIsHotkeyHelpOpen,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
  });

  // --- License/Trial Hook ---
  const {
    proModalOpen,
    proModalFeature,
    closeProModal,
    isTrialActive,
    trialDaysRemaining,
    canStartTrial,
    isExpired,
    isFree,
    isPro,
    canUseBatchExport,
    showProModal,
    startTrial,
  } = useFeatureAccess();

  const handleOpenSettings = (tab: SettingsTabInput = 'library', section: SettingsFocusSection = null) => {
    setSettingsTab(resolveSettingsTab(tab));
    setSettingsSection(section);
    setIsSettingsModalOpen(true);
  };

  const handleOpenHotkeySettings = () => {
    setIsHotkeyHelpOpen(false);
    handleOpenSettings('shortcuts');
  };

  const handleOpenLicenseSettings = () => {
    handleOpenSettings('license', 'license');
  };

  // Create a dummy image for generation from scratch (no base image)
  const createDummyImage = (): IndexedImage => {
    return {
      id: 'dummy-generation',
      name: 'New Generation',
      lastModified: Date.now(),
      directoryId: '',
      handle: {} as FileSystemFileHandle,
      metadataString: '',
      models: [],
      loras: [],
      sampler: '',
      scheduler: '',
      metadata: {
        normalizedMetadata: {
          prompt: '',
          negativePrompt: '',
          steps: 20,
          cfg_scale: 7.0,
          seed: -1,
          width: 1024,
          height: 1024,
        }
      }
    };
  };

  useEffect(() => {
    if (!isFolderSelectionLoaded) {
      initializeFolderSelection();
    }
  }, [initializeFolderSelection, isFolderSelectionLoaded]);

  // Load annotations on app start
  useEffect(() => {
    if (!isAnnotationsLoaded) {
      loadAnnotations();
    }
  }, [loadAnnotations, isAnnotationsLoaded]);

  // Initialize license and keep trial opt-in
  useEffect(() => {
    const initializeLicense = async () => {
      // 1. Rehydrate Zustand store from persistent storage
      await useLicenseStore.persist.rehydrate();
      const licenseState = useLicenseStore.getState();

      // 2. Check current status (defaults to free until user opts into trial)
      licenseState.checkLicenseStatus();
    };

    initializeLicense();
  }, []);

  // --- Effects ---
  useEffect(() => {
    const applyTheme = (themeValue: string, systemShouldUseDark: boolean) => {
      // Determine if we should be in "dark mode" for Tailwind utilities
      const isDark =
        themeValue === 'dark' ||
        themeValue === 'dracula' ||
        themeValue === 'nord' ||
        themeValue === 'ocean' ||
        (themeValue === 'system' && systemShouldUseDark);

      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }

      // Apply the data-theme attribute for CSS variables
      if (themeValue === 'system') {
        document.documentElement.setAttribute('data-theme', systemShouldUseDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', themeValue);
      }
    };

    if (window.electronAPI) {
      window.electronAPI.getTheme().then(({ shouldUseDarkColors }) => {
        applyTheme(theme, shouldUseDarkColors);
      });

      const unsubscribe = window.electronAPI.onThemeUpdated(({ shouldUseDarkColors }) => {
        applyTheme(theme, shouldUseDarkColors);
      });

      return () => {
        if (unsubscribe) unsubscribe();
      };
    } else {
      // Fallback for browser
      applyTheme(theme, window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
  }, [theme]);

  // Initialize the cache manager on startup
  useEffect(() => {
    const initializeCache = async () => {
      // Zustand persistence can be async, wait for it to rehydrate
      await useSettingsStore.persist.rehydrate();
      let path = useSettingsStore.getState().cachePath;
      if (!path && window.electronAPI) {
        path = undefined;
      }
      await cacheManager.init();

      // Validate cached images have valid file handles (for hot reload scenarios in browser)
      // Note: In Electron, mock handles are created with proper getFile() implementation
      const isElectron = typeof window !== 'undefined' && window.electronAPI;
      const currentImages = useImageStore.getState().images;

      if (!isElectron && currentImages.length > 0) {
        const firstImage = currentImages[0];
        const fileHandle = firstImage.thumbnailHandle || firstImage.handle;
        if (!fileHandle || typeof fileHandle.getFile !== 'function') {
          console.warn('⚠️ Detected invalid file handles (likely after hot reload). Clearing state...');
          resetState();
        }
      } else if (currentImages.length > 0) {
        // Clean up any invalid images that might have been loaded
        cleanupInvalidImages();
      }
    };
    initializeCache().catch(console.error);
  }, []); // ✅ Run only once on mount

  // Handler for loading directory from a path
  const handleLoadFromPath = useCallback(async (path: string) => {
    try {

      // Check if directory already exists in the store
      const existingDir = safeDirectories.find(d => d.path === path);
      if (existingDir) {
        return;
      }

      // Create directory object for Electron environment
      const dirName = path.split(/[\\/]/).pop() || path;
      const mockHandle = {
        name: dirName,
        kind: 'directory' as const
      };

      const newDirectory: Directory = {
        id: path,
        name: dirName,
        path: path,
        handle: mockHandle as unknown as FileSystemDirectoryHandle,
        autoWatch: globalAutoWatch
      };

      // Load the directory using the hook's loadDirectory function
      await loadDirectory(newDirectory, false);

      // Start watcher if autoWatch is enabled
      if (window.electronAPI && globalAutoWatch) {
        try {
          const result = await window.electronAPI.startWatchingDirectory({
            directoryId: path,
            dirPath: path
          });
          if (!result.success) {
            console.error(`Failed to start auto-watch: ${result.error}`);
          }
        } catch (err) {
          console.error('Error starting auto-watch:', err);
        }
      }

    } catch (error) {
      console.error('Error loading directory from path:', error);
    }
  }, [loadDirectory, safeDirectories, globalAutoWatch]);

  // On mount, load directories stored in localStorage
  useEffect(() => {
    // Only run once on mount
    handleLoadFromStorage();
  }, []);

  // Listen for directory load events from the main process (e.g., from CLI argument)
  useEffect(() => {
    if (window.electronAPI && typeof window.electronAPI.onLoadDirectoryFromCLI === 'function') {
      const unsubscribe = window.electronAPI.onLoadDirectoryFromCLI((path: string) => {
        if (path) {
          handleLoadFromPath(path);
        }
      });

      // Cleanup the listener when the component unmounts
      return unsubscribe;
    }
  }, [handleLoadFromPath]);

  // Listen for new images from file watcher
  useEffect(() => {
    if (!window.electronAPI) return;

    const unsubscribe = window.electronAPI.onNewImagesDetected(async (data) => {
      const { directoryId, files } = data;
      const directory = directories.find(d => d.id === directoryId);

      if (!directory || !files || files.length === 0) return;

      // Show toast notification
      setNewImagesToast({ count: files.length, directoryName: directory.name });

      // Processar novos arquivos usando a função do useImageLoader
      await processNewWatchedFiles(directory, files);

      if (sortOrder === 'date-desc') {
        setCurrentPage(1);
      }
    });

    return () => unsubscribe();
  }, [directories, processNewWatchedFiles, sortOrder]);

  useEffect(() => {
    if (!window.electronAPI?.onTransferIndexedImagesProgress) return;

    const unsubscribe = window.electronAPI.onTransferIndexedImagesProgress((payload) => {
      setTransferProgress(payload);
      if (payload.stage === 'done') {
        setTimeout(() => {
          const latest = useImageStore.getState().transferProgress;
          if (latest?.transferId === payload.transferId) {
            useImageStore.getState().setTransferProgress(null);
          }
        }, 2500);
      }
    });

    return unsubscribe;
  }, [setTransferProgress]);

  // Watcher debug logs
  useEffect(() => {
    if (!window.electronAPI?.onWatcherDebug) return;

    console.log('[App] Setting up watcher-debug listener');
    const unsubscribe = window.electronAPI.onWatcherDebug(({ message }) => {
      console.log('[WATCHER-DEBUG]', message);
    });
    console.log('[App] watcher-debug listener registered successfully');

    return () => {
      console.log('[App] Cleaning up watcher-debug listener');
      unsubscribe();
    };
  }, []);

  // Restore auto-watchers on app start
  useEffect(() => {
    if (!window.electronAPI || directories.length === 0) return;

    const restoreWatchers = async () => {
      console.log('[App] Restoring watchers for directories:', directories.map(d => ({ id: d.id, name: d.name, autoWatch: d.autoWatch })));
      for (const dir of directories) {
        if (dir.autoWatch) {
          try {
            console.log(`[App] Starting watcher for ${dir.name} (${dir.path})`);
            const result = await window.electronAPI.startWatchingDirectory({
              directoryId: dir.id,
              dirPath: dir.path
            });
            console.log(`[App] Watcher start result for ${dir.name}:`, result);
          } catch (err) {
            console.error(`Failed to restore watcher for ${dir.path}:`, err);
          }
        } else {
          console.log(`[App] Skipping watcher for ${dir.name} (autoWatch: ${dir.autoWatch})`);
        }
      }
    };

    // Delay para garantir que todas as pastas foram carregadas
    const timeoutId = setTimeout(restoreWatchers, 1000);

    return () => clearTimeout(timeoutId);
  }, [directories]);

  // Sync all directories with globalAutoWatch setting when it changes
  useEffect(() => {
    if (!window.electronAPI || directories.length === 0) return;

    const syncAutoWatch = async () => {
      console.log(`[App] Syncing all directories to globalAutoWatch: ${globalAutoWatch}`);
      for (const dir of directories) {
        // Update directory autoWatch state if it differs from global
        if (dir.autoWatch !== globalAutoWatch) {
          console.log(`[App] Updating ${dir.name} autoWatch from ${dir.autoWatch} to ${globalAutoWatch}`);
          toggleAutoWatch(dir.id);

          // Start or stop watcher based on new state
          try {
            if (globalAutoWatch) {
              const result = await window.electronAPI.startWatchingDirectory({
                directoryId: dir.id,
                dirPath: dir.path
              });
              console.log(`[App] Started watcher for ${dir.name}:`, result);
            } else {
              await window.electronAPI.stopWatchingDirectory({
                directoryId: dir.id
              });
              console.log(`[App] Stopped watcher for ${dir.name}`);
            }
          } catch (err) {
            console.error(`Failed to sync watcher for ${dir.path}:`, err);
          }
        }
      }
    };

    syncAutoWatch();
  }, [globalAutoWatch]);

  // Auto-dismiss new images toast after 5 seconds
  useEffect(() => {
    if (newImagesToast) {
      const timer = setTimeout(() => {
        setNewImagesToast(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [newImagesToast]);

  // Get app version and check if we should show changelog
  useEffect(() => {
    const checkForNewVersion = async () => {
      // Wait for Zustand persistence to rehydrate
      await useSettingsStore.persist.rehydrate();

      let version = '0.10.5'; // Default fallback version

      if (window.electronAPI && window.electronAPI.getAppVersion) {
        try {
          version = await window.electronAPI.getAppVersion();
        } catch (error) {
          console.warn('Failed to get app version from Electron, using fallback:', error);
        }
      }

      setCurrentVersion(version);

      // Get the current lastViewedVersion from the store after rehydration
      const currentLastViewed = useSettingsStore.getState().lastViewedVersion;

      // Check if this is a new version since last view (or first run)
      if (currentLastViewed !== version) {
        setIsChangelogModalOpen(true);
        setLastViewedVersion(version);
      }
    };

    checkForNewVersion();
  }, []); // Run only once on mount

  // Listen for menu events
  useEffect(() => {
    if (!window.electronAPI) return;

    const unsubscribeAddFolder = window.electronAPI.onMenuAddFolder(() => {
      handleSelectFolder();
    });

    const unsubscribeOpenSettings = window.electronAPI.onMenuOpenSettings(() => {
      setIsSettingsModalOpen(true);
    });

    const unsubscribeToggleView = window.electronAPI.onMenuToggleView(() => {
      toggleViewMode();
    });

    const unsubscribeShowChangelog = window.electronAPI.onMenuShowChangelog(() => {
      setIsChangelogModalOpen(true);
    });

    return () => {
      unsubscribeAddFolder();
      unsubscribeOpenSettings();
      unsubscribeToggleView();
      unsubscribeShowChangelog();
    };
  }, [handleSelectFolder, toggleViewMode]);

  useEffect(() => {
    if (previousSearchQueryRef.current !== searchQuery) {
      setCurrentPage(1);
      previousSearchQueryRef.current = searchQuery;
    }
  }, [searchQuery]);

  // Reset page if current page exceeds available pages after filtering
  useEffect(() => {
    const totalPages = Math.ceil(safeFilteredImages.length / itemsPerPage);
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [safeFilteredImages.length, itemsPerPage, currentPage]);

  // Clean up selectedImage if its directory no longer exists
  useEffect(() => {
    if (selectedImage && !safeDirectories.find(d => d.id === selectedImage.directoryId)) {
      console.warn('Selected image directory no longer exists, clearing selection');
      setSelectedImage(null);
    }
  }, [selectedImage, safeDirectories, setSelectedImage]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      SIDEBAR_WIDTH_STORAGE_KEY,
      String(Math.round(preferredSidebarWidth))
    );
  }, [preferredSidebarWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      RIGHT_SIDEBAR_WIDTH_STORAGE_KEY,
      String(Math.round(preferredRightSidebarWidth))
    );
  }, [preferredRightSidebarWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (!sidebarResizeState || typeof window === 'undefined') {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - sidebarResizeState.startX;
      if (sidebarResizeState.side === 'left') {
        const nextWidth = sidebarResizeState.startWidth + deltaX;
        setPreferredSidebarWidth(
          clampSidebarWidth(nextWidth, viewportWidth, mainContentMarginRight)
        );
        return;
      }

      const nextWidth = sidebarResizeState.startWidth - deltaX;
      setPreferredRightSidebarWidth(
        clampRightSidebarWidth(nextWidth, viewportWidth, mainContentMarginLeft)
      );
    };

    const handlePointerUp = () => {
      setSidebarResizeState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    window.addEventListener('blur', handlePointerUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('blur', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [mainContentMarginLeft, mainContentMarginRight, sidebarResizeState, viewportWidth]);

  useEffect(() => {
    if (!selectedImage) {
      lastOpenedModalImageIdRef.current = null;
      return;
    }

    if (lastOpenedModalImageIdRef.current === selectedImage.id) {
      return;
    }
    lastOpenedModalImageIdRef.current = selectedImage.id;

    const navigationSource =
      clusterNavigationContext && clusterNavigationContext.length > 0
        ? clusterNavigationContext
        : safeFilteredImages;
    const navigationImageIds = navigationSource.map((image) => image.id);
    const navigationSourceType: OpenImageModalState['navigationSource'] =
      clusterNavigationContext && clusterNavigationContext.length > 0 ? 'cluster' : 'filtered';

    setOpenImageModals((current) => {
      const highestZIndex = current.length > 0 ? Math.max(...current.map((modal) => modal.zIndex)) : 59;
      const existingModal = current.find((modal) => modal.imageId === selectedImage.id);

      if (existingModal) {
        const nextZIndex = current.length > 1 ? highestZIndex + 1 : existingModal.zIndex;
        const shouldUpdate =
          existingModal.isMinimized || existingModal.zIndex !== nextZIndex;

        if (!shouldUpdate) {
          return current;
        }

        return current.map((modal) => {
          if (modal.modalId !== existingModal.modalId) {
            return modal;
          }

          return {
            ...modal,
            zIndex: nextZIndex,
            isMinimized: false,
          };
        });
      }

      const modalId = `image-modal-${Date.now()}-${selectedImage.id}`;

      return [
        ...current,
        {
          modalId,
          imageId: selectedImage.id,
          navigationImageIds,
          navigationSource: navigationSourceType,
          zIndex: highestZIndex + 1,
          initialWindowOffset: current.length * 28,
          isMinimized: false,
        },
      ];
    });
  }, [clusterNavigationContext, safeFilteredImages, selectedImage]);

  const filteredNavigationImageIds = useMemo(
    () => safeFilteredImages.map((image) => image.id),
    [safeFilteredImages]
  );

  const getImageByIdFromStore = useCallback((imageId: string) => {
    if (!imageId) {
      return undefined;
    }

    const state = useImageStore.getState();
    return state.images.find((image) => image.id === imageId)
      ?? state.filteredImages.find((image) => image.id === imageId);
  }, []);

  const resolveModalNavigationImageIds = useCallback((modal: OpenImageModalState) => {
    const sourceIds =
      modal.navigationSource === 'filtered'
        ? filteredNavigationImageIds
        : modal.navigationImageIds;

    return sourceIds.filter((imageId) => Boolean(getImageByIdFromStore(imageId)));
  }, [filteredNavigationImageIds, getImageByIdFromStore]);

  useEffect(() => {
    setOpenImageModals((current) => {
      let changed = false;
      const next = current.flatMap((modal) => {
        const image = getImageByIdFromStore(modal.imageId);
        const directoryExists = image ? safeDirectories.some((directory) => directory.id === image.directoryId) : false;

        if (!image || !directoryExists) {
          changed = true;
          return [];
        }

        if (modal.navigationSource === 'filtered') {
          return [modal];
        }

        const navigationImageIds = resolveModalNavigationImageIds(modal);
        if (navigationImageIds.length !== modal.navigationImageIds.length) {
          changed = true;
          return [{ ...modal, navigationImageIds }];
        }

        return [modal];
      });

      return changed ? next : current;
    });
  }, [getImageByIdFromStore, resolveModalNavigationImageIds, safeDirectories]);

  useEffect(() => {
    const selectedImageId = useImageStore.getState().selectedImage?.id ?? null;
    const nextActiveModal = [...openImageModals]
      .filter((modal) => !modal.isMinimized)
      .sort((left, right) => right.zIndex - left.zIndex)[0];
    const nextActiveModalId = nextActiveModal?.modalId ?? null;

    if (nextActiveModalId !== activeImageModalId) {
      setActiveImageModalId(nextActiveModalId);
      return;
    }

    if (nextActiveModal) {
      const nextActiveImage = getImageByIdFromStore(nextActiveModal.imageId);
      if (nextActiveImage && selectedImageId !== nextActiveImage.id) {
        setSelectedImage(nextActiveImage);
      }
    } else {
      if (selectedImageId !== null) {
        setSelectedImage(null);
      }
      if (openImageModals.length === 0 && useImageStore.getState().clusterNavigationContext !== null) {
        setClusterNavigationContext(null);
      }
    }
  }, [activeImageModalId, getImageByIdFromStore, openImageModals, setClusterNavigationContext, setSelectedImage]);

  // --- Memoized Callbacks for UI ---
  const handleImageDeleted = useCallback((imageId: string) => {
    removeImage(imageId);
    setOpenImageModals((current) => {
      return current.flatMap((modal) => {
        const navigationImageIds = modal.navigationImageIds.filter((id) => id !== imageId);
        if (modal.imageId === imageId) {
          return [];
        }
        return [{ ...modal, navigationImageIds }];
      });
    });
    if (useImageStore.getState().selectedImage?.id === imageId) {
      setSelectedImage(null);
    }
  }, [removeImage, setSelectedImage]);

  const handleImageRenamed = useCallback((imageId: string, newName: string) => {
    updateImage(imageId, newName);
  }, [updateImage]);

  const handleActivateImageModal = useCallback((modalId: string) => {
    setOpenImageModals((current) => {
      const targetModal = current.find((modal) => modal.modalId === modalId);
      if (!targetModal) {
        return current;
      }

      const nextZIndex = Math.max(...current.map((modal) => modal.zIndex)) + 1;
      return current.map((modal) =>
        modal.modalId === modalId ? { ...modal, zIndex: nextZIndex, isMinimized: false } : modal
      );
    });
    setActiveImageModalId(modalId);
    const targetModal = openImageModals.find((modal) => modal.modalId === modalId);
    const targetImage = targetModal ? getImageByIdFromStore(targetModal.imageId) ?? null : null;
    if (targetImage && useImageStore.getState().selectedImage?.id !== targetImage.id) {
      setSelectedImage(targetImage);
    }
  }, [getImageByIdFromStore, openImageModals, setSelectedImage]);

  const handleMinimizeImageModal = useCallback((modalId: string) => {
    setOpenImageModals((current) =>
      current.map((modal) =>
        modal.modalId === modalId ? { ...modal, isMinimized: true } : modal
      )
    );
  }, []);

  const handleMinimizeAllImageModals = useCallback(() => {
    setOpenImageModals((current) => {
      if (current.every((modal) => modal.isMinimized)) {
        return current;
      }

      return current.map((modal) => (
        modal.isMinimized ? modal : { ...modal, isMinimized: true }
      ));
    });
  }, []);

  const handleCloseImageModal = useCallback((modalId: string, imageId: string) => {
    setOpenImageModals((current) => current.filter((modal) => modal.modalId !== modalId));

    if (useImageStore.getState().selectedImage?.id === imageId) {
      setSelectedImage(null);
    }
  }, [setSelectedImage]);

  const handleCloseImageModalFromFooter = useCallback((modalId: string) => {
    const targetModal = openImageModals.find((modal) => modal.modalId === modalId);
    if (!targetModal) {
      return;
    }

    handleCloseImageModal(targetModal.modalId, targetModal.imageId);
  }, [handleCloseImageModal, openImageModals]);

  const handleImageModalNavigate = useCallback((modalId: string, direction: 'next' | 'previous') => {
    const targetModal = openImageModals.find((modal) => modal.modalId === modalId);
    if (!targetModal) {
      return;
    }

    const availableImageIds = resolveModalNavigationImageIds(targetModal);
    const currentIndex = availableImageIds.findIndex((imageId) => imageId === targetModal.imageId);

    if (currentIndex === -1) {
      return;
    }

    const nextImageId =
      direction === 'next'
        ? availableImageIds[currentIndex + 1]
        : availableImageIds[currentIndex - 1];

    if (!nextImageId) {
      return;
    }

    setOpenImageModals((current) =>
      current.map((modal) =>
        modal.modalId === modalId ? { ...modal, imageId: nextImageId } : modal
      )
    );

    const nextImage = getImageByIdFromStore(nextImageId);
    if (nextImage && useImageStore.getState().selectedImage?.id !== nextImage.id) {
      setSelectedImage(nextImage);
    }
  }, [getImageByIdFromStore, openImageModals, resolveModalNavigationImageIds, setSelectedImage]);

  const handleOpenBatchExport = useCallback(() => {
    if (!canUseBatchExport) {
      showProModal('batch_export');
      return;
    }
    setIsBatchExportModalOpen(true);
  }, [canUseBatchExport, showProModal]);

  // --- Render Logic ---
  const paginatedImages = useMemo(
    () => {
      if (itemsPerPage === -1) {
        return safeFilteredImages;
      }
      return safeFilteredImages.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
    },
    [safeFilteredImages, currentPage, itemsPerPage]
  );
  const totalPages = itemsPerPage === -1
    ? 1
    : Math.ceil(safeFilteredImages.length / itemsPerPage);
  const openImageModalEntries = useMemo(() => {
    return openImageModals
      .map((modal) => {
        const image = getImageByIdFromStore(modal.imageId);
        if (!image) {
          return null;
        }

        const navigationImageIds = resolveModalNavigationImageIds(modal);
        const currentIndex = navigationImageIds.findIndex((imageId) => imageId === modal.imageId);
        const directoryPath = safeDirectories.find((directory) => directory.id === image.directoryId)?.path;
        if (!directoryPath) {
          return null;
        }

        return {
          ...modal,
          image,
          directoryPath,
          currentIndex: currentIndex === -1 ? 0 : currentIndex,
          totalImages: navigationImageIds.length,
        };
      })
      .filter(Boolean) as Array<OpenImageModalState & {
        image: IndexedImage;
        directoryPath: string;
        currentIndex: number;
        totalImages: number;
      }>;
  }, [getImageByIdFromStore, openImageModals, resolveModalNavigationImageIds, safeDirectories]);

  const footerWindowItems = useMemo(() => {
    return openImageModals
      .map((modal) => {
        const image = getImageByIdFromStore(modal.imageId);
        if (!image) {
          return null;
        }

        return {
          id: modal.modalId,
          title: image.name,
          isActive: activeImageModalId === modal.modalId,
          isMinimized: modal.isMinimized,
        };
      })
      .filter(Boolean) as Array<{
        id: string;
        title: string;
        isActive: boolean;
        isMinimized: boolean;
      }>;
  }, [activeImageModalId, getImageByIdFromStore, openImageModals]);
  const hasVisibleImageModal = openImageModalEntries.some((modal) => !modal.isMinimized);

  const normalizeFolderPath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');
  const activeFolderHasProgress = (() => {
    const progressDirectoryIds = Object.keys(directoryProgress);
    if (progressDirectoryIds.length === 0) {
      return false;
    }

    if (selectedFolders.size === 0) {
      return progressDirectoryIds.some((directoryId) =>
        safeDirectories.some((directory) => directory.id === directoryId && (directory.visible ?? true))
      );
    }

    const normalizedSelectedFolders = Array.from(selectedFolders).map(normalizeFolderPath);

    return progressDirectoryIds.some((directoryId) => {
      const directory = safeDirectories.find((entry) => entry.id === directoryId);
      if (!directory || directory.visible === false) {
        return false;
      }

      const normalizedDirectoryPath = normalizeFolderPath(directory.path);
      return normalizedSelectedFolders.some((selectedFolder) =>
        selectedFolder === normalizedDirectoryPath ||
        selectedFolder.startsWith(`${normalizedDirectoryPath}/`) ||
        normalizedDirectoryPath.startsWith(`${selectedFolder}/`)
      );
    });
  })();
  const shouldShowLibraryPlaceholder =
    libraryView === 'library' &&
    safeFilteredImages.length === 0 &&
    activeFolderHasProgress;

  return (
    <div className="min-h-screen bg-gradient-to-r from-gray-950 to-gray-900 text-gray-200 font-sans">
      <BrowserCompatibilityWarning />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        commands={commands}
      />

      <HotkeyHelp
        isOpen={isHotkeyHelpOpen}
        onClose={() => setIsHotkeyHelpOpen(false)}
        onOpenSettings={handleOpenHotkeySettings}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => {
          setIsSettingsModalOpen(false);
          setSettingsSection(null);
        }}
        initialTab={settingsTab}
        focusSection={settingsSection}
      />

      <ComparisonModal
        isOpen={isComparisonModalOpen}
        onClose={closeComparisonModal}
      />

      <BatchExportModal
        isOpen={isBatchExportModalOpen}
        onClose={() => setIsBatchExportModalOpen(false)}
        selectedImageIds={safeSelectedImages}
        filteredImages={safeFilteredImages}
        directories={safeDirectories}
      />

      {hasDirectories && (
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          width={sidebarWidth}
          isResizing={isLeftSidebarResizing}
          onResizeStart={handleSidebarResizeStart}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          availableModels={availableModels}
          availableLoras={availableLoras}
          availableSamplers={availableSamplers}
          availableSchedulers={availableSchedulers}
          selectedModels={selectedModels}
          selectedLoras={selectedLoras}
          selectedSamplers={selectedSamplers}
          selectedSchedulers={selectedSchedulers}
          onModelChange={(models) => setSelectedFilters({ models })}
          onLoraChange={(loras) => setSelectedFilters({ loras })}
          onSamplerChange={(samplers) => setSelectedFilters({ samplers })}
          onSchedulerChange={(schedulers) => setSelectedFilters({ schedulers })}
          onClearAllFilters={() => {
            setSearchQuery('');
            setSelectedFilters({
              models: [],
              excludedModels: [],
              loras: [],
              excludedLoras: [],
              samplers: [],
              excludedSamplers: [],
              schedulers: [],
              excludedSchedulers: [],
            });
            setSelectedTags([]);
            setExcludedTags([]);
            setSelectedAutoTags([]);
            setExcludedAutoTags([]);
            setFavoriteFilterMode('neutral');
            setSelectedRatings([]);
            setAdvancedFilters({});
          }}
          advancedFilters={advancedFilters}
          onAdvancedFiltersChange={setAdvancedFilters}
          onClearAdvancedFilters={() => {
            setAdvancedFilters({});
            setSelectedRatings([]);
          }}
          availableDimensions={availableDimensions}
          selectedRatings={selectedRatings}
          onSelectedRatingsChange={setSelectedRatings}
          onAddFolder={handleSelectFolder}
          isIndexing={indexingState === 'indexing' || indexingState === 'completed'}
          scanSubfolders={scanSubfolders}
          excludedFolders={excludedFolders}
          onExcludeFolder={addExcludedFolder}
          onIncludeFolder={removeExcludedFolder}
          sortOrder={sortOrder}
          onSortOrderChange={imageStoreSetSortOrder}
          onReshuffle={reshuffle}
        >
          <DirectoryList
            directories={safeDirectories}
            onRemoveDirectory={handleRemoveDirectory}
            onUpdateDirectory={handleUpdateFolder}
            refreshingDirectories={refreshingDirectories}
            directoryProgress={directoryProgress}
            onToggleFolderSelection={toggleFolderSelection}
            onClearFolderSelection={clearFolderSelection}
            isFolderSelected={isFolderSelected}
            selectedFolders={selectedFolders}
            includeSubfolders={includeSubfolders}
            onToggleIncludeSubfolders={toggleIncludeSubfolders}
            isIndexing={indexingState === 'indexing' || indexingState === 'paused' || indexingState === 'completed'}
            scanSubfolders={scanSubfolders}
          />
        </Sidebar>
      )}
      
      {isQueueOpen ? (
        <GenerationQueueSidebar
          onClose={() => setIsQueueOpen(false)}
          width={rightSidebarWidth}
          isResizing={isRightSidebarResizing}
          onResizeStart={handleRightSidebarResizeStart}
        />
      ) : (
        <ImagePreviewSidebar
          width={rightSidebarWidth}
          isResizing={isRightSidebarResizing}
          onResizeStart={handleRightSidebarResizeStart}
        />
      )}

      <div
        className={`h-screen flex flex-col ${isSidebarResizing ? 'transition-none' : 'transition-[margin] duration-300 ease-in-out'}`}
        style={{ marginLeft: mainContentMarginLeft, marginRight: mainContentMarginRight }}
      >
        <Header
          onOpenSettings={() => handleOpenSettings()}
          onOpenAnalytics={() => setIsAnalyticsOpen(true)}
          onOpenLicense={handleOpenLicenseSettings}
          onOpenA1111Generate={() => setIsA1111GenerateModalOpen(true)}
          onOpenComfyUIGenerate={() => setIsComfyUIGenerateModalOpen(true)}
          libraryView={libraryView}
          onLibraryViewChange={setLibraryView}
        />

        <main className="mx-auto p-4 flex-1 flex flex-col min-h-0 w-full">
          {error && (
            <div className="bg-red-900/50 text-red-300 p-3 rounded-lg my-4 flex items-center justify-between">
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="ml-4 p-1 hover:bg-red-800/50 rounded transition-colors"
                title="Dismiss message"
              >
                <X size={16} />
              </button>
            </div>
          )}
          
          {/* Toast Notification */}
          {success && (
            <Toast
              message={success}
              onDismiss={() => setSuccess(null)}
            />
          )}

          {/* New Images Toast */}
          {newImagesToast && (
            <div className="fixed bottom-4 right-4 z-50 animate-slide-in-right">
              <div className="bg-blue-900/90 backdrop-blur-sm text-blue-100 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-[300px] max-w-[500px] border border-blue-700/50">
                <div className="flex items-center gap-2 flex-1">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                  <span className="text-sm">
                    <span className="font-semibold">{newImagesToast.count}</span> new image{newImagesToast.count !== 1 ? 's' : ''} detected in <span className="font-semibold">{newImagesToast.directoryName}</span>
                  </span>
                </div>
                <button
                  onClick={() => setNewImagesToast(null)}
                  className="p-1 hover:bg-blue-800/50 rounded transition-colors flex-shrink-0"
                  title="Dismiss"
                  aria-label="Dismiss notification"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          )}

          {!isLoading && !hasDirectories && <FolderSelector onSelectFolder={handleSelectFolder} />}

          {hasDirectories && (
            <>
                <GridToolbar
                  selectedImages={safeSelectedImages}
                  images={paginatedImages}
                  directories={safeDirectories}
                  onDeleteSelected={handleDeleteSelectedImages}
                  onGenerateA1111={(image) => {
                    setSelectedImageForGeneration(image);
                    setIsA1111GenerateModalOpen(true);
                  }}
                  onGenerateComfyUI={(image) => {
                    setSelectedImageForGeneration(image);
                    setIsComfyUIGenerateModalOpen(true);
                  }}
                  onCompare={(images) => {
                    setComparisonImages(images);
                    openComparisonModal();
                  }}
                  onBatchExport={handleOpenBatchExport}
                />

              <div className="flex-1 min-h-0">
                {libraryView === 'library' ? (
                  shouldShowLibraryPlaceholder ? (
                    <div className="flex h-full items-center justify-center text-sm text-gray-500">
                      Loading folder...
                    </div>
                  ) : viewMode === 'grid' ? (
                        <ImageGrid
                          images={paginatedImages}
                          onImageClick={handleImageSelection}
                          selectedImages={safeSelectedImages}
                          currentPage={currentPage}
                          totalPages={totalPages}
                          onPageChange={setCurrentPage}
                          onBatchExport={handleOpenBatchExport}
                        />
                      ) : (
                        <ImageTable
                          images={paginatedImages}
                          onImageClick={handleImageSelection}
                          selectedImages={safeSelectedImages}
                          onBatchExport={handleOpenBatchExport}
                        />
                  )
                ) : libraryView === 'model' ? (
                  <ModelView
                    isQueueOpen={isQueueOpen}
                    onToggleQueue={() => setIsQueueOpen((prev) => !prev)}
                    onModelSelect={(modelName) => {
                      setSelectedFilters({ models: [modelName] });
                      setLibraryView('library');
                    }}
                  />
                ) : (
                  <SmartLibrary
                    isQueueOpen={isQueueOpen}
                    onToggleQueue={() => setIsQueueOpen((prev) => !prev)}
                    onBatchExport={handleOpenBatchExport}
                  />
                )}
              </div>

              {libraryView === 'library' && (
                <Footer
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                  itemsPerPage={itemsPerPage}
                  onItemsPerPageChange={setItemsPerPage}
                  viewMode={viewMode}
                  onViewModeChange={toggleViewMode}
                  filteredCount={safeFilteredImages.length}
                  totalCount={selectionTotalImages}
                  directoryCount={selectionDirectoryCount}
                  enrichmentProgress={enrichmentProgress}
                  a1111Progress={a1111Progress}
                  transferProgress={transferProgress}
                  queueCount={queueCount}
                  isQueueOpen={isQueueOpen}
                  onToggleQueue={() => setIsQueueOpen((prev) => !prev)}
                  windowItems={footerWindowItems}
                  onWindowSelect={handleActivateImageModal}
                  onWindowClose={handleCloseImageModalFromFooter}
                />
              )}
            </>
          )}
        </main>

        {openImageModalEntries.map((modal) => (
          <ImageModal
            key={modal.modalId}
            image={modal.image}
            onClose={() => handleCloseImageModal(modal.modalId, modal.image.id)}
            onImageDeleted={handleImageDeleted}
            onImageRenamed={handleImageRenamed}
            currentIndex={modal.currentIndex}
            totalImages={modal.totalImages}
            onNavigateNext={() => handleImageModalNavigate(modal.modalId, 'next')}
            onNavigatePrevious={() => handleImageModalNavigate(modal.modalId, 'previous')}
            directoryPath={modal.directoryPath}
            isIndexing={progress && progress.total > 0 && progress.current < progress.total}
            zIndex={modal.zIndex}
            isActive={activeImageModalId === modal.modalId && !modal.isMinimized}
            onActivate={() => handleActivateImageModal(modal.modalId)}
            initialWindowOffset={modal.initialWindowOffset}
            isMinimized={modal.isMinimized}
            onMinimize={() => handleMinimizeImageModal(modal.modalId)}
          />
        ))}

        {hasVisibleImageModal && (
          <div
            className="fixed inset-0 z-50 bg-black/10 backdrop-blur-[2px] transition-opacity duration-200"
            onClick={handleMinimizeAllImageModals}
          />
        )}

        <ChangelogModal
          isOpen={isChangelogModalOpen}
          onClose={() => setIsChangelogModalOpen(false)}
          currentVersion={currentVersion}
        />

        <Analytics
          isOpen={isAnalyticsOpen}
          onClose={() => setIsAnalyticsOpen(false)}
        />

        <ProOnlyModal
          isOpen={proModalOpen}
          onClose={closeProModal}
          feature={proModalFeature}
          isTrialActive={isTrialActive}
          daysRemaining={trialDaysRemaining}
          canStartTrial={canStartTrial}
          onStartTrial={startTrial}
          isExpired={isExpired}
          isPro={isPro}
        />

        {/* Generate Modals */}
        {isA1111GenerateModalOpen && (
          <A1111GenerateModal
            isOpen={isA1111GenerateModalOpen}
            onClose={() => {
              setIsA1111GenerateModalOpen(false);
              setSelectedImageForGeneration(null);
            }}
            image={selectedImageForGeneration || createDummyImage()}
            onGenerate={async (params: A1111GenerationParams) => {
              const imageToUse = selectedImageForGeneration || createDummyImage();
              const customMetadata: Partial<BaseMetadata> = {
                prompt: params.prompt,
                negativePrompt: params.negativePrompt,
                cfg_scale: params.cfgScale,
                steps: params.steps,
                seed: params.randomSeed ? -1 : params.seed,
                width: params.width,
                height: params.height,
                model: params.model || imageToUse.metadata?.normalizedMetadata?.model,
                ...(params.sampler ? { sampler: params.sampler } : {}),
              };
              await generateWithA1111(imageToUse, customMetadata, params.numberOfImages);
              setIsA1111GenerateModalOpen(false);
              setSelectedImageForGeneration(null);
            }}
            isGenerating={isGeneratingA1111}
          />
        )}

        {isComfyUIGenerateModalOpen && (
          <ComfyUIGenerateModal
            isOpen={isComfyUIGenerateModalOpen}
            onClose={() => {
              setIsComfyUIGenerateModalOpen(false);
              setSelectedImageForGeneration(null);
            }}
            image={selectedImageForGeneration || createDummyImage()}
            onGenerate={async (params: ComfyUIGenerationParams) => {
              const imageToUse = selectedImageForGeneration || createDummyImage();
              const customMetadata: Partial<BaseMetadata> = {
                prompt: params.prompt,
                negativePrompt: params.negativePrompt,
                cfg_scale: params.cfgScale,
                steps: params.steps,
                seed: params.randomSeed ? -1 : params.seed,
                width: params.width,
                height: params.height,
                batch_size: params.numberOfImages,
                model: params.model?.name || imageToUse.metadata?.normalizedMetadata?.model,
                ...(params.sampler ? { sampler: params.sampler } : {}),
                ...(params.scheduler ? { scheduler: params.scheduler } : {}),
              };
              await generateWithComfyUI(imageToUse, {
                customMetadata,
                overrides: {
                  model: params.model || undefined,
                  loras: params.loras,
                },
                workflowMode: params.workflowMode,
                sourceImagePolicy: params.sourceImagePolicy,
                advancedPromptJson: params.advancedPromptJson,
                advancedWorkflowJson: params.advancedWorkflowJson,
                maskFile: params.maskFile,
              });
              setIsComfyUIGenerateModalOpen(false);
              setSelectedImageForGeneration(null);
            }}
            isGenerating={isGeneratingComfyUI}
          />
        )}
      </div>
    </div>
  );
}
