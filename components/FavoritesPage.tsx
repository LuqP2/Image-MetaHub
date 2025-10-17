import React, { useState, useMemo } from 'react';
import { useFavoritesStore } from '../store/useFavoritesStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageSelection } from '../hooks/useImageSelection';
import ImageGrid from './ImageGrid';
import ImageTable from './ImageTable';
import ActionToolbar from './ActionToolbar';

const FavoritesPage: React.FC = () => {
  const favorites = useFavoritesStore((state) => state.favorites);
  const { viewMode, toggleViewMode } = useSettingsStore();
  const { selectedImages, handleImageSelection, clearSelection, handleDeleteSelectedImages } = useImageSelection();
  const [sortOrder, setSortOrder] = useState({ key: 'lastModified', direction: 'desc' });

  const sortedFavorites = useMemo(() => {
    const sorted = [...favorites].sort((a, b) => {
      if (sortOrder.key === 'name') {
        return a.name.localeCompare(b.name);
      }
      // Default to date
      return b.lastModified - a.lastModified;
    });

    if (sortOrder.direction === 'asc') {
      return sorted.reverse();
    }
    return sorted;
  }, [favorites, sortOrder]);

  if (favorites.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <h2 className="text-2xl font-bold mb-2">No Favorites Yet</h2>
        <p>You can add images to your favorites from the image gallery or the image detail view.</p>
      </div>
    );
  }

  return (
    <>
      <ActionToolbar
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        selectedCount={selectedImages.size}
        onClearSelection={clearSelection}
        onDeleteSelected={handleDeleteSelectedImages}
        viewMode={viewMode}
        onViewModeChange={toggleViewMode}
      />
      <div className="flex-1 min-h-0">
        {viewMode === 'grid' ? (
          <ImageGrid
            images={sortedFavorites}
            onImageClick={handleImageSelection}
            selectedImages={selectedImages}
          />
        ) : (
          <ImageTable
            images={sortedFavorites}
            onImageClick={handleImageSelection}
            selectedImages={selectedImages}
          />
        )}
      </div>
    </>
  );
};

export default FavoritesPage;
