import React, { useState } from 'react';
import { ChevronDown, X, Star, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useImageStore } from '../store/useImageStore';

const TagsAndFavorites: React.FC = () => {
  const {
    showFavoritesOnly,
    setShowFavoritesOnly,
    availableTags,
    availableAutoTags,
    selectedTags,
    selectedAutoTags,
    setSelectedTags,
    setSelectedAutoTags,
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

  // Get tags only from current images (not all from IndexedDB)
  const currentImagesTags = React.useMemo(() => {
    const tagCounts = new Map<string, number>();
    for (const image of images) {
      if (image.tags) {
        for (const tag of image.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
    }
    return Array.from(tagCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [images]);

  // Filter tags by search query
  const filteredTags = tagSearchQuery
    ? currentImagesTags.filter(tag =>
        tag.name.toLowerCase().includes(tagSearchQuery.toLowerCase())
      )
    : currentImagesTags;

  // Filter auto-tags by search query (from store, already calculated)
  const filteredAutoTags = autoTagSearchQuery
    ? availableAutoTags.filter(tag =>
        tag.name.toLowerCase().includes(autoTagSearchQuery.toLowerCase())
      )
    : availableAutoTags;

  const handleTagToggle = (tagName: string, checked: boolean) => {
    if (checked) {
      setSelectedTags([...selectedTags, tagName]);
    } else {
      setSelectedTags(selectedTags.filter(t => t !== tagName));
    }
  };

  const handleAutoTagToggle = (tagName: string, checked: boolean) => {
    if (checked) {
      setSelectedAutoTags([...selectedAutoTags, tagName]);
    } else {
      setSelectedAutoTags(selectedAutoTags.filter(t => t !== tagName));
    }
  };

  const clearSelectedTags = () => {
    setSelectedTags([]);
  };

  const clearSelectedAutoTags = () => {
    setSelectedAutoTags([]);
  };

  // Don't render if no tags or favorites exist in current images
  if (currentImagesTags.length === 0 && totalFavoriteCount === 0) {
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
          {(showFavoritesOnly || selectedTags.length > 0) && (
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
                <label className="flex items-center space-x-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={showFavoritesOnly}
                    onChange={(e) => setShowFavoritesOnly(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                  />
                  <Star
                    className={`w-4 h-4 ${showFavoritesOnly ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400 group-hover:text-yellow-400'}`}
                  />
                  <span className="text-sm text-gray-300 group-hover:text-gray-50">
                    Show Favorites Only
                  </span>
                  <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded border border-gray-600">
                    {favoriteCount}
                  </span>
                </label>
              )}

              {/* Tags Section */}
              {currentImagesTags.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Tag className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-400 font-medium">Tags</span>
                      {selectedTags.length > 0 && (
                        <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded border border-blue-700/50">
                          {selectedTags.length} selected
                        </span>
                      )}
                    </div>
                    {selectedTags.length > 0 && (
                      <button
                        onClick={clearSelectedTags}
                        className="text-xs text-gray-400 hover:text-red-400 cursor-pointer"
                        title="Clear tag filters"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  {/* Tag Search */}
                  {currentImagesTags.length > 5 && (
                    <input
                      type="text"
                      placeholder="Filter tags..."
                      value={tagSearchQuery}
                      onChange={(e) => setTagSearchQuery(e.target.value)}
                      className="w-full bg-gray-700 text-gray-200 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
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
                        <label
                          key={tag.name}
                          className="flex items-center space-x-2 cursor-pointer group py-1 px-2 rounded hover:bg-gray-700/50"
                        >
                          <input
                            type="checkbox"
                            checked={selectedTags.includes(tag.name)}
                            onChange={(e) => handleTagToggle(tag.name, e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                          />
                          <span className="text-sm text-gray-300 group-hover:text-gray-50 flex-1">
                            {tag.name}
                          </span>
                          <span className="text-xs text-gray-500 group-hover:text-gray-400">
                            {tag.count}
                          </span>
                        </label>
                      ))
                    )}
                  </div>

                  {filteredTags.length > 0 && currentImagesTags.length > filteredTags.length && (
                    <div className="text-xs text-gray-500 text-center pt-1">
                      {filteredTags.length} of {currentImagesTags.length} tags
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
                          {selectedAutoTags.length} selected
                        </span>
                      )}
                    </div>
                    {selectedAutoTags.length > 0 && (
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

                  {/* Auto-Tags List */}
                  <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-1">
                    {filteredAutoTags.length === 0 ? (
                      <div className="text-xs text-gray-500 py-2">
                        No auto-tags match "{autoTagSearchQuery}"
                      </div>
                    ) : (
                      filteredAutoTags.slice(0, 50).map((tag) => (
                        <label
                          key={tag.name}
                          className="flex items-center space-x-2 cursor-pointer group py-1 px-2 rounded hover:bg-gray-700/50"
                        >
                          <input
                            type="checkbox"
                            checked={selectedAutoTags.includes(tag.name)}
                            onChange={(e) => handleAutoTagToggle(tag.name, e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                          />
                          <span className="text-sm text-gray-300 group-hover:text-gray-50 flex-1">
                            {tag.name}
                          </span>
                          <span className="text-xs text-gray-500 group-hover:text-gray-400">
                            {tag.count}
                          </span>
                        </label>
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
              {currentImagesTags.length === 0 && totalFavoriteCount === 0 && (
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
