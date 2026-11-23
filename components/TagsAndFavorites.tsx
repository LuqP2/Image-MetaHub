import { useTranslation } from '../i18n/useTranslation';
import LibraryRatingFilter from './LibraryRatingFilter';
import LibraryFavoriteFilter from './LibraryFavoriteFilter';
import { TeamReviewFilter } from './team/TeamReviewFilter';
import TriStateToggle, { getFilterModeLabel, getNextFilterMode } from './TriStateToggle';
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Tag, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useImageStore } from '../store/useImageStore';
import { InclusionFilterMode, TagInfo } from '../types';
import CollectionFormModal, { CollectionFormValues } from './CollectionFormModal';
import { normalizeCollectionTagNames } from '../services/imageAnnotationsStorage';

type TagContextMenuState = {
  x: number;
  y: number;
  tag: TagInfo;
  automatic: boolean;
};

type RenameDialogState = {
  isOpen: boolean;
  sourceTag: string;
  automatic?: boolean;
  value: string;
};

const TagsAndFavorites: React.FC = () => {
  const { t } = useTranslation();
  const matchModeLabel = (mode: 'all' | 'any') => t(mode === 'all' ? 'libraryTags.all' : 'libraryTags.any');
  const favoriteFilterMode = useImageStore((state) => state.favoriteFilterMode);
  const setFavoriteFilterMode = useImageStore((state) => state.setFavoriteFilterMode);
  const selectedRatings = useImageStore((state) => state.selectedRatings);
  const setSelectedRatings = useImageStore((state) => state.setSelectedRatings);
  const catalogTags = useImageStore((state) => state.availableTags);
  const availableAutoTags = useImageStore((state) => state.availableAutoTags);
  const selectedTags = useImageStore((state) => state.selectedTags);
  const excludedTags = useImageStore((state) => state.excludedTags);
  const selectedTagsMatchMode = useImageStore((state) => state.selectedTagsMatchMode);
  const selectedAutoTags = useImageStore((state) => state.selectedAutoTags);
  const excludedAutoTags = useImageStore((state) => state.excludedAutoTags);
  const setSelectedTags = useImageStore((state) => state.setSelectedTags);
  const setExcludedTags = useImageStore((state) => state.setExcludedTags);
  const setSelectedTagsMatchMode = useImageStore((state) => state.setSelectedTagsMatchMode);
  const setSelectedAutoTags = useImageStore((state) => state.setSelectedAutoTags);
  const setExcludedAutoTags = useImageStore((state) => state.setExcludedAutoTags);
  const renameTag = useImageStore((state) => state.renameTag);
  const renameAutoTag = useImageStore((state) => state.renameAutoTag);
  const removeAutoTags = useImageStore((state) => state.removeAutoTags);
  const clearTag = useImageStore((state) => state.clearTag);
  const deleteTag = useImageStore((state) => state.deleteTag);
  const purgeTag = useImageStore((state) => state.purgeTag);
  const refreshAvailableAutoTags = useImageStore((state) => state.refreshAvailableAutoTags);
  const filteredImages = useImageStore((state) => state.filteredImages);
  const images = useImageStore((state) => state.images);
  const indexingState = useImageStore((state) => state.indexingState);
  const collections = useImageStore((state) => state.collections);
  const createCollection = useImageStore((state) => state.createCollection);

  const [isExpanded, setIsExpanded] = useState(true);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [autoTagSearchQuery, setAutoTagSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<TagContextMenuState | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState>({
    isOpen: false,
    sourceTag: '',
    value: '',
  });
  const [collectionSourceTag, setCollectionSourceTag] = useState<TagContextMenuState | null>(null);
  const contextMenuRef = React.useRef<HTMLDivElement>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);

  // Refresh auto-tags when images change
  React.useEffect(() => {
    refreshAvailableAutoTags();
  }, [images, refreshAvailableAutoTags]);

  React.useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handleCloseMenu = (event: MouseEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setContextMenu(null);
    };

    window.addEventListener('click', handleCloseMenu, true);
    window.addEventListener('contextmenu', handleCloseMenu, true);

    return () => {
      window.removeEventListener('click', handleCloseMenu, true);
      window.removeEventListener('contextmenu', handleCloseMenu, true);
    };
  }, [contextMenu]);

  React.useEffect(() => {
    if (!renameDialog.isOpen) {
      return;
    }

    const timeout = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 10);

    return () => window.clearTimeout(timeout);
  }, [renameDialog.isOpen]);

  const isIndexing = indexingState === 'indexing';
  const totalFavoriteCount = useMemo(
    () => (isIndexing ? 0 : images.filter((img) => img.isFavorite).length),
    [images, isIndexing]
  );
  const favoriteCount = useMemo(
    () => (isIndexing ? 0 : filteredImages.filter((img) => img.isFavorite).length),
    [filteredImages, isIndexing]
  );
  const favoriteBadgeCount = favoriteFilterMode === 'include' ? favoriteCount : totalFavoriteCount;
  const totalRatedCount = useMemo(
    () => (isIndexing ? 0 : images.filter((img) => (img.rating ?? 0) > 0).length),
    [images, isIndexing]
  );
  const quickRatingCounts = useMemo(() => {
    // Optimization: Consolidate 5 Array.filter passes into a single O(N) loop and avoid new Map(arr.map()) allocation overhead
    const counts = new Map<number, number>([
      [1, 0], [2, 0], [3, 0], [4, 0], [5, 0],
    ]);
    if (!isIndexing) {
      for (let i = 0; i < images.length; i++) {
        const rating = images[i].rating;
        if (rating && rating >= 1 && rating <= 5) {
          counts.set(rating, (counts.get(rating) || 0) + 1);
        }
      }
    }
    return counts;
  }, [images, isIndexing]);

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const image of images) {
      for (const tag of image.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    // Keep deliberately empty catalog tags. Counts for assigned tags come from the live library.
    return catalogTags.flatMap(tag => {
      const count = counts.get(tag.name);
      return count ? [{ ...tag, count }] : tag.count === 0 ? [tag] : [];
    });
  }, [catalogTags, images]);

  // Filter tags by search query
  const filteredTags = tagSearchQuery
    ? availableTags.filter(tag =>
        tag.name.toLowerCase().includes(tagSearchQuery.toLowerCase())
      )
    : availableTags;

  // Filter auto-tags by search query (from store, already calculated)
  const filteredAutoTags = autoTagSearchQuery
    ? availableAutoTags.filter(tag =>
        tag.name.toLowerCase().includes(autoTagSearchQuery.toLowerCase())
      )
    : availableAutoTags;

  const getTagFilterMode = (tagName: string): InclusionFilterMode => {
    if (selectedTags.includes(tagName)) return 'include';
    if (excludedTags.includes(tagName)) return 'exclude';
    return 'neutral';
  };

  const getAutoTagFilterMode = (tagName: string): InclusionFilterMode => {
    if (selectedAutoTags.includes(tagName)) return 'include';
    if (excludedAutoTags.includes(tagName)) return 'exclude';
    return 'neutral';
  };

  const handleTagCycle = (tagName: string) => {
    const currentMode = getTagFilterMode(tagName);
    const nextMode = getNextFilterMode(currentMode);

    if (nextMode === 'include') {
      setSelectedTags([...selectedTags.filter(t => t !== tagName), tagName]);
      setExcludedTags(excludedTags.filter(t => t !== tagName));
      return;
    }

    if (nextMode === 'exclude') {
      setSelectedTags(selectedTags.filter(t => t !== tagName));
      setExcludedTags([...excludedTags.filter(t => t !== tagName), tagName]);
      return;
    }

    setSelectedTags(selectedTags.filter(t => t !== tagName));
    setExcludedTags(excludedTags.filter(t => t !== tagName));
  };

  const handleAutoTagCycle = (tagName: string) => {
    setTagFilterMode(tagName, getNextFilterMode(getAutoTagFilterMode(tagName)), true);
  };

  const clearSelectedTags = () => {
    setSelectedTags([]);
    setExcludedTags([]);
  };

  const clearSelectedAutoTags = () => {
    setSelectedAutoTags([]);
    setExcludedAutoTags([]);
  };

  const setTagFilterMode = (tagName: string, mode: InclusionFilterMode, automatic = false) => {
    const included = (automatic ? selectedAutoTags : selectedTags).filter(tag => tag !== tagName);
    const excluded = (automatic ? excludedAutoTags : excludedTags).filter(tag => tag !== tagName);
    if (mode === 'include') included.push(tagName);
    if (mode === 'exclude') excluded.push(tagName);
    (automatic ? setSelectedAutoTags : setSelectedTags)(included);
    (automatic ? setExcludedAutoTags : setExcludedTags)(excluded);
  };

  const handleTagContextMenu = (event: React.MouseEvent, tag: TagInfo, automatic = false) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, tag, automatic });
  };

  React.useLayoutEffect(() => {
    const menu = contextMenuRef.current;
    if (!contextMenu || !menu) return;
    const margin = 8;
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(margin, Math.min(contextMenu.x, window.innerWidth - width - margin));
    const below = contextMenu.y + margin;
    const top = below + height + margin <= window.innerHeight
      ? below
      : Math.max(margin, contextMenu.y - height - margin);
    Object.assign(menu.style, { left: `${left}px`, top: `${top}px` });
  }, [contextMenu]);

  const closeContextMenu = () => setContextMenu(null);

  const openRenameDialog = () => {
    if (!contextMenu) {
      return;
    }

    setRenameDialog({
      isOpen: true,
      sourceTag: contextMenu.tag.name,
      value: contextMenu.tag.name,
      automatic: contextMenu.automatic,
    });
    closeContextMenu();
  };

  const closeRenameDialog = () => {
    setRenameDialog({
      isOpen: false,
      sourceTag: '',
      value: '',
    });
  };

  const handleRenameSubmit = async () => {
    const nextName = renameDialog.value.trim();
    const sourceTag = renameDialog.sourceTag;
    if (!nextName || nextName.toLowerCase() === renameDialog.sourceTag) {
      closeRenameDialog();
      return;
    }

    closeRenameDialog();
    if (renameDialog.automatic) renameAutoTag(sourceTag, nextName);
    else await renameTag(sourceTag, nextName);
  };

  const handleTagAction = async (action: () => Promise<void>) => {
    closeContextMenu();
    await action();
  };

  const openCreateCollectionDialog = () => {
    if (!contextMenu) {
      return;
    }

    setCollectionSourceTag(contextMenu);
    closeContextMenu();
  };

  const handleCreateCollection = async (values: CollectionFormValues) => {
    if (!collectionSourceTag) {
      return;
    }

    if (collectionSourceTag.automatic) {
      await createCollection({
        kind: 'manual',
        name: values.name,
        description: values.description || undefined,
        imageIds: images.filter(image => image.autoTags?.includes(collectionSourceTag.tag.name)).map(image => image.id),
        sortIndex: collections.length,
        coverImageId: null,
        type: 'custom',
      });
      setCollectionSourceTag(null);
      return;
    }
    const normalizedTag = normalizeCollectionTagNames(collectionSourceTag.tag.name).join(', ');
    const normalizedTags = normalizeCollectionTagNames(collectionSourceTag.tag.name);
    const snapshotImageIds = values.autoUpdate
      ? []
      : images
          .filter(
            (image) =>
              Array.isArray(image.tags) &&
              normalizedTags.some((tag) => image.tags.includes(tag)),
          )
          .map((image) => image.id);

    await createCollection({
      kind: 'tag_rule',
      name: values.name,
      description: values.description || undefined,
      sourceTag: normalizedTag,
      autoUpdate: values.autoUpdate,
      imageIds: [],
      snapshotImageIds,
      sortIndex: collections.length,
      coverImageId: null,
      thumbnailId: undefined,
      type: 'custom',
      query: undefined,
    });

    setCollectionSourceTag(null);
  };

  const handleClearFromMenu = async () => {
    if (!contextMenu) {
      return;
    }

    const confirmed = window.confirm(
      t('libraryTags.clearConfirm', { tag: contextMenu.tag.name }),
    );
    if (!confirmed) {
      return;
    }

    await handleTagAction(() => clearTag(contextMenu.tag.name));
  };

  const handleDeleteFromMenu = async () => {
    if (!contextMenu) {
      return;
    }

    if (contextMenu.tag.count > 0) {
      const shouldPurge = window.confirm(
        t('libraryTags.usedConfirm', { tag: contextMenu.tag.name, count: contextMenu.tag.count }),
      );

      if (shouldPurge) {
        await handlePurgeFromMenu();
      }
      return;
    }

    const confirmed = window.confirm(t('libraryTags.deleteEmptyConfirm', { tag: contextMenu.tag.name }));
    if (!confirmed) {
      return;
    }

    await handleTagAction(() => deleteTag(contextMenu.tag.name));
  };

  const handlePurgeFromMenu = async () => {
    if (!contextMenu) {
      return;
    }

    if (contextMenu.automatic) {
      if (window.confirm(t('libraryTags.deleteAutoConfirm', { tag: contextMenu.tag.name }))) {
        removeAutoTags(contextMenu.tag.name);
        closeContextMenu();
      }
      return;
    }

    const confirmed = window.confirm(
      t('libraryTags.purgeConfirm', { tag: contextMenu.tag.name }),
    );
    if (!confirmed) {
      return;
    }

    await handleTagAction(() => purgeTag(contextMenu.tag.name));
  };

  // Don't render if no filters are available and no rating filter is active
  if (
    availableTags.length === 0 &&
    totalFavoriteCount === 0 &&
    availableAutoTags.length === 0 &&
    totalRatedCount === 0 &&
    selectedRatings.length === 0 &&
    selectedTags.length === 0 &&
    excludedTags.length === 0
  ) {
    return null;
  }

  return (
    <div className="border-b border-gray-700">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
        aria-label={isExpanded ? t('libraryTags.collapse') : t('libraryTags.expand')}
      >
        <div className="flex items-center space-x-2">
          <span className="text-gray-300 font-medium">{t('libraryTags.heading')}</span>
          {(selectedRatings.length > 0 || favoriteFilterMode !== 'neutral' || selectedTags.length > 0 || excludedTags.length > 0 || selectedAutoTags.length > 0 || excludedAutoTags.length > 0) && (
            <span className="rounded border border-blue-700/50 bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300">
              {t('libraryTags.active')}
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              <LibraryRatingFilter selectedRatings={selectedRatings} onChange={setSelectedRatings} counts={quickRatingCounts} />
              <TeamReviewFilter />

              {/* Favorites Toggle */}
              {totalFavoriteCount > 0 && (
                <LibraryFavoriteFilter favoriteFilterMode={favoriteFilterMode} onChange={setFavoriteFilterMode} count={favoriteBadgeCount} />
              )}

              {/* Tags Section */}
              {(availableTags.length > 0 || selectedTags.length > 0 || excludedTags.length > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Tag className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-400 font-medium">{t('comparison.tags')}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedTagsMatchMode(selectedTagsMatchMode === 'any' ? 'all' : 'any')}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
                          selectedTagsMatchMode === 'all'
                            ? 'border-blue-600/60 bg-blue-900/40 text-blue-200'
                            : 'border-gray-700 bg-gray-800/70 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                        }`}
                        title={selectedTagsMatchMode === 'all' ? t('libraryTags.matchAllHelp') : t('libraryTags.matchAnyHelp')}
                        aria-label={t('libraryTags.matchMode', { mode: matchModeLabel(selectedTagsMatchMode) })}
                      >
                        {selectedTagsMatchMode === 'all' ? t('libraryTags.all') : t('libraryTags.any')}
                      </button>
                      {selectedTags.length > 0 && (
                        <span className="rounded border border-blue-700/50 bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300">
                          {selectedTags.length > 1 ? t('libraryTags.includeModeCount', { count: selectedTags.length, mode: matchModeLabel(selectedTagsMatchMode) }) : t('librarySearch.includeCount', { count: selectedTags.length })}
                        </span>
                      )}
                      {excludedTags.length > 0 && (
                        <span className="rounded border border-red-700/50 bg-red-900/40 px-2 py-0.5 text-xs text-red-300">
                          {t('librarySearch.excludeCount', { count: excludedTags.length })}
                        </span>
                      )}
                    </div>
                    {(selectedTags.length > 0 || excludedTags.length > 0) && (
                      <button
                        type="button"
                        onClick={clearSelectedTags}
                        className="text-xs text-gray-400 hover:text-red-400 cursor-pointer"
                        title={t('libraryTags.clearFilters')}
                        aria-label={t('libraryTags.clearFilters')}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  {/* Tag Search */}
                  {availableTags.length > 5 && (
                    <input
                      type="text"
                      placeholder={t('libraryTags.filterTags')}
                      value={tagSearchQuery}
                      onChange={(e) => setTagSearchQuery(e.target.value)}
                      className="w-full bg-gray-700 text-gray-200 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
                    />
                  )}

                  {/* Tags List */}
                  <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-1">
                    {filteredTags.length === 0 ? (
                      <div className="text-xs text-gray-500 py-2">
                        {t('libraryTags.noTags', { query: tagSearchQuery })}
                      </div>
                    ) : (
                      filteredTags.map((tag) => (
                        <div
                          key={tag.name}
                          className="flex items-center space-x-2 cursor-pointer group py-1 px-2 rounded hover:bg-gray-700/50"
                          onContextMenu={(event) => handleTagContextMenu(event, tag)}
                        >
                          <TriStateToggle
                            mode={getTagFilterMode(tag.name)}
                            onClick={() => handleTagCycle(tag.name)}
                            title={t('libraryTags.tagCycle', { tag: tag.name, mode: getFilterModeLabel(getTagFilterMode(tag.name), t) })}
                          />
                          <span className="text-sm text-gray-300 group-hover:text-gray-50 flex-1">
                            {tag.name}
                          </span>
                          <span className="text-xs text-gray-500 group-hover:text-gray-400">
                            {tag.count}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  {filteredTags.length > 0 && availableTags.length > filteredTags.length && (
                    <div className="text-xs text-gray-500 text-center pt-1">
                      {t('libraryTags.tagCount', { count: filteredTags.length, total: availableTags.length })}
                    </div>
                  )}
                </div>
              )}

              {/* Auto-Tags Section */}
              {availableAutoTags.length > 0 && (
                <div className="space-y-2 pt-4 border-t border-gray-700/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Tag className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-400 font-medium">{t('libraryTags.autoTags')}</span>
                      {selectedAutoTags.length > 0 && (
                        <span className="rounded border border-blue-700/50 bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300">
                          {t('librarySearch.includeCount', { count: selectedAutoTags.length })}
                        </span>
                      )}
                      {excludedAutoTags.length > 0 && (
                        <span className="rounded border border-red-700/50 bg-red-900/40 px-2 py-0.5 text-xs text-red-300">
                          {t('librarySearch.excludeCount', { count: excludedAutoTags.length })}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t('libraryTags.deleteAllAutoConfirm'))) removeAutoTags();
                      }}
                      className="text-xs text-gray-400 hover:text-red-400"
                    >
                      {t('librarySearch.clearAll')}
                    </button>
                    {(selectedAutoTags.length > 0 || excludedAutoTags.length > 0) && (
                      <button
                        onClick={clearSelectedAutoTags}
                        className="text-xs text-gray-400 hover:text-red-400 cursor-pointer"
                        title={t('libraryTags.clearAutoFilters')}
                        aria-label={t('libraryTags.clearAutoFilters')}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  {/* Auto-Tag Search */}
                  {availableAutoTags.length > 5 && (
                    <input
                      type="text"
                      placeholder={t('libraryTags.filterAutoTags')}
                      value={autoTagSearchQuery}
                      onChange={(e) => setAutoTagSearchQuery(e.target.value)}
                      className="w-full bg-gray-700 text-gray-200 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder-gray-500"
                    />
                  )}

                  {/* Auto-Tags List */}
                  <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-1">
                    {filteredAutoTags.length === 0 ? (
                      <div className="text-xs text-gray-500 py-2">
                        {t('libraryTags.noAutoTags', { query: autoTagSearchQuery })}
                      </div>
                    ) : (
                      filteredAutoTags.slice(0, 50).map((tag) => (
                        <div
                          key={tag.name}
                          onContextMenu={(event) => handleTagContextMenu(event, tag, true)}
                          className="flex items-center space-x-2 cursor-pointer group py-1 px-2 rounded hover:bg-gray-700/50"
                        >
                          <TriStateToggle
                            mode={getAutoTagFilterMode(tag.name)}
                            onClick={() => handleAutoTagCycle(tag.name)}
                            title={t('libraryTags.autoTagCycle', { tag: tag.name, mode: getFilterModeLabel(getAutoTagFilterMode(tag.name), t) })}
                          />
                          <span className="text-sm text-gray-300 group-hover:text-gray-50 flex-1">
                            {tag.name}
                          </span>
                          <span className="text-xs text-gray-500 group-hover:text-gray-400">
                            {tag.count}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  {filteredAutoTags.length > 50 && (
                    <div className="text-xs text-gray-500 text-center pt-1">
                      {t('libraryTags.topAutoTags', { count: filteredAutoTags.length })}
                    </div>
                  )}
                </div>
              )}

              {/* Empty State */}
              {availableTags.length === 0 && totalFavoriteCount === 0 && availableAutoTags.length === 0 && (
                <div className="text-xs text-gray-500 text-center py-4">
                  {t('libraryTags.empty')}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-[100] min-w-[220px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.tag.count > 0 && (
            <>
              <button
                type="button"
                className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
                onClick={() => {
                  setTagFilterMode(contextMenu.tag.name, 'include', contextMenu.automatic);
                  closeContextMenu();
                }}
              >
                {t('librarySearch.include')}
              </button>
              <button
                type="button"
                className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
                onClick={() => {
                  setTagFilterMode(contextMenu.tag.name, 'exclude', contextMenu.automatic);
                  closeContextMenu();
                }}
              >
                {t('librarySearch.exclude')}
              </button>
              <button
                type="button"
                className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
                onClick={() => {
                  setTagFilterMode(contextMenu.tag.name, 'neutral', contextMenu.automatic);
                  closeContextMenu();
                }}
              >
                {t('libraryTags.clearFilter')}
              </button>

              <div className="my-1 border-t border-gray-700" />
            </>
          )}

          <button
            type="button"
            className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
            onClick={openRenameDialog}
          >
            {t('libraryTags.rename')}
          </button>
          <button
            type="button"
            className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
            onClick={openCreateCollectionDialog}
          >
            {t('libraryGallery.createCollection')}
          </button>
          {!contextMenu.automatic && contextMenu.tag.count > 0 && (
            <button
              type="button"
              className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
              onClick={() => void handleClearFromMenu()}
            >
              <span className="block">{t('libraryTags.clearFromImages')}</span>
              <span className="block text-xs text-gray-500">{t('libraryTags.keepTag')}</span>
            </button>
          )}
          {contextMenu.tag.count === 0 && (
            <button
              type="button"
              className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
              onClick={() => void handleDeleteFromMenu()}
            >
              <span className="block">{t('libraryTags.removeEmpty')}</span>
              <span className="block text-xs text-gray-500">{t('libraryTags.removeEmptyHelp')}</span>
            </button>
          )}

          {contextMenu.tag.count > 0 && (
            <>
              <div className="my-1 border-t border-gray-700" />

              <button
                type="button"
                className="w-full px-4 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-900/30"
                onClick={() => void handlePurgeFromMenu()}
              >
                <span className="block">{contextMenu.automatic ? t('libraryTags.deleteAllImages') : t('libraryTags.clearDelete')}</span>
                {!contextMenu.automatic && <span className="block text-xs text-red-200/80">{t('libraryTags.clearDeleteHelp')}</span>}
              </button>
            </>
          )}
        </div>,
        document.body,
      )}

      <CollectionFormModal
        isOpen={collectionSourceTag !== null}
        title={t('libraryGallery.createCollection')}
        submitLabel={t('libraryGallery.createCollection')}
        initialValues={{
          name: collectionSourceTag?.tag.name ?? '',
          description: '',
          sourceTag: collectionSourceTag?.tag.name ?? '',
          autoUpdate: true,
          includeTargetImages: false,
        }}
        onClose={() => setCollectionSourceTag(null)}
        onSubmit={handleCreateCollection}
        showSourceTag={!collectionSourceTag?.automatic}
        disableSourceTag
        showAutoUpdate={!collectionSourceTag?.automatic}
      />

      {renameDialog.isOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onClick={closeRenameDialog}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-4 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={t('libraryTags.renameAccessible')}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-white">{t('libraryTags.rename')}</h3>
              <p className="mt-1 text-xs text-gray-400">
                {t('libraryTags.renameHelp')}
              </p>
            </div>

            <input
              ref={renameInputRef}
              type="text"
              value={renameDialog.value}
              onChange={(event) => setRenameDialog((current) => ({ ...current, value: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleRenameSubmit();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeRenameDialog();
                }
              }}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder={t('libraryTags.tagName')}
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
                onClick={closeRenameDialog}
              >
                {t('libraryFolders.cancel')}
              </button>
              <button
                type="button"
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 hover:text-gray-950"
                onClick={() => void handleRenameSubmit()}
              >
                {t('libraryFolders.rename')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TagsAndFavorites;
