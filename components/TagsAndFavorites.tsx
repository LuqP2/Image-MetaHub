import React, { useMemo, useState } from 'react';
import { ChevronDown, Star, Tag, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useImageStore } from '../store/useImageStore';
import { InclusionFilterMode, TagInfo } from '../types';
import TriStateToggle, { getFilterModeLabel, getNextFilterMode } from './TriStateToggle';
import { getRatingChipClasses } from './RatingStars';

type TagContextMenuState = {
  x: number;
  y: number;
  tag: TagInfo;
};

type RenameDialogState = {
  isOpen: boolean;
  sourceTag: string;
  value: string;
};

const TagsAndFavorites: React.FC = () => {
  const favoriteFilterMode = useImageStore((state) => state.favoriteFilterMode);
  const setFavoriteFilterMode = useImageStore((state) => state.setFavoriteFilterMode);
  const selectedRatings = useImageStore((state) => state.selectedRatings);
  const setSelectedRatings = useImageStore((state) => state.setSelectedRatings);
  const availableTags = useImageStore((state) => state.availableTags);
  const availableAutoTags = useImageStore((state) => state.availableAutoTags);
  const selectedTags = useImageStore((state) => state.selectedTags);
  const excludedTags = useImageStore((state) => state.excludedTags);
  const selectedAutoTags = useImageStore((state) => state.selectedAutoTags);
  const excludedAutoTags = useImageStore((state) => state.excludedAutoTags);
  const setSelectedTags = useImageStore((state) => state.setSelectedTags);
  const setExcludedTags = useImageStore((state) => state.setExcludedTags);
  const setSelectedAutoTags = useImageStore((state) => state.setSelectedAutoTags);
  const setExcludedAutoTags = useImageStore((state) => state.setExcludedAutoTags);
  const renameTag = useImageStore((state) => state.renameTag);
  const clearTag = useImageStore((state) => state.clearTag);
  const deleteTag = useImageStore((state) => state.deleteTag);
  const purgeTag = useImageStore((state) => state.purgeTag);
  const refreshAvailableAutoTags = useImageStore((state) => state.refreshAvailableAutoTags);
  const filteredImages = useImageStore((state) => state.filteredImages);
  const images = useImageStore((state) => state.images);
  const indexingState = useImageStore((state) => state.indexingState);

  const [isExpanded, setIsExpanded] = useState(true);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [autoTagSearchQuery, setAutoTagSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<TagContextMenuState | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState>({
    isOpen: false,
    sourceTag: '',
    value: '',
  });
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
  const quickRatingOptions = [1, 2, 3, 4, 5] as const;
  const quickRatingCounts = useMemo(
    () => new Map(
      quickRatingOptions.map((value) => [
        value,
        isIndexing ? 0 : images.filter((img) => img.rating === value).length,
      ]),
    ),
    [images, isIndexing]
  );

  const toggleSelectedRating = (value: typeof quickRatingOptions[number]) => {
    setSelectedRatings(
      selectedRatings.includes(value)
        ? selectedRatings.filter((rating) => rating !== value)
        : [...selectedRatings, value],
    );
  };

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
    const currentMode = getAutoTagFilterMode(tagName);
    const nextMode = getNextFilterMode(currentMode);

    if (nextMode === 'include') {
      setSelectedAutoTags([...selectedAutoTags.filter(t => t !== tagName), tagName]);
      setExcludedAutoTags(excludedAutoTags.filter(t => t !== tagName));
      return;
    }

    if (nextMode === 'exclude') {
      setSelectedAutoTags(selectedAutoTags.filter(t => t !== tagName));
      setExcludedAutoTags([...excludedAutoTags.filter(t => t !== tagName), tagName]);
      return;
    }

    setSelectedAutoTags(selectedAutoTags.filter(t => t !== tagName));
    setExcludedAutoTags(excludedAutoTags.filter(t => t !== tagName));
  };

  const clearSelectedTags = () => {
    setSelectedTags([]);
    setExcludedTags([]);
  };

  const clearSelectedAutoTags = () => {
    setSelectedAutoTags([]);
    setExcludedAutoTags([]);
  };

  const setTagFilterMode = (tagName: string, mode: InclusionFilterMode) => {
    if (mode === 'include') {
      setSelectedTags([...selectedTags.filter(t => t !== tagName), tagName]);
      setExcludedTags(excludedTags.filter(t => t !== tagName));
      return;
    }

    if (mode === 'exclude') {
      setSelectedTags(selectedTags.filter(t => t !== tagName));
      setExcludedTags([...excludedTags.filter(t => t !== tagName), tagName]);
      return;
    }

    setSelectedTags(selectedTags.filter(t => t !== tagName));
    setExcludedTags(excludedTags.filter(t => t !== tagName));
  };

  const handleTagContextMenu = (event: React.MouseEvent, tag: TagInfo) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 220;
    const menuHeight = 260;
    const maxX = Math.max(12, window.innerWidth - menuWidth - 12);
    const maxY = Math.max(12, window.innerHeight - menuHeight - 12);

    setContextMenu({
      x: Math.min(event.clientX, maxX),
      y: Math.min(event.clientY, maxY),
      tag,
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  const openRenameDialog = () => {
    if (!contextMenu) {
      return;
    }

    setRenameDialog({
      isOpen: true,
      sourceTag: contextMenu.tag.name,
      value: contextMenu.tag.name,
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
    await renameTag(sourceTag, nextName);
  };

  const handleTagAction = async (action: () => Promise<void>) => {
    closeContextMenu();
    await action();
  };

  const handleClearFromMenu = async () => {
    if (!contextMenu) {
      return;
    }

    const confirmed = window.confirm(
      `Clear tag "${contextMenu.tag.name}" from all images?\n\nThe tag will remain in the library as an empty tag.`,
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
        `Tag "${contextMenu.tag.name}" is still used by ${contextMenu.tag.count} image(s) and cannot be deleted directly.\n\nDo you want to purge it instead?`,
      );

      if (shouldPurge) {
        await handlePurgeFromMenu();
      }
      return;
    }

    const confirmed = window.confirm(`Delete empty tag "${contextMenu.tag.name}" from the library?`);
    if (!confirmed) {
      return;
    }

    await handleTagAction(() => deleteTag(contextMenu.tag.name));
  };

  const handlePurgeFromMenu = async () => {
    if (!contextMenu) {
      return;
    }

    const confirmed = window.confirm(
      `Purge tag "${contextMenu.tag.name}"?\n\nThis will remove it from all images and then delete the tag from the library. This cannot be undone.`,
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
    selectedRatings.length === 0
  ) {
    return null;
  }

  return (
    <div className="border-b border-gray-700">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <span className="text-gray-300 font-medium">Ratings, Favorites & Tags</span>
          {(selectedRatings.length > 0 || favoriteFilterMode !== 'neutral' || selectedTags.length > 0 || excludedTags.length > 0 || selectedAutoTags.length > 0 || excludedAutoTags.length > 0) && (
            <span className="rounded border border-gray-700 bg-gray-900 px-2 py-0.5 text-xs text-gray-300">
              active
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
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Star className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-400 font-medium">Rating</span>
                    {selectedRatings.length > 0 && (
                      <span className="rounded border border-gray-700 bg-gray-900 px-2 py-0.5 text-xs text-gray-300">
                        {selectedRatings.join(', ')}
                      </span>
                    )}
                  </div>
                  {selectedRatings.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedRatings([])}
                      className="text-xs text-gray-400 hover:text-red-400 cursor-pointer"
                      title="Clear rating filters"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedRatings([])}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      selectedRatings.length === 0
                        ? 'border-gray-600 bg-gray-800 text-gray-100'
                        : 'border-gray-700 bg-gray-800/70 text-gray-300 hover:border-gray-600 hover:text-gray-100'
                    }`}
                  >
                    All
                  </button>
                  {quickRatingOptions.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleSelectedRating(value)}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs font-semibold tabular-nums transition-colors ${getRatingChipClasses(value, selectedRatings.includes(value))}`}
                      title={`${quickRatingCounts.get(value) ?? 0} images rated ${value}`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              {/* Favorites Toggle */}
              {totalFavoriteCount > 0 && (
                <div className="flex items-center space-x-2 group py-1 px-2 rounded hover:bg-gray-700/50">
                  <TriStateToggle
                    mode={favoriteFilterMode}
                    onClick={() => setFavoriteFilterMode(getNextFilterMode(favoriteFilterMode))}
                    title={`Favorites filter: ${getFilterModeLabel(favoriteFilterMode)}. Click to cycle.`}
                  />
                  <Star
                    className={`w-4 h-4 ${
                      favoriteFilterMode === 'include'
                        ? 'text-yellow-400 fill-yellow-400'
                        : favoriteFilterMode === 'exclude'
                          ? 'text-red-300'
                          : 'text-gray-400 group-hover:text-yellow-400'
                    }`}
                  />
                  <span className="text-sm text-gray-300 group-hover:text-gray-50 flex-1">
                    {favoriteFilterMode === 'include'
                      ? 'Show Favorites Only'
                      : favoriteFilterMode === 'exclude'
                        ? 'Exclude Favorites'
                        : 'Favorites'}
                  </span>
                  <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded border border-gray-600">
                    {favoriteBadgeCount}
                  </span>
                </div>
              )}

              {/* Tags Section */}
              {availableTags.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Tag className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-400 font-medium">Tags</span>
                      {selectedTags.length > 0 && (
                        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-0.5 text-xs text-gray-300">
                          {selectedTags.length} include
                        </span>
                      )}
                      {excludedTags.length > 0 && (
                        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-0.5 text-xs text-gray-300">
                          {excludedTags.length} exclude
                        </span>
                      )}
                    </div>
                    {(selectedTags.length > 0 || excludedTags.length > 0) && (
                      <button
                        type="button"
                        onClick={clearSelectedTags}
                        className="text-xs text-gray-400 hover:text-red-400 cursor-pointer"
                        title="Clear tag filters"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  {/* Tag Search */}
                  {availableTags.length > 5 && (
                    <input
                      type="text"
                      placeholder="Filter tags..."
                      value={tagSearchQuery}
                      onChange={(e) => setTagSearchQuery(e.target.value)}
                      className="w-full rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 bg-gray-900 border border-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-500"
                    />
                  )}

                  {/* Tags List */}
                  <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-1">
                    {filteredTags.length === 0 ? (
                      <div className="text-xs text-gray-500 py-2">
                        No tags match "{tagSearchQuery}"
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
                            title={`Tag "${tag.name}": ${getFilterModeLabel(getTagFilterMode(tag.name))}. Click to cycle.`}
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
                      {filteredTags.length} of {availableTags.length} tags
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
                      <span className="text-sm text-gray-400 font-medium">Auto Tags</span>
                      {selectedAutoTags.length > 0 && (
                        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-0.5 text-xs text-gray-300">
                          {selectedAutoTags.length} include
                        </span>
                      )}
                      {excludedAutoTags.length > 0 && (
                        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-0.5 text-xs text-gray-300">
                          {excludedAutoTags.length} exclude
                        </span>
                      )}
                    </div>
                    {(selectedAutoTags.length > 0 || excludedAutoTags.length > 0) && (
                      <button
                        onClick={clearSelectedAutoTags}
                        className="text-xs text-gray-400 hover:text-red-400 cursor-pointer"
                        title="Clear auto-tag filters"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  {/* Auto-Tag Search */}
                  {availableAutoTags.length > 5 && (
                    <input
                      type="text"
                      placeholder="Filter auto-tags..."
                      value={autoTagSearchQuery}
                      onChange={(e) => setAutoTagSearchQuery(e.target.value)}
                      className="w-full rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 bg-gray-900 border border-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-500"
                    />
                  )}

                  {/* Auto-Tags List */}
                  <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-1">
                    {filteredAutoTags.length === 0 ? (
                      <div className="text-xs text-gray-500 py-2">
                        No auto-tags match "{autoTagSearchQuery}"
                      </div>
                    ) : (
                      filteredAutoTags.slice(0, 50).map((tag) => (
                        <div
                          key={tag.name}
                          className="flex items-center space-x-2 cursor-pointer group py-1 px-2 rounded hover:bg-gray-700/50"
                        >
                          <TriStateToggle
                            mode={getAutoTagFilterMode(tag.name)}
                            onClick={() => handleAutoTagCycle(tag.name)}
                            title={`Auto-tag "${tag.name}": ${getFilterModeLabel(getAutoTagFilterMode(tag.name))}. Click to cycle.`}
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
                      Showing top 50 of {filteredAutoTags.length} auto-tags
                    </div>
                  )}
                </div>
              )}

              {/* Empty State */}
              {availableTags.length === 0 && totalFavoriteCount === 0 && availableAutoTags.length === 0 && (
                <div className="text-xs text-gray-500 text-center py-4">
                  No favorites or tags yet
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[220px] rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.tag.count > 0 && (
            <>
              <button
                type="button"
                className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
                onClick={() => {
                  setTagFilterMode(contextMenu.tag.name, 'include');
                  closeContextMenu();
                }}
              >
                Include
              </button>
              <button
                type="button"
                className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
                onClick={() => {
                  setTagFilterMode(contextMenu.tag.name, 'exclude');
                  closeContextMenu();
                }}
              >
                Exclude
              </button>
              <button
                type="button"
                className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
                onClick={() => {
                  setTagFilterMode(contextMenu.tag.name, 'neutral');
                  closeContextMenu();
                }}
              >
                Clear Filter
              </button>

              <div className="my-1 border-t border-gray-700" />
            </>
          )}

          <button
            type="button"
            className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
            onClick={openRenameDialog}
          >
            Rename Tag
          </button>
          {contextMenu.tag.count > 0 && (
            <button
              type="button"
              className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
              onClick={() => void handleClearFromMenu()}
            >
              <span className="block">Clear From Images</span>
              <span className="block text-xs text-gray-500">Keep the tag in the library</span>
            </button>
          )}
          {contextMenu.tag.count === 0 && (
            <button
              type="button"
              className="w-full px-4 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700"
              onClick={() => void handleDeleteFromMenu()}
            >
              <span className="block">Remove Empty Tag</span>
              <span className="block text-xs text-gray-500">Removes only the unused library entry</span>
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
                <span className="block">Clear and Delete</span>
                <span className="block text-xs text-red-200/80">Removes the tag from images, then deletes the tag</span>
              </button>
            </>
          )}
        </div>
      )}

      {renameDialog.isOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onClick={closeRenameDialog}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-4 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Rename tag"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-white">Rename Tag</h3>
              <p className="mt-1 text-xs text-gray-400">
                Renaming to an existing tag will merge both tags.
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
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-gray-500 focus:ring-1 focus:ring-gray-500"
              placeholder="Tag name"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
                onClick={closeRenameDialog}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-white"
                onClick={() => void handleRenameSubmit()}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TagsAndFavorites;
