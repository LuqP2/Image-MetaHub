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
import CommandPalette from './components/CommandPalette';
import HotkeyHelp from './components/HotkeyHelp';
import Analytics from './components/Analytics';
import ProOnlyModal from './components/ProOnlyModal';
import { useA1111ProgressContext } from './contexts/A1111ProgressContext';
// Ensure the correct path to ImageTable
import ImageTable from './components/ImageTable'; // Verify this file exists or adjust the path

export default function App() {
  const { progressState: a1111Progress } = useA1111ProgressContext();
  
  // --- Hooks ---
  const { handleSelectFolder, handleUpdateFolder, handleLoadFromStorage, handleRemoveDirectory, loadDirectory } = useImageLoader();
  const { handleImageSelection, handleDeleteSelectedImages, clearSelection } = useImageSelection();

  // --- Zustand Store State (Granular Selectors for Performance) ---
  // Data selectors
  const filteredImages = useImageStore((state) => state.filteredImages);
  const selectionTotalImages = useImageStore((state) => state.selectionTotalImages);
  const selectionDirectoryCount = useImageStore((state) => state.selectionDirectoryCount);
  const directories = useImageStore((state) => state.directories);
  const selectedImages = useImageStore((state) => state.selectedImages);
  const selectedImage = useImageStore((state) => state.selectedImage);
  const previewImage = useImageStore((state) => state.previewImage);

  // Loading & progress selectors
  const isLoading = useImageStore((state) => state.isLoading);
  const progress = useImageStore((state) => state.progress);
  const indexingState = useImageStore((state) => state.indexingState);
  const enrichmentProgress = useImageStore((state) => state.enrichmentProgress);

  // Status selectors
  const error = useImageStore((state) => state.error);
  const success = useImageStore((state) => state.success);

  // Filter state selectors
  const searchQuery = useImageStore((state) => state.searchQuery);
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const availableModels = useImageStore((state) => state.availableModels);
  const availableLoras = useImageStore((state) => state.availableLoras);
  const availableSchedulers = useImageStore((state) => state.availableSchedulers);
  const availableDimensions = useImageStore((state) => state.availableDimensions);
  const selectedModels = useImageStore((state) => state.selectedModels);
  const selectedLoras = useImageStore((state) => state.selectedLoras);
  const selectedSchedulers = useImageStore((state) => state.selectedSchedulers);
  const advancedFilters = useImageStore((state) => state.advancedFilters);

  // Folder selection selectors
  const folderSelection = useImageStore((state) => state.folderSelection);
  const isFolderSelectionLoaded = useImageStore((state) => state.isFolderSelectionLoaded);

  // Modal state selectors
  const isComparisonModalOpen = useImageStore((state) => state.isComparisonModalOpen);
  const isAnnotationsLoaded = useImageStore((state) => state.isAnnotationsLoaded);

  // Action selectors
  const setSearchQuery = useImageStore((state) => state.setSearchQuery);
  const setSelectedFilters = useImageStore((state) => state.setSelectedFilters);
  const setAdvancedFilters = useImageStore((state) => state.setAdvancedFilters);
  const setSelectedImage = useImageStore((state) => state.setSelectedImage);
  const removeImage = useImageStore((state) => state.removeImage);
  const updateImage = useImageStore((state) => state.updateImage);
  const toggleDirectoryVisibility = useImageStore((state) => state.toggleDirectoryVisibility);
  const setFolderSelectionState = useImageStore((state) => state.setFolderSelectionState);
  const getFolderSelectionState = useImageStore((state) => state.getFolderSelectionState);
  const resetState = useImageStore((state) => state.resetState);
  const setSuccess = useImageStore((state) => state.setSuccess);
  const setError = useImageStore((state) => state.setError);
  const handleNavigateNext = useImageStore((state) => state.handleNavigateNext);
  const handleNavigatePrevious = useImageStore((state) => state.handleNavigatePrevious);
  const cleanupInvalidImages = useImageStore((state) => state.cleanupInvalidImages);
  const closeComparisonModal = useImageStore((state) => state.closeComparisonModal);
  const initializeFolderSelection = useImageStore((state) => state.initializeFolderSelection);
  const loadAnnotations = useImageStore((state) => state.loadAnnotations);
  const imageStoreSetSortOrder = useImageStore((state) => state.setSortOrder);
  const sortOrder = useImageStore((state) => state.sortOrder);

  const safeFilteredImages = Array.isArray(filteredImages) ? filteredImages : [];
  const safeDirectories = Array.isArray(directories) ? directories : [];
  const safeSelectedImages = selectedImages instanceof Set ? selectedImages : new Set<string>();

  // --- Settings Store State ---
  const {
    itemsPerPage,
    setItemsPerPage,
    viewMode,
    toggleViewMode,
    theme,
    setLastViewedVersion,
  } = useSettingsStore();

  // --- Local UI State ---
  const [currentPage, setCurrentPage] = useState(1);
  const previousSearchQueryRef = useRef(searchQuery);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'hotkeys' | 'themes'>('general');
  const [settingsSection, setSettingsSection] = useState<'license' | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isHotkeyHelpOpen, setIsHotkeyHelpOpen] = useState(false);
  const [isChangelogModalOpen, setIsChangelogModalOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string>('0.10.0');

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
    startTrial,
  } = useFeatureAccess();

  const handleOpenSettings = (tab: 'general' | 'hotkeys' | 'themes' = 'general', section: 'license' | null = null) => {
    setSettingsTab(tab);
    setSettingsSection(section);
    setIsSettingsModalOpen(true);
  };

  const handleOpenHotkeySettings = () => {
    setIsHotkeyHelpOpen(false);
    handleOpenSettings('hotkeys');
  };

  const handleOpenLicenseSettings = () => {
    handleOpenSettings('general', 'license');
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
        handle: mockHandle as unknown as FileSystemDirectoryHandle
      };
      
      // Load the directory using the hook's loadDirectory function
      await loadDirectory(newDirectory, false);
      
    } catch (error) {
      console.error('Error loading directory from path:', error);
    }
  }, [loadDirectory, safeDirectories]);

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

  // --- Memoized Callbacks for UI ---
  const handleImageDeleted = useCallback((imageId: string) => {
    removeImage(imageId);
    setSelectedImage(null);
  }, [removeImage, setSelectedImage]);

  const handleImageRenamed = useCallback((imageId: string, newName: string) => {
    updateImage(imageId, newName);
    setSelectedImage(null);
  }, [updateImage, setSelectedImage]);

  const getCurrentImageIndex = useCallback(() => {
    if (!selectedImage) return 0;
    return safeFilteredImages.findIndex(img => img.id === selectedImage.id);
  }, [selectedImage, safeFilteredImages]);

  // Memoize ImageModal callbacks to prevent unnecessary re-renders during Phase B
  const handleCloseImageModal = useCallback(() => {
    setSelectedImage(null);
  }, [setSelectedImage]);

  const handleImageModalNavigateNext = useCallback(() => {
    handleNavigateNext();
  }, [handleNavigateNext]);

  const handleImageModalNavigatePrevious = useCallback(() => {
    handleNavigatePrevious();
  }, [handleNavigatePrevious]);

  // --- Render Logic ---
  const paginatedImages = useMemo(
    () => safeFilteredImages.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [safeFilteredImages, currentPage, itemsPerPage]
  );
  const totalPages = Math.ceil(safeFilteredImages.length / itemsPerPage);
  const hasDirectories = safeDirectories.length > 0;
  const directoryPath = selectedImage ? safeDirectories.find(d => d.id === selectedImage.directoryId)?.path : undefined;

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

      {hasDirectories && (
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          availableModels={availableModels}
          availableLoras={availableLoras}
          availableSchedulers={availableSchedulers}
          selectedModels={selectedModels}
          selectedLoras={selectedLoras}
          selectedSchedulers={selectedSchedulers}
          onModelChange={(models) => setSelectedFilters({ models })}
          onLoraChange={(loras) => setSelectedFilters({ loras })}
          onSchedulerChange={(schedulers) => setSelectedFilters({ schedulers })}
          onClearAllFilters={() => {
            setSelectedFilters({ models: [], loras: [], schedulers: [] });
            setAdvancedFilters({});
          }}
          advancedFilters={advancedFilters}
          onAdvancedFiltersChange={setAdvancedFilters}
          onClearAdvancedFilters={() => setAdvancedFilters({})}
          availableDimensions={availableDimensions}
          onAddFolder={handleSelectFolder}
          isIndexing={indexingState === 'indexing' || indexingState === 'completed'}
          sortOrder={sortOrder}
          onSortOrderChange={imageStoreSetSortOrder}
        >
          <DirectoryList
            directories={safeDirectories}
            onRemoveDirectory={handleRemoveDirectory}
            onUpdateDirectory={handleUpdateFolder}
            onToggleVisibility={toggleDirectoryVisibility}
            onUpdateSelection={setFolderSelectionState}
            getSelectionState={getFolderSelectionState}
            folderSelection={folderSelection}
            isIndexing={indexingState === 'indexing' || indexingState === 'paused' || indexingState === 'completed'}
            scanSubfolders={scanSubfolders}
          />
        </Sidebar>
      )}
      
      <ImagePreviewSidebar />

      <div className={`${hasDirectories ? (isSidebarCollapsed ? 'ml-12' : 'ml-80') : 'ml-0'} ${previewImage ? 'mr-96' : 'mr-0'} h-screen flex flex-col transition-all duration-300 ease-in-out`}>
        <Header
          onOpenSettings={() => handleOpenSettings()}
          onOpenAnalytics={() => setIsAnalyticsOpen(true)}
          onOpenLicense={handleOpenLicenseSettings}
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

          {!isLoading && !hasDirectories && <FolderSelector onSelectFolder={handleSelectFolder} />}

          {hasDirectories && (
            <>
              <div className="flex-1 min-h-0">
                {viewMode === 'grid' ? (
                    <ImageGrid
                      images={paginatedImages}
                      onImageClick={handleImageSelection}
                      selectedImages={safeSelectedImages}
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={setCurrentPage}
                    />
                  ) : (
                    <ImageTable
                      images={paginatedImages}
                      onImageClick={handleImageSelection}
                      selectedImages={safeSelectedImages}
                    />
                )}
              </div>

              <Footer
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                itemsPerPage={itemsPerPage}
                onItemsPerPageChange={setItemsPerPage}
                selectedCount={safeSelectedImages.size}
                onClearSelection={clearSelection}
                onDeleteSelected={handleDeleteSelectedImages}
                viewMode={viewMode}
                onViewModeChange={toggleViewMode}
                filteredCount={safeFilteredImages.length}
                totalCount={selectionTotalImages}
                directoryCount={selectionDirectoryCount}
                enrichmentProgress={enrichmentProgress}
                a1111Progress={a1111Progress}
              />
            </>
          )}
        </main>

        {selectedImage && directoryPath && (
          <ImageModal
            image={selectedImage}
            onClose={handleCloseImageModal}
            onImageDeleted={handleImageDeleted}
            onImageRenamed={handleImageRenamed}
            currentIndex={getCurrentImageIndex()}
            totalImages={safeFilteredImages.length}
            onNavigateNext={handleImageModalNavigateNext}
            onNavigatePrevious={handleImageModalNavigatePrevious}
            directoryPath={directoryPath}
            isIndexing={progress && progress.total > 0 && progress.current < progress.total}
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
      </div>
    </div>
  );
}
