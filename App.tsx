import React, { useState, useEffect, useCallback } from 'react';
import { useImageStore } from './store/useImageStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useImageLoader } from './hooks/useImageLoader';
import { useImageSelection } from './hooks/useImageSelection';

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
import cacheManager from './services/cacheManager';

export default function App() {
  // --- Hooks ---
  const { handleSelectFolder, handleUpdateFolder, handleLoadFromPath } = useImageLoader();
  const { handleImageSelection, handleDeleteSelectedImages, clearSelection } = useImageSelection();

  // --- Zustand Store State ---
  const {
    images,
    filteredImages,
    directoryHandle,
    directoryPath,
    isLoading,
    progress,
    error,
    success,
    selectedImage,
    selectedImages,
    searchQuery,
    availableModels,
    availableLoras,
    availableSchedulers,
    selectedModels,
    selectedLoras,
    selectedSchedulers,
    advancedFilters,
    setSearchQuery,
    setSelectedFilters,
    setAdvancedFilters,
    setSelectedImage,
    removeImage,
    updateImage,
  } = useImageStore();
  const imageStoreSetSortOrder = useImageStore((state) => state.setSortOrder);

  // --- Settings Store State ---
  const {
    sortOrder,
    itemsPerPage,
    setSortOrder,
    setItemsPerPage,
  } = useSettingsStore();

  // --- Local UI State ---
  const [searchField, setSearchField] = useState<SearchField>('any');
  const [currentPage, setCurrentPage] = useState(1);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // --- Effects ---
  // Initialize the cache manager on startup
  useEffect(() => {
    const initializeCache = async () => {
      // Zustand persistence can be async, wait for it to rehydrate
      await useSettingsStore.persist.rehydrate();

      let path = useSettingsStore.getState().cachePath;

      // If no custom path is set in Electron, use a default path or skip
      if (!path && window.electronAPI) {
        // Fallback: use a hardcoded default or leave undefined for cacheManager to handle
        path = undefined;
      }

      console.log(`Initializing cache with base path: ${path}`);
      // Pass undefined if path is null, so the default is used
      await cacheManager.init(path || undefined);
    };

    initializeCache().catch(console.error);
  }, []);

  // On mount, check if a directory is stored in localStorage and load it
  useEffect(() => {
    const storedPath = localStorage.getItem('image-metahub-electron-directory-path');
    if (storedPath && !directoryHandle) {
      handleLoadFromPath(storedPath);
    }
  }, [directoryHandle, handleLoadFromPath]);

  // Reset page on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [filteredImages]);

  // Sync settings store with image store for sorting
  useEffect(() => {
    imageStoreSetSortOrder(sortOrder);
  }, [sortOrder, imageStoreSetSortOrder]);

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

  const handleNavigateNext = useCallback(() => {
    if (!selectedImage) return;
    const currentIndex = getCurrentImageIndex();
    if (currentIndex < filteredImages.length - 1) {
      setSelectedImage(filteredImages[currentIndex + 1]);
    }
  }, [selectedImage, filteredImages, getCurrentImageIndex, setSelectedImage]);

  const handleNavigatePrevious = useCallback(() => {
    if (!selectedImage) return;
    const currentIndex = getCurrentImageIndex();
    if (currentIndex > 0) {
      setSelectedImage(filteredImages[currentIndex - 1]);
    }
  }, [selectedImage, filteredImages, getCurrentImageIndex, setSelectedImage]);


  // --- Render Logic ---
  const paginatedImages = itemsPerPage === 'all'
    ? filteredImages
    : filteredImages.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(filteredImages.length / itemsPerPage);

  const handleChangeFolder = async () => {
    useImageStore.getState().resetState();
    localStorage.removeItem('image-metahub-electron-directory-path');
    localStorage.removeItem('image-metahub-directory-name');
    await handleSelectFolder();
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans">
      <BrowserCompatibilityWarning />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />

      {directoryHandle && (
        <Sidebar
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
        />
      )}

      <div className={`${directoryHandle ? 'ml-80' : ''} h-screen flex flex-col`}>
        <Header
          directoryHandle={directoryHandle}
          onUpdateFolder={handleUpdateFolder}
          onChangeFolder={handleChangeFolder}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
        />

        <main className="container mx-auto p-4 flex-1 flex flex-col min-h-0">
          {error && <div className="bg-red-900/50 text-red-300 p-3 rounded-lg my-4">{error}</div>}
          {success && <div className="bg-green-900/50 text-green-300 p-3 rounded-lg my-4">{success}</div>}

          {isLoading && <Loader progress={progress} />}
          {!isLoading && !directoryHandle && <FolderSelector onSelectFolder={handleSelectFolder} />}

          {directoryHandle && !isLoading && (
            <>
              <StatusBar
                filteredCount={filteredImages.length}
                totalCount={images.length}
                directoryName={directoryHandle.name}
              />

              <ActionToolbar
                sortOrder={sortOrder}
                onSortOrderChange={setSortOrder}
                selectedCount={selectedImages.size}
                onClearSelection={clearSelection}
                onDeleteSelected={handleDeleteSelectedImages}
              />

              <div className="flex-1 min-h-0">
                <ImageGrid
                  images={paginatedImages}
                  onImageClick={handleImageSelection}
                  selectedImages={selectedImages}
                />
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

        {selectedImage && (
          <ImageModal
            image={selectedImage}
            onClose={() => setSelectedImage(null)}
            onImageDeleted={handleImageDeleted}
            onImageRenamed={handleImageRenamed}
            currentIndex={getCurrentImageIndex()}
            totalImages={filteredImages.length}
            onNavigateNext={handleNavigateNext}
            onNavigatePrevious={handleNavigatePrevious}
            directoryPath={directoryPath}
          />
        )}
      </div>
    </div>
  );
}