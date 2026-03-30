import React, { useState } from 'react';
import { ChevronDown, Star, Tag, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useImageStore } from '../store/useImageStore';
import { InclusionFilterMode } from '../types';
import TriStateToggle, { getFilterModeLabel, getNextFilterMode } from './TriStateToggle';

const TagsAndFavorites: React.FC = () => {
  const {
    favoriteFilterMode,
    setFavoriteFilterMode,
    availableTags,
    availableAutoTags,
    selectedTags,
    excludedTags,
    selectedAutoTags,
    excludedAutoTags,
    setSelectedTags,
    setExcludedTags,
    setSelectedAutoTags,
    setExcludedAutoTags,
    refreshAvailableAutoTags,
    filteredImages,
    images, // All images in current folder(s)
  } = useImageStore();

  const [isExpanded, setIsExpanded] = useState(true);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [autoTagSearchQuery, setAutoTagSearchQuery] = useState('');

  // Refresh auto-tags when images change
  React.useEffect(() => {
    refreshAvailableAutoTags();
  }, [images, refreshAvailableAutoTags]);

  // Count favorites in ALL current images (not just filtered)
  const totalFavoriteCount = images.filter(img => img.isFavorite).length;

  // Count favorites in filtered set (for display)
  const favoriteCount = filteredImages.filter(img => img.isFavorite).length;
  const favoriteBadgeCount = favoriteFilterMode === 'include' ? favoriteCount : totalFavoriteCount;

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

  // Don't render if no favorites, tags, or auto-tags exist
  if (availableTags.length === 0 && totalFavoriteCount === 0 && availableAutoTags.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-gray-700">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <span className="text-gray-300 font-medium">Favorites & Tags</span>
          {(favoriteFilterMode !== 'neutral' || selectedTags.length > 0 || excludedTags.length > 0 || selectedAutoTags.length > 0 || excludedAutoTags.length > 0) && (
            <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded border border-blue-700/50">
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
                        <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded border border-blue-700/50">
                          {selectedTags.length} include
                        </span>
                      )}
                      {excludedTags.length > 0 && (
                        <span className="text-xs bg-red-900/40 text-red-300 px-2 py-0.5 rounded border border-red-700/50">
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
                      className="w-full bg-gray-700 text-gray-200 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
                    />
                  )}

                  <p className="text-[11px] text-gray-500">
                    Click a tag to cycle include, exclude, and off.
                  </p>

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
                        <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded border border-blue-700/50">
                          {selectedAutoTags.length} include
                        </span>
                      )}
                      {excludedAutoTags.length > 0 && (
                        <span className="text-xs bg-red-900/40 text-red-300 px-2 py-0.5 rounded border border-red-700/50">
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
                      className="w-full bg-gray-700 text-gray-200 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder-gray-500"
                    />
                  )}

                  <p className="text-[11px] text-gray-500">
                    Click an auto-tag to cycle include, exclude, and off.
                  </p>

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
    </div>
  );
};

export default TagsAndFavorites;
