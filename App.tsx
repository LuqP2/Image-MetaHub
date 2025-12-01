import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useImageStore } from './store/useImageStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useImageLoader } from './hooks/useImageLoader';
import { useImageSelection } from './hooks/useImageSelection';
import { useHotkeys } from './hooks/useHotkeys';
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
import Footer from './components/Footer';
import cacheManager from './services/cacheManager';
import DirectoryList from './components/DirectoryList';
import ImagePreviewSidebar from './components/ImagePreviewSidebar';
import CommandPalette from './components/CommandPalette';
import HotkeyHelp from './components/HotkeyHelp';
import Analytics from './components/Analytics';
import { useA1111ProgressContext } from './contexts/A1111ProgressContext';
// Ensure the correct path to ImageTable
import ImageTable from './components/ImageTable'; // Verify this file exists or adjust the path

export default function App() {
  const { progressState: a1111Progress } = useA1111ProgressContext();
  
  // --- Hooks ---
  const { handleSelectFolder, handleUpdateFolder, handleLoadFromStorage, handleRemoveDirectory, loadDirectory } = useImageLoader();
  const { handleImageSelection, handleDeleteSelectedImages, clearSelection } = useImageSelection();

  // --- Zustand Store State ---
  const {
    images,
    filteredImages,
    selectionTotalImages,
    selectionDirectoryCount,
    directories,
    isLoading,
    progress,
    indexingState,
    error,
    success,
    previewImage,
    selectedImage,
    selectedImages,
    searchQuery,
    scanSubfolders,
    availableModels,
    availableLoras,
    availableSchedulers,
    availableDimensions,
    selectedModels,
    selectedLoras,
    selectedSchedulers,
    advancedFilters,
    folderSelection,
    isFolderSelectionLoaded,
    enrichmentProgress,
    setSearchQuery,
    setSelectedFilters,
    setAdvancedFilters,
    setSelectedImage,
    removeImage,
    updateImage,
    toggleDirectoryVisibility,
    setFolderSelectionState,
    getFolderSelectionState,
    initializeFolderSelection,
    resetState,
    setSuccess,
    setError,
    handleNavigateNext,
    handleNavigatePrevious,
    cleanupInvalidImages,
  } = useImageStore();
  const imageStoreSetSortOrder = useImageStore((state) => state.setSortOrder);
  const sortOrder = useImageStore((state) => state.sortOrder);

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
  const [settingsTab, setSettingsTab] = useState<'general' | 'hotkeys'>('general');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isHotkeyHelpOpen, setIsHotkeyHelpOpen] = useState(false);
  const [isChangelogModalOpen, setIsChangelogModalOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string>('0.9.6-rc');

  // --- Hotkeys Hook ---
  const { commands } = useHotkeys({
    isCommandPaletteOpen,
    setIsCommandPaletteOpen,
    isHotkeyHelpOpen,
    setIsHotkeyHelpOpen,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
  });

  const handleOpenSettings = (tab: 'general' | 'hotkeys' = 'general') => {
    setSettingsTab(tab);
    setIsSettingsModalOpen(true);
  };

  const handleOpenHotkeySettings = () => {
    setIsHotkeyHelpOpen(false);
    handleOpenSettings('hotkeys');
  };

  useEffect(() => {
    if (!isFolderSelectionLoaded) {
      initializeFolderSelection();
    }
  }, [initializeFolderSelection, isFolderSelectionLoaded]);

  // --- Effects ---
  useEffect(() => {
    const applyTheme = (themeValue, systemShouldUseDark) => {
      if (themeValue === 'dark' || (themeValue === 'system' && systemShouldUseDark)) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
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
      if (!isElectron && images.length > 0) {
        const firstImage = images[0];
        const fileHandle = firstImage.thumbnailHandle || firstImage.handle;
        if (!fileHandle || typeof fileHandle.getFile !== 'function') {
          console.warn('⚠️ Detected invalid file handles (likely after hot reload). Clearing state...');
          resetState();
        }
      } else if (images.length > 0) {
        // Clean up any invalid images that might have been loaded
        cleanupInvalidImages();
      }
    };
    initializeCache().catch(console.error);
  }, [images, resetState]);

  // Handler for loading directory from a path
  const handleLoadFromPath = useCallback(async (path: string) => {
    try {
      
      // Check if directory already exists in the store
      const existingDir = directories.find(d => d.path === path);
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
  }, [loadDirectory, directories]);

  // On mount, load directories stored in localStorage
  useEffect(() => {
    // The hook is memoized, so this will only run once on mount
    handleLoadFromStorage();
  }, [handleLoadFromStorage]);

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

      let version = '0.9.6-rc'; // Default fallback version

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
    const totalPages = Math.ceil(filteredImages.length / itemsPerPage);
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [filteredImages.length, itemsPerPage, currentPage]);

  // Clean up selectedImage if its directory no longer exists
  useEffect(() => {
    if (selectedImage && !directories.find(d => d.id === selectedImage.directoryId)) {
      console.warn('Selected image directory no longer exists, clearing selection');
      setSelectedImage(null);
    }
  }, [selectedImage, directories, setSelectedImage]);

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
    return filteredImages.findIndex(img => img.id === selectedImage.id);
  }, [selectedImage, filteredImages]);

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
  const paginatedImages = filteredImages.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filteredImages.length / itemsPerPage);
  const hasDirectories = directories.length > 0;
  const directoryPath = selectedImage ? directories.find(d => d.id === selectedImage.directoryId)?.path : undefined;

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
        onClose={() => setIsSettingsModalOpen(false)}
        initialTab={settingsTab}
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
            directories={directories}
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
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onOpenAnalytics={() => setIsAnalyticsOpen(true)}
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
                      selectedImages={selectedImages}
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={setCurrentPage}
                    />
                  ) : (
                    <ImageTable
                      images={paginatedImages}
                      onImageClick={handleImageSelection}
                      selectedImages={selectedImages}
                    />
                )}
              </div>

              <Footer
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                itemsPerPage={itemsPerPage}
                onItemsPerPageChange={setItemsPerPage}
                selectedCount={selectedImages.size}
                onClearSelection={clearSelection}
                onDeleteSelected={handleDeleteSelectedImages}
                viewMode={viewMode}
                onViewModeChange={toggleViewMode}
                filteredCount={filteredImages.length}
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
            totalImages={filteredImages.length}
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
      </div>
    </div>
  );
}