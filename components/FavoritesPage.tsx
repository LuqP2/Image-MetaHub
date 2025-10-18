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
  const [sortOrder, setSortOrder] = useState('lastModified');

  // Filter selected images to only show those that are favorites
  const favoriteSelectedImages = useMemo(() => {
    const favoriteIds = new Set(favorites.map(fav => fav.id));
    return new Set(Array.from(selectedImages).filter(id => favoriteIds.has(id)));
  }, [selectedImages, favorites]);

  const sortedFavorites = useMemo(() => {
    const sorted = [...favorites].sort((a, b) => {
      if (sortOrder === 'name') {
        return a.name.localeCompare(b.name);
      }
      // Default to date
      return b.lastModified - a.lastModified;
    });

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

  // Convert FavoriteImage[] to IndexedImage[] for compatibility with existing components
  const indexedFavorites = useMemo(() => {
    return sortedFavorites.map(fav => ({
      ...fav,
      handle: undefined as unknown as FileSystemFileHandle, // FavoriteImage doesn't have handles
      thumbnailHandle: undefined,
      thumbnailUrl: undefined,
    }));
  }, [sortedFavorites]);

  return (
    <>
      <ActionToolbar
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        selectedCount={favoriteSelectedImages.size}
        onClearSelection={clearSelection}
        onDeleteSelected={handleDeleteSelectedImages}
        viewMode={viewMode}
        onViewModeChange={toggleViewMode}
      />
      <div className="flex-1 min-h-0">
        {viewMode === 'grid' ? (
          <ImageGrid
            images={indexedFavorites}
            onImageClick={handleImageSelection}
            selectedImages={favoriteSelectedImages}
          />
        ) : (
          <ImageTable
            images={indexedFavorites}
            onImageClick={handleImageSelection}
            selectedImages={favoriteSelectedImages}
          />
        )}
      </div>
    </>
  );
};

export default FavoritesPage;
