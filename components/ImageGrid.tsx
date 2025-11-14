import React, { useState, useEffect, useRef } from 'react';
import { type IndexedImage } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';
import { useContextMenu } from '../hooks/useContextMenu';
import { Check, Info, Copy, Folder, Download } from 'lucide-react';
import { useThumbnail } from '../hooks/useThumbnail';

// --- ImageCard Component ---
interface ImageCardProps {
  image: IndexedImage;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  isSelected: boolean;
  isFocused?: boolean;
  onImageLoad: (id: string, aspectRatio: number) => void;
  onContextMenu?: (image: IndexedImage, event: React.MouseEvent) => void;
  baseWidth: number;
}

const ImageCard: React.FC<ImageCardProps> = ({ image, onImageClick, isSelected, isFocused, onImageLoad, onContextMenu, baseWidth }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number>(1);
  const setPreviewImage = useImageStore((state) => state.setPreviewImage);
  const thumbnailsDisabled = useSettingsStore((state) => state.disableThumbnails);

  useThumbnail(image);

  useEffect(() => {
    if (thumbnailsDisabled) {
      setImageUrl(null);
      return;
    }

    if (image.thumbnailStatus === 'ready' && image.thumbnailUrl) {
      setImageUrl(image.thumbnailUrl);
      return;
    }

    let isMounted = true;
    let fallbackUrl: string | null = null;
    const fileHandle = image.thumbnailHandle || image.handle;
    const isElectron = typeof window !== 'undefined' && window.electronAPI;

    const loadFallback = async () => {
      if (!fileHandle || typeof fileHandle.getFile !== 'function') {
        return;
      }

      try {
        const file = await fileHandle.getFile();
        if (!isMounted) return;
        fallbackUrl = URL.createObjectURL(file);
        setImageUrl(fallbackUrl);
      } catch (error) {
        if (isElectron) {
          console.error('Failed to load image:', error);
        }
      }
    };

    void loadFallback();

    return () => {
      isMounted = false;
      if (fallbackUrl) {
        URL.revokeObjectURL(fallbackUrl);
      }
    };
  }, [image.handle, image.thumbnailHandle, image.thumbnailStatus, image.thumbnailUrl, thumbnailsDisabled]);

  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewImage(image);
  };

  return (
    <div
      className={`bg-gray-800 rounded-lg overflow-hidden shadow-md cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/30 group relative flex items-center justify-center ${
        isSelected ? 'ring-4 ring-blue-500 ring-opacity-75' : ''
      } ${
        isFocused ? 'ring-2 ring-yellow-400 ring-opacity-75' : ''
      }`}
      style={{ width: `${baseWidth}px`, height: `${baseWidth * 1.2}px`, flexShrink: 0 }}
      onClick={(e) => onImageClick(image, e)}
      onContextMenu={(e) => onContextMenu && onContextMenu(image, e)}
    >
      {isSelected && (
        <div className="absolute top-2 right-2 z-10">
          <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
            <Check className="w-4 h-4 text-white" />
          </div>
        </div>
      )}
      <button
        onClick={handlePreviewClick}
        className="absolute top-2 left-2 z-10 p-1.5 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-500"
        title="Show details"
      >
        <Info className="h-4 w-4" />
      </button>

      {imageUrl ? (
        <img
          src={imageUrl}
          alt={image.name}
          className="max-w-full max-h-full object-contain"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full animate-pulse bg-gray-700"></div>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <p className="text-white text-xs truncate">{image.name}</p>
      </div>
    </div>
  );
};


// --- ImageGrid Component ---
interface ImageGridProps {
  images: IndexedImage[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const ImageGrid: React.FC<ImageGridProps> = ({ images, onImageClick, selectedImages, currentPage, totalPages, onPageChange }) => {
  const imageSize = useSettingsStore((state) => state.imageSize);
  const directories = useImageStore((state) => state.directories);
  const focusedImageIndex = useImageStore((state) => state.focusedImageIndex);
  const setFocusedImageIndex = useImageStore((state) => state.setFocusedImageIndex);
  const setPreviewImage = useImageStore((state) => state.setPreviewImage);
  const previewImage = useImageStore((state) => state.previewImage);
  const gridRef = useRef<HTMLDivElement>(null);
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({});

  const handleImageLoad = (id: string, aspectRatio: number) => {
    setImageAspectRatios(prev => ({ ...prev, [id]: aspectRatio }));
  };

  const {
    contextMenu,
    showContextMenu,
    hideContextMenu,
    copyPrompt,
    copyNegativePrompt,
    copySeed,
    copyImage,
    copyModel,
    showInFolder,
    exportImage
  } = useContextMenu();

  // Sync focusedImageIndex when previewImage changes
  useEffect(() => {
    if (previewImage) {
      const index = images.findIndex(img => img.id === previewImage.id);
      if (index !== -1 && index !== focusedImageIndex) {
        setFocusedImageIndex(index);
      }
    }
  }, [previewImage, images, focusedImageIndex, setFocusedImageIndex]);

  // Adjust focusedImageIndex when changing pages via arrow keys
  useEffect(() => {
    if (focusedImageIndex === -1 && images.length > 0) {
      // Quando volta de página, vai para última imagem
      setFocusedImageIndex(images.length - 1);
      setPreviewImage(images[images.length - 1]);
    }
  }, [focusedImageIndex, images, setFocusedImageIndex, setPreviewImage]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if we're in a modal, command palette, or text input
      const target = e.target as HTMLElement;
      const isInModal = document.querySelector('[role="dialog"]') !== null;
      const isInCommandPalette = document.querySelector('.command-palette, [data-command-palette]') !== null;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Block navigation if in modal/command palette or typing (except for Enter which should still work)
      if (isInModal || isInCommandPalette) {
        return;
      }

      // For arrow keys and page navigation, require grid focus
      const needsFocus = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key);
      if (needsFocus && !gridRef.current?.contains(document.activeElement)) {
        return;
      }

      // Enter key works globally when an image is focused (fixes Issue #21)
      if (e.key === 'Enter' && !isTyping) {
        const currentIndex = focusedImageIndex ?? -1;
        if (currentIndex >= 0 && currentIndex < images.length) {
          e.preventDefault();
          e.stopPropagation();
          onImageClick(images[currentIndex], e as any);
          return;
        }
      }

      const currentIndex = focusedImageIndex ?? -1;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = currentIndex + 1;
        if (nextIndex < images.length) {
          setFocusedImageIndex(nextIndex);
          setPreviewImage(images[nextIndex]);
        } else if (currentPage < totalPages) {
          // Chegou no final da página, vai pra próxima
          onPageChange(currentPage + 1);
          setFocusedImageIndex(0);
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = currentIndex - 1;
        if (prevIndex >= 0) {
          setFocusedImageIndex(prevIndex);
          setPreviewImage(images[prevIndex]);
        } else if (currentPage > 1) {
          // Chegou no início da página, vai pra anterior
          onPageChange(currentPage - 1);
          setFocusedImageIndex(-1); // Será ajustado quando as imagens mudarem
        }
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        if (currentPage < totalPages) {
          onPageChange(currentPage + 1);
          setFocusedImageIndex(0);
        }
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        if (currentPage > 1) {
          onPageChange(currentPage - 1);
          setFocusedImageIndex(0);
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        onPageChange(1);
        setFocusedImageIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        onPageChange(totalPages);
        setFocusedImageIndex(0);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [focusedImageIndex, images, setFocusedImageIndex, setPreviewImage, onImageClick, currentPage, totalPages, onPageChange]);

  if (images.length === 0) {
    return <div className="text-center py-16 text-gray-500">No images found. Try a different search term.</div>;
  }

  const handleContextMenu = (image: IndexedImage, e: React.MouseEvent) => {
    if (selectedImages.size > 1) {
      return;
    }
    const directoryPath = directories.find(d => d.id === image.directoryId)?.path;
    showContextMenu(e, image, directoryPath);
  };

  return (
    <div 
      ref={gridRef}
      className="h-full w-full p-1 outline-none overflow-auto" 
      style={{ minWidth: 0, minHeight: 0 }} 
      data-area="grid" 
      tabIndex={0}
      onClick={() => gridRef.current?.focus()}
    >
      <div 
        className="flex flex-wrap gap-2"
        style={{
          alignContent: 'flex-start',
        }}
      >
        {images.map((image, index) => {
          const isFocused = focusedImageIndex === index;
          
          return (
            <ImageCard
              key={image.id}
              image={image}
              onImageClick={onImageClick}
              isSelected={selectedImages.has(image.id)}
              isFocused={isFocused}
              onImageLoad={handleImageLoad}
              onContextMenu={handleContextMenu}
              baseWidth={imageSize}
            />
          );
        })}
      </div>

      {contextMenu.visible && (
        <div
          className="fixed z-[60] bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[160px] context-menu-class"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={copyImage}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
          >
            <Copy className="w-4 h-4" />
            Copy to Clipboard
          </button>

          <div className="border-t border-gray-600 my-1"></div>

          <button
            onClick={copyPrompt}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.prompt && !(contextMenu.image?.metadata as any)?.prompt}
          >
            <Copy className="w-4 h-4" />
            Copy Prompt
          </button>
          <button
            onClick={copyNegativePrompt}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.negativePrompt && !(contextMenu.image?.metadata as any)?.negativePrompt}
          >
            <Copy className="w-4 h-4" />
            Copy Negative Prompt
          </button>
          <button
            onClick={copySeed}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.seed && !(contextMenu.image?.metadata as any)?.seed}
          >
            <Copy className="w-4 h-4" />
            Copy Seed
          </button>
          <button
            onClick={copyModel}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.models?.[0] && !(contextMenu.image?.metadata as any)?.model}
          >
            <Copy className="w-4 h-4" />
            Copy Model
          </button>

          <div className="border-t border-gray-600 my-1"></div>

          <button
            onClick={showInFolder}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
          >
            <Folder className="w-4 h-4" />
            Show in Folder
          </button>

          <button
            onClick={exportImage}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export Image
          </button>
        </div>
      )}
    </div>
  );
};

export default ImageGrid;