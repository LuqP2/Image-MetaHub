import React, { useState, useRef, useEffect } from 'react';
import {
  Copy,
  Folder,
  Download,
  Star,
  GitCompare,
  Sparkles,
  Trash2,
  ChevronDown,
  Trash2,
  ChevronDown
} from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { copyImageToClipboard, showInExplorer } from '../utils/imageUtils';
import { type IndexedImage } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';

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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toggleFavorite = useImageStore((state) => state.toggleFavorite);
  const { canUseComparison, canUseA1111, canUseComfyUI, showProModal } = useFeatureAccess();


  // ... (rest of the file)

  const selectedCount = selectedImages.size;
  const selectedImagesList = images.filter(img => selectedImages.has(img.id));
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

  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-2 mb-1 px-5">
      {/* Selection Context Toolbar - Centered or justified as needed */}
      <div className="flex items-center gap-1">
          <span className="text-[11px] text-gray-400 mr-2">{selectedCount} selected</span>

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
      </div>
    </div>
  );
};

export default GridToolbar;
