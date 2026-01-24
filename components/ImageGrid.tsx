import React, { useState, useEffect, useRef, useCallback } from 'react';
import { type IndexedImage, type BaseMetadata } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';
import { useContextMenu } from '../hooks/useContextMenu';
import { Check, Info, Copy, Folder, Download, Clipboard, Sparkles, GitCompare, Star, Square, CheckSquare, Crown, Archive, Package } from 'lucide-react';
import { useThumbnail } from '../hooks/useThumbnail';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import { useGenerateWithA1111 } from '../hooks/useGenerateWithA1111';
import { useGenerateWithComfyUI } from '../hooks/useGenerateWithComfyUI';
import { A1111GenerateModal, type GenerationParams as A1111GenerationParams } from './A1111GenerateModal';
import { ComfyUIGenerateModal, type GenerationParams as ComfyUIGenerationParams } from './ComfyUIGenerateModal';
import Toast from './Toast';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import ProBadge from './ProBadge';

// --- ImageCard Component ---
interface ImageCardProps {
  image: IndexedImage;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  isSelected: boolean;
  isFocused?: boolean;
  onImageLoad: (id: string, aspectRatio: number) => void;
  onContextMenu?: (image: IndexedImage, event: React.MouseEvent) => void;
  baseWidth: number;
  isComparisonFirst?: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
  isMarkedBest?: boolean;       // For deduplication: marked as best to keep
  isMarkedArchived?: boolean;   // For deduplication: marked for archive
}

const ImageCard: React.FC<ImageCardProps> = React.memo(({ image, onImageClick, isSelected, isFocused, onImageLoad, onContextMenu, baseWidth, isComparisonFirst, cardRef, isMarkedBest, isMarkedArchived }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number>(1);
  const setPreviewImage = useImageStore((state) => state.setPreviewImage);
  const thumbnailsDisabled = useSettingsStore((state) => state.disableThumbnails);
  const showFilenames = useSettingsStore((state) => state.showFilenames);
  const showFullFilePath = useSettingsStore((state) => state.showFullFilePath);
  const doubleClickToOpen = useSettingsStore((state) => state.doubleClickToOpen);
  const [showToast, setShowToast] = useState(false);
  const toggleImageSelection = useImageStore((state) => state.toggleImageSelection);
  const canDragExternally = typeof window !== 'undefined' && !!window.electronAPI?.startFileDrag;

  // Extract filename to display based on showFullFilePath setting
  const displayName = showFullFilePath
    ? image.name
    : image.name.split('/').pop() || image.name;

  // Lazy load thumbnails only when visible in viewport
  const [intersectionRef, isVisible] = useIntersectionObserver<HTMLDivElement>({
    rootMargin: '400px', // Start loading 400px before entering viewport
    freezeOnceVisible: true, // Once loaded, stay loaded
  });

  // Only request thumbnail when visible (or about to be visible)
  useThumbnail(isVisible ? image : null);

  // Merge refs: combine intersectionRef with cardRef
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      intersectionRef(node);
      if (cardRef) {
        cardRef(node);
      }
    },
    [intersectionRef, cardRef]
  );

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
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
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
        if (!isMounted) return;
        // Only log non-file-not-found errors to reduce console noise
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (isElectron && !errorMessage.includes('Failed to read file')) {
          console.error('Failed to load image:', error);
        }
        // Set a special marker to indicate load failure
        setImageUrl('ERROR');
      }
    };

    // Debounce heavy fallback fetch; if thumbnail becomes ready meanwhile, this effect will rerun and cancel
    fallbackTimer = setTimeout(() => {
      void loadFallback();
    }, 180);

    return () => {
      isMounted = false;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
      if (fallbackUrl && fallbackUrl !== 'ERROR') {
        URL.revokeObjectURL(fallbackUrl);
      }
    };
  }, [image.handle, image.thumbnailHandle, image.thumbnailStatus, image.thumbnailUrl, thumbnailsDisabled]);

  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewImage(image);
  };

  const handleCopyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (image.prompt) {
      navigator.clipboard.writeText(image.prompt);
      setShowToast(true);
    }
  };

  const toggleFavorite = useImageStore((state) => state.toggleFavorite);

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(image.id);
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleImageSelection(image.id);
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canDragExternally) {
      return;
    }

    const directoryPath = image.directoryId;
    if (!directoryPath) {
      return;
    }

    const [, relativeFromId] = image.id.split('::');
    const relativePath = relativeFromId || image.name;

    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copy';
    }
    window.electronAPI?.startFileDrag({ directoryPath, relativePath });
  };

  return (
    <div className="flex flex-col items-center" style={{ width: `${baseWidth}px` }}>
      {showToast && <Toast message="Prompt copied to clipboard!" onDismiss={() => setShowToast(false)} />}
      <div
        ref={mergedRef}
        className={`bg-gray-800 rounded-lg overflow-hidden shadow-md cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/30 group relative flex items-center justify-center ${
          isSelected ? 'ring-4 ring-blue-500 ring-opacity-75' : ''
        } ${
          isFocused ? 'ring-2 ring-yellow-400 ring-opacity-75' : ''
        }`}
        style={{ width: '100%', height: `${baseWidth * 1.2}px`, flexShrink: 0 }}
        onClick={(e) => {
          if (doubleClickToOpen) {
            if (e.ctrlKey || e.metaKey) {
              // Ctrl/Cmd+click: toggle selection (add/remove from multi-select)
              toggleImageSelection(image.id);
            } else {
              // Single click: select only this image and set as preview
              useImageStore.setState({
                selectedImages: new Set([image.id]),
                previewImage: image
              });
            }
          } else {
            onImageClick(image, e);
          }
        }}
        onDoubleClick={(e) => {
          if (doubleClickToOpen) {
            onImageClick(image, e);
          }
        }}
        onContextMenu={(e) => onContextMenu && onContextMenu(image, e)}
        onDragStart={handleDragStart}
        draggable={canDragExternally}
      >
        {/* Checkbox for selection - always visible on hover or when selected */}
        <button
          onClick={handleCheckboxClick}
          className={`absolute top-2 left-2 z-20 p-1 rounded transition-all ${
            isSelected
              ? 'bg-blue-500 text-white opacity-100'
              : 'bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-blue-500/80'
          }`}
          title={isSelected ? 'Deselect image' : 'Select image'}
        >
          {isSelected ? (
            <CheckSquare className="h-5 w-5" />
          ) : (
            <Square className="h-5 w-5" />
          )}
        </button>

        {/* Deduplication: Best badge */}
        {isMarkedBest && (
          <div className="absolute top-2 left-11 z-20 px-2 py-1 bg-yellow-500/90 rounded-lg text-white text-xs font-bold shadow-lg flex items-center gap-1">
            <Crown className="h-3.5 w-3.5" />
            Best
          </div>
        )}

        {/* Deduplication: Archived badge */}
        {isMarkedArchived && (
          <div className="absolute top-2 left-11 z-20 px-2 py-1 bg-gray-600/90 rounded-lg text-white text-xs font-bold shadow-lg flex items-center gap-1">
            <Archive className="h-3.5 w-3.5" />
            Archive
          </div>
        )}

        {isComparisonFirst && (
          <div className="absolute top-2 left-11 z-20 px-2 py-1 bg-purple-600 rounded-lg text-white text-xs font-bold shadow-lg">
            Compare #1
          </div>
        )}
        <button
          onClick={handlePreviewClick}
          className="absolute top-11 left-2 z-10 p-1.5 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-500"
          title="Show details"
        >
          <Info className="h-4 w-4" />
        </button>

        <button
          onClick={handleFavoriteClick}
          className={`absolute top-2 right-2 z-10 p-1.5 rounded-full transition-all ${
            image.isFavorite
              ? 'bg-yellow-500/80 text-white opacity-100 hover:bg-yellow-600'
              : 'bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-yellow-500'
          }`}
          title={image.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star className={`h-4 w-4 ${image.isFavorite ? 'fill-current' : ''}`} />
        </button>
        <button
          onClick={handleCopyClick}
          className="absolute top-2 right-11 z-10 p-1.5 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-green-500"
          title="Copy Prompt"
          disabled={!image.prompt}
        >
          <Copy className="h-4 w-4" />
        </button>

        {imageUrl === 'ERROR' ? (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <div className="text-center text-gray-400 px-4">
              <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <p className="text-xs">File not found</p>
            </div>
          </div>
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt={image.name}
            className="max-w-full max-h-full object-contain"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full animate-pulse bg-gray-700"></div>
        )}
        {/* Tags display - always visible if tags exist */}
        {image.tags && image.tags.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/90 to-transparent">
            <div className="flex flex-wrap gap-1 items-center">
              {image.tags.slice(0, 2).map(tag => (
                <span
                  key={tag}
                  className="text-[10px] bg-gray-700/80 text-gray-300 px-1.5 py-0.5 rounded"
                >
                  #{tag}
                </span>
              ))}
              {image.tags.length > 2 && (
                <span className="text-[10px] text-gray-400">
                  +{image.tags.length - 2}
                </span>
              )}
            </div>
          </div>
        )}

        {!showFilenames && (
          <div className={`absolute left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${
            image.tags && image.tags.length > 0 ? 'bottom-8' : 'bottom-0'
          }`}>
            <p className="text-white text-xs truncate">{displayName}</p>
          </div>
        )}
      </div>
      {showFilenames && (
        <div className="mt-2 w-full px-1">
          <p className="text-[11px] text-gray-400 text-center truncate">{displayName}</p>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if relevant data changed
  // Efficient tag comparison using join instead of JSON.stringify
  const prevTags = prevProps.image.tags;
  const nextTags = nextProps.image.tags;
  const tagsEqual = (!prevTags && !nextTags) ||
    (prevTags && nextTags && prevTags.length === nextTags.length && prevTags.join(',') === nextTags.join(','));

  return (
    prevProps.image.id === nextProps.image.id &&
    prevProps.image.thumbnailUrl === nextProps.image.thumbnailUrl &&
    prevProps.image.thumbnailStatus === nextProps.image.thumbnailStatus &&
    prevProps.image.isFavorite === nextProps.image.isFavorite &&
    tagsEqual &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isFocused === nextProps.isFocused &&
    prevProps.isComparisonFirst === nextProps.isComparisonFirst &&
    prevProps.baseWidth === nextProps.baseWidth
  );
});


// --- ImageGrid Component ---
interface ImageGridProps {
  images: IndexedImage[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onBatchExport: () => void;
  // Deduplication support (optional)
  markedBestIds?: Set<string>;      // IDs of images marked as best
  markedArchivedIds?: Set<string>;  // IDs of images marked for archive
}

const ImageGrid: React.FC<ImageGridProps> = ({ images, onImageClick, selectedImages, currentPage, totalPages, onPageChange, onBatchExport, markedBestIds, markedArchivedIds }) => {
  const imageSize = useSettingsStore((state) => state.imageSize);
  const directories = useImageStore((state) => state.directories);
  const focusedImageIndex = useImageStore((state) => state.focusedImageIndex);
  const setFocusedImageIndex = useImageStore((state) => state.setFocusedImageIndex);
  const setPreviewImage = useImageStore((state) => state.setPreviewImage);
  const previewImage = useImageStore((state) => state.previewImage);
  const gridRef = useRef<HTMLDivElement>(null);
  const imageCardsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({});
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isComfyUIGenerateModalOpen, setIsComfyUIGenerateModalOpen] = useState(false);
  const [selectedImageForGeneration, setSelectedImageForGeneration] = useState<IndexedImage | null>(null);
  const [comparisonFirstImage, setComparisonFirstImage] = useState<IndexedImage | null>(null);
  const setComparisonImages = useImageStore((state) => state.setComparisonImages);
  const openComparisonModal = useImageStore((state) => state.openComparisonModal);
  const toggleImageSelection = useImageStore((state) => state.toggleImageSelection);

  // Drag-to-select states
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  const [initialSelectedImages, setInitialSelectedImages] = useState<Set<string>>(new Set());
  const { canUseComparison, showProModal, canUseA1111, canUseComfyUI, canUseBatchExport, initialized } = useFeatureAccess();
  const selectedCount = selectedImages.size;

  const handleImageLoad = (id: string, aspectRatio: number) => {
    setImageAspectRatios(prev => ({ ...prev, [id]: aspectRatio }));
  };

  const { generateWithA1111, isGenerating } = useGenerateWithA1111();
  const { generateWithComfyUI, isGenerating: isGeneratingComfyUI } = useGenerateWithComfyUI();

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
    exportImage,
    copyMetadataToA1111
  } = useContextMenu();

  const openGenerateModal = useCallback(() => {
    if (!contextMenu.image) return;
    if (!canUseA1111) {
      showProModal('a1111');
      hideContextMenu();
      return;
    }
    setSelectedImageForGeneration(contextMenu.image);
    setIsGenerateModalOpen(true);
    hideContextMenu();
  }, [contextMenu.image, hideContextMenu, canUseA1111, showProModal]);

  const openComfyUIGenerateModal = useCallback(() => {
    if (!contextMenu.image) return;
    if (!canUseComfyUI) {
      showProModal('comfyui');
      hideContextMenu();
      return;
    }
    setSelectedImageForGeneration(contextMenu.image);
    setIsComfyUIGenerateModalOpen(true);
    hideContextMenu();
  }, [contextMenu.image, hideContextMenu, canUseComfyUI, showProModal]);

  const selectForComparison = useCallback(() => {
    if (!contextMenu.image) return;
    if (!canUseComparison) {
      showProModal('comparison');
      hideContextMenu();
      return;
    }

    if (!comparisonFirstImage) {
      // First image selected
      setComparisonFirstImage(contextMenu.image);
      // Show notification
      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-purple-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      notification.textContent = 'Image 1 selected. Right-click another image to compare.';
      document.body.appendChild(notification);
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, 3000);
    } else {
      // Second image selected - start comparison
      setComparisonImages([comparisonFirstImage, contextMenu.image]);
      openComparisonModal();
      setComparisonFirstImage(null);
    }

    hideContextMenu();
  }, [contextMenu.image, comparisonFirstImage, setComparisonImages, openComparisonModal, hideContextMenu, canUseComparison, showProModal]);

  const handleBatchExport = useCallback(() => {
    hideContextMenu();
    onBatchExport();
  }, [hideContextMenu, onBatchExport]);

  // Drag-to-select handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start selection if clicking on the grid background (not on an image)
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).hasAttribute('data-grid-background')) {
      return;
    }

    e.preventDefault();
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left + (gridRef.current?.scrollLeft || 0);
    const y = e.clientY - rect.top + (gridRef.current?.scrollTop || 0);

    setIsSelecting(true);
    setSelectionStart({ x, y });
    setSelectionEnd({ x, y });
    setInitialSelectedImages(new Set(selectedImages));
  }, [selectedImages]);

  // Throttled with requestAnimationFrame for performance
  const rafIdRef = useRef<number | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isSelecting || !selectionStart) return;

    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    // Schedule the intersection calculation for the next animation frame
    rafIdRef.current = requestAnimationFrame(() => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + (gridRef.current?.scrollLeft || 0);
      const y = e.clientY - rect.top + (gridRef.current?.scrollTop || 0);

      setSelectionEnd({ x, y });

      // Calculate which images are within the selection box
      const box = {
        left: Math.min(selectionStart.x, x),
        right: Math.max(selectionStart.x, x),
        top: Math.min(selectionStart.y, y),
        bottom: Math.max(selectionStart.y, y),
      };

      const newSelection = new Set(e.shiftKey ? initialSelectedImages : []);

      imageCardsRef.current.forEach((element, imageId) => {
        const imageRect = element.getBoundingClientRect();
        const scrollTop = gridRef.current?.scrollTop || 0;
        const scrollLeft = gridRef.current?.scrollLeft || 0;

        const imageBox = {
          left: imageRect.left - rect.left + scrollLeft,
          right: imageRect.right - rect.left + scrollLeft,
          top: imageRect.top - rect.top + scrollTop,
          bottom: imageRect.bottom - rect.top + scrollTop,
        };

        // Check if boxes intersect
        const intersects = !(
          imageBox.right < box.left ||
          imageBox.left > box.right ||
          imageBox.bottom < box.top ||
          imageBox.top > box.bottom
        );

        if (intersects) {
          newSelection.add(imageId);
        }
      });

      useImageStore.setState({ selectedImages: newSelection });
      rafIdRef.current = null;
    });
  }, [isSelecting, selectionStart, initialSelectedImages]);

  const handleMouseUp = useCallback(() => {
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionEnd(null);
  }, []);

  // ALL HOOKS MUST BE BEFORE ANY EARLY RETURNS
  // Sync focusedImageIndex when previewImage changes
  useEffect(() => {
    if (previewImage) {
      const index = images.findIndex(img => img.id === previewImage.id);
      if (index !== -1 && index !== focusedImageIndex) {
        setFocusedImageIndex(index);
      }
    }
  }, [previewImage?.id]); // ✅ Removed focusedImageIndex to break circular dependency

  // Adjust focusedImageIndex when changing pages via arrow keys
  useEffect(() => {
    if (focusedImageIndex === -1 && images.length > 0) {
      // Quando volta de página, vai para última imagem
      setFocusedImageIndex(images.length - 1);
      setPreviewImage(images[images.length - 1]);
    }
  }, [images.length]); // ✅ Removed focusedImageIndex to break circular dependency

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

          // Alt+Enter = Open image in fullscreen mode (hide metadata panel)
          if (e.altKey) {
            sessionStorage.setItem('openImageFullscreen', 'true');
            onImageClick(images[currentIndex], e as any);
          } else {
            // Regular Enter = Open modal normally
            sessionStorage.removeItem('openImageFullscreen');
            onImageClick(images[currentIndex], e as any);
          }
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

  // Add global mouseup listener to handle selection end even outside the grid
  useEffect(() => {
    if (!isSelecting) return;

    const handleGlobalMouseUp = () => {
      setIsSelecting(false);
      setSelectionStart(null);
      setSelectionEnd(null);
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isSelecting]);

  // Memoized callbacks - MUST be before early return
  const handleContextMenu = useCallback((image: IndexedImage, e: React.MouseEvent) => {
    const directoryPath = directories.find(d => d.id === image.directoryId)?.path;
    showContextMenu(e, image, directoryPath);
  }, [directories, showContextMenu]);

  // Memoized cardRef callback factory
  const createCardRef = useCallback((imageId: string) => {
    return (el: HTMLDivElement | null) => {
      if (el) {
        imageCardsRef.current.set(imageId, el);
      } else {
        imageCardsRef.current.delete(imageId);
      }
    };
  }, []);

  // Early return AFTER all hooks
  if (images.length === 0) {
    return <div className="text-center py-16 text-gray-500">No images found. Try a different search term.</div>;
  }

  return (
    <div
      ref={gridRef}
      className="h-full w-full p-1 outline-none overflow-auto"
      style={{ minWidth: 0, minHeight: 0, position: 'relative', userSelect: isSelecting ? 'none' : 'auto' }}
      data-area="grid"
      tabIndex={0}
      onClick={() => gridRef.current?.focus()}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div
        className="flex flex-wrap gap-2"
        style={{
          alignContent: 'flex-start',
        }}
        data-grid-background
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
              isComparisonFirst={comparisonFirstImage?.id === image.id}
              cardRef={createCardRef(image.id)}
              isMarkedBest={markedBestIds?.has(image.id)}
              isMarkedArchived={markedArchivedIds?.has(image.id)}
            />
          );
        })}
      </div>

      {/* Selection box visual */}
      {isSelecting && selectionStart && selectionEnd && (
        <div
          className="absolute pointer-events-none z-30"
          style={{
            left: `${Math.min(selectionStart.x, selectionEnd.x)}px`,
            top: `${Math.min(selectionStart.y, selectionEnd.y)}px`,
            width: `${Math.abs(selectionEnd.x - selectionStart.x)}px`,
            height: `${Math.abs(selectionEnd.y - selectionStart.y)}px`,
            border: '2px solid rgba(59, 130, 246, 0.8)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
          }}
        />
      )}

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
            onClick={selectForComparison}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            title={!canUseComparison && initialized ? 'Pro feature - start trial' : undefined}
          >
            <GitCompare className="w-4 h-4" />
            <span className="flex-1">
              {comparisonFirstImage ? 'Compare with this' : 'Select for Comparison'}
            </span>
            <ProBadge size="sm" />
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

            {selectedCount > 1 && (
              <button
                onClick={handleBatchExport}
                className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
                title={!canUseBatchExport && initialized ? 'Pro feature - start trial' : undefined}
              >
                <Package className="w-4 h-4" />
                <span className="flex-1">Batch Export Selected ({selectedCount})</span>
                <ProBadge size="sm" />
              </button>
            )}

            <div className="border-t border-gray-600 my-1"></div>

          <button
            onClick={copyMetadataToA1111}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.metadata?.normalizedMetadata?.prompt}
            title={!canUseA1111 && initialized ? 'Pro feature - start trial' : undefined}
          >
            <Clipboard className="w-4 h-4" />
            <span className="flex-1">Copy to A1111</span>
            <ProBadge size="sm" />
          </button>

          <button
            onClick={openGenerateModal}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.metadata?.normalizedMetadata?.prompt}
            title={!canUseA1111 && initialized ? 'Pro feature - start trial' : undefined}
          >
            <Sparkles className="w-4 h-4" />
            <span className="flex-1">Generate with A1111</span>
            <ProBadge size="sm" />
          </button>

          <button
            onClick={openComfyUIGenerateModal}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.metadata?.normalizedMetadata?.prompt}
            title={!canUseComfyUI && initialized ? 'Pro feature - start trial' : undefined}
          >
            <Sparkles className="w-4 h-4" />
            <span className="flex-1">Generate with ComfyUI</span>
            <ProBadge size="sm" />
          </button>
        </div>
      )}

      {/* Generate Variation Modal */}
      {isGenerateModalOpen && selectedImageForGeneration && (
        <A1111GenerateModal
          isOpen={isGenerateModalOpen}
          onClose={() => {
            setIsGenerateModalOpen(false);
            setSelectedImageForGeneration(null);
          }}
          image={selectedImageForGeneration}
            onGenerate={async (params: A1111GenerationParams) => {
              const customMetadata: Partial<BaseMetadata> = {
                prompt: params.prompt,
                negativePrompt: params.negativePrompt,
                cfg_scale: params.cfgScale,
                steps: params.steps,
                seed: params.randomSeed ? -1 : params.seed,
                width: params.width,
                height: params.height,
                model: params.model || selectedImageForGeneration.metadata?.normalizedMetadata?.model,
                ...(params.sampler ? { sampler: params.sampler } : {}),
              };
            await generateWithA1111(selectedImageForGeneration, customMetadata, params.numberOfImages);
            setIsGenerateModalOpen(false);
            setSelectedImageForGeneration(null);
          }}
          isGenerating={isGenerating}
        />
      )}

      {/* ComfyUI Generate Variation Modal */}
      {isComfyUIGenerateModalOpen && selectedImageForGeneration && (
        <ComfyUIGenerateModal
          isOpen={isComfyUIGenerateModalOpen}
          onClose={() => {
            setIsComfyUIGenerateModalOpen(false);
            setSelectedImageForGeneration(null);
          }}
          image={selectedImageForGeneration}
          onGenerate={async (params: ComfyUIGenerationParams) => {
            const customMetadata: Partial<BaseMetadata> = {
              prompt: params.prompt,
              negativePrompt: params.negativePrompt,
              cfg_scale: params.cfgScale,
              steps: params.steps,
              seed: params.randomSeed ? -1 : params.seed,
              width: params.width,
              height: params.height,
              batch_size: params.numberOfImages,
              ...(params.sampler ? { sampler: params.sampler } : {}),
              ...(params.scheduler ? { scheduler: params.scheduler } : {}),
            };
            await generateWithComfyUI(selectedImageForGeneration, {
              customMetadata,
              overrides: {
                model: params.model,
                loras: params.loras,
              },
            });
            setIsComfyUIGenerateModalOpen(false);
            setSelectedImageForGeneration(null);
          }}
          isGenerating={isGeneratingComfyUI}
        />
      )}
    </div>
  );
};

export default ImageGrid;
