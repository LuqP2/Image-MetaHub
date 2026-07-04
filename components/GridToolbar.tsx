import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Copy,
  Folder,
  Download,
  Heart,
  GitCompare,
  Sparkles,
  Trash2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Tag,
  RefreshCw,
  Plus,
  Play,
  Workflow,
  Image as ImageIcon,
  X,
  Search,
  CheckCircle
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useImageStore } from '../store/useImageStore';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { copyImageToClipboard, showInExplorer } from '../utils/imageUtils';
import { getFileExtension, isAudioFileName, isVideoFileName } from '../utils/mediaTypes.js';
import { SmartCollection, type IndexedImage } from '../types';

import ActiveFilters from './ActiveFilters';
import TagManagerModal from './TagManagerModal';
import { useReparseMetadata } from '../hooks/useReparseMetadata';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import Tooltip from './Tooltip';
import ProBadge from './ProBadge';
import type { ImageGroup, ImageGroupByMode } from '../utils/imageGrouping';

const OPEN_BATCH_EXPORT_EVENT = 'imagemetahub:open-batch-export';

const canOpenImageEditorForImage = (image?: IndexedImage): boolean => (
  Boolean(image)
  && !isVideoFileName(image!.name, image!.fileType)
  && !isAudioFileName(image!.name, image!.fileType)
  && getFileExtension(image!.name) !== '.gif'
);

interface GridToolbarProps {

  selectedImages: Set<string>;
  images: IndexedImage[];
  directories: { id: string; path: string }[];
  onCreateCollectionFromFiltered?: () => void;
  onAddCurrentFilteredToCollection?: (collectionId: string) => Promise<void> | void;
  filteredImageActionCount?: number;
  onDeleteSelected: () => void;
  onGenerateA1111: (image: IndexedImage) => void;
  onGenerateComfyUI: (image: IndexedImage) => void;
  onOpenComfyUIWorkspace?: (image: IndexedImage) => void;
  onOpenImageEditor?: (image: IndexedImage) => void;
  onCompare: (images: IndexedImage[]) => void;
  onBatchExport: () => void;
  onStartSlideshow: () => void;
  slideshowImageCount: number;
  slideshowSourceLabel?: string;
  groups?: ImageGroup[];
  groupBy?: ImageGroupByMode;
  onJumpToGroup?: (groupId: string) => void;
  onClearAllFilters?: () => void;
}

const formatCalendarDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getGroupDateKey = (group: ImageGroup): string | null => {
  if (group.dateKey) {
    return group.dateKey;
  }
  if (typeof group.startTime === 'number') {
    return formatCalendarDateKey(new Date(group.startTime));
  }
  return null;
};

const sameCalendarMonth = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();

interface PreviewPosition {
  x: number;
  y: number;
}

const GROUP_JUMP_PREVIEW_SIZE = 176;
const GROUP_JUMP_PREVIEW_OFFSET = 16;

const getGroupJumpPreviewPosition = (event: React.MouseEvent): PreviewPosition => ({
  x: Math.max(
    GROUP_JUMP_PREVIEW_OFFSET,
    Math.min(event.clientX + GROUP_JUMP_PREVIEW_OFFSET, window.innerWidth - GROUP_JUMP_PREVIEW_SIZE - GROUP_JUMP_PREVIEW_OFFSET),
  ),
  y: Math.max(
    GROUP_JUMP_PREVIEW_OFFSET,
    Math.min(event.clientY + GROUP_JUMP_PREVIEW_OFFSET, window.innerHeight - GROUP_JUMP_PREVIEW_SIZE - GROUP_JUMP_PREVIEW_OFFSET),
  ),
});

const GroupJumpThumbnailPreview: React.FC<{ image?: IndexedImage; position?: PreviewPosition | null }> = ({ image, position }) => {
  const thumbnail = useResolvedThumbnail(image ?? null);
  const thumbnailUrl = thumbnail?.thumbnailUrl ?? image?.thumbnailUrl ?? null;

  return (
    <div
      className={`pointer-events-none z-[60] h-44 w-44 overflow-hidden rounded-lg border border-gray-600 bg-gray-900 shadow-2xl shadow-black/50 ${
        position ? 'fixed' : 'absolute left-full top-3 ml-2'
      }`}
      style={position ? { left: position.x, top: position.y } : undefined}
    >
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-2xl font-medium text-gray-500">
          {image?.name?.charAt(0).toUpperCase() || '-'}
        </div>
      )}
    </div>
  );
};

const GroupJumpThumbnail: React.FC<{ image?: IndexedImage }> = ({ image }) => {
  const thumbnail = useResolvedThumbnail(image ?? null);
  const thumbnailUrl = thumbnail?.thumbnailUrl ?? image?.thumbnailUrl ?? null;

  return (
    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-gray-700 bg-gray-900">
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-gray-500">
          {image?.name?.charAt(0).toUpperCase() || '-'}
        </div>
      )}
    </div>
  );
};

interface GroupJumpMenuItemProps {
  group: ImageGroup;
  image?: IndexedImage;
  onHover: (groupId: string) => void;
  onPreviewMove: (groupId: string, event: React.MouseEvent) => void;
  onPreviewLeave: () => void;
  onSelect: (groupId: string) => void;
}

const GroupJumpMenuItem: React.FC<GroupJumpMenuItemProps> = ({
  group,
  image,
  onHover,
  onPreviewMove,
  onPreviewLeave,
  onSelect,
}) => (
  <button
    onMouseEnter={(event) => onPreviewMove(group.id, event)}
    onMouseMove={(event) => onPreviewMove(group.id, event)}
    onMouseLeave={onPreviewLeave}
    onFocus={() => onHover(group.id)}
    onClick={() => onSelect(group.id)}
    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
  >
    <span className="flex min-w-0 items-center gap-3">
      <GroupJumpThumbnail image={image} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{group.label}</span>
        {group.subtitle && (
          <span className="block truncate text-xs text-gray-400">{group.subtitle}</span>
        )}
      </span>
    </span>
    <span className="shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300">{group.count}</span>
  </button>
);

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
  onCreateCollectionFromFiltered,
  onAddCurrentFilteredToCollection,
  filteredImageActionCount = 0,
  onDeleteSelected,
  onGenerateA1111,
  onGenerateComfyUI,
  onOpenComfyUIWorkspace,
  onOpenImageEditor,
  onCompare,
  onBatchExport,
  onStartSlideshow,
  slideshowImageCount,
  slideshowSourceLabel = 'current view',
  groups = [],
  groupBy = 'none',
  onJumpToGroup,
  onClearAllFilters,
}) => {
  const [generateDropdownOpen, setGenerateDropdownOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isCollectionActionsOpen, setIsCollectionActionsOpen] = useState(false);
  const [isAddToCollectionSubmenuOpen, setIsAddToCollectionSubmenuOpen] = useState(false);
  const [isJumpMenuOpen, setIsJumpMenuOpen] = useState(false);
  const [jumpQuery, setJumpQuery] = useState('');
  const [selectedJumpDateKey, setSelectedJumpDateKey] = useState<string | null>(null);
  const [jumpCalendarMonth, setJumpCalendarMonth] = useState(() => new Date());
  const [previewJumpGroupId, setPreviewJumpGroupId] = useState<string | null>(null);
  const [previewJumpPosition, setPreviewJumpPosition] = useState<PreviewPosition | null>(null);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const collectionActionsRef = useRef<HTMLDivElement>(null);
  const jumpMenuRef = useRef<HTMLDivElement>(null);
  const bulkToggleFavorite = useImageStore((state) => state.bulkToggleFavorite);
  const clearImageSelection = useImageStore((state) => state.clearImageSelection);
  const collections = useImageStore((state) => state.collections);
  const allImages = useImageStore((state) => state.images);
  const { canUseComparison, canUseA1111, canUseComfyUI, canUseImageEditor, showProModal, canUseBulkTagging, initialized, canUseDuringTrialOrPro } = useFeatureAccess();
  const { isReparsing, reparseImages } = useReparseMetadata();


  // ... (rest of the file)

  const selectedCount = selectedImages.size;
  const selectedImagesList = useMemo(() => {
    if (selectedImages.size === 0) {
      return [];
    }

    // Optimization: Avoid intermediate array allocation for map creation
    const pageLookup = new Map<string, IndexedImage>();
    for (const image of images) {
      pageLookup.set(image.id, image);
    }
    const storeImages = useImageStore.getState().images;

    return Array.from(selectedImages)
      .map((imageId) => pageLookup.get(imageId) ?? storeImages.find((image) => image.id === imageId))
      .filter((image): image is IndexedImage => Boolean(image));
  }, [images, selectedImages]);
  const firstSelectedImage = selectedImagesList[0];
  const canOpenSelectedImageEditor = Boolean(
    selectedCount === 1 &&
    onOpenImageEditor &&
    canOpenImageEditorForImage(firstSelectedImage),
  );
  const editImageTooltip = selectedCount === 1
    ? (canOpenSelectedImageEditor ? 'Edit image' : 'Image editor is available for static images')
    : 'Select one image to edit';
  // Check if all selected images are favorites
  const allFavorites = selectedImagesList.length > 0 && selectedImagesList.every(img => img.isFavorite);

  const closeJumpMenu = useCallback(() => {
    setIsJumpMenuOpen(false);
    setPreviewJumpGroupId(null);
    setPreviewJumpPosition(null);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setGenerateDropdownOpen(false);
      }
      if (collectionActionsRef.current && !collectionActionsRef.current.contains(event.target as Node)) {
        setIsCollectionActionsOpen(false);
        setIsAddToCollectionSubmenuOpen(false);
      }
      if (jumpMenuRef.current && !jumpMenuRef.current.contains(event.target as Node)) {
        closeJumpMenu();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeJumpMenu]);

  const handleCopyToClipboard = async () => {
    if (!firstSelectedImage) return;
    const result = await copyImageToClipboard(firstSelectedImage);
    if (result.success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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

  const handleExport = () => {
    if (selectedCount === 1 && firstSelectedImage) {
      window.dispatchEvent(new CustomEvent(OPEN_BATCH_EXPORT_EVENT, {
        detail: {
          imageIds: [firstSelectedImage.id],
          preferredSource: 'selected',
        },
      }));
      return;
    }

    onBatchExport();
  };

  const handleToggleFavorites = () => {
    if (selectedImagesList.length === 0) return;

    const nextFavoriteState = !allFavorites;
    void bulkToggleFavorite(
      selectedImagesList.map((img) => img.id),
      nextFavoriteState,
    );
  };

  const handleCompare = () => {
    if (!canUseComparison) {
      showProModal('comparison');
      return;
    }
    if (selectedImagesList.length >= 2 && selectedImagesList.length <= 4) {
      onCompare(selectedImagesList.slice(0, 4));
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

  const handleOpenComfyUIWorkspace = () => {
    if (!canUseComfyUI) {
      showProModal('comfyui');
      setGenerateDropdownOpen(false);
      return;
    }
    if (firstSelectedImage && onOpenComfyUIWorkspace) {
      onOpenComfyUIWorkspace(firstSelectedImage);
    }
    setGenerateDropdownOpen(false);
  };

  const handleOpenImageEditor = () => {
    if (firstSelectedImage && canOpenSelectedImageEditor && onOpenImageEditor) {
      if (!canUseImageEditor) {
        showProModal('image_editor');
        return;
      }
      onOpenImageEditor(firstSelectedImage);
    }
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
  const canUseFilteredCollectionActions =
    filteredImageActionCount > 0 &&
    (Boolean(onCreateCollectionFromFiltered) || Boolean(onAddCurrentFilteredToCollection));
  const canJumpToGroups = groups.length > 0 && Boolean(onJumpToGroup);
  const jumpImageLookup = useMemo(() => {
    const lookup = new Map<string, IndexedImage>();
    for (const image of allImages) {
      lookup.set(image.id, image);
    }
    for (const image of images) {
      lookup.set(image.id, image);
    }
    return lookup;
  }, [allImages, images]);
  const useCalendarJump = groupBy === 'date' || groupBy === 'session';
  const groupsByDate = useMemo(() => {
    const next = new Map<string, ImageGroup[]>();
    for (const group of groups) {
      const key = getGroupDateKey(group);
      if (!key) {
        continue;
      }
      const dateGroups = next.get(key) ?? [];
      dateGroups.push(group);
      next.set(key, dateGroups);
    }
    return next;
  }, [groups]);
  const calendarDateKeys = useMemo(() => Array.from(groupsByDate.keys()).sort(), [groupsByDate]);
  const activeJumpDateKey = selectedJumpDateKey && groupsByDate.has(selectedJumpDateKey)
    ? selectedJumpDateKey
    : calendarDateKeys[0] ?? null;
  const calendarGroups = activeJumpDateKey ? groupsByDate.get(activeJumpDateKey) ?? [] : [];
  const calendarMonthDays = useMemo(() => {
    const monthStart = new Date(jumpCalendarMonth.getFullYear(), jumpCalendarMonth.getMonth(), 1);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return date;
    });
  }, [jumpCalendarMonth]);
  const visibleJumpGroups = useMemo(() => {
    const normalizedQuery = jumpQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return groups;
    }

    return groups.filter((group) =>
      `${group.label} ${group.subtitle ?? ''}`.toLowerCase().includes(normalizedQuery)
    );
  }, [groups, jumpQuery]);
  const previewJumpGroup = previewJumpGroupId
    ? groups.find((group) => group.id === previewJumpGroupId)
    : undefined;
  const previewJumpImage = previewJumpGroup
    ? jumpImageLookup.get(previewJumpGroup.thumbnailImageId ?? previewJumpGroup.startImageId)
    : undefined;
  const handleJumpGroupHover = (groupId: string) => {
    setPreviewJumpGroupId(groupId);
    setPreviewJumpPosition(null);
  };
  const handleJumpGroupPreviewMove = (groupId: string, event: React.MouseEvent) => {
    setPreviewJumpGroupId(groupId);
    setPreviewJumpPosition(getGroupJumpPreviewPosition(event));
  };
  const handleJumpGroupPreviewLeave = () => {
    setPreviewJumpGroupId(null);
    setPreviewJumpPosition(null);
  };
  const getJumpGroupImage = (group: ImageGroup) =>
    jumpImageLookup.get(group.thumbnailImageId ?? group.startImageId);

  useEffect(() => {
    if (!isJumpMenuOpen || !useCalendarJump || calendarDateKeys.length === 0) {
      return;
    }

    const targetKey = activeJumpDateKey ?? calendarDateKeys[0];
    if (!targetKey) {
      return;
    }

    const [year, monthIndex, day] = targetKey.split('-').map(Number);
    const targetDate = new Date(year, monthIndex - 1, day || 1);
    if (!sameCalendarMonth(jumpCalendarMonth, targetDate)) {
      setJumpCalendarMonth(targetDate);
    }
    if (selectedJumpDateKey !== targetKey) {
      setSelectedJumpDateKey(targetKey);
    }
  }, [activeJumpDateKey, calendarDateKeys, isJumpMenuOpen, jumpCalendarMonth, selectedJumpDateKey, useCalendarJump]);

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

  if (selectedCount === 0 && !hasActiveFilters && !canUseFilteredCollectionActions && slideshowImageCount === 0 && !canJumpToGroups) {
    return null;
  }

  const handleAddToCollection = async (collection: SmartCollection) => {
    if (!onAddCurrentFilteredToCollection) {
      return;
    }

    await onAddCurrentFilteredToCollection(collection.id);
    setIsCollectionActionsOpen(false);
    setIsAddToCollectionSubmenuOpen(false);
  };

  const handleCreateCollectionFromFiltered = () => {
    onCreateCollectionFromFiltered?.();
    setIsCollectionActionsOpen(false);
    setIsAddToCollectionSubmenuOpen(false);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-1 px-5 min-h-[36px]">
        {/* Selection Context Toolbar - Centered or justified as needed */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
            {slideshowImageCount > 0 && (
              <>
                <Tooltip label={`Start slideshow from ${slideshowSourceLabel} (${slideshowImageCount} item${slideshowImageCount === 1 ? '' : 's'})`}>
                  <motion.button
                    onClick={onStartSlideshow}
                    whileTap={{ scale: 0.85 }}
                    className="p-1.5 text-gray-400 hover:text-blue-300 hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label="Start slideshow"
                  >
                    <Play className="w-4 h-4" />
                  </motion.button>
                </Tooltip>
                {(selectedCount > 0 || hasActiveFilters || canUseFilteredCollectionActions) && (
                  <div className="w-px h-4 bg-gray-700 mx-1" />
                )}
              </>
            )}

            {selectedCount > 0 && (
              <>
                <span className="text-[11px] text-gray-400 mr-2 whitespace-nowrap">{selectedCount} selected</span>

                <Tooltip label="Clear selection">
                  <motion.button
                    onClick={clearImageSelection}
                    whileTap={{ scale: 0.85 }}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label="Clear selection"
                  >
                    <X className="w-4 h-4" />
                  </motion.button>
                </Tooltip>

                {/* Copy to Clipboard */}
                <Tooltip label={copied ? 'Copied!' : 'Copy to Clipboard'}>
                  <motion.button
                    onClick={handleCopyToClipboard}
                    whileTap={{ scale: 0.85 }}
                    className={`p-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      copied ? 'text-green-400' : 'text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                    aria-label={copied ? 'Copied!' : 'Copy to Clipboard'}
                    disabled={selectedCount !== 1}
                  >
                    {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </motion.button>
                </Tooltip>

                {/* Show in Folder */}
                <Tooltip label="Show in Folder">
                  <motion.button
                    onClick={handleShowInFolder}
                    whileTap={{ scale: 0.85 }}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label="Show in Folder"
                    disabled={selectedCount !== 1}
                  >
                    <Folder className="w-4 h-4" />
                  </motion.button>
                </Tooltip>

                {/* Export */}
                <Tooltip label={selectedCount > 1 ? 'Export selected images' : 'Export'}>
                  <motion.button
                    onClick={handleExport}
                    whileTap={{ scale: 0.85 }}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label={selectedCount > 1 ? 'Export selected images' : 'Export'}
                    disabled={selectedCount === 0}
                  >
                    <Download className="w-4 h-4" />
                  </motion.button>
                </Tooltip>

                {/* Favorites */}
                <Tooltip label={allFavorites ? 'Remove from Favorites' : 'Add to Favorites'}>
                  <motion.button
                    onClick={handleToggleFavorites}
                    whileTap={{ scale: 0.85 }}
                    className={`p-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      allFavorites
                        ? 'text-rose-400 hover:text-rose-300 hover:bg-gray-700'
                        : 'text-gray-400 hover:text-rose-400 hover:bg-gray-700'
                    }`}
                    aria-label={allFavorites ? 'Remove from Favorites' : 'Add to Favorites'}
                  >
                    <Heart className={`w-4 h-4 ${allFavorites ? 'fill-current' : ''}`} />
                  </motion.button>
                </Tooltip>

                <Tooltip label={selectedCount === 1 ? 'Reparse metadata' : `Reparse selected (${selectedCount})`}>
                  <motion.button
                    onClick={handleReparseSelected}
                    whileTap={{ scale: 0.85 }}
                    className={`p-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isReparsing
                        ? 'text-cyan-300 bg-cyan-500/10 cursor-wait'
                        : 'text-gray-400 hover:text-cyan-300 hover:bg-gray-700'
                    }`}
                    aria-label={selectedCount === 1 ? 'Reparse metadata' : `Reparse selected (${selectedCount})`}
                    disabled={selectedCount === 0 || isReparsing}
                  >
                    <RefreshCw className={`w-4 h-4 ${isReparsing ? 'animate-spin' : ''}`} />
                  </motion.button>
                </Tooltip>

                 {/* Tagging */}
                 <Tooltip label="Add/Remove Tags">
                   <motion.button
                    onClick={handleTagClick}
                    whileTap={{ scale: 0.85 }}
                    className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label="Add/Remove Tags"
                  >
                    <Tag className="w-4 h-4" />
                  </motion.button>
                </Tooltip>
  
                {/* Divider */}
                <div className="w-px h-4 bg-gray-700 mx-1" />

                {/* Compare */}
                <Tooltip label={canOpenSelectedImageEditor && !canUseImageEditor ? 'Image Editor (Pro Feature) - start trial' : editImageTooltip}>
                  <motion.button
                    onClick={handleOpenImageEditor}
                    whileTap={canOpenSelectedImageEditor ? { scale: 0.85 } : undefined}
                    className={`p-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      canOpenSelectedImageEditor
                        ? 'text-gray-400 hover:text-cyan-300 hover:bg-gray-700'
                        : 'text-gray-600 cursor-not-allowed'
                    }`}
                    aria-label="Edit image"
                    disabled={!canOpenSelectedImageEditor}
                  >
                    <ImageIcon className="w-4 h-4" />
                    {canOpenSelectedImageEditor && !canUseDuringTrialOrPro && initialized && <ProBadge size="sm" />}
                  </motion.button>
                </Tooltip>

                <Tooltip label={selectedCount >= 2 && selectedCount <= 4 ? `Compare ${selectedCount} Images` : 'Select between 2 and 4 images to compare'}>
                  <motion.button
                    onClick={handleCompare}
                    whileTap={selectedCount >= 2 && selectedCount <= 4 ? { scale: 0.85 } : undefined}
                    className={`p-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      selectedCount >= 2 && selectedCount <= 4
                        ? 'text-gray-400 hover:text-purple-400 hover:bg-gray-700'
                        : 'text-gray-600 cursor-not-allowed'
                    }`}
                    aria-label={selectedCount >= 2 && selectedCount <= 4 ? `Compare ${selectedCount} Images` : 'Select between 2 and 4 images to compare'}
                    disabled={selectedCount < 2 || selectedCount > 4}
                  >
                    <GitCompare className="w-4 h-4" />
                  </motion.button>
                </Tooltip>

                {/* Generate Dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <Tooltip label="Generate">
                    <motion.button
                      onClick={() => setGenerateDropdownOpen(!generateDropdownOpen)}
                      whileTap={selectedCount === 1 ? { scale: 0.85 } : undefined}
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors flex items-center gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      aria-label="Generate"
                      disabled={selectedCount !== 1}
                    >
                      <Sparkles className="w-4 h-4" />
                      <ChevronDown className="w-3 h-3" />
                    </motion.button>
                  </Tooltip>
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
                      <button
                        onClick={handleOpenComfyUIWorkspace}
                        className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
                      >
                        <Workflow className="w-3.5 h-3.5" />
                        ComfyUI Workspace
                      </button>
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div className="w-px h-4 bg-gray-700 mx-1" />

                {/* Delete */}
                <Tooltip label="Delete Selected">
                  <motion.button
                    onClick={onDeleteSelected}
                    whileTap={{ scale: 0.85 }}
                    className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label="Delete Selected"
                  >
                    <Trash2 className="w-4 h-4" />
                  </motion.button>
                </Tooltip>
                
                {hasActiveFilters && <div className="w-px h-6 bg-gray-600 mx-2 flex-shrink-0" />}
              </>
            )}

            {canUseFilteredCollectionActions && (
              <>
                {selectedCount > 0 && <div className="w-px h-4 bg-gray-700 mx-1" />}
                <div className="relative" ref={collectionActionsRef}>
                  <Tooltip label={`Collection actions for ${filteredImageActionCount} filtered image${filteredImageActionCount === 1 ? '' : 's'}`}>
                    <motion.button
                      onClick={() => setIsCollectionActionsOpen((open) => !open)}
                      whileTap={{ scale: 0.85 }}
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      aria-label="Collection actions"
                    >
                      <Plus className="w-4 h-4" />
                    </motion.button>
                  </Tooltip>

                  {isCollectionActionsOpen && (
                    <div className="absolute left-0 top-full mt-1 min-w-[220px] rounded-lg border border-gray-700 bg-gray-800 py-1 shadow-xl z-50">
                      <div
                        className="relative"
                        onMouseEnter={() => setIsAddToCollectionSubmenuOpen(true)}
                        onMouseLeave={() => setIsAddToCollectionSubmenuOpen(false)}
                      >
                        <button
                          onClick={() => setIsAddToCollectionSubmenuOpen((open) => !open)}
                          disabled={!onAddCurrentFilteredToCollection}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:text-gray-500"
                        >
                          <span>Add filtered images to collection</span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${isAddToCollectionSubmenuOpen ? '-rotate-90' : 'rotate-[-90deg]'}`} />
                        </button>

                        {isAddToCollectionSubmenuOpen && onAddCurrentFilteredToCollection && (
                          <div className="absolute left-full top-0 min-w-[220px] rounded-lg border border-gray-700 bg-gray-800 py-1 shadow-xl">
                            {collections.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">No collections yet</div>
                            ) : (
                              collections.map((collection) => (
                                <button
                                  key={collection.id}
                                  onClick={() => void handleAddToCollection(collection)}
                                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
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
                        onClick={handleCreateCollectionFromFiltered}
                        disabled={!onCreateCollectionFromFiltered}
                        className="w-full px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:text-gray-500"
                      >
                        Create new collection from filtered images
                      </button>
                    </div>
                  )}
                </div>
                {hasActiveFilters && <div className="w-px h-6 bg-gray-600 mx-2 flex-shrink-0" />}
              </>
            )}

            {canJumpToGroups && (
              <>
                {(selectedCount > 0 || canUseFilteredCollectionActions || slideshowImageCount > 0) && (
                  <div className="w-px h-4 bg-gray-700 mx-1" />
                )}
                <div className="relative" ref={jumpMenuRef}>
                  <Tooltip label="Jump to group">
                    <motion.button
                      onClick={() => {
                        if (isJumpMenuOpen) {
                          closeJumpMenu();
                          return;
                        }
                        setIsJumpMenuOpen(true);
                      }}
                      whileTap={{ scale: 0.85 }}
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors flex items-center gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      aria-label="Jump to group"
                    >
                      <Search className="w-4 h-4" />
                      <ChevronDown className="w-3 h-3" />
                    </motion.button>
                  </Tooltip>

                  {isJumpMenuOpen && (
                    <div
                      className="absolute left-0 top-full mt-1 w-72 rounded-lg border border-gray-700 bg-gray-800 p-2 shadow-xl z-50"
                      onMouseLeave={handleJumpGroupPreviewLeave}
                    >
                      {previewJumpGroup && (
                        <GroupJumpThumbnailPreview image={previewJumpImage} position={previewJumpPosition} />
                      )}
                      {useCalendarJump ? (
                        <>
                          <div className="mb-2 flex items-center justify-between">
                            <button
                              onClick={() => setJumpCalendarMonth((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}
                              className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
                              aria-label="Previous month"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <div className="text-sm font-medium text-gray-200">
                              {jumpCalendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                            </div>
                            <button
                              onClick={() => setJumpCalendarMonth((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}
                              className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
                              aria-label="Next month"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-gray-500">
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                              <div key={`${day}-${index}`}>{day}</div>
                            ))}
                          </div>

                          <div className="grid grid-cols-7 gap-1">
                            {calendarMonthDays.map((date) => {
                              const dateKey = formatCalendarDateKey(date);
                              const dateGroups = groupsByDate.get(dateKey) ?? [];
                              const markerCount = groupBy === 'session'
                                ? dateGroups.length
                                : dateGroups.reduce((total, group) => total + group.count, 0);
                              const isSelected = dateKey === activeJumpDateKey;
                              const inMonth = sameCalendarMonth(date, jumpCalendarMonth);

                              return (
                                <button
                                  key={dateKey}
                                  onClick={() => markerCount > 0 && setSelectedJumpDateKey(dateKey)}
                                  disabled={markerCount === 0}
                                  className={`relative h-8 rounded-md text-xs transition-colors ${
                                    isSelected
                                      ? 'bg-blue-600 text-white'
                                      : markerCount > 0
                                      ? 'bg-gray-700 text-gray-100 hover:bg-gray-600'
                                      : 'text-gray-600'
                                  } ${inMonth ? '' : 'opacity-40'}`}
                                  title={markerCount > 0 ? `${markerCount} ${groupBy === 'session' ? 'session' : 'image'}${markerCount === 1 ? '' : 's'}` : undefined}
                                >
                                  {date.getDate()}
                                  {markerCount > 0 && (
                                    <span className={`absolute -right-1 -top-1 min-w-[16px] rounded-full px-1 text-[10px] leading-4 ${
                                      isSelected ? 'bg-white text-blue-700' : 'bg-blue-500 text-white'
                                    }`}>
                                      {markerCount}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          <div className="mt-3 max-h-52 overflow-y-auto border-t border-gray-700 pt-2">
                            {calendarGroups.length === 0 ? (
                              <div className="px-2 py-3 text-sm text-gray-500">No groups on this day</div>
                            ) : (
                              calendarGroups.map((group) => (
                                <GroupJumpMenuItem
                                  key={group.id}
                                  group={group}
                                  image={getJumpGroupImage(group)}
                                  onHover={handleJumpGroupHover}
                                  onPreviewMove={handleJumpGroupPreviewMove}
                                  onPreviewLeave={handleJumpGroupPreviewLeave}
                                  onSelect={(groupId) => {
                                    onJumpToGroup?.(groupId);
                                    closeJumpMenu();
                                  }}
                                />
                              ))
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <input
                            value={jumpQuery}
                            onChange={(event) => setJumpQuery(event.target.value)}
                            placeholder="Find group..."
                            className="mb-2 w-full rounded-md border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
                            autoFocus
                          />
                          <div className="max-h-72 overflow-y-auto">
                            {visibleJumpGroups.length === 0 ? (
                              <div className="px-2 py-3 text-sm text-gray-500">No matching groups</div>
                            ) : (
                              visibleJumpGroups.map((group) => (
                                <GroupJumpMenuItem
                                  key={group.id}
                                  group={group}
                                  image={getJumpGroupImage(group)}
                                  onHover={handleJumpGroupHover}
                                  onPreviewMove={handleJumpGroupPreviewMove}
                                  onPreviewLeave={handleJumpGroupPreviewLeave}
                                  onSelect={(groupId) => {
                                    onJumpToGroup?.(groupId);
                                    closeJumpMenu();
                                    setJumpQuery('');
                                  }}
                                />
                              ))
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Active Filters */}
            <div className="flex-1 min-w-0 overflow-hidden">
               <ActiveFilters onClearAll={onClearAllFilters} />
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
