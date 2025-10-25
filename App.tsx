import React, { useState, useEffect, useCallback } from 'react';
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
import Loader from './components/Loader';
import Sidebar from './components/Sidebar';
import BrowserCompatibilityWarning from './components/BrowserCompatibilityWarning';
import Header from './components/Header';
import StatusBar from './components/StatusBar';
import ActionToolbar from './components/ActionToolbar';
import { SearchField } from './components/SearchBar';
import Pagination from './components/Pagination';
import SettingsModal from './components/SettingsModal';
import ChangelogModal from './components/ChangelogModal';
import DirectoryList from './components/DirectoryList';
import ImagePreviewSidebar from './components/ImagePreviewSidebar';
import CommandPalette from './components/CommandPalette';
import HotkeyHelp from './components/HotkeyHelp';
// Ensure the correct path to ImageTable
import ImageTable from './components/ImageTable'; // Verify this file exists or adjust the path
import UpdateNotification from './components/updateNotification';

export default function App() {
  
  // --- Hooks ---
  const { handleSelectFolder, handleUpdateFolder, handleLoadFromStorage, handleRemoveDirectory, loadDirectory, cancelIndexing } = useImageLoader();
  const { handleImageSelection, handleDeleteSelectedImages, clearSelection } = useImageSelection();

  // --- Zustand Store State ---
  const {
    images,
    filteredImages,
    directories,
    isLoading,
    progress,
    indexingState,
    error,
    success,
    previewImage,
    selectedImage,
    selectedImages,
    shouldOpenModal,
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
    visibleSubfolders,
    visibleRoots,
    setSearchQuery,
    setSelectedFilters,
    setAdvancedFilters,
    setSelectedImage,
    setShouldOpenModal,
    removeDirectory,
    updateImage,
    toggleDirectoryVisibility,
    toggleSubfolderVisibility,
    toggleRootVisibility,
    resetState,
    setIndexingState,
    setLoading,
    setProgress,
    setSuccess,
    setError,
    handleNavigateNext,
    handleNavigatePrevious,
    cleanupInvalidImages,
    handleNavigateNextPreview,
    handleNavigatePreviousPreview,
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
  const [searchField, setSearchField] = useState<SearchField>('any');
  const [currentPage, setCurrentPage] = useState(1);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'hotkeys'>('general');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isHotkeyHelpOpen, setIsHotkeyHelpOpen] = useState(false);
  const [isChangelogModalOpen, setIsChangelogModalOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string>('0.9.4');

  // --- Hotkeys Hook ---

  // --- Pagination Logic ---
  const paginatedImages = itemsPerPage === 'all'
    ? filteredImages
    : filteredImages.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(filteredImages.length / itemsPerPage);

  // --- Hotkeys Hook ---
  const { commands } = useHotkeys({
    isCommandPaletteOpen,
    setIsCommandPaletteOpen,
    isHotkeyHelpOpen,
    setIsHotkeyHelpOpen,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    currentPage,
    setCurrentPage,
    totalPages,
  });

  const handleOpenSettings = (tab: 'general' | 'hotkeys' = 'general') => {
    setSettingsTab(tab);
    setIsSettingsModalOpen(true);
  };

  const handleOpenHotkeySettings = () => {
    setIsHotkeyHelpOpen(false);
    handleOpenSettings('hotkeys');
  };

  // --- Indexing Control Functions ---
  const handlePauseIndexing = useCallback(() => {
    setIndexingState('paused');
  }, [setIndexingState]);

  const handleResumeIndexing = useCallback(() => {
    setIndexingState('indexing');
  }, [setIndexingState]);

  const handleCancelIndexing = useCallback(() => {
    // Abort any ongoing indexing operation
    cancelIndexing();
    setIndexingState('idle');
    setLoading(false);
    setProgress(null);
  }, [cancelIndexing, setIndexingState, setLoading, setProgress]);

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
      // Cache initialization moved to Electron SQLite database

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
      await loadDirectory(newDirectory);
      
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
      
      let version = '0.9.4'; // Default fallback version
      
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

  // Keyboard navigation for preview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (previewImage && !isSettingsModalOpen && !isCommandPaletteOpen && !isHotkeyHelpOpen) {
        if (e.key === 'ArrowRight') {
          handleNavigateNextPreview();
        } else if (e.key === 'ArrowLeft') {
          handleNavigatePreviousPreview();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previewImage, isSettingsModalOpen, isCommandPaletteOpen, isHotkeyHelpOpen, handleNavigateNextPreview, handleNavigatePreviousPreview]);

  // Arrow keys navigation for grid (when grid is visible)
  useEffect(() => {
    const handleArrowKeys = (e: KeyboardEvent) => {
      // Only handle arrow keys when:
      // 1. Not in any modal or input
      // 2. Not in preview pane (preview has its own handler)
      if (isSettingsModalOpen || isCommandPaletteOpen || isHotkeyHelpOpen || previewImage) return;
      
      const isInInput = document.activeElement?.tagName === 'INPUT' || 
                       document.activeElement?.tagName === 'TEXTAREA';
      if (isInInput) return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNavigateNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleNavigatePrevious();
      }
    };

    document.addEventListener('keydown', handleArrowKeys);
    return () => document.removeEventListener('keydown', handleArrowKeys);
  }, [isSettingsModalOpen, isCommandPaletteOpen, isHotkeyHelpOpen, previewImage, handleNavigateNext, handleNavigatePrevious]);

  // NOTE: We intentionally do NOT reset currentPage when filters/search change.
  // The user requested to remain on the same page when filtering. The clamp
  // effect below will ensure the current page is adjusted only if it becomes
  // out of range after the results change (for example, deleting many items).

  // Clamp current page when the number of filtered images changes (for example after deletion)
  // This preserves the user's current page unless it becomes out of range, in which case we
  // move to the last valid page instead of jumping back to page 1.
  useEffect(() => {
    const totalPages = itemsPerPage === 'all' ? 1 : Math.max(1, Math.ceil(filteredImages.length / itemsPerPage));
    setCurrentPage((prev) => (prev > totalPages ? totalPages : prev));
  }, [filteredImages.length, itemsPerPage]);

  // Clean up selectedImage if its directory no longer exists
  useEffect(() => {
    if (selectedImage && !directories.find(d => d.id === selectedImage.directoryId)) {
      console.warn('Selected image directory no longer exists, clearing selection');
      setSelectedImage(null);
    }
  }, [selectedImage, directories, setSelectedImage]);

  // Sync current page when selectedImage or previewImage changes via keyboard navigation
  useEffect(() => {
    const imageToSync = previewImage || selectedImage;
    if (!imageToSync || itemsPerPage === 'all') return;

    const imageIndex = filteredImages.findIndex(img => img.id === imageToSync.id);
    if (imageIndex === -1) return;

    const targetPage = Math.floor(imageIndex / itemsPerPage) + 1;
    setCurrentPage(targetPage);
  }, [selectedImage, previewImage, filteredImages, itemsPerPage]);

  // --- Memoized Callbacks for UI ---
  const handleImageRenamed = useCallback((imageId: string, newName: string) => {
    updateImage(imageId, newName);
    setSelectedImage(null);
  }, [updateImage, setSelectedImage]);

  const getCurrentImageIndex = useCallback(() => {
    if (!selectedImage) return 0;
    return filteredImages.findIndex(img => img.id === selectedImage.id);
  }, [selectedImage, filteredImages]);

  // --- Render Logic ---
  // ...existing code...
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
          searchField={searchField}
          onSearchFieldChange={setSearchField}
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
          }}
          advancedFilters={advancedFilters}
          onAdvancedFiltersChange={setAdvancedFilters}
          onClearAdvancedFilters={() => setAdvancedFilters({})}
          availableDimensions={availableDimensions}
        >
          <DirectoryList
            directories={directories}
            onRemoveDirectory={handleRemoveDirectory}
            onUpdateDirectory={handleUpdateFolder}
            onToggleVisibility={toggleDirectoryVisibility}
            onToggleSubfolderVisibility={toggleSubfolderVisibility}
            onToggleRootVisibility={toggleRootVisibility}
            visibleSubfolders={visibleSubfolders}
            visibleRoots={visibleRoots}
            isIndexing={indexingState === 'indexing' || indexingState === 'paused' || indexingState === 'completed'}
            scanSubfolders={scanSubfolders}
          />
        </Sidebar>
      )}
      
      <ImagePreviewSidebar />

      <div className={`${hasDirectories ? (isSidebarCollapsed ? 'ml-12' : 'ml-80') : ''} ${previewImage ? 'mr-96' : ''} h-screen flex flex-col transition-all duration-300 ease-in-out`}>
        <Header
          onAddFolder={handleSelectFolder}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          isIndexing={indexingState === 'indexing' || indexingState === 'completed'}
          isIndexingPaused={indexingState === 'paused'}
        />

        <main className="container mx-auto p-4 flex-1 flex flex-col min-h-0" onClick={() => clearSelection()}>
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
          {success && (
            <div className="bg-green-900/50 text-green-300 p-3 rounded-lg my-4 flex items-center justify-between">
              <span>{success}</span>
              <button
                onClick={() => setSuccess(null)}
                className="ml-4 p-1 hover:bg-green-800/50 rounded transition-colors"
                title="Dismiss message"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {isLoading && progress && progress.total === 0 && <Loader progress={progress} />}
          {!isLoading && !hasDirectories && <FolderSelector onSelectFolder={handleSelectFolder} />}

          {hasDirectories && (
            <>
              {/* Show StatusBar only during indexing operations */}
              {(indexingState === 'indexing' || indexingState === 'paused' || indexingState === 'completed') && (
                <StatusBar
                  filteredCount={filteredImages.length}
                  totalCount={images.length}
                  directoryCount={directories.length}
                  indexingState={indexingState}
                  progress={progress}
                  onPauseIndexing={handlePauseIndexing}
                  onResumeIndexing={handleResumeIndexing}
                  onCancelIndexing={handleCancelIndexing}
                />
              )}

              <ActionToolbar
                sortOrder={sortOrder}
                onSortOrderChange={imageStoreSetSortOrder}
                selectedCount={selectedImages.size}
                onClearSelection={clearSelection}
                onDeleteSelected={handleDeleteSelectedImages}
                viewMode={viewMode}
                onViewModeChange={toggleViewMode}
                filteredCount={filteredImages.length}
                totalCount={images.length}
                directoryCount={directories.length}
              />

              <div className="flex-1 min-h-0">
                {viewMode === 'grid' ? (
                    <ImageGrid
                      images={paginatedImages}
                      onImageClick={handleImageSelection}
                      selectedImages={selectedImages}
                    />
                  ) : (
                    <ImageTable
                      images={paginatedImages}
                      onImageClick={handleImageSelection}
                      selectedImages={selectedImages}
                    />
                )}
              </div>

              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                itemsPerPage={itemsPerPage}
                onItemsPerPageChange={setItemsPerPage}
                totalItems={filteredImages.length}
              />
            </>
          )}
        </main>

        {selectedImage && directoryPath && shouldOpenModal && (
          <ImageModal
            image={selectedImage}
            onClose={() => {
              setShouldOpenModal(false);
            }}
            onImageRenamed={handleImageRenamed}
            currentIndex={getCurrentImageIndex()}
            totalImages={filteredImages.length}
            onNavigateNext={handleNavigateNext}
            onNavigatePrevious={handleNavigatePrevious}
            directoryPath={directoryPath}
            isIndexing={progress && progress.total > 0 && progress.current < progress.total}
          />
        )}

        <ChangelogModal
          isOpen={isChangelogModalOpen}
          onClose={() => setIsChangelogModalOpen(false)}
          currentVersion={currentVersion}
        />
        <UpdateNotification />
      </div>
    </div>
  );
}