import React, { useState, useEffect, useCallback } from 'react';
import { useImageStore } from './store/useImageStore';
import { useImageLoader } from './hooks/useImageLoader';
import { useImageFilters } from './hooks/useImageFilters';
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

export default function App() {
  // --- Hooks ---
  const { handleSelectFolder, handleUpdateFolder } = useImageLoader();
  useImageFilters(); // This hook just runs effects, no need to get values here
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
    sortOrder,
    availableModels,
    availableLoras,
    availableSchedulers,
    selectedModels,
    selectedLoras,
    selectedSchedulers,
    setSearchQuery,
    setSelectedFilters,
    setSortOrder,
    setSelectedImage,
    removeImage,
    updateImage,
  } = useImageStore();

  // --- Local UI State ---
  const [searchField, setSearchField] = useState<SearchField>('any');
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [advancedFilters, setAdvancedFilters] = useState<any>({});

  // --- Effects ---
  // Reset page on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [filteredImages]);

  // Persist settings
  useEffect(() => {
    localStorage.setItem('image-metahub-sort-order', sortOrder);
  }, [sortOrder]);

  useEffect(() => {
    localStorage.setItem('image-metahub-items-per-page', itemsPerPage.toString());
  }, [itemsPerPage]);

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
          advancedFilters={advancedFilters}
          onAdvancedFiltersChange={setAdvancedFilters}
          onClearAllFilters={() => {
            setSelectedFilters({ models: [], loras: [], schedulers: [] });
            setAdvancedFilters({});
          }}
          images={images}
        />
      )}

      <div className={`${directoryHandle ? 'ml-80' : ''} h-screen flex flex-col`}>
        <Header
          directoryHandle={directoryHandle}
          onUpdateFolder={handleUpdateFolder}
          onChangeFolder={handleChangeFolder}
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

              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-4 mt-4">
                  <button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1}>Prev</button>
                  <span>Page {currentPage} of {totalPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages}>Next</button>
                </div>
              )}
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