import { FixedSizeGrid as Grid, GridChildComponentProps, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { type IndexedImage, type BaseMetadata, type Directory, ImageStack, SmartCollection } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';
import { useContextMenu } from '../hooks/useContextMenu';
import { Heart, Info, Copy, Folder, Download, Clipboard, Sparkles, GitCompare, Square, Search,
  Archive,
  ChevronRight,
  CheckSquare,
  Crown,
  EyeOff,
  Package,
  Play,
  Music,
  Tag,
  RefreshCw,
  Pencil
} from 'lucide-react';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import { useGenerateWithA1111 } from '../hooks/useGenerateWithA1111';
import { useGenerateWithComfyUI } from '../hooks/useGenerateWithComfyUI';
import { useReparseMetadata } from '../hooks/useReparseMetadata';
import { useImageComparison } from '../hooks/useImageComparison';
import { A1111GenerateModal, type GenerationParams as A1111GenerationParams } from './A1111GenerateModal';
import { ComfyUIGenerateModal, type GenerationParams as ComfyUIGenerationParams } from './ComfyUIGenerateModal';
import Toast from './Toast';
import { RATING_VALUES, RatingValueIcons, getRatingChipClasses, getRatingLabel } from './RatingStars';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import ProBadge from './ProBadge';
import { useImageStacking } from '../hooks/useImageStacking';
import TagManagerModal from './TagManagerModal';
import TransferImagesModal, { type TransferDestination } from './TransferImagesModal';
import CollectionFormModal, { CollectionFormValues } from './CollectionFormModal';
import { transferIndexedImages } from '../services/fileTransferService';
import { thumbnailManager } from '../services/thumbnailManager';
import { getContextMenuRatingTargetIds } from '../utils/ratingSelection';
import { getRenameBasename, renameIndexedImage } from '../services/imageRenameService';
import { isAudioFileName, isVideoFileName } from '../utils/mediaTypes.js';
import {
  beginPerformanceFlow,
  createProfilerOnRender,
  finishPerformanceFlow,
  markPerformanceFlow,
  recordPerformanceCounter,
  recordPerformanceDuration,
} from '../utils/performanceDiagnostics';

interface ImageRenameResult {
  oldImageId: string;
  newImageId: string;
  newRelativePath: string;
}

interface ImageCardProps {
  image: IndexedImage;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  enableAuxClickOpen?: boolean;
  isSelected: boolean;
  isFocused?: boolean;
  onImageLoad: (id: string, aspectRatio: number) => void;
  onContextMenu?: (image: IndexedImage, event: React.MouseEvent) => void;
  onRenameRequest?: (image: IndexedImage) => void;
  onRenameComplete?: (result?: ImageRenameResult) => void;
  isRenaming?: boolean;
  baseWidth: number;
  isComparisonFirst?: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
  isMarkedBest?: boolean;       // For deduplication: marked as best to keep
  isMarkedArchived?: boolean;   // For deduplication: marked for archive
  isBlurred?: boolean;
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
};

const getRelativeImagePath = (image: IndexedImage): string => {
  const [, relativePath = ''] = image.id.split('::');
  return relativePath || image.name;
};

const joinDisplayPath = (basePath: string, relativePath: string): string => {
  const normalizedBase = (basePath || '').replace(/[/\\]+$/, '');
  const normalizedRelative = (relativePath || '').replace(/\\/g, '/').replace(/^[/\\]+/, '');

  if (!normalizedBase) {
    return normalizedRelative;
  }

  if (!normalizedRelative) {
    return normalizedBase;
  }

  return `${normalizedBase}/${normalizedRelative}`;
};

const formatAudioDuration = (seconds?: number | null): string | null => {
  if (seconds == null || !Number.isFinite(seconds)) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const abbreviatePathForDisplay = (relativePath: string): string => {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);

  if (segments.length <= 2) {
    return normalizedPath;
  }

  const fileName = segments[segments.length - 1];
  const firstFolder = segments[0];
  return `${firstFolder}/.../${fileName}`;
};

const getWarmupImage = (item: IndexedImage | ImageStack): IndexedImage =>
  isImageStack(item) ? item.coverImage : item;

const collectWarmupImages = (
  items: (IndexedImage | ImageStack)[],
  startIndex: number,
  endIndex: number
): IndexedImage[] => {
  if (items.length === 0 || endIndex < startIndex) {
    return [];
  }

  const safeStart = Math.max(0, startIndex);
  const safeEnd = Math.min(items.length - 1, endIndex);
  const images: IndexedImage[] = [];

  for (let index = safeStart; index <= safeEnd; index++) {
    images.push(getWarmupImage(items[index]));
  }

  return images;
};

const visibleGridThumbnailFlows = new Map<string, string>();

const ImageCard: React.FC<ImageCardProps> = React.memo(({ image, onImageClick, enableAuxClickOpen = true, isSelected, isFocused, onImageLoad, onContextMenu, onRenameRequest, onRenameComplete, isRenaming = false, baseWidth, isComparisonFirst, cardRef, isMarkedBest, isMarkedArchived, isBlurred }) => {
  const [renameValue, setRenameValue] = useState('');
  const [isSubmittingRename, setIsSubmittingRename] = useState(false);
  const thumbnail = useResolvedThumbnail(image);
  const suppressNextClickRef = useRef(false);
  const dragResetTimeoutRef = useRef<number | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const submittingRenameRef = useRef(false);
  const cancelingRenameRef = useRef(false);

  const setPreviewImage = useImageStore((state) => state.setPreviewImage);
  const directories = useImageStore((state) => state.directories);
  const thumbnailsDisabled = useSettingsStore((state) => state.disableThumbnails);
  const showFilenames = useSettingsStore((state) => state.showFilenames);
  const showFullFilePath = useSettingsStore((state) => state.showFullFilePath);
  const doubleClickToOpen = useSettingsStore((state) => state.doubleClickToOpen);
  const [showToast, setShowToast] = useState(false);
  const toggleImageSelection = useImageStore((state) => state.toggleImageSelection);
  const canDragExternally = typeof window !== 'undefined' && !!window.electronAPI?.startFileDrag;
  const isVideo = isVideoFileName(image.name, image.fileType);
  const isAudio = isAudioFileName(image.name, image.fileType);
  const audioDuration = formatAudioDuration((image.metadata as any)?.normalizedMetadata?.audio?.duration_seconds);
  const resolvedThumbnailUrl = !thumbnailsDisabled && !isVideo && !isAudio && thumbnail?.thumbnailStatus === 'ready'
    ? thumbnail.thumbnailUrl
    : null;
  const hasThumbnailError = !thumbnailsDisabled && thumbnail?.thumbnailStatus === 'error';

  const relativeImagePath = getRelativeImagePath(image);
  const directoryPath = directories.find((dir) => dir.id === image.directoryId)?.path || '';
  const fullImagePath = joinDisplayPath(directoryPath, relativeImagePath);
  const fullDisplayName = showFullFilePath ? fullImagePath : image.name;
  const displayName = showFullFilePath
    ? abbreviatePathForDisplay(fullImagePath)
    : relativeImagePath.split(/[/\\]/).pop() || image.name;

  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (cardRef) {
        cardRef(node);
      }
    },
    [cardRef]
  );

  useEffect(() => {
    if (resolvedThumbnailUrl) {
      const flowId = visibleGridThumbnailFlows.get(image.id);
      if (flowId) {
        markPerformanceFlow(flowId, 'thumbnail-ready', {
          imageId: image.id,
          imageName: image.name,
        });
        finishPerformanceFlow(flowId, {
          imageId: image.id,
          imageName: image.name,
          status: 'ready',
        });
        visibleGridThumbnailFlows.delete(image.id);
      }
      return;
    }

    if (hasThumbnailError) {
      const flowId = visibleGridThumbnailFlows.get(image.id);
      if (flowId) {
        markPerformanceFlow(flowId, 'thumbnail-error', {
          imageId: image.id,
          imageName: image.name,
        });
        finishPerformanceFlow(flowId, {
          imageId: image.id,
          imageName: image.name,
          status: 'error',
        });
        visibleGridThumbnailFlows.delete(image.id);
      }
      return;
    }
  }, [hasThumbnailError, image.id, image.name, resolvedThumbnailUrl]);

  useEffect(() => {
    return () => {
      if (dragResetTimeoutRef.current !== null) {
        window.clearTimeout(dragResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isRenaming) {
      submittingRenameRef.current = false;
      cancelingRenameRef.current = false;
      setIsSubmittingRename(false);
      return;
    }

    setRenameValue(getRenameBasename(image));
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [image, isRenaming]);

  const handleRenameSubmit = useCallback(async () => {
    if (!isRenaming || submittingRenameRef.current) {
      return;
    }

    const nextValue = renameValue.trim();
    if (nextValue === getRenameBasename(image)) {
      onRenameComplete?.();
      return;
    }

    submittingRenameRef.current = true;
    setIsSubmittingRename(true);
    try {
      const result = await renameIndexedImage(image, nextValue);
      if (!result.success) {
        alert(result.error || 'Failed to rename image.');
        requestAnimationFrame(() => {
          renameInputRef.current?.focus();
          renameInputRef.current?.select();
        });
        return;
      }

      if (result.newImageId && result.newRelativePath) {
        onRenameComplete?.({
          oldImageId: image.id,
          newImageId: result.newImageId,
          newRelativePath: result.newRelativePath,
        });
        return;
      }

      onRenameComplete?.();
    } finally {
      submittingRenameRef.current = false;
      setIsSubmittingRename(false);
    }
  }, [image, isRenaming, onRenameComplete, renameValue]);

  const handleRenameCancel = useCallback(() => {
    if (isSubmittingRename) {
      return;
    }

    cancelingRenameRef.current = true;
    onRenameComplete?.();
  }, [isSubmittingRename, onRenameComplete]);

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

    suppressNextClickRef.current = true;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copy';
    }
    window.electronAPI?.startFileDrag({ directoryPath, relativePath });
  };

  const handleDragEnd = () => {
    if (dragResetTimeoutRef.current !== null) {
      window.clearTimeout(dragResetTimeoutRef.current);
    }

    dragResetTimeoutRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = false;
      dragResetTimeoutRef.current = null;
    }, 0);
  };

  const handlePointerLikeDown = (clientX: number, clientY: number, button: number) => {
    if (!canDragExternally || button !== 0) {
      pointerDownRef.current = null;
      return;
    }

    pointerDownRef.current = { x: clientX, y: clientY };
  };

  const handlePointerLikeMove = (clientX: number, clientY: number, buttons: number) => {
    if (!pointerDownRef.current || (buttons & 1) !== 1) {
      return;
    }

    const deltaX = clientX - pointerDownRef.current.x;
    const deltaY = clientY - pointerDownRef.current.y;
    if (Math.abs(deltaX) >= 4 || Math.abs(deltaY) >= 4) {
      suppressNextClickRef.current = true;
    }
  };

  const clearPointerTracking = () => {
    pointerDownRef.current = null;
  };

  return (
    <div className="flex flex-col items-center" style={{ width: `${baseWidth}px` }}>
      {showToast && <Toast message="Prompt copied to clipboard!" onDismiss={() => setShowToast(false)} />}
      <div
        ref={mergedRef}
        data-image-id={image.id}
        className={`relative group flex items-center justify-center bg-gray-800 rounded-xl overflow-hidden cursor-pointer transition-all duration-300 ease-out border border-gray-700/50 ${
          isSelected 
            ? 'ring-4 ring-blue-500 ring-opacity-75 shadow-lg shadow-blue-500/20 translate-y-[-2px]' 
            : 'hover:shadow-2xl hover:shadow-black/50 hover:border-gray-600 hover:translate-y-[-4px]'
        } ${
          isFocused ? 'outline outline-2 outline-dashed outline-blue-400 outline-offset-2 z-10' : ''
        }`}
        style={{ width: '100%', height: `${baseWidth * 1.2}px`, flexShrink: 0 }}
        onMouseDown={(e) => {
          handlePointerLikeDown(e.clientX, e.clientY, e.button);
          if (enableAuxClickOpen && e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onMouseMove={(e) => {
          handlePointerLikeMove(e.clientX, e.clientY, e.buttons);
        }}
        onMouseUp={clearPointerTracking}
        onMouseLeave={clearPointerTracking}
        onClick={(e) => {
          if (suppressNextClickRef.current) {
            e.preventDefault();
            e.stopPropagation();
            suppressNextClickRef.current = false;
            return;
          }

          if (doubleClickToOpen) {
            if (e.ctrlKey || e.metaKey) {
              toggleImageSelection(image.id);
            } else {
              setPreviewImage(image);
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
        onAuxClick={(e) => {
          if (enableAuxClickOpen && e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            onImageClick(image, e);
          }
        }}

        onContextMenu={(e) => onContextMenu && onContextMenu(image, e)}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        draggable={canDragExternally}
      >
        {/* Checkbox for selection - always visible on hover or when selected */}
        <button
          onClick={handleCheckboxClick}
          className={`absolute top-2 left-2 z-20 p-1 rounded transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
          className="absolute top-11 left-2 z-10 p-1.5 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:opacity-100"
          title="Show details"
        >
          <Info className="h-4 w-4" />
        </button>

        <button
          onClick={handleFavoriteClick}
          className={`absolute top-2 right-2 z-10 p-1.5 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-rose-500 focus:opacity-100 ${
            image.isFavorite
              ? 'bg-rose-500/85 text-white opacity-100 hover:bg-rose-600'
              : 'bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-rose-500'
          }`}
          title={image.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart className={`h-4 w-4 ${image.isFavorite ? 'fill-current' : ''}`} />
        </button>
        <button
          onClick={handleCopyClick}
          className="absolute top-2 right-11 z-10 p-1.5 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:opacity-100"
          title="Copy Prompt"
          disabled={!image.prompt}
        >
          <Copy className="h-4 w-4" />
        </button>

        {hasThumbnailError ? (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <div className="text-center text-gray-400 px-4">
              <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <p className="text-xs">Preview unavailable</p>
            </div>
          </div>
        ) : isAudio ? (
          <div className="flex h-full w-full items-center justify-center bg-gray-900">
            <div className="flex flex-col items-center gap-2 px-3 text-center text-gray-300">
              <div className="rounded-full border border-cyan-400/30 bg-cyan-400/10 p-3 text-cyan-200">
                <Music className="h-7 w-7" />
              </div>
              <span className="max-w-full truncate text-xs font-medium text-gray-200">Audio</span>
              {audioDuration && (
                <span className="rounded bg-black/30 px-2 py-0.5 font-mono text-[11px] text-gray-300">{audioDuration}</span>
              )}
            </div>
          </div>
        ) : resolvedThumbnailUrl ? (
          <img
            src={resolvedThumbnailUrl}
            alt={image.name}
            className={`max-w-full max-h-full object-contain transition-all duration-200 ${
              isBlurred ? 'filter blur-xl scale-110 opacity-80' : ''
            } image-alpha-grid`}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full animate-pulse bg-gray-700"></div>
        )}

        {isVideo && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="rounded-full bg-black/50 p-2 shadow-lg">
              <Play className="h-6 w-6 text-white/90" />
            </div>
          </div>
        )}

        {isAudio && (
          <div className="absolute right-2 bottom-2 z-10 rounded-full bg-black/50 p-1.5 text-cyan-100 shadow-lg pointer-events-none">
            <Music className="h-4 w-4" />
          </div>
        )}

        {isBlurred && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <EyeOff className="h-8 w-8 text-white/80 drop-shadow" />
          </div>
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
            <p className="text-white text-xs truncate" title={fullDisplayName}>{displayName}</p>
          </div>
        )}
      </div>
      {(showFilenames || isRenaming) && (
        <div className="mt-2 w-full min-h-[2.25rem] px-1">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              aria-label={`Rename ${image.name}`}
              className="h-8 w-full rounded-md border border-blue-500/70 bg-gray-950 px-2 text-center text-[11px] leading-tight text-white outline-none ring-2 ring-blue-500/30 disabled:cursor-wait disabled:opacity-70"
              disabled={isSubmittingRename}
              onChange={(event) => setRenameValue(event.target.value)}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onBlur={() => {
                if (cancelingRenameRef.current) {
                  cancelingRenameRef.current = false;
                  return;
                }
                void handleRenameSubmit();
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleRenameSubmit();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  handleRenameCancel();
                }
              }}
            />
          ) : (
            <p
              role={onRenameRequest ? 'button' : undefined}
              className="text-[11px] leading-tight text-center text-gray-400"
              style={{
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
                overflow: 'hidden',
              }}
              title={fullDisplayName}
              onDoubleClick={(event) => {
                if (!onRenameRequest) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                onRenameRequest(image);
              }}
            >
              {displayName}
            </p>
          )}
        </div>
      )}
    </div>
  );
});


function isImageStack(item: IndexedImage | ImageStack): item is ImageStack {
  return (item as ImageStack).coverImage !== undefined;
}

const GAP_SIZE = 16;
const ITEM_HEIGHT_RATIO = 1.0;
const CARD_HEIGHT_RATIO = 1.2;
const FILENAME_HEIGHT = 40;

const getItemHeight = (imageSize: number, showFilenames: boolean): number =>
  (imageSize * CARD_HEIGHT_RATIO) + (showFilenames ? FILENAME_HEIGHT : 0);

interface CellData {
  items: (IndexedImage | ImageStack)[];
  columnCount: number;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  onStackClick: (stack: ImageStack) => void;
  selectedImages: Set<string>;
  focusedImageIndex: number | null;
  imageSize: number;
  handleImageLoad: (id: string, aspectRatio: number) => void;
  handleContextMenu: (image: IndexedImage, event: React.MouseEvent) => void;
  handleRenameRequest: (image: IndexedImage) => void;
  handleRenameComplete: (result?: ImageRenameResult) => void;
  renamingImageId: string | null;
  comparisonFirstImageId?: string;
  createCardRef: (id: string) => (node: HTMLDivElement | null) => void;
  markedBestIds?: Set<string>;
  markedArchivedIds?: Set<string>;
  enableSafeMode?: boolean;
  sensitiveTagSet?: Set<string>;
  blurSensitiveImages?: boolean;
  toggleImageSelection: (imageId: string, multiSelect: boolean) => void;
}

const Cell = React.memo(({ columnIndex, rowIndex, style, data }: GridChildComponentProps<CellData>) => {
  const {
    items,
    columnCount,
    onImageClick,
    onStackClick,
    selectedImages,
    focusedImageIndex,
    imageSize,
    handleImageLoad,
    handleContextMenu,
    handleRenameRequest,
    handleRenameComplete,
    renamingImageId,
    comparisonFirstImageId,
    createCardRef,
    markedBestIds,
    markedArchivedIds,
    enableSafeMode,
    sensitiveTagSet,
    blurSensitiveImages,
    toggleImageSelection
  } = data;

  const index = rowIndex * columnCount + columnIndex;

  if (index >= items.length) {
    return <div style={style} />;
  }

  const item = items[index];

  if (isImageStack(item)) {
    const isSensitive = enableSafeMode &&
      sensitiveTagSet && sensitiveTagSet.size > 0 &&
      !!item.coverImage.tags?.some(tag => sensitiveTagSet.has(tag.toLowerCase()));

    return (
      <div style={{
        ...style,
        left: (style.left as number) + GAP_SIZE,
        top: (style.top as number) + GAP_SIZE,
        width: (style.width as number) - GAP_SIZE,
        height: (style.height as number) - GAP_SIZE,
      }}>
        <div
          className="relative group cursor-pointer w-full h-full"
          onClick={() => onStackClick(item)}
          data-image-id={item.coverImage.id}
        >
          <div className="absolute top-[-4px] left-[4px] right-[-4px] bottom-[4px] bg-gray-700 rounded-lg border border-gray-600 shadow-sm z-0"></div>
          <div className="absolute top-[-8px] left-[8px] right-[-8px] bottom-[8px] bg-gray-800 rounded-lg border border-gray-700 shadow-sm z-[-1]"></div>

          <div className="relative z-10 w-full h-full">
            <ImageCard
              image={item.coverImage}
              onImageClick={(img, e) => {
                  e.stopPropagation();
                  onStackClick(item);
              }}
              enableAuxClickOpen={false}
              isSelected={selectedImages.has(item.coverImage.id)}
              isFocused={false}
              onImageLoad={handleImageLoad}
              onContextMenu={(img, e) => handleContextMenu(img, e)}
              onRenameRequest={handleRenameRequest}
              onRenameComplete={handleRenameComplete}
              isRenaming={renamingImageId === item.coverImage.id}
              baseWidth={imageSize}
              isComparisonFirst={false}
              cardRef={createCardRef(item.id)}
              isMarkedBest={markedBestIds?.has(item.coverImage.id)}
              isMarkedArchived={markedArchivedIds?.has(item.coverImage.id)}
              isBlurred={isSensitive && enableSafeMode && blurSensitiveImages}
            />

            <div className="absolute top-2 right-2 bg-black/60 text-white text-[11px] font-medium px-2 py-0.5 rounded-md backdrop-blur-md z-20 border border-white/10 shadow-sm">
              +{item.count}
            </div>
            <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] font-mono px-1.5 py-0.5 rounded backdrop-blur-sm z-20 pointer-events-none">
              Stack
            </div>
          </div>
        </div>
      </div>
    );
  }

  const image = item;
  const isFocused = focusedImageIndex === index;
  const isSensitive = enableSafeMode &&
    sensitiveTagSet && sensitiveTagSet.size > 0 &&
    !!image.tags?.some(tag => sensitiveTagSet.has(tag.toLowerCase()));

  return (
    <div 
      style={{
      ...style,
      left: (style.left as number) + GAP_SIZE,
      top: (style.top as number) + GAP_SIZE,
      width: (style.width as number) - GAP_SIZE,
      height: (style.height as number) - GAP_SIZE,
    }}
    data-image-id={image.id}
    >
      <ImageCard
        image={image}
        onImageClick={onImageClick}
        isSelected={selectedImages.has(image.id)}
        isFocused={isFocused}
        onImageLoad={handleImageLoad}
        onContextMenu={(img, e) => handleContextMenu(img, e)}
        onRenameRequest={handleRenameRequest}
        onRenameComplete={handleRenameComplete}
        isRenaming={renamingImageId === image.id}
        baseWidth={imageSize}
        isComparisonFirst={comparisonFirstImageId === image.id}
        cardRef={createCardRef(image.id)}
        isMarkedBest={markedBestIds?.has(image.id)}
        isMarkedArchived={markedArchivedIds?.has(image.id)}
        isBlurred={isSensitive && enableSafeMode && blurSensitiveImages}
      />
    </div>
  );
}, areEqual);

// --- ImageGrid Component ---
interface ImageGridProps {
  images: IndexedImage[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onBatchExport: () => void;
  activeCollection?: SmartCollection | null;
  isCollectionsView?: boolean;
  onImageRenamed?: (oldImageId: string, newImageId: string) => void;
  onFindSimilar?: (image: IndexedImage) => void;
  markedBestIds?: Set<string>;      // IDs of images marked as best
  markedArchivedIds?: Set<string>;  // IDs of images marked for archive
}

const InnerGridElement = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
  <div ref={ref} {...props} data-grid-background="true" />
));

const ImageGrid: React.FC<ImageGridProps> = ({
  images,
  onImageClick,
  selectedImages,
  currentPage,
  totalPages,
  onPageChange,
  onBatchExport,
  activeCollection = null,
  isCollectionsView = false,
  onImageRenamed,
  onFindSimilar,
  markedBestIds,
  markedArchivedIds,
}) => {
  const imageSize = useSettingsStore((state) => state.imageSize);
  const itemsPerPage = useSettingsStore((state) => state.itemsPerPage);
  const showFilenames = useSettingsStore((state) => state.showFilenames);

  const isStackingEnabled = useImageStore((state) => state.isStackingEnabled);
  const setStackingEnabled = useImageStore((state) => state.setStackingEnabled);
  const setViewingStackPrompt = useImageStore((state) => state.setViewingStackPrompt);
  const setSearchQuery = useImageStore((state) => state.setSearchQuery);
  const { stackedItems } = useImageStacking(images, isStackingEnabled);
  const itemsToRender = isStackingEnabled ? stackedItems : images;
  const isInfinite = itemsPerPage === -1;
  const gridScopeRef = useRef<HTMLDivElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const virtualGridRef = useRef<React.ElementRef<typeof Grid>>(null);
  const gridKeyboardActiveRef = useRef(false);
  const imageCardsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const cardRefCallbacksRef = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());
  const columnCountRef = useRef<number>(1);
  const lastWarmupWindowRef = useRef<string>('');
  const releasePaginatedBackgroundPauseRef = useRef<(() => void) | null>(null);
  const lastScrollSampleRef = useRef<{ top: number; at: number }>({ top: 0, at: 0 });

  const sensitiveTags = useSettingsStore((state) => state.sensitiveTags);
  const blurSensitiveImages = useSettingsStore((state) => state.blurSensitiveImages);
  const enableSafeMode = useSettingsStore((state) => state.enableSafeMode);
  const directories = useImageStore((state) => state.directories);
  const filterAndSortImages = useImageStore((state) => state.filterAndSortImages);

  const focusedImageIndex = useImageStore((state) => state.focusedImageIndex);
  const setFocusedImageIndex = useImageStore((state) => state.setFocusedImageIndex);
  const setPreviewImage = useImageStore((state) => state.setPreviewImage);
  const previewImage = useImageStore((state) => state.previewImage);
  const transferProgress = useImageStore((state) => state.transferProgress);

  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isComfyUIGenerateModalOpen, setIsComfyUIGenerateModalOpen] = useState(false);
  const [selectedImageForGeneration, setSelectedImageForGeneration] = useState<IndexedImage | null>(null);
  const toggleImageSelection = useImageStore((state) => state.toggleImageSelection);
  const bulkSetImageRating = useImageStore((state) => state.bulkSetImageRating);

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  const [initialSelectedImages, setInitialSelectedImages] = useState<Set<string>>(new Set());
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<'copy' | 'move' | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isCopySubmenuOpen, setIsCopySubmenuOpen] = useState(false);
  const [isCollectionSubmenuOpen, setIsCollectionSubmenuOpen] = useState(false);
  const [isAddToCollectionSubmenuOpen, setIsAddToCollectionSubmenuOpen] = useState(false);
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
  const [renamingImageId, setRenamingImageId] = useState<string | null>(null);
  const [transferStatusText, setTransferStatusText] = useState<string>('');
  const collections = useImageStore((state) => state.collections);
  const createCollection = useImageStore((state) => state.createCollection);
  const addImagesToCollection = useImageStore((state) => state.addImagesToCollection);
  const removeImagesFromCollection = useImageStore((state) => state.removeImagesFromCollection);
  const updateCollection = useImageStore((state) => state.updateCollection);
  const { canUseComparison, showProModal, canUseA1111, canUseComfyUI, canUseBatchExport, canUseBulkTagging, canUseFileManagement, initialized, canUseDuringTrialOrPro } = useFeatureAccess();
  const selectedCount = selectedImages.size;
  const sensitiveTagSet = useMemo(() => {
    return new Set(
      (sensitiveTags ?? [])
        .map(tag => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
        .filter(Boolean)
    );
  }, [sensitiveTags]);
  const showFilenameArea = showFilenames || renamingImageId !== null;



  const { generateWithA1111, isGenerating } = useGenerateWithA1111();

  const { generateWithComfyUI, isGenerating: isGeneratingComfyUI } = useGenerateWithComfyUI();
  const { isReparsing, reparseImages } = useReparseMetadata();
  const {
    comparisonImages: queuedComparisonImages,
    comparisonCount,
    addImage: addImageToComparison
  } = useImageComparison();

  const {
    contextMenu,
    contextMenuRef,
    showContextMenu,
    hideContextMenu,
    copyPrompt,
    copyNegativePrompt,
    copySeed,
    copyImage,
    copyModel,
    showInFolder,
    exportImage,
    copyMetadataToA1111,
    copyRawMetadata,
    addTag
  } = useContextMenu();

  const submenuHorizontalClass = contextMenu.horizontalDirection === 'left' ? 'right-full' : 'left-full';

  const getGridScrollElement = useCallback(() => gridScrollRef.current ?? gridScopeRef.current, []);

  const setNonVirtualGridRef = useCallback((node: HTMLDivElement | null) => {
    gridScopeRef.current = node;
    gridScrollRef.current = node;
  }, []);

  useEffect(() => {
    if (!contextMenu.visible && isCopySubmenuOpen) {
      setIsCopySubmenuOpen(false);
    }
    if (!contextMenu.visible && isCollectionSubmenuOpen) {
      setIsCollectionSubmenuOpen(false);
    }
    if (!contextMenu.visible && isAddToCollectionSubmenuOpen) {
      setIsAddToCollectionSubmenuOpen(false);
    }
  }, [contextMenu.visible, isAddToCollectionSubmenuOpen, isCollectionSubmenuOpen, isCopySubmenuOpen]);

  const queuedComparisonFirstImageId = queuedComparisonImages[0]?.id;
  const imageGridProfilerOnRender = useMemo(() => createProfilerOnRender('ImageGrid'), []);

  const handleAddTag = useCallback(() => {
    const isContextImageSelected = contextMenu.image && selectedImages.has(contextMenu.image.id);
    const effectiveCount = contextMenu.image 
        ? (isContextImageSelected ? selectedCount : 1)
        : selectedCount;

    if (effectiveCount > 1 && !canUseBulkTagging) {
        showProModal('bulk_tagging');
        hideContextMenu();
        return;
    }
    const result = addTag();
    if (result === 'open-tag-modal') {
        setIsTagManagerOpen(true);
    }
  }, [addTag, selectedCount, canUseBulkTagging, showProModal, hideContextMenu]);

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

    const added = addImageToComparison(contextMenu.image);
    if (added && comparisonCount === 0) {
      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-purple-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      notification.textContent = 'Image added to comparison. Add one more image to open compare.';
      document.body.appendChild(notification);
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, 3000);
    }

    hideContextMenu();
  }, [contextMenu.image, hideContextMenu, canUseComparison, showProModal, addImageToComparison, comparisonCount]);

  const openFindSimilar = useCallback(() => {
    if (!contextMenu.image || !onFindSimilar) {
      return;
    }

    onFindSimilar(contextMenu.image);
    hideContextMenu();
  }, [contextMenu.image, hideContextMenu, onFindSimilar]);

  const handleBatchExport = useCallback(() => {
    hideContextMenu();
    onBatchExport();
  }, [hideContextMenu, onBatchExport]);

  const contextImagePrompt = contextMenu.image?.prompt || contextMenu.image?.metadata?.normalizedMetadata?.prompt;
  const canFindSimilar = Boolean(contextImagePrompt) && Boolean(onFindSimilar);

  const getContextTargetImages = useCallback(() => {
    if (!contextMenu.image) {
      return [];
    }

    if (selectedImages.has(contextMenu.image.id)) {
      return images.filter((image) => selectedImages.has(image.id));
    }

    return [contextMenu.image];
  }, [contextMenu.image, images, selectedImages]);

  const handleAddToExistingCollection = useCallback(async (collection: SmartCollection) => {
    const targetImages = getContextTargetImages();
    if (targetImages.length === 0) {
      hideContextMenu();
      return;
    }

    await addImagesToCollection(collection.id, targetImages.map((image) => image.id));

    hideContextMenu();
  }, [addImagesToCollection, getContextTargetImages, hideContextMenu]);

  const handleCreateCollectionFromContext = useCallback(async (values: CollectionFormValues) => {
    const targetImages = getContextTargetImages();
    const targetImageIds = values.includeTargetImages ? targetImages.map((image) => image.id) : [];
    const coverImageId = targetImageIds.length > 0 ? targetImageIds[0] : null;

    await createCollection({
      kind: 'manual',
      name: values.name,
      description: values.description || undefined,
      sortIndex: collections.length,
      imageIds: targetImageIds,
      snapshotImageIds: [],
      coverImageId,
      autoUpdate: false,
      sourceTag: null,
      thumbnailId: coverImageId ?? undefined,
      type: 'custom',
      query: undefined,
    });

    setIsCollectionModalOpen(false);
    hideContextMenu();
  }, [collections.length, createCollection, getContextTargetImages, hideContextMenu]);

  const handleSetCollectionCover = useCallback(async () => {
    if (!activeCollection || !contextMenu.image) {
      hideContextMenu();
      return;
    }

    await updateCollection(activeCollection.id, {
      coverImageId: contextMenu.image.id,
      thumbnailId: contextMenu.image.id,
    });
    hideContextMenu();
  }, [activeCollection, contextMenu.image, hideContextMenu, updateCollection]);

  const handleRemoveFromCurrentCollection = useCallback(async () => {
    if (!activeCollection) {
      hideContextMenu();
      return;
    }

    const targetImages = getContextTargetImages();
    if (targetImages.length === 0) {
      hideContextMenu();
      return;
    }

    await removeImagesFromCollection(activeCollection.id, targetImages.map((image) => image.id));

    hideContextMenu();
  }, [activeCollection, getContextTargetImages, hideContextMenu, removeImagesFromCollection]);

  const handleSetRating = useCallback((rating: 1 | 2 | 3 | 4 | 5 | null) => {
    const targetImageIds = getContextMenuRatingTargetIds(selectedImages, contextMenu.image?.id);
    if (targetImageIds.length === 0) {
      hideContextMenu();
      return;
    }

    bulkSetImageRating(targetImageIds, rating);
    hideContextMenu();
  }, [bulkSetImageRating, contextMenu.image?.id, hideContextMenu, selectedImages]);

  const handleReparseMetadata = useCallback(async () => {
    const targetImages = getContextTargetImages();
    if (targetImages.length === 0) {
      hideContextMenu();
      return;
    }

    hideContextMenu();
    await reparseImages(targetImages);
  }, [getContextTargetImages, hideContextMenu, reparseImages]);

  const openTransferModal = useCallback((mode: 'copy' | 'move') => {
    const targetImages = getContextTargetImages();
    if (targetImages.length === 0) {
      hideContextMenu();
      return;
    }
    if (!canUseFileManagement) {
      showProModal('file_management');
      hideContextMenu();
      return;
    }

    setTransferMode(mode);
    setTransferStatusText('');
    setIsTransferModalOpen(true);
    hideContextMenu();
  }, [canUseFileManagement, getContextTargetImages, hideContextMenu, showProModal]);

  const openInlineRename = useCallback((image: IndexedImage | null | undefined) => {
    if (!image) {
      hideContextMenu();
      return;
    }
    if (!canUseFileManagement) {
      showProModal('file_management');
      hideContextMenu();
      return;
    }

    setRenamingImageId(image.id);
    hideContextMenu();
  }, [canUseFileManagement, hideContextMenu, showProModal]);

  const closeInlineRename = useCallback((result?: ImageRenameResult) => {
    if (result) {
      onImageRenamed?.(result.oldImageId, result.newImageId);
    }
    setRenamingImageId(null);
  }, [onImageRenamed]);

  const handleTransferConfirm = useCallback(async (directory: TransferDestination) => {
    if (!transferMode) {
      return;
    }

    const targetImages = getContextTargetImages();
    if (targetImages.length === 0) {
      setIsTransferModalOpen(false);
      return;
    }

    setIsTransferring(true);
    setTransferStatusText(transferMode === 'move' ? 'Moving files...' : 'Copying files...');
    try {
      await transferIndexedImages({
        images: targetImages,
        destinationDirectory: directory,
        mode: transferMode,
        onStatus: setTransferStatusText,
      });
      setIsTransferModalOpen(false);
      setTransferMode(null);
      setTransferStatusText('');
    } finally {
      setIsTransferring(false);
    }
  }, [getContextTargetImages, transferMode]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) {
      return;
    }

    const target = e.target as HTMLElement;

    const isInteractive = target.closest('button') || 
                          target.closest('a') || 
                          target.closest('input') || 
                          target.closest('[data-image-id]');

    if (isInteractive) {
      return;
    }

    const preserveExistingSelection = e.ctrlKey || e.metaKey || e.shiftKey;

    if (!preserveExistingSelection) {
        useImageStore.setState({ selectedImages: new Set() });
        setFocusedImageIndex(-1);
    }

    e.preventDefault();
    const scrollElement = getGridScrollElement();
    const rect = scrollElement?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left + (scrollElement?.scrollLeft || 0);
    const y = e.clientY - rect.top + (scrollElement?.scrollTop || 0);

    setIsSelecting(true);
    setSelectionStart({ x, y });
    setSelectionEnd({ x, y });
    const currentSelection = preserveExistingSelection ? new Set(selectedImages) : new Set<string>();
    setInitialSelectedImages(currentSelection);
  }, [getGridScrollElement, selectedImages]);

  useEffect(() => {
    const handleGlobalPointerDown = (event: MouseEvent) => {
      if (!gridScopeRef.current?.contains(event.target as Node)) {
        gridKeyboardActiveRef.current = false;
      }
    };

    const handleGlobalFocusIn = (event: FocusEvent) => {
      if (!gridScopeRef.current?.contains(event.target as Node)) {
        gridKeyboardActiveRef.current = false;
      }
    };

    document.addEventListener('mousedown', handleGlobalPointerDown, true);
    document.addEventListener('focusin', handleGlobalFocusIn);

    return () => {
      document.removeEventListener('mousedown', handleGlobalPointerDown, true);
      document.removeEventListener('focusin', handleGlobalFocusIn);
    };
  }, []);

  const rafIdRef = useRef<number | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isSelecting || !selectionStart) return;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      const scrollElement = getGridScrollElement();
      const rect = scrollElement?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + (scrollElement?.scrollLeft || 0);
      const y = e.clientY - rect.top + (scrollElement?.scrollTop || 0);

      setSelectionEnd({ x, y });

      const box = {
        left: Math.min(selectionStart.x, x),
        right: Math.max(selectionStart.x, x),
        top: Math.min(selectionStart.y, y),
        bottom: Math.max(selectionStart.y, y),
      };

      const preserveExistingSelection = e.ctrlKey || e.metaKey || e.shiftKey;
      const newSelection = new Set(preserveExistingSelection ? initialSelectedImages : []);

      if (isInfinite) {
        const columnCount = columnCountRef.current;
        const colWidth = imageSize + GAP_SIZE;
        const itemHeight = getItemHeight(imageSize, showFilenameArea);
        const rowHeight = itemHeight + GAP_SIZE;

        const minRow = Math.max(0, Math.floor((box.top - GAP_SIZE) / rowHeight));
        const maxRow = Math.floor((box.bottom - GAP_SIZE) / rowHeight);
        
        const minCol = Math.max(0, Math.floor((box.left - GAP_SIZE) / colWidth));
        const maxCol = Math.min(columnCount - 1, Math.floor((box.right - GAP_SIZE) / colWidth));

        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const index = r * columnCount + c;
                if (index >= 0 && index < itemsToRender.length) {
                    const item = itemsToRender[index];
                    const itemLeft = c * colWidth + GAP_SIZE;
                    const itemTop = r * rowHeight + GAP_SIZE;
                    const itemRight = itemLeft + imageSize;
                    const itemBottom = itemTop + itemHeight;

                    const intersects = !(
                        itemRight < box.left ||
                        itemLeft > box.right ||
                        itemBottom < box.top ||
                        itemTop > box.bottom
                    );

                    if (intersects) {
                        newSelection.add(typeof item === 'object' && 'coverImage' in item ? item.coverImage.id : item.id);
                    }
                }
            }
        }
      } else {
        imageCardsRef.current.forEach((element, imageId) => {
          const imageRect = element.getBoundingClientRect();
          const scrollTop = scrollElement?.scrollTop || 0;
          const scrollLeft = scrollElement?.scrollLeft || 0;
  
          const imageBox = {
            left: imageRect.left - rect.left + scrollLeft,
            right: imageRect.right - rect.left + scrollLeft,
            top: imageRect.top - rect.top + scrollTop,
            bottom: imageRect.bottom - rect.top + scrollTop,
          };
  
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
      }

      useImageStore.setState({ selectedImages: newSelection });
      rafIdRef.current = null;
    });
  }, [getGridScrollElement, isSelecting, selectionStart, initialSelectedImages, isInfinite, itemsToRender, imageSize, showFilenameArea]);

  const handleMouseUp = useCallback(() => {
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionEnd(null);
  }, []);

  useEffect(() => {
    if (previewImage) {
      const index = images.findIndex(img => img.id === previewImage.id);
      if (index !== -1 && index !== focusedImageIndex) {
        setFocusedImageIndex(index);
      }
    }
  }, [previewImage?.id]);

  useEffect(() => {
    if (focusedImageIndex === -1 && images.length > 0 && gridKeyboardActiveRef.current) {
      setFocusedImageIndex(images.length - 1);
      setPreviewImage(images[images.length - 1]);
    }
  }, [images.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInModal = document.querySelector('[role="dialog"]') !== null;
      const isInCommandPalette = document.querySelector('.command-palette, [data-command-palette]') !== null;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (isInModal || isInCommandPalette) {
        return;
      }

      const needsFocus = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key);
      if (needsFocus && !gridKeyboardActiveRef.current) {
        return;
      }

      if (e.key === 'Enter' && !isTyping) {
        const currentIndex = focusedImageIndex ?? -1;
        if (currentIndex >= 0 && currentIndex < images.length) {
          e.preventDefault();
          e.stopPropagation();

          if (e.altKey) {
            sessionStorage.setItem('openImageFullscreen', 'true');
            onImageClick(images[currentIndex], e as any);
          } else {
            sessionStorage.removeItem('openImageFullscreen');
            onImageClick(images[currentIndex], e as any);
          }
          return;
        }
      }

      const currentIndex = focusedImageIndex ?? -1;
      let nextIndex = currentIndex;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextIndex = currentIndex + 1;
        if (nextIndex < images.length) {
          setFocusedImageIndex(nextIndex);
          setPreviewImage(images[nextIndex]);
        } else if (currentPage < totalPages) {
          onPageChange(currentPage + 1);
          setFocusedImageIndex(0);
          nextIndex = -1;
        } else {
            nextIndex = -1;
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        nextIndex = currentIndex - 1;
        if (nextIndex >= 0) {
          setFocusedImageIndex(nextIndex);
          setPreviewImage(images[nextIndex]);
        } else if (currentPage > 1) {
          onPageChange(currentPage - 1);
          setFocusedImageIndex(-1);
          nextIndex = -1;
        } else {
            nextIndex = -1;
        }
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        if (currentPage < totalPages) {
          onPageChange(currentPage + 1);
          setFocusedImageIndex(0);
          nextIndex = -1;
        }
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        if (currentPage > 1) {
          onPageChange(currentPage - 1);
          setFocusedImageIndex(0);
          nextIndex = -1;
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        onPageChange(1);
        setFocusedImageIndex(0);
        nextIndex = -1;
      } else if (e.key === 'End') {
        e.preventDefault();
        onPageChange(totalPages);
        setFocusedImageIndex(0);
        nextIndex = -1;
      }

    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [focusedImageIndex, images, setFocusedImageIndex, setPreviewImage, onImageClick, currentPage, totalPages, onPageChange]);

  useEffect(() => {
    if (!gridKeyboardActiveRef.current || focusedImageIndex == null || focusedImageIndex < 0) {
      return;
    }

    if (isInfinite) {
      const columnCount = Math.max(1, columnCountRef.current);
      virtualGridRef.current?.scrollToItem({
        rowIndex: Math.floor(focusedImageIndex / columnCount),
        columnIndex: focusedImageIndex % columnCount,
        align: 'auto',
      });
      return;
    }

    const focusedImage = images[focusedImageIndex];
    if (!focusedImage) {
      return;
    }

    const focusedElement = imageCardsRef.current.get(focusedImage.id);
    if (typeof focusedElement?.scrollIntoView === 'function') {
      focusedElement.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [focusedImageIndex, images, isInfinite]);

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

  useEffect(() => {
    filterAndSortImages();
  }, [filterAndSortImages, sensitiveTags, blurSensitiveImages, enableSafeMode]);

  const handleContextMenu = useCallback((image: IndexedImage, e: React.MouseEvent) => {
    const directoryPath = directories.find(d => d.id === image.directoryId)?.path;
    showContextMenu(e, image, directoryPath);
  }, [directories, showContextMenu]);

  const createCardRef = useCallback((imageId: string) => {
    const existing = cardRefCallbacksRef.current.get(imageId);
    if (existing) {
      return existing;
    }

    const callback = (el: HTMLDivElement | null) => {
      if (el) {
        imageCardsRef.current.set(imageId, el);
      } else {
        imageCardsRef.current.delete(imageId);
      }
    };

    cardRefCallbacksRef.current.set(imageId, callback);
    return callback;
  }, []);



 

  const contextMenuContent = contextMenu.visible && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={contextMenuRef}
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
            onClick={handleAddTag}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
          >
            <Tag className="w-4 h-4" />
            <span className="flex-1">Add/Remove Tags</span>
            {!canUseBulkTagging && selectedCount > 1 && initialized && !canUseDuringTrialOrPro && <ProBadge size="sm" />}
          </button>

          <div
            className="relative"
            onMouseEnter={() => setIsCollectionSubmenuOpen(true)}
            onMouseLeave={() => {
              setIsCollectionSubmenuOpen(false);
              setIsAddToCollectionSubmenuOpen(false);
            }}
          >
            <button
              onClick={() => setIsCollectionSubmenuOpen((open) => !open)}
              className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            >
              <Folder className="w-4 h-4" />
              <span className="flex-1">Collection</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </button>

            {isCollectionSubmenuOpen && (
              <div className={`absolute top-0 min-w-[220px] rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl ${submenuHorizontalClass}`}>
                <div
                  className="relative"
                  onMouseEnter={() => setIsAddToCollectionSubmenuOpen(true)}
                  onMouseLeave={() => setIsAddToCollectionSubmenuOpen(false)}
                >
                  <button
                    onClick={() => setIsAddToCollectionSubmenuOpen((open) => !open)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                  >
                    <span className="flex-1">Add to Collection</span>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </button>

                  {isAddToCollectionSubmenuOpen && (
                    <div className={`absolute top-0 min-w-[220px] rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl ${submenuHorizontalClass}`}>
                      {collections.length === 0 ? (
                        <div className="px-4 py-2 text-sm text-gray-500">No collections yet</div>
                      ) : (
                        collections.map((collection) => (
                          <button
                            key={collection.id}
                            onClick={() => void handleAddToExistingCollection(collection)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                          >
                            <span className="truncate">{collection.name}</span>
                            {collection.sourceTag && (
                              <span className="text-[10px] uppercase tracking-wide text-gray-500">
                                {collection.autoUpdate !== false ? 'Auto' : 'Linked'}
                              </span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => {
                    setIsCollectionModalOpen(true);
                    hideContextMenu();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                >
                  Create New Collection
                </button>
              </div>
            )}
          </div>

          {isCollectionsView && activeCollection && (
            <>
              <button
                onClick={() => void handleSetCollectionCover()}
                className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
              >
                <Folder className="w-4 h-4" />
                Set as Cover
              </button>

              <button
                onClick={() => void handleRemoveFromCurrentCollection()}
                className="w-full text-left px-4 py-2 text-sm text-amber-200 hover:bg-amber-900/20 hover:text-amber-100 transition-colors flex items-center gap-2"
              >
                <Folder className="w-4 h-4" />
                <span className="flex-1">Remove from Current Collection</span>
              </button>
            </>
          )}

          <div className="px-4 py-2">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Set Rating</div>
            <div className="flex flex-wrap gap-1.5">
              {RATING_VALUES.map((value) => (
                <button
                  key={value}
                  onClick={() => handleSetRating(value as 1 | 2 | 3 | 4 | 5)}
                  className={`rounded-md border px-2 py-1 transition-colors ${getRatingChipClasses(value, false)}`}
                  title={`Set ${getRatingLabel(value)}`}
                  aria-label={`Set ${getRatingLabel(value)}`}
                >
                  <RatingValueIcons value={value} size={11} starClassName="fill-current" />
                </button>
              ))}
              <button
                onClick={() => handleSetRating(null)}
                className="rounded-md border border-gray-700 bg-gray-900/50 px-2 py-1 text-xs text-gray-300 transition-colors hover:border-rose-500/60 hover:text-rose-200"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="border-t border-gray-600 my-1"></div>

          <div
            className="relative"
            onMouseEnter={() => setIsCopySubmenuOpen(true)}
            onMouseLeave={() => setIsCopySubmenuOpen(false)}
          >
            <button
              onClick={() => setIsCopySubmenuOpen((open) => !open)}
              className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            >
              <Copy className="w-4 h-4" />
              <span className="flex-1">Copy</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </button>

            {isCopySubmenuOpen && (
              <div className={`absolute top-0 min-w-[190px] rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl ${submenuHorizontalClass}`}>
                <button
                  onClick={copyPrompt}
                  className="w-full px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                  disabled={!contextMenu.image?.prompt && !(contextMenu.image?.metadata as any)?.prompt}
                >
                  Prompt
                </button>
                <button
                  onClick={copyNegativePrompt}
                  className="w-full px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                  disabled={!contextMenu.image?.negativePrompt && !(contextMenu.image?.metadata as any)?.negativePrompt}
                >
                  Negative Prompt
                </button>
                <button
                  onClick={copySeed}
                  className="w-full px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                  disabled={!contextMenu.image?.seed && !(contextMenu.image?.metadata as any)?.seed}
                >
                  Seed
                </button>
                <button
                  onClick={copyModel}
                  className="w-full px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                  disabled={!contextMenu.image?.models?.[0] && !(contextMenu.image?.metadata as any)?.model}
                >
                  Checkpoint
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-gray-600 my-1"></div>

          <button
            onClick={selectForComparison}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            title={!canUseComparison && initialized ? 'Pro feature - start trial' : undefined}
          >
            <GitCompare className="w-4 h-4" />
            <span className="flex-1">
              Add to Compare {canUseComparison && comparisonCount > 0 ? `(${comparisonCount}/4)` : ''}
            </span>
            {!canUseDuringTrialOrPro && <ProBadge size="sm" />}
          </button>

          <button
            onClick={openFindSimilar}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!canFindSimilar}
            title={canFindSimilar ? 'Find images with matching prompt and metadata' : 'Requires prompt metadata'}
          >
            <Search className="w-4 h-4" />
            <span className="flex-1">Find similar...</span>
          </button>

          <div className="border-t border-gray-600 my-1"></div>

          <button
              onClick={copyRawMetadata}
              className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
              disabled={!contextMenu.image?.metadata}
            >
              <Copy className="w-4 h-4" />
              Copy Raw Metadata
            </button>

          <button
            onClick={handleReparseMetadata}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={isReparsing}
          >
            <RefreshCw className={`w-4 h-4 ${isReparsing ? 'animate-spin' : ''}`} />
            {getContextTargetImages().length > 1 ? `Reparse Selected (${getContextTargetImages().length})` : 'Reparse Metadata'}
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
            onClick={() => openInlineRename(contextMenu.image)}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            title={!canUseFileManagement && initialized ? 'Pro feature - start trial' : undefined}
          >
            <Pencil className="w-4 h-4" />
            <span className="flex-1">Rename...</span>
            {!canUseDuringTrialOrPro && <ProBadge size="sm" />}
          </button>

          <button
            onClick={() => openTransferModal('copy')}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            title={!canUseFileManagement && initialized ? 'Pro feature - start trial' : undefined}
          >
            <Folder className="w-4 h-4" />
            <span className="flex-1">Copy To...</span>
            {!canUseDuringTrialOrPro && <ProBadge size="sm" />}
          </button>

          <button
            onClick={() => openTransferModal('move')}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            title={!canUseFileManagement && initialized ? 'Pro feature - start trial' : undefined}
          >
            <Folder className="w-4 h-4" />
            <span className="flex-1">Move To...</span>
            {!canUseDuringTrialOrPro && <ProBadge size="sm" />}
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
                {!canUseDuringTrialOrPro && <ProBadge size="sm" />}
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
            {!canUseDuringTrialOrPro && <ProBadge size="sm" />}
          </button>

          <button
            onClick={openGenerateModal}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.metadata?.normalizedMetadata?.prompt}
            title={!canUseA1111 && initialized ? 'Pro feature - start trial' : undefined}
          >
            <Sparkles className="w-4 h-4" />
            <span className="flex-1">Generate with A1111</span>
            {!canUseDuringTrialOrPro && <ProBadge size="sm" />}
          </button>

          <button
            onClick={openComfyUIGenerateModal}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!contextMenu.image?.metadata?.normalizedMetadata?.prompt}
            title={!canUseComfyUI && initialized ? 'Pro feature - start trial' : undefined}
          >
            <Sparkles className="w-4 h-4" />
            <span className="flex-1">Generate with ComfyUI</span>
            {!canUseDuringTrialOrPro && <ProBadge size="sm" />}
          </button>
        </div>,
        document.body,
      )
    : null;

  const modalsContent = (
    <>
      <CollectionFormModal
        isOpen={isCollectionModalOpen}
        title="Create Collection"
        submitLabel="Create Collection"
        initialValues={{
          name: '',
          description: '',
          sourceTag: '',
          autoUpdate: false,
          includeTargetImages: getContextTargetImages().length > 0,
        }}
        onClose={() => setIsCollectionModalOpen(false)}
        onSubmit={handleCreateCollectionFromContext}
        showIncludeTargetImages={getContextTargetImages().length > 0}
      />

      <TagManagerModal
        isOpen={isTagManagerOpen}
        onClose={() => setIsTagManagerOpen(false)}
        selectedImageIds={contextMenu.image ? (selectedImages.has(contextMenu.image.id) ? Array.from(selectedImages) : [contextMenu.image.id]) : []}
      />

      <TransferImagesModal
        isOpen={isTransferModalOpen && !!transferMode}
        onClose={() => {
          setIsTransferModalOpen(false);
        }}
        images={getContextTargetImages()}
        directories={directories}
        mode={transferMode || 'copy'}
        isSubmitting={isTransferring}
        statusText={transferStatusText}
        progress={transferProgress}
        onConfirm={handleTransferConfirm}
      />

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
              model: params.model?.name || selectedImageForGeneration.metadata?.normalizedMetadata?.model,
              ...(params.sampler ? { sampler: params.sampler } : {}),
              ...(params.scheduler ? { scheduler: params.scheduler } : {}),
            };
            await generateWithComfyUI(selectedImageForGeneration, {
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
    </>
  );

  const handleStackClick = React.useCallback((stack: ImageStack) => {
    const prompt = stack.coverImage.metadata?.normalizedMetadata?.prompt || stack.coverImage.metadata?.positive_prompt;
    if (prompt) {
        setSearchQuery(prompt);
        setStackingEnabled(false);
        setViewingStackPrompt(prompt);
    }
  }, [setStackingEnabled, setViewingStackPrompt]);

  useEffect(() => {
    lastWarmupWindowRef.current = '';
  }, [itemsToRender]);

  useEffect(() => {
    return () => {
      for (const [imageId, flowId] of visibleGridThumbnailFlows.entries()) {
        markPerformanceFlow(flowId, 'grid-unmounted', { imageId });
        finishPerformanceFlow(flowId, { imageId, status: 'grid-unmounted' });
      }
      visibleGridThumbnailFlows.clear();
    };
  }, []);

  useEffect(() => {
    if (isInfinite) {
      if (releasePaginatedBackgroundPauseRef.current) {
        releasePaginatedBackgroundPauseRef.current();
        releasePaginatedBackgroundPauseRef.current = null;
      }
      return;
    }

    const visiblePageImages = collectWarmupImages(itemsToRender, 0, itemsToRender.length - 1);
    const keepImageIds = new Set(visiblePageImages.map((image) => image.id));

    thumbnailManager.cancelQueuedJobs({ queue: 'all', keepImageIds });
    releasePaginatedBackgroundPauseRef.current?.();
    releasePaginatedBackgroundPauseRef.current = thumbnailManager.pauseBackgroundWork();

    thumbnailManager.scheduleViewport({
      visibleImages: visiblePageImages,
      aheadImages: [],
      keepImageIds,
      cancelQueue: 'all',
    });

    return () => {
      if (releasePaginatedBackgroundPauseRef.current) {
        releasePaginatedBackgroundPauseRef.current();
        releasePaginatedBackgroundPauseRef.current = null;
      }
    };
  }, [isInfinite, itemsToRender, currentPage]);

  const isEmpty = itemsToRender.length === 0;

  const handleImageLoad = useCallback((id: string, aspectRatio: number) => {
  }, []);

  if (isEmpty) {
     return (
        <React.Profiler id="ImageGrid" onRender={imageGridProfilerOnRender}>
        <div className="flex flex-col h-full w-full">
            <div className="flex-1 flex items-center justify-center h-64 text-gray-500">
                No images found
            </div>
            {modalsContent}
        </div>
        </React.Profiler>
     );
  }

  if (isInfinite) {
    return (
      <React.Profiler id="ImageGrid" onRender={imageGridProfilerOnRender}>
      <div className="flex flex-col h-full w-full">
         <div
            ref={gridScopeRef}
            className="flex-1 outline-none"
            style={{ position: 'relative' }}
            data-area="grid"
            tabIndex={0}
            onFocus={() => {
              gridKeyboardActiveRef.current = true;
            }}
            onMouseDownCapture={(event) => {
              if (!isTypingTarget(event.target)) {
                gridKeyboardActiveRef.current = true;
              }
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            <AutoSizer>
              {({ height, width }) => {
                const columnCount = Math.floor(width / (imageSize + GAP_SIZE));
                const safeColumnCount = columnCount > 0 ? columnCount : 1;
                const rowCount = Math.ceil(itemsToRender.length / safeColumnCount);
                
                columnCountRef.current = safeColumnCount;

                const cellData: CellData = {
                    items: itemsToRender,
                    columnCount: safeColumnCount,
                    onImageClick,
                    onStackClick: handleStackClick,
                    selectedImages,
                    focusedImageIndex,
                    imageSize,
                    handleImageLoad,
                    handleContextMenu,
                    handleRenameRequest: openInlineRename,
                    handleRenameComplete: closeInlineRename,
                    renamingImageId,
                    comparisonFirstImageId: queuedComparisonFirstImageId,
                    createCardRef,
                    markedBestIds,
                    markedArchivedIds,
                    enableSafeMode,
                    sensitiveTagSet,
                    blurSensitiveImages,
                    toggleImageSelection
                };

                return (
                  <Grid
                    ref={virtualGridRef}
                    columnCount={safeColumnCount}
                    columnWidth={imageSize + GAP_SIZE}
                    height={height}
                    overscanColumnCount={1}
                    overscanRowCount={4}
                    rowCount={rowCount}
                    rowHeight={getItemHeight(imageSize, showFilenameArea) + GAP_SIZE}
                    width={width}
                    outerRef={gridScrollRef}
                    className="no-scrollbar-if-needed"
                    itemData={cellData}
                    itemKey={({ columnIndex, rowIndex, data }) => {
                      const itemIndex = rowIndex * safeColumnCount + columnIndex;
                      const item = (data as CellData).items[itemIndex];
                      return item ? item.id : `empty-${rowIndex}-${columnIndex}`;
                    }}
                    style={{ overflowX: 'hidden' }}
                    innerElementType={InnerGridElement}
                    onScroll={({ scrollTop, scrollUpdateWasRequested }) => {
                      const currentAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
                      const previousSample = lastScrollSampleRef.current;
                      const deltaMs = Math.max(1, currentAt - previousSample.at);
                      const velocityPxPerMs = Math.round(((scrollTop - previousSample.top) / deltaMs) * 1000) / 1000;
                      lastScrollSampleRef.current = { top: scrollTop, at: currentAt };
                      recordPerformanceCounter('grid.scroll-sample', {
                        scrollTop,
                        scrollUpdateWasRequested,
                        velocityPxPerMs,
                      });
                    }}
                    onItemsRendered={({ visibleColumnStartIndex, visibleColumnStopIndex, visibleRowStartIndex, visibleRowStopIndex, overscanRowStopIndex }) => {
                      const itemsRenderedStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
                      const visibleStartIndex = (visibleRowStartIndex * safeColumnCount) + visibleColumnStartIndex;
                      const visibleStopIndex = Math.min(
                        itemsToRender.length - 1,
                        (visibleRowStopIndex * safeColumnCount) + visibleColumnStopIndex
                      );
                      const aheadStopIndex = Math.min(
                        itemsToRender.length - 1,
                        (((overscanRowStopIndex + 4) * safeColumnCount) - 1)
                      );
                      const windowKey = `${visibleStartIndex}:${visibleStopIndex}:${aheadStopIndex}:${itemsToRender.length}:${safeColumnCount}`;

                      if (lastWarmupWindowRef.current === windowKey) {
                        return;
                      }
                      lastWarmupWindowRef.current = windowKey;

                      const primaryImages = collectWarmupImages(itemsToRender, visibleStartIndex, visibleStopIndex);
                      const secondaryImages = collectWarmupImages(itemsToRender, visibleStopIndex + 1, aheadStopIndex);
                      const visibleImageIds = new Set(primaryImages.map((image) => image.id));

                      for (const [imageId, flowId] of visibleGridThumbnailFlows.entries()) {
                        if (!visibleImageIds.has(imageId)) {
                          markPerformanceFlow(flowId, 'left-viewport', { imageId });
                          finishPerformanceFlow(flowId, { imageId, status: 'left-viewport' });
                          visibleGridThumbnailFlows.delete(imageId);
                        }
                      }

                      for (const image of primaryImages) {
                        const resolvedThumbnail = thumbnailManager.getResolvedState(image);
                        const readyThumbnailUrl = resolvedThumbnail?.thumbnailUrl ?? image.thumbnailUrl;
                        const readyThumbnailStatus = resolvedThumbnail?.thumbnailStatus ?? image.thumbnailStatus;

                        if (readyThumbnailStatus === 'ready' && readyThumbnailUrl) {
                          recordPerformanceCounter('grid.thumbnail-visible-ready-hit', {
                            imageId: image.id,
                            imageName: image.name,
                          });
                          continue;
                        }

                        if (!visibleGridThumbnailFlows.has(image.id)) {
                          const flowId = beginPerformanceFlow('grid.thumbnail-visible', {
                            imageId: image.id,
                            imageName: image.name,
                            visibleStartIndex,
                            visibleStopIndex,
                          });
                          if (flowId) {
                            visibleGridThumbnailFlows.set(image.id, flowId);
                          }
                        }
                      }

                      thumbnailManager.scheduleViewport({
                        visibleImages: primaryImages,
                        aheadImages: secondaryImages,
                      });
                      recordPerformanceDuration('grid.items-rendered', (typeof performance !== 'undefined' ? performance.now() : Date.now()) - itemsRenderedStartedAt, {
                        visibleStartIndex,
                        visibleStopIndex,
                        aheadStopIndex,
                        columnCount: safeColumnCount,
                        primaryCount: primaryImages.length,
                        secondaryCount: secondaryImages.length,
                        itemCount: itemsToRender.length,
                      });
                    }}
                  >
                    {Cell}
                  </Grid>
                );
              }}
            </AutoSizer>


        {/* Selection box visual - Needs to be adjusted for scroll in infinite mode 
            because it's rendered outside the scrolling container but coordinates are content-relative 
        */}
        {isSelecting && selectionStart && selectionEnd && (
          <div
            className="absolute pointer-events-none z-30"
            style={{
              left: `${Math.min(selectionStart.x, selectionEnd.x)}px`,
              top: `${Math.min(selectionStart.y, selectionEnd.y) - (getGridScrollElement()?.scrollTop || 0)}px`,
              width: `${Math.abs(selectionEnd.x - selectionStart.x)}px`,
              height: `${Math.abs(selectionEnd.y - selectionStart.y)}px`,
              border: '2px solid rgba(59, 130, 246, 0.8)',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
            }}
          />
        )}

            {contextMenuContent}
            {modalsContent}
          </div>
      </div>
      </React.Profiler>
    );
  }

  return (
    <React.Profiler id="ImageGrid" onRender={imageGridProfilerOnRender}>
    <div className="flex flex-col h-full w-full">
      <div
        ref={setNonVirtualGridRef}
        className="flex-1 p-4 outline-none overflow-auto"
        style={{ minWidth: 0, minHeight: 0, position: 'relative', userSelect: isSelecting ? 'none' : 'auto' }}
        data-area="grid"
        tabIndex={0}
        onFocus={() => {
          gridKeyboardActiveRef.current = true;
        }}
        onMouseDownCapture={(event) => {
          if (!isTypingTarget(event.target)) {
            gridKeyboardActiveRef.current = true;
          }
        }}
        onClick={() => {
          gridKeyboardActiveRef.current = true;
          gridScopeRef.current?.focus();
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <div
          className="flex flex-wrap gap-4"
          style={{
            alignContent: 'flex-start',
          }}
          data-grid-background
        >
          {itemsToRender.map((item, index) => {
            if (isImageStack(item)) {
               const isSensitive = enableSafeMode &&
                sensitiveTagSet && sensitiveTagSet.size > 0 &&
                !!item.coverImage.tags?.some(tag => sensitiveTagSet.has(tag.toLowerCase()));
                
                return (
                    <div 
                        key={item.id}
                        className="relative group cursor-pointer"
                        style={{ width: imageSize, height: getItemHeight(imageSize, showFilenameArea) }}
                        onClick={() => handleStackClick(item)}
                    >
                        {/* Back cards effect */}
                        <div className="absolute top-[-4px] left-[4px] right-[-4px] bottom-[4px] bg-gray-700 rounded-lg border border-gray-600 shadow-sm z-0"></div>
                        <div className="absolute top-[-8px] left-[8px] right-[-8px] bottom-[8px] bg-gray-800 rounded-lg border border-gray-700 shadow-sm z-[-1]"></div>
                        
                        <div className="relative z-10 w-full h-full">
                            <ImageCard
                                image={item.coverImage}
                                onImageClick={() => handleStackClick(item)}
                                enableAuxClickOpen={false}
                                isSelected={selectedImages.has(item.coverImage.id)}
                                isFocused={false}
                                onImageLoad={handleImageLoad}
                onContextMenu={(img, e) => handleContextMenu(img, e)}
                onRenameRequest={openInlineRename}
                onRenameComplete={closeInlineRename}
                isRenaming={renamingImageId === item.coverImage.id}
                baseWidth={imageSize}
                                isComparisonFirst={false}
                                cardRef={createCardRef(item.id)}
                                isMarkedBest={markedBestIds?.has(item.coverImage.id)}
                                isMarkedArchived={markedArchivedIds?.has(item.coverImage.id)}
                                isBlurred={isSensitive && enableSafeMode && blurSensitiveImages}
                            />
                            {/* Low prominence Stack Badge */}
                            <div className="absolute top-2 right-2 bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-full shadow-lg z-20 border border-blue-400">
                                +{item.count}
                            </div>
                            <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] font-mono px-1.5 py-0.5 rounded backdrop-blur-sm z-20 pointer-events-none">
                                Stack
                            </div>
                        </div>
                    </div>
                );
            }

            const image = item;
            const isFocused = focusedImageIndex === index;
            const isSensitive = enableSafeMode &&
              sensitiveTagSet.size > 0 &&
              !!image.tags?.some(tag => sensitiveTagSet.has(tag.toLowerCase()));

            return (
              <ImageCard
                key={image.id}
                image={image}
                onImageClick={onImageClick}
                isSelected={selectedImages.has(image.id)}
                isFocused={isFocused}
                onImageLoad={handleImageLoad}
                onContextMenu={handleContextMenu}
                onRenameRequest={openInlineRename}
                onRenameComplete={closeInlineRename}
                isRenaming={renamingImageId === image.id}
                baseWidth={imageSize}
                isComparisonFirst={queuedComparisonFirstImageId === image.id}
                cardRef={createCardRef(image.id)}
                isMarkedBest={markedBestIds?.has(image.id)}
                isMarkedArchived={markedArchivedIds?.has(image.id)}
                isBlurred={isSensitive && enableSafeMode && blurSensitiveImages}
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

        {contextMenuContent}
        {modalsContent}
      </div>
    </div>
    </React.Profiler>
  );
};

export default ImageGrid;
