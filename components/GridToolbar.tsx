import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Copy,
  Folder,
  Download,
  Star,
  GitCompare,
  Sparkles,
  Trash2,
  ChevronDown,
  Tag,
  RefreshCw
} from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { copyImageToClipboard, showInExplorer } from '../utils/imageUtils';
import { type IndexedImage } from '../types';

import ActiveFilters from './ActiveFilters';
import TagManagerModal from './TagManagerModal';
import { useReparseMetadata } from '../hooks/useReparseMetadata';

interface GridToolbarProps {

  selectedImages: Set<string>;
  images: IndexedImage[];
  directories: { id: string; path: string }[];
  onDeleteSelected: () => void;
  onGenerateA1111: (image: IndexedImage) => void;
  onGenerateComfyUI: (image: IndexedImage) => void;
  onCompare: (images: [IndexedImage, IndexedImage]) => void;
  onBatchExport: () => void;
}

const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
  const notification = document.createElement('div');
  notification.className = `fixed top-4 right-4 ${type === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white px-4 py-2 rounded-lg shadow-lg z-50`;
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => {
    if (document.body.contains(notification)) {
      document.body.removeChild(notification);
    }
  }, 2000);
};

const GridToolbar: React.FC<GridToolbarProps> = ({
  selectedImages,
  images,
  directories,
  onDeleteSelected,
  onGenerateA1111,
  onGenerateComfyUI,
  onCompare,
  onBatchExport,
}) => {
  const [generateDropdownOpen, setGenerateDropdownOpen] = useState(false);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toggleFavorite = useImageStore((state) => state.toggleFavorite);
  const { canUseComparison, canUseA1111, canUseComfyUI, showProModal, canUseBulkTagging } = useFeatureAccess();
  const { isReparsing, reparseImages } = useReparseMetadata();


  // ... (rest of the file)

  const selectedCount = selectedImages.size;
  const selectedImagesList = useMemo(() => {
    if (selectedImages.size === 0) {
      return [];
    }

    const pageLookup = new Map(images.map((image) => [image.id, image]));
    const storeImages = useImageStore.getState().images;

    return Array.from(selectedImages)
      .map((imageId) => pageLookup.get(imageId) ?? storeImages.find((image) => image.id === imageId))
      .filter((image): image is IndexedImage => Boolean(image));
  }, [images, selectedImages]);
  const firstSelectedImage = selectedImagesList[0];
  // Check if all selected images are favorites
  const allFavorites = selectedImagesList.length > 0 && selectedImagesList.every(img => img.isFavorite);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setGenerateDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopyToClipboard = async () => {
    if (!firstSelectedImage) return;
    const result = await copyImageToClipboard(firstSelectedImage);
    if (result.success) {
      showNotification('Image copied to clipboard!');
    } else {
      showNotification(`Failed to copy: ${result.error}`, 'error');
    }
  };

  const handleShowInFolder = () => {
    if (!firstSelectedImage) return;
    const directory = directories.find(d => d.id === firstSelectedImage.directoryId);
    if (!directory) {
      showNotification('Cannot determine file location', 'error');
      return;
    }
    showInExplorer(`${directory.path}/${firstSelectedImage.name}`);
  };

  const handleExport = async () => {
    if (selectedCount > 1) {
      onBatchExport();
      return;
    }
    if (!firstSelectedImage) return;
    const directory = directories.find(d => d.id === firstSelectedImage.directoryId);
    if (!directory) return;

    if (!window.electronAPI) {
      showNotification('Export only available in desktop app', 'error');
      return;
    }

    try {
      const destResult = await window.electronAPI.showDirectoryDialog();
      if (destResult.canceled || !destResult.path) return;

      const sourcePathResult = await window.electronAPI.joinPaths(directory.path, firstSelectedImage.name);
      if (!sourcePathResult.success || !sourcePathResult.path) throw new Error('Failed to construct source path');

      const destPathResult = await window.electronAPI.joinPaths(destResult.path, firstSelectedImage.name);
      if (!destPathResult.success || !destPathResult.path) throw new Error('Failed to construct destination path');

      const readResult = await window.electronAPI.readFile(sourcePathResult.path);
      if (!readResult.success || !readResult.data) throw new Error('Failed to read file');

      const writeResult = await window.electronAPI.writeFile(destPathResult.path, readResult.data);
      if (!writeResult.success) throw new Error('Failed to write file');

      showNotification('Image exported successfully!');
    } catch (error: any) {
      showNotification(`Export failed: ${error.message}`, 'error');
    }
  };

  const handleToggleFavorites = () => {
    selectedImagesList.forEach(img => toggleFavorite(img.id));
  };

  const handleCompare = () => {
    if (!canUseComparison) {
      showProModal('comparison');
      return;
    }
    if (selectedImagesList.length === 2) {
      onCompare([selectedImagesList[0], selectedImagesList[1]]);
    }
  };

  const handleGenerateA1111 = () => {
    if (!canUseA1111) {
      showProModal('a1111');
      setGenerateDropdownOpen(false);
      return;
    }
    if (firstSelectedImage) {
      onGenerateA1111(firstSelectedImage);
    }
    setGenerateDropdownOpen(false);
  };

  const handleGenerateComfyUI = () => {
    if (!canUseComfyUI) {
      showProModal('comfyui');
      setGenerateDropdownOpen(false);
      return;
    }
    if (firstSelectedImage) {
      onGenerateComfyUI(firstSelectedImage);
    }
    setGenerateDropdownOpen(false);
  };

  const handleTagClick = () => {
    if (selectedCount > 1 && !canUseBulkTagging) {
      showProModal('bulk_tagging');
      return;
    }
    setIsTagModalOpen(true);
  };

  const handleReparseSelected = async () => {
    if (selectedImagesList.length === 0) {
      return;
    }

    await reparseImages(selectedImagesList);
  };

  const selectedModels = useImageStore((state) => state.selectedModels);
  const excludedModels = useImageStore((state) => state.excludedModels);
  const selectedLoras = useImageStore((state) => state.selectedLoras);
  const excludedLoras = useImageStore((state) => state.excludedLoras);
  const selectedSamplers = useImageStore((state) => state.selectedSamplers);
  const excludedSamplers = useImageStore((state) => state.excludedSamplers);
  const selectedSchedulers = useImageStore((state) => state.selectedSchedulers);
  const excludedSchedulers = useImageStore((state) => state.excludedSchedulers);
  const selectedGenerators = useImageStore((state) => state.selectedGenerators);
  const excludedGenerators = useImageStore((state) => state.excludedGenerators);
  const selectedGpuDevices = useImageStore((state) => state.selectedGpuDevices);
  const excludedGpuDevices = useImageStore((state) => state.excludedGpuDevices);
  const selectedTags = useImageStore((state) => state.selectedTags);
  const excludedTags = useImageStore((state) => state.excludedTags);
  const selectedAutoTags = useImageStore((state) => state.selectedAutoTags);
  const excludedAutoTags = useImageStore((state) => state.excludedAutoTags);
  const searchQuery = useImageStore((state) => state.searchQuery);
  const favoriteFilterMode = useImageStore((state) => state.favoriteFilterMode);
  const selectedRatings = useImageStore((state) => state.selectedRatings);

  const advancedFilters = useImageStore((state) => state.advancedFilters);

  const hasActiveFilters = 
      selectedModels.length > 0 ||
      excludedModels.length > 0 ||
      selectedLoras.length > 0 ||
      excludedLoras.length > 0 ||
      selectedSamplers.length > 0 ||
      excludedSamplers.length > 0 ||
      selectedSchedulers.length > 0 ||
      excludedSchedulers.length > 0 ||
      selectedGenerators.length > 0 ||
      excludedGenerators.length > 0 ||
      selectedGpuDevices.length > 0 ||
      excludedGpuDevices.length > 0 ||
      selectedTags.length > 0 ||
      excludedTags.length > 0 ||
      selectedAutoTags.length > 0 ||
      excludedAutoTags.length > 0 ||
      !!searchQuery ||
      favoriteFilterMode !== 'neutral' ||
      selectedRatings.length > 0 ||
      (advancedFilters && Object.keys(advancedFilters).length > 0);

  if (selectedCount === 0 && !hasActiveFilters) {
    return null;
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-1 px-5 min-h-[36px]">
        {/* Selection Context Toolbar - Centered or justified as needed */}
        <div className="flex items-center gap-1 flex-1 overflow-hidden">
            {selectedCount > 0 && (
              <>
                <span className="text-[11px] text-gray-400 mr-2 whitespace-nowrap">{selectedCount} selected</span>

                {/* Copy to Clipboard */}
                <button
                  onClick={handleCopyToClipboard}
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                  title="Copy to Clipboard"
                  disabled={selectedCount !== 1}
                >
                  <Copy className="w-4 h-4" />
                </button>

                {/* Show in Folder */}
                <button
                  onClick={handleShowInFolder}
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                  title="Show in Folder"
                  disabled={selectedCount !== 1}
                >
                  <Folder className="w-4 h-4" />
                </button>

                {/* Export */}
                <button
                  onClick={handleExport}
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                  title={selectedCount > 1 ? 'Export selected images' : 'Export'}
                  disabled={selectedCount === 0}
                >
                  <Download className="w-4 h-4" />
                </button>

                {/* Favorites */}
                <button
                  onClick={handleToggleFavorites}
                  className={`p-1.5 rounded transition-colors ${
                    allFavorites
                      ? 'text-yellow-400 hover:text-yellow-300 hover:bg-gray-700'
                      : 'text-gray-400 hover:text-yellow-400 hover:bg-gray-700'
                  }`}
                  title={allFavorites ? 'Remove from Favorites' : 'Add to Favorites'}
                >
                  <Star className={`w-4 h-4 ${allFavorites ? 'fill-current' : ''}`} />
                </button>

                <button
                  onClick={handleReparseSelected}
                  className={`p-1.5 rounded transition-colors ${
                    isReparsing
                      ? 'text-cyan-300 bg-cyan-500/10 cursor-wait'
                      : 'text-gray-400 hover:text-cyan-300 hover:bg-gray-700'
                  }`}
                  title={selectedCount === 1 ? 'Reparse metadata' : `Reparse selected (${selectedCount})`}
                  disabled={selectedCount === 0 || isReparsing}
                >
                  <RefreshCw className={`w-4 h-4 ${isReparsing ? 'animate-spin' : ''}`} />
                </button>

                 {/* Tagging */}
                 <button
                  onClick={handleTagClick}
                  className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors"
                  title="Add/Remove Tags"
                >
                  <Tag className="w-4 h-4" />
                </button>
  
                {/* Divider */}
                <div className="w-px h-4 bg-gray-700 mx-1" />

                {/* Compare (only with exactly 2 images) */}
                <button
                  onClick={handleCompare}
                  className={`p-1.5 rounded transition-colors ${
                    selectedCount === 2
                      ? 'text-gray-400 hover:text-purple-400 hover:bg-gray-700'
                      : 'text-gray-600 cursor-not-allowed'
                  }`}
                  title={selectedCount === 2 ? 'Compare Images' : 'Select exactly 2 images to compare'}
                  disabled={selectedCount !== 2}
                >
                  <GitCompare className="w-4 h-4" />
                </button>

                {/* Generate Dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setGenerateDropdownOpen(!generateDropdownOpen)}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors flex items-center gap-0.5"
                    title="Generate"
                    disabled={selectedCount !== 1}
                  >
                    <Sparkles className="w-4 h-4" />
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {generateDropdownOpen && selectedCount === 1 && (
                    <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px] z-50">
                      <button
                        onClick={handleGenerateA1111}
                        className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        with A1111
                      </button>
                      <button
                        onClick={handleGenerateComfyUI}
                        className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        with ComfyUI
                      </button>
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div className="w-px h-4 bg-gray-700 mx-1" />

                {/* Delete */}
                <button
                  onClick={onDeleteSelected}
                  className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                  title="Delete Selected"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                
                {/* Divider between selection tools and filters if both exist */}
                {hasActiveFilters && <div className="w-px h-6 bg-gray-600 mx-2 flex-shrink-0" />}
              </>
            )}

            {/* Active Filters */}
            <div className="flex-1 min-w-0">
               <ActiveFilters />
            </div>
        </div>
      </div>

      <TagManagerModal
        isOpen={isTagModalOpen}
        onClose={() => setIsTagModalOpen(false)}
        selectedImageIds={Array.from(selectedImages)}
      />
    </>
  );
};

export default GridToolbar;
