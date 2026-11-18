import { useTranslation } from '../i18n/useTranslation';
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
  Layers,
  Layers2,
  Workflow,
  Image as ImageIcon,
  X,
  Search,
  ArrowLeft,
  SlidersHorizontal,
  BarChart3
} from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { copyImageToClipboard, showInExplorer } from '../utils/imageUtils';
import { canEditRasterFile, isAudioFileName, isVideoFileName } from '../utils/mediaTypes.js';
import { SmartCollection, type IndexedImage } from '../types';

import ActiveFilters from './ActiveFilters';
import TagManagerModal from './TagManagerModal';
import AutomationRulesModal from './AutomationRulesModal';
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
  && canEditRasterFile(image!.name)
);

interface GridToolbarProps {
  canvasAction?: React.ReactNode;
  isLibraryView?: boolean;

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
  onAddToBoard?: (images: IndexedImage[]) => void;
  onBatchExport: () => void;
  onStartSlideshow: () => void;
  slideshowImageCount: number;
  slideshowSourceLabel?: string;
  groups?: ImageGroup[];
  groupBy?: ImageGroupByMode;
  onJumpToGroup?: (groupId: string) => void;
  onClearAllFilters?: () => void;
  /** When a model/cluster/collection scope is active, returns to the matching Explore dimension. */
  onExitScope?: () => void;
  /** Human label for the scope's Explore dimension, e.g. "Clusters". */
  scopeReturnLabel?: string;
  /** Opens the Analytics view (relocated from the global header into the library toolbar). */
  onOpenAnalytics?: () => void;
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
  canvasAction,
  isLibraryView = false,
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
  onAddToBoard,
  onBatchExport,
  onStartSlideshow,
  slideshowImageCount,
  slideshowSourceLabel,
  groups = [],
  groupBy = 'none',
  onJumpToGroup,
  onClearAllFilters,
  onExitScope,
  scopeReturnLabel,
  onOpenAnalytics,
}) => {
  const { language, t } = useTranslation();
  const calendarWeekdays = useMemo(() => {
    const weekday = new Intl.DateTimeFormat(language, { weekday: 'narrow', timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, index) => weekday.format(Date.UTC(2026, 0, 4 + index)));
  }, [language]);
  const [generateDropdownOpen, setGenerateDropdownOpen] = useState(false);
  const [isCollectionActionsOpen, setIsCollectionActionsOpen] = useState(false);
  const [isAddToCollectionSubmenuOpen, setIsAddToCollectionSubmenuOpen] = useState(false);
  const [isJumpMenuOpen, setIsJumpMenuOpen] = useState(false);
  const [jumpQuery, setJumpQuery] = useState('');
  const [selectedJumpDateKey, setSelectedJumpDateKey] = useState<string | null>(null);
  const [jumpCalendarMonth, setJumpCalendarMonth] = useState(() => new Date());
  const [previewJumpGroupId, setPreviewJumpGroupId] = useState<string | null>(null);
  const [previewJumpPosition, setPreviewJumpPosition] = useState<PreviewPosition | null>(null);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [isAutomationRulesOpen, setIsAutomationRulesOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const collectionActionsRef = useRef<HTMLDivElement>(null);
  const jumpMenuRef = useRef<HTMLDivElement>(null);
  const calendarInitializedRef = useRef(false);
  const bulkToggleFavorite = useImageStore((state) => state.bulkToggleFavorite);
  const clearImageSelection = useImageStore((state) => state.clearImageSelection);
  const isStackingEnabled = useImageStore((state) => state.isStackingEnabled);
  const setStackingEnabled = useImageStore((state) => state.setStackingEnabled);
  const viewingStackPrompt = useImageStore((state) => state.viewingStackPrompt);
  const setViewingStackPrompt = useImageStore((state) => state.setViewingStackPrompt);
  const setSearchQuery = useImageStore((state) => state.setSearchQuery);
  const collections = useImageStore((state) => state.collections);
  const allImages = useImageStore((state) => state.images);
  const startAutoTagging = useImageStore((state) => state.startAutoTagging);
  const isAutoTagging = useImageStore((state) => state.isAutoTagging);
  const autoTaggingProgress = useImageStore((state) => state.autoTaggingProgress);
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const { canUseComparison, canUseA1111, canUseComfyUI, canUseImageEditor, showProModal, canUseBulkTagging, initialized, canUseDuringTrialOrPro, canUseAnalytics } = useFeatureAccess();
  const { isReparsing, reparseImages } = useReparseMetadata();

  const hasDirectories = directories.length > 0;
  const autoTagPercent = autoTaggingProgress && autoTaggingProgress.total > 0
    ? Math.min(100, Math.round((autoTaggingProgress.current / autoTaggingProgress.total) * 100))
    : null;

  const handleAutoTagLibrary = () => {
    const primaryPath = directories[0]?.path ?? '';
    if (!hasDirectories || isAutoTagging) {
      return;
    }
    startAutoTagging(primaryPath, scanSubfolders);
  };


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
    ? (canOpenSelectedImageEditor ? t('libraryGallery.editImageButton') : t('libraryGallery.imageEditorStaticOnly'))
    : t('libraryGallery.selectOneImageToEdit');
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
      showNotification(t('libraryGallery.imageCopiedToClipboard'));
    } else {
      showNotification(t('libraryGallery.failedToCopyError', { error: String(result.error) }), 'error');
    }
  };

  const handleShowInFolder = () => {
    if (!firstSelectedImage) return;
    const directory = directories.find(d => d.id === firstSelectedImage.directoryId);
    if (!directory) {
      showNotification(t('libraryGallery.cannotDetermineFileLocation'), 'error');
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

  const selectedFolders = useImageStore((state) => state.selectedFolders);
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

  // Snap the calendar to the active date's month, but only ONCE per menu-open.
  // Re-running this on every render would revert the user's manual month
  // navigation (Prev/Next arrows), leaving the calendar stuck on the active
  // date's month. The ref gates the sync to the initial open.
  useEffect(() => {
    if (!isJumpMenuOpen) {
      calendarInitializedRef.current = false;
      return;
    }

    if (!useCalendarJump || calendarDateKeys.length === 0 || calendarInitializedRef.current) {
      return;
    }

    const targetKey = activeJumpDateKey ?? calendarDateKeys[0];
    if (!targetKey) {
      return;
    }

    calendarInitializedRef.current = true;

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
      selectedFolders.size > 0 ||
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

  // Keep the Library toolbar visible: stacking is always available.

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
      <div className="flex items-center justify-between gap-2 px-5 min-h-[32px]">
        {/* Selection Context Toolbar - Centered or justified as needed */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 flex-1 min-w-0">
            {onAddToBoard && <button disabled={!selectedImagesList.length} className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-40" onClick={() => onAddToBoard(selectedImagesList)}>{t('libraryGallery.addToBoard')}</button>}
            {onExitScope && (
              <>
                <Tooltip label={scopeReturnLabel ? t('libraryGallery.backToLabel', { label: scopeReturnLabel }) : t('libraryGallery.back')}>
                  <button
                    onClick={onExitScope}
                    className="flex items-center gap-1 rounded px-2 py-1.5 text-gray-300 transition-colors hover:bg-gray-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    title={scopeReturnLabel ? t('libraryGallery.backToLabel', { label: scopeReturnLabel }) : t('libraryGallery.back')}
                    aria-label={scopeReturnLabel ? t('libraryGallery.backToLabel', { label: scopeReturnLabel }) : t('libraryGallery.back')}
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span className="text-[11px] font-medium">{t('libraryGallery.back')}</span>
                  </button>
                </Tooltip>
                <div className="w-px h-4 bg-gray-700 mx-1" />
              </>
            )}

            {slideshowImageCount > 0 && (
              <>
                <Tooltip label={t('libraryGallery.startSlideshowFromLabel', { label: slideshowSourceLabel ?? t('libraryGallery.currentView') })}>
                  <button
                    onClick={onStartSlideshow}
                    className="p-1.5 text-gray-400 hover:text-blue-300 hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label={t('libraryGallery.startSlideshow')}
                  >
                    <Play className="w-4 h-4" />
                  </button>
                </Tooltip>
              </>
            )}

            {canUseFilteredCollectionActions && (
              <>
                {selectedCount > 0 && <div className="w-px h-4 bg-gray-700 mx-1" />}
                <div className="relative" ref={collectionActionsRef}>
                  <Tooltip label={t('libraryGallery.collectionActionsForImages', { count: filteredImageActionCount })}>
                    <button
                      onClick={() => setIsCollectionActionsOpen((open) => !open)}
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      aria-label={t('libraryGallery.collectionActions')}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
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
                          <span>{t('libraryGallery.addFilteredImagesToCollection')}</span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${isAddToCollectionSubmenuOpen ? '-rotate-90' : 'rotate-[-90deg]'}`} />
                        </button>

                        {isAddToCollectionSubmenuOpen && onAddCurrentFilteredToCollection && (
                          <div className="absolute left-full top-0 min-w-[220px] rounded-lg border border-gray-700 bg-gray-800 py-1 shadow-xl">
                            {collections.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">{t('libraryGallery.noCollectionsYet')}</div>
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
                                      {collection.autoUpdate !== false ? t('libraryGallery.auto') : t('libraryGallery.linked')}
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
                        {t('libraryGallery.createNewCollectionFromFilteredImages')}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {isLibraryView && (
              <Tooltip label={isStackingEnabled ? t('libraryGallery.disableStacking') : t('libraryGallery.stackItemsByIdenticalPrompt')}>
                <button
                  onClick={() => setStackingEnabled(!isStackingEnabled)}
                  className={`rounded p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${isStackingEnabled ? 'bg-accent/15 text-accent hover:bg-accent/20' : 'text-gray-400 hover:bg-gray-700 hover:text-accent'}`}
                  aria-label={isStackingEnabled ? t('libraryGallery.disableStacking') : t('libraryGallery.stackItemsByIdenticalPrompt')}
                  aria-pressed={isStackingEnabled}
                >
                  {isStackingEnabled ? <Layers2 size={16} /> : <Layers size={16} />}
                </button>
              </Tooltip>
            )}
            {isLibraryView && viewingStackPrompt && (
              <Tooltip label={t('libraryGallery.returnToTheStackedResults')}>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setStackingEnabled(true);
                    setViewingStackPrompt(null);
                  }}
                  className="flex items-center gap-1 rounded px-2 py-1.5 text-gray-300 transition-colors hover:bg-gray-700 hover:text-accent"
                >
                  <ArrowLeft size={12} />
                  <span className="text-[11px] font-medium">{t('libraryGallery.back')}</span>
                </button>
              </Tooltip>
            )}

            <Tooltip label={t('libraryGallery.automationRules')}>
              <button
                onClick={() => setIsAutomationRulesOpen(true)}
                className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={t('libraryGallery.automationRules')}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip label={isAutoTagging ? t('libraryGallery.autoTaggingProgress', { progress: autoTagPercent === null ? '…' : autoTagPercent + '%' }) : t('libraryGallery.autoTagLibrary')}>
              <button
                onClick={handleAutoTagLibrary}
                disabled={!hasDirectories || isAutoTagging}
                className={`flex items-center gap-1 rounded p-1.5 transition-colors hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 ${isAutoTagging ? 'text-accent' : 'text-gray-400 hover:text-accent'}`}
                aria-label={t('libraryGallery.autoTagLibrary')}
              >
                <Tag className={`h-4 w-4 ${isAutoTagging ? 'animate-pulse' : ''}`} />
                {isAutoTagging && autoTagPercent !== null && (
                  <span className="text-[10px] font-semibold tabular-nums">{autoTagPercent}%</span>
                )}
              </button>
            </Tooltip>

            {onOpenAnalytics && (
            <Tooltip label={t('libraryGallery.analytics')}>
              <button
                onClick={() => {
                  if (canUseAnalytics) {
                    onOpenAnalytics();
                  } else {
                    showProModal('analytics');
                  }
                }}
                className="relative p-1.5 text-gray-400 hover:text-accent hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={t('libraryGallery.analytics')}
              >
                <BarChart3 className="w-4 h-4" />
              </button>
            </Tooltip>
            )}

            {selectedCount > 0 && (
              <>
                <span className="text-[11px] text-gray-400 mr-2 whitespace-nowrap">{t('libraryGallery.selectedCount', { count: selectedCount })}</span>

                <Tooltip label={t('libraryGallery.clearSelection')}>
                  <button
                    onClick={clearImageSelection}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    title={t('libraryGallery.clearSelection')}
                    aria-label={t('libraryGallery.clearSelection')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </Tooltip>

                {/* Copy to Clipboard */}
                <Tooltip label={t('libraryGallery.copyToClipboard')}>
                  <button
                    onClick={handleCopyToClipboard}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    title={t('libraryGallery.copyToClipboard')}
                    aria-label={t('libraryGallery.copyToClipboard')}
                    disabled={selectedCount !== 1}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </Tooltip>

                {/* Show in Folder */}
                <Tooltip label={t('libraryGallery.showInFolder')}>
                  <button
                    onClick={handleShowInFolder}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    title={t('libraryGallery.showInFolder')}
                    aria-label={t('libraryGallery.showInFolder')}
                    disabled={selectedCount !== 1}
                  >
                    <Folder className="w-4 h-4" />
                  </button>
                </Tooltip>

                {/* Export */}
                <Tooltip label={selectedCount > 1 ? t('libraryGallery.exportSelectedImages') : t('settings.shortcuts.export')}>
                  <button
                    onClick={handleExport}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    title={selectedCount > 1 ? t('libraryGallery.exportSelectedImages') : t('settings.shortcuts.export')}
                    aria-label={selectedCount > 1 ? t('libraryGallery.exportSelectedImages') : t('settings.shortcuts.export')}
                    disabled={selectedCount === 0}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </Tooltip>

                {/* Favorites */}
                <Tooltip label={allFavorites ? t('libraryGallery.removeFromFavoritesToolbar') : t('libraryGallery.addToFavoritesToolbar')}>
                  <button
                    onClick={handleToggleFavorites}
                    className={`p-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      allFavorites
                        ? 'text-rose-400 hover:text-rose-300 hover:bg-gray-700'
                        : 'text-gray-400 hover:text-rose-400 hover:bg-gray-700'
                    }`}
                    title={allFavorites ? t('libraryGallery.removeFromFavoritesToolbar') : t('libraryGallery.addToFavoritesToolbar')}
                    aria-label={allFavorites ? t('libraryGallery.removeFromFavoritesToolbar') : t('libraryGallery.addToFavoritesToolbar')}
                  >
                    <Heart className={`w-4 h-4 ${allFavorites ? 'fill-current' : ''}`} />
                  </button>
                </Tooltip>

                <Tooltip label={selectedCount === 1 ? t('libraryGallery.reparseMetadataTooltip') : t('libraryGallery.reparseSelectionTooltip', { count: selectedCount })}>
                  <button
                    onClick={handleReparseSelected}
                    className={`p-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isReparsing
                        ? 'text-cyan-300 bg-cyan-500/10 cursor-wait'
                        : 'text-gray-400 hover:text-cyan-300 hover:bg-gray-700'
                    }`}
                    title={selectedCount === 1 ? t('libraryGallery.reparseMetadataTooltip') : t('libraryGallery.reparseSelectionTooltip', { count: selectedCount })}
                    aria-label={selectedCount === 1 ? t('libraryGallery.reparseMetadataTooltip') : t('libraryGallery.reparseSelectionTooltip', { count: selectedCount })}
                    disabled={selectedCount === 0 || isReparsing}
                  >
                    <RefreshCw className={`w-4 h-4 ${isReparsing ? 'animate-spin' : ''}`} />
                  </button>
                </Tooltip>

                 {/* Tagging */}
                 <Tooltip label={t('libraryGallery.addRemoveTags')}>
                   <button
                    onClick={handleTagClick}
                    className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    title={t('libraryGallery.addRemoveTags')}
                    aria-label={t('libraryGallery.addRemoveTags')}
                  >
                    <Tag className="w-4 h-4" />
                  </button>
                </Tooltip>
  
                {/* Divider */}
                <div className="w-px h-4 bg-gray-700 mx-1" />

                {/* Compare */}
                <Tooltip label={canOpenSelectedImageEditor && !canUseImageEditor ? t('libraryGallery.imageEditorPro') : editImageTooltip}>
                  <button
                    onClick={handleOpenImageEditor}
                    className={`p-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      canOpenSelectedImageEditor
                        ? 'text-gray-400 hover:text-cyan-300 hover:bg-gray-700'
                        : 'text-gray-600 cursor-not-allowed'
                    }`}
                    title={canOpenSelectedImageEditor && !canUseImageEditor ? t('libraryGallery.imageEditorPro') : editImageTooltip}
                    aria-label={t('libraryGallery.editImageButton')}
                    disabled={!canOpenSelectedImageEditor}
                  >
                    <ImageIcon className="w-4 h-4" />
                    {canOpenSelectedImageEditor && !canUseDuringTrialOrPro && initialized && <ProBadge size="sm" />}
                  </button>
                </Tooltip>

                <Tooltip label={selectedCount >= 2 && selectedCount <= 4 ? t('libraryGallery.compareCountImages', { count: selectedCount }) : t('libraryGallery.compareSelectionLimit')}>
                  <button
                    onClick={handleCompare}
                    className={`p-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      selectedCount >= 2 && selectedCount <= 4
                        ? 'text-gray-400 hover:text-purple-400 hover:bg-gray-700'
                        : 'text-gray-600 cursor-not-allowed'
                    }`}
                    title={selectedCount >= 2 && selectedCount <= 4 ? t('libraryGallery.compareCountImages', { count: selectedCount }) : t('libraryGallery.compareSelectionLimit')}
                    aria-label={selectedCount >= 2 && selectedCount <= 4 ? t('libraryGallery.compareCountImages', { count: selectedCount }) : t('libraryGallery.compareSelectionLimit')}
                    disabled={selectedCount < 2 || selectedCount > 4}
                  >
                    <GitCompare className="w-4 h-4" />
                  </button>
                </Tooltip>

                {/* Generate Dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <Tooltip label={t('libraryGallery.generate')}>
                    <button
                      onClick={() => setGenerateDropdownOpen(!generateDropdownOpen)}
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors flex items-center gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      title={t('libraryGallery.generate')}
                      aria-label={t('libraryGallery.generate')}
                      disabled={selectedCount !== 1}
                    >
                      <Sparkles className="w-4 h-4" />
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </Tooltip>
                  {generateDropdownOpen && selectedCount === 1 && (
                    <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px] z-50">
                      <button
                        onClick={handleGenerateA1111}
                        className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {t('libraryGallery.withA1111')}
                      </button>
                      <button
                        onClick={handleGenerateComfyUI}
                        className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {t('libraryGallery.withComfyui')}
                      </button>
                      <button
                        onClick={handleOpenComfyUIWorkspace}
                        className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
                      >
                        <Workflow className="w-3.5 h-3.5" />
                        {t('libraryGallery.comfyuiWorkspace')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div className="w-px h-4 bg-gray-700 mx-1" />

                {/* Delete */}
                <Tooltip label={t('settings.shortcuts.action.deleteSelected')}>
                  <button
                    onClick={onDeleteSelected}
                    className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    title={t('settings.shortcuts.action.deleteSelected')}
                    aria-label={t('settings.shortcuts.action.deleteSelected')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </Tooltip>
                
                {hasActiveFilters && <div className="w-px h-6 bg-gray-600 mx-2 flex-shrink-0" />}
              </>
            )}

            {canJumpToGroups && (
              <>
                {(selectedCount > 0 || canUseFilteredCollectionActions || slideshowImageCount > 0) && (
                  <div className="w-px h-4 bg-gray-700 mx-1" />
                )}
                <div className="relative" ref={jumpMenuRef}>
                  <Tooltip label={t('libraryGallery.jumpToGroup')}>
                    <button
                      onClick={() => {
                        if (isJumpMenuOpen) {
                          closeJumpMenu();
                          return;
                        }
                        setIsJumpMenuOpen(true);
                      }}
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors flex items-center gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      title={t('libraryGallery.jumpToGroup')}
                      aria-label={t('libraryGallery.jumpToGroup')}
                    >
                      <Search className="w-4 h-4" />
                      <ChevronDown className="w-3 h-3" />
                    </button>
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
                              aria-label={t('libraryGallery.previousMonth')}
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <div className="text-sm font-medium text-gray-200">
                              {jumpCalendarMonth.toLocaleDateString(language, { month: 'long', year: 'numeric' })}
                            </div>
                            <button
                              onClick={() => setJumpCalendarMonth((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}
                              className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
                              aria-label={t('libraryGallery.nextMonth')}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-gray-500">
                            {calendarWeekdays.map((day, index) => (
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
                                  title={markerCount > 0 ? t(groupBy === 'session' ? 'libraryGallery.sessionCount' : 'libraryGallery.imageCount', { count: markerCount }) : undefined}
                                >
                                  {date.getDate()}
                                  {markerCount > 0 && (
                                    <span className={`absolute -right-1 -top-1 min-w-[16px] rounded-full px-1 text-[10px] leading-4 ${
                                      isSelected ? 'bg-white text-blue-700' : 'bg-blue-500 text-gray-950'
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
                              <div className="px-2 py-3 text-sm text-gray-500">{t('libraryGallery.noGroupsOnThisDay')}</div>
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
                            placeholder={t('libraryGallery.findGroup')}
                            className="mb-2 w-full rounded-md border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
                            autoFocus
                          />
                          <div className="max-h-72 overflow-y-auto">
                            {visibleJumpGroups.length === 0 ? (
                              <div className="px-2 py-3 text-sm text-gray-500">{t('libraryGallery.noMatchingGroups')}</div>
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
            <div className={`flex-1 overflow-hidden ${hasActiveFilters ? 'min-w-[min(100%,12rem)]' : 'min-w-0'}`}>
               <ActiveFilters onClearAll={onClearAllFilters} />
            </div>
            {canvasAction}
        </div>


      </div>

      <TagManagerModal
        isOpen={isTagModalOpen}
        onClose={() => setIsTagModalOpen(false)}
        selectedImageIds={Array.from(selectedImages)}
      />

      <AutomationRulesModal
        isOpen={isAutomationRulesOpen}
        onClose={() => setIsAutomationRulesOpen(false)}
      />
    </>
  );
};

export default GridToolbar;
