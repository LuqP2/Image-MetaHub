import { create } from 'zustand';
import { IndexedImage, FavoriteImage, indexedImageToFavorite } from '../types';

interface FavoritesState {
  favorites: FavoriteImage[];
  favoriteIds: Set<string>;
  isLoaded: boolean;
  loadFavorites: () => Promise<void>;
  addFavorite: (image: IndexedImage) => Promise<void>;
  removeFavorite: (imageId: string) => Promise<void>;
  toggleFavorite: (image: IndexedImage) => Promise<boolean>;
  isFavorite: (imageId: string) => boolean;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: [],
  favoriteIds: new Set(),
  isLoaded: false,

  /**
   * Loads the initial list of favorites from the main process.
   */
  loadFavorites: async () => {
    if (get().isLoaded) return;

    try {
      const result = await window.electronAPI.getFavorites();
      if (result.success) {
        const favorites = result.favorites || [];
        const favoriteIds = new Set(favorites.map((fav) => fav.id));
        set({ favorites, favoriteIds, isLoaded: true });
      } else {
        console.error('Failed to load favorites:', result.error);
        set({ isLoaded: true }); // Mark as loaded even on error to prevent retries
      }
    } catch (error) {
      console.error('Error calling getFavorites:', error);
      set({ isLoaded: true });
    }
  },

  /**
   * Adds an image to the favorites and updates the state.
   * @param image The image to add.
   */
  addFavorite: async (image) => {
    try {
      const favoriteImage = indexedImageToFavorite(image);
      const result = await window.electronAPI.addFavorite(favoriteImage);
      if (result.success) {
        const favorites = result.favorites || [];
        const favoriteIds = new Set(favorites.map((fav) => fav.id));
        set({ favorites, favoriteIds });
      } else {
        console.error('Failed to add favorite:', result.error);
      }
    } catch (error) {
      console.error('Error calling addFavorite:', error);
    }
  },

  /**
   * Removes an image from the favorites and updates the state.
   * @param imageId The ID of the image to remove.
   */
  removeFavorite: async (imageId) => {
    try {
      const result = await window.electronAPI.removeFavorite(imageId);
      if (result.success) {
        const favorites = result.favorites || [];
        const favoriteIds = new Set(favorites.map((fav) => fav.id));
        set({ favorites, favoriteIds });
      } else {
        console.error('Failed to remove favorite:', result.error);
      }
    } catch (error) {
      console.error('Error calling removeFavorite:', error);
    }
  },

  /**
   * Toggles the favorite status of an image.
   * @param image The image to toggle.
   * @returns {Promise<boolean>} The new favorite status.
   */
  toggleFavorite: async (image) => {
    const isCurrentlyFavorite = get().isFavorite(image.id);
    if (isCurrentlyFavorite) {
      await get().removeFavorite(image.id);
      return false;
    } else {
      await get().addFavorite(image);
      return true;
    }
  },

  /**
   * Checks if an image is in the favorites.
   * @param imageId The ID of the image to check.
   * @returns {boolean} True if the image is a favorite, false otherwise.
   */
  isFavorite: (imageId) => {
    return get().favoriteIds.has(imageId);
  },
}));
