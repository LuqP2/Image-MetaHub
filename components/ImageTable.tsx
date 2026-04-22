import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { type IndexedImage, type Directory, SmartCollection } from '../types';
import { useContextMenu } from '../hooks/useContextMenu';
import { useImageStore } from '../store/useImageStore';
import { Copy, Folder, Download, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, Info, Package, Play, Music, RefreshCw, Star, Pencil } from 'lucide-react';
import { useThumbnail } from '../hooks/useThumbnail';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import ProBadge from './ProBadge';
import TransferImagesModal, { type TransferDestination } from './TransferImagesModal';
import { transferIndexedImages } from '../services/fileTransferService';
import { RATING_VALUES, RatingValueIcons, getRatingBadgeClasses, getRatingChipClasses, getRatingLabel } from './RatingStars';
import { getContextMenuRatingTargetIds } from '../utils/ratingSelection';
import { useReparseMetadata } from '../hooks/useReparseMetadata';
import CollectionFormModal, { CollectionFormValues } from './CollectionFormModal';
import RenameImageModal from './RenameImageModal';
import { isAudioFileName, isVideoFileName } from '../utils/mediaTypes.js';

interface ImageTableProps {
  images: IndexedImage[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
  onBatchExport: () => void;
  activeCollection?: SmartCollection | null;
  isCollectionsView?: boolean;
  onImageRenamed?: (oldImageId: string, newImageId: string) => void;
}

type SortField = 'filename' | 'model' | 'steps' | 'cfg' | 'size' | 'seed';
type SortDirection = 'asc' | 'desc' | null;

const getRelativeImagePath = (image: IndexedImage): string => {
  const [, relativePath = ''] = image.id.split('::');
  return relativePath || image.name;
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

const ImageTable: React.FC<ImageTableProps> = ({
  images,
  onImageClick,
  selectedImages,
  onBatchExport,
  activeCollection = null,
  isCollectionsView = false,
  onImageRenamed,
}) => {
  const directories = useImageStore((state) => state.directories);
  const transferProgress = useImageStore((state) => state.transferProgress);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [sortedImages, setSortedImages] = useState<IndexedImage[]>(images);
  const [transferMode, setTransferMode] = useState<'copy' | 'move' | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isCopySubmenuOpen, setIsCopySubmenuOpen] = useState(false);
  const [isCollectionSubmenuOpen, setIsCollectionSubmenuOpen] = useState(false);
  const [isAddToCollectionSubmenuOpen, setIsAddToCollectionSubmenuOpen] = useState(false);
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
  const [renameImage, setRenameImage] = useState<IndexedImage | null>(null);
  const [transferStatusText, setTransferStatusText] = useState<string>('');
  const bulkSetImageRating = useImageStore((state) => state.bulkSetImageRating);
  const collections = useImageStore((state) => state.collections);
  const createCollection = useImageStore((state) => state.createCollection);
  const addImagesToCollection = useImageStore((state) => state.addImagesToCollection);
  const removeImagesFromCollection = useImageStore((state) => state.removeImagesFromCollection);
  const updateCollection = useImageStore((state) => state.updateCollection);
  const { canUseFileManagement, showProModal, initialized, canUseDuringTrialOrPro } = useFeatureAccess();
  const { isReparsing, reparseImages } = useReparseMetadata();

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
    copyRawMetadata
  } = useContextMenu();

  const submenuHorizontalClass = contextMenu.horizontalDirection === 'left' ? 'right-full' : 'left-full';

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

  const selectedCount = selectedImages.size;

  const handleContextMenu = (image: IndexedImage, e: React.MouseEvent) => {
    const directoryPath = directories.find(d => d.id === image.directoryId)?.path;
    showContextMenu(e, image, directoryPath);
  };

  const handleBatchExport = () => {
    hideContextMenu();
    onBatchExport();
  };

  const getContextTargetImages = useCallback(() => {
    if (!contextMenu.image) {
      return [];
    }

    if (selectedImages.has(contextMenu.image.id)) {
      return images.filter((image) => selectedImages.has(image.id));
    }

    return [contextMenu.image];
  }, [contextMenu.image, images, selectedImages]);

  const handleSetRating = useCallback((rating: 1 | 2 | 3 | 4 | 5 | null) => {
    const targetImageIds = getContextMenuRatingTargetIds(selectedImages, contextMenu.image?.id);
    if (!targetImageIds.length) {
      hideContextMenu();
      return;
    }

    bulkSetImageRating(targetImageIds, rating);
    hideContextMenu();
  }, [bulkSetImageRating, contextMenu.image?.id, hideContextMenu, selectedImages]);

  const handleAddToExistingCollection = useCallback(async (collection: SmartCollection) => {
    const targetImages = getContextTargetImages();
    if (!targetImages.length) {
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
    if (!targetImages.length) {
      hideContextMenu();
      return;
    }

    await removeImagesFromCollection(activeCollection.id, targetImages.map((image) => image.id));

    hideContextMenu();
  }, [activeCollection, getContextTargetImages, hideContextMenu, removeImagesFromCollection]);

  const handleReparseMetadata = useCallback(async () => {
    const targetImages = getContextTargetImages();
    if (!targetImages.length) {
      hideContextMenu();
      return;
    }

    hideContextMenu();
    await reparseImages(targetImages);
  }, [getContextTargetImages, hideContextMenu, reparseImages]);

  const openTransferModal = useCallback((mode: 'copy' | 'move') => {
    const targetImages = getContextTargetImages();
    if (!targetImages.length) {
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

  const openRenameModal = useCallback((image: IndexedImage | null | undefined) => {
    if (!image) {
      hideContextMenu();
      return;
    }
    if (!canUseFileManagement) {
      showProModal('file_management');
      hideContextMenu();
      return;
    }

    setRenameImage(image);
    hideContextMenu();
  }, [canUseFileManagement, hideContextMenu, showProModal]);

  const handleTransferConfirm = useCallback(async (directory: TransferDestination) => {
    if (!transferMode) {
      return;
    }

    const targetImages = getContextTargetImages();
    if (!targetImages.length) {
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

  // Function to apply sorting based on current field and direction
  // Memoized for performance - avoids recreating sort function on every render
  const applySorting = useCallback((imagesToSort: IndexedImage[], field: SortField | null, direction: SortDirection) => {
    if (!field || !direction) {
      return imagesToSort;
    }

    return [...imagesToSort].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (field) {
        case 'filename':
          aValue = a.handle.name.toLowerCase();
          bValue = b.handle.name.toLowerCase();
          break;
        case 'model':
          aValue = (a.models?.[0] || '').toLowerCase();
          bValue = (b.models?.[0] || '').toLowerCase();
          break;
        case 'steps': {
          const aSteps = a.steps || (a.metadata as any)?.steps || (a.metadata as any)?.normalizedMetadata?.steps || 0;
          const bSteps = b.steps || (b.metadata as any)?.steps || (b.metadata as any)?.normalizedMetadata?.steps || 0;
          aValue = aSteps;
          bValue = bSteps;
          break;
        }
        case 'cfg': {
          const aCfg = a.cfgScale || (a.metadata as any)?.cfg_scale || (a.metadata as any)?.cfgScale || (a.metadata as any)?.normalizedMetadata?.cfg_scale || 0;
          const bCfg = b.cfgScale || (b.metadata as any)?.cfg_scale || (b.metadata as any)?.cfgScale || (b.metadata as any)?.normalizedMetadata?.cfg_scale || 0;
          aValue = aCfg;
          bValue = bCfg;
          break;
        }
        case 'size': {
          const aDims = a.dimensions || (a.metadata as any)?.dimensions || '0x0';
          const bDims = b.dimensions || (b.metadata as any)?.dimensions || '0x0';
          const [aW, aH] = aDims.split('×').map(Number);
          const [bW, bH] = bDims.split('×').map(Number);
          aValue = aW * aH;
          bValue = bW * bH;
          break;
        }
        case 'seed': {
          const aSeed = a.seed || (a.metadata as any)?.seed || (a.metadata as any)?.normalizedMetadata?.seed || 0;
          const bSeed = b.seed || (b.metadata as any)?.seed || (b.metadata as any)?.normalizedMetadata?.seed || 0;
          aValue = aSeed;
          bValue = bSeed;
          break;
        }
        default:
          return 0;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return direction === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      } else {
        return direction === 'asc' ? (aValue as number) - (bValue as number) : (bValue as number) - (aValue as number);
      }
    });
  }, []); // No dependencies - pure function

  const handleSort = (field: SortField) => {
    let newDirection: SortDirection = 'asc';
    
    if (sortField === field) {
      if (sortDirection === 'asc') {
        newDirection = 'desc';
      } else if (sortDirection === 'desc') {
        newDirection = null;
        setSortField(null);
        setSortDirection(null);
        return;
      }
    }
    
    setSortField(field);
    setSortDirection(newDirection);
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    }
    if (sortDirection === 'asc') {
      return <ArrowUp className="w-3 h-3" />;
    }
    return <ArrowDown className="w-3 h-3" />;
  };

  // Update sorted images when images prop changes OR when sort settings change
  useEffect(() => {
    const sorted = applySorting(images, sortField, sortDirection);
    setSortedImages(sorted);
  }, [images, sortField, sortDirection, applySorting]);

  const columnWidths = [
    '96px', // Preview
    '280px', // Filename
    '220px', // Model
    '110px', // Steps
    '110px', // CFG
    '140px', // Size
    '160px', // Seed
  ];

  const gridTemplateColumns = columnWidths.join(' ');

  // Row renderer for virtualized list
  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const image = sortedImages[index];
    return (
      <div style={style}>
        <ImageTableRow
          image={image}
          onImageClick={onImageClick}
          isSelected={selectedImages.has(image.id)}
          onContextMenu={handleContextMenu}
          gridTemplateColumns={gridTemplateColumns}
        />
      </div>
    );
  };

  const ROW_HEIGHT = 64; // Height of each table row in pixels
  const HEADER_HEIGHT = 48; // Height of table header

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[1100px]">
          {/* Fixed Header */}
          <div className="bg-gray-800 border-b border-gray-700" style={{ height: HEADER_HEIGHT }}>
            <div className="grid text-sm" style={{ gridTemplateColumns }}>
              <div className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Preview</div>
              <button
                className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors flex items-center gap-1 text-left"
                onClick={() => handleSort('filename')}
              >
                <span className="flex items-center gap-1">Filename {getSortIcon('filename')}</span>
              </button>
              <button
                className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors flex items-center gap-1 text-left"
                onClick={() => handleSort('model')}
              >
                <span className="flex items-center gap-1">Model {getSortIcon('model')}</span>
              </button>
              <button
                className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors flex items-center gap-1 text-left"
                onClick={() => handleSort('steps')}
              >
                <span className="flex items-center gap-1">Steps {getSortIcon('steps')}</span>
              </button>
              <button
                className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors flex items-center gap-1 text-left"
                onClick={() => handleSort('cfg')}
              >
                <span className="flex items-center gap-1">CFG {getSortIcon('cfg')}</span>
              </button>
              <button
                className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors flex items-center gap-1 text-left"
                onClick={() => handleSort('size')}
              >
                <span className="flex items-center gap-1">Size {getSortIcon('size')}</span>
              </button>
              <button
                className="px-3 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-700/50 transition-colors flex items-center gap-1 text-left"
                onClick={() => handleSort('seed')}
              >
                <span className="flex items-center gap-1">Seed {getSortIcon('seed')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Virtualized Content */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-x-auto">
          <div className="min-w-[1100px] h-full">
            <AutoSizer>
              {({ height, width }: { height: number; width: number }) => (
                <List
                  height={height}
                  itemCount={sortedImages.length}
                  itemSize={ROW_HEIGHT}
                  width={width}
                  overscanCount={5}
                  itemKey={(index) => sortedImages[index]?.id ?? index}
                >
                  {Row}
                </List>
              )}
            </AutoSizer>
          </div>
        </div>
      </div>

      {contextMenu.visible && typeof document !== 'undefined' &&
        createPortal(
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
                  disabled={!contextMenu.image?.prompt}
                >
                  Prompt
                </button>
                <button
                  onClick={copyNegativePrompt}
                  className="w-full px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                  disabled={!contextMenu.image?.negativePrompt}
                >
                  Negative Prompt
                </button>
                <button
                  onClick={copySeed}
                  className="w-full px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                  disabled={!contextMenu.image?.seed}
                >
                  Seed
                </button>
                <button
                  onClick={copyModel}
                  className="w-full px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                  disabled={!contextMenu.image?.models?.[0]}
                >
                  Checkpoint
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-gray-600 my-1"></div>

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
            onClick={() => openRenameModal(contextMenu.image)}
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
              >
                <Package className="w-4 h-4" />
                Batch Export Selected ({selectedCount})
              </button>
            )}
          </div>,
          document.body,
        )}

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

      <RenameImageModal
        isOpen={!!renameImage}
        image={renameImage}
        onClose={() => setRenameImage(null)}
        onRenamed={({ oldImageId, newImageId }) => onImageRenamed?.(oldImageId, newImageId)}
      />
    </div>
  );
};

// Componente separado para cada linha da tabela com preview
interface ImageTableRowProps {
  image: IndexedImage;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  isSelected: boolean;
  onContextMenu?: (image: IndexedImage, event: React.MouseEvent) => void;
  gridTemplateColumns: string;
}

const ImageTableRow: React.FC<ImageTableRowProps> = React.memo(({ image, onImageClick, isSelected, onContextMenu, gridTemplateColumns }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const thumbnail = useResolvedThumbnail(image);
  const setPreviewImage = useImageStore((state) => state.setPreviewImage);
  const directories = useImageStore((state) => state.directories);
  const thumbnailsDisabled = useSettingsStore((state) => state.disableThumbnails);
  const showFullFilePath = useSettingsStore((state) => state.showFullFilePath);
  const isVideo = isVideoFileName(image.name, image.fileType);
  const isAudio = isAudioFileName(image.name, image.fileType);
  const audioDuration = formatAudioDuration((image.metadata as any)?.normalizedMetadata?.audio?.duration_seconds);
  const relativeImagePath = getRelativeImagePath(image);
  const directoryPath = directories.find((dir) => dir.id === image.directoryId)?.path || '';
  const fullImagePath = joinDisplayPath(directoryPath, relativeImagePath);
  const displayName = showFullFilePath ? fullImagePath : image.handle.name;

  useThumbnail(image);

  useEffect(() => {
    if (thumbnailsDisabled) {
      setImageUrl(null);
      setIsLoading(false);
      return;
    }

    if (thumbnail?.thumbnailStatus === 'ready' && thumbnail.thumbnailUrl) {
      setImageUrl(thumbnail.thumbnailUrl);
      setIsLoading(false);
      return;
    }

    if (isVideo || isAudio) {
      setImageUrl(null);
      setIsLoading(false);
      return;
    }

    if (thumbnail?.thumbnailStatus === 'error') {
      setImageUrl(null);
      setIsLoading(false);
      return;
    }

    setImageUrl(null);
    setIsLoading(true);
  }, [thumbnail?.thumbnailHandle, image.handle, thumbnail?.thumbnailStatus, thumbnail?.thumbnailUrl, thumbnailsDisabled, isVideo, isAudio]);

  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewImage(image);
  };

  return (
    <div
      className={`border-b border-gray-700 hover:bg-gray-800/50 cursor-pointer transition-colors group grid items-center ${
        isSelected ? 'bg-blue-900/30 border-blue-700' : ''
      }`}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={(e) => onImageClick(image, e)}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          onImageClick(image, e);
        }
      }}
      onContextMenu={(e) => onContextMenu && onContextMenu(image, e)}
      style={{ height: '64px', gridTemplateColumns }}
    >
      <div className="px-3 py-2">
        <div className={`relative flex h-12 w-12 items-center justify-center overflow-hidden rounded ${
          image.hasAlpha && !isAudio && !isVideo ? 'image-alpha-grid' : 'bg-gray-700'
        }`}>
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
          ) : isAudio ? (
            <>
              <div className="flex h-full w-full flex-col items-center justify-center bg-gray-900 text-cyan-200">
                <Music className="h-5 w-5" />
                {audioDuration && (
                  <span className="mt-0.5 font-mono text-[9px] text-gray-300">{audioDuration}</span>
                )}
              </div>
              <button
                onClick={handlePreviewClick}
                className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-500/70"
                title="Show details"
              >
                <Info className="h-4 w-4 text-white" />
              </button>
            </>
          ) : imageUrl ? (
            <>
              <img
                src={imageUrl}
                alt={image.handle.name}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {image.rating && (
                <div className={`absolute right-1 top-1 rounded border px-1 py-0.5 ${getRatingBadgeClasses(image.rating)}`}>
                  <RatingValueIcons value={image.rating} size={6} className="text-current" starClassName="fill-current" />
                </div>
              )}
              {isVideo && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="rounded-full bg-black/50 p-1.5">
                    <Play className="h-4 w-4 text-white/90" />
                  </div>
                </div>
              )}
              <button
                onClick={handlePreviewClick}
                className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-500/70"
                title="Show details"
              >
                <Info className="h-4 w-4 text-white" />
              </button>
            </>
          ) : (
            <span className="text-xs text-gray-500">ERR</span>
          )}
        </div>
      </div>
      <div className="px-3 py-2 text-gray-300 font-medium truncate" title={displayName}>
        {displayName}
      </div>
      <div className="px-3 py-2 text-gray-400 truncate" title={image.models?.[0] || 'Unknown'}>
        {image.models?.[0] || <span className="text-gray-600">Unknown</span>}
      </div>
      <div className="px-3 py-2 text-center">
        {(() => {
          const steps = image.steps || (image.metadata as any)?.steps || (image.metadata as any)?.normalizedMetadata?.steps;
          return steps ? (
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              steps < 20 ? 'bg-green-900/40 text-green-300' :
              steps < 35 ? 'bg-blue-900/40 text-blue-300' :
              'bg-orange-900/40 text-orange-300'
            }`}>
              {steps}
            </span>
          ) : (
            <span className="text-gray-600 text-xs">—</span>
          );
        })()}
      </div>
      <div className="px-3 py-2 text-center text-gray-400">
        {(() => {
          const cfg = image.cfgScale || (image.metadata as any)?.cfg_scale || (image.metadata as any)?.cfgScale || (image.metadata as any)?.normalizedMetadata?.cfg_scale;
          return cfg ? (
            <span className="font-mono text-sm">{typeof cfg === 'number' ? cfg.toFixed(1) : cfg}</span>
          ) : (
            <span className="text-gray-600 text-xs">—</span>
          );
        })()}
      </div>
      <div className="px-3 py-2 text-gray-400 font-mono text-xs">
        {(() => {
          const dims = image.dimensions ||
                      (image.metadata as any)?.dimensions ||
                      ((image.metadata as any)?.width && (image.metadata as any)?.height 
                        ? `${(image.metadata as any).width}×${(image.metadata as any).height}` 
                        : null);
          return dims || <span className="text-gray-600">—</span>;
        })()}
      </div>
      <div className="px-3 py-2 text-gray-500 font-mono text-xs truncate" title={(image.seed || (image.metadata as any)?.seed || (image.metadata as any)?.normalizedMetadata?.seed)?.toString()}>
        {(() => {
          const seed = image.seed || (image.metadata as any)?.seed || (image.metadata as any)?.normalizedMetadata?.seed;
          return seed || <span className="text-gray-600">—</span>;
        })()}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for performance - only re-render if critical props changed
  return (
    prevProps.image.id === nextProps.image.id &&
    prevProps.image.thumbnailUrl === nextProps.image.thumbnailUrl &&
    prevProps.image.thumbnailStatus === nextProps.image.thumbnailStatus &&
    prevProps.image.rating === nextProps.image.rating &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.gridTemplateColumns === nextProps.gridTemplateColumns
  );
});

export default ImageTable;
