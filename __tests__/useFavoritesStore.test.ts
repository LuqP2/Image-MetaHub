import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFavoritesStore } from '../store/useFavoritesStore';
import { IndexedImage } from '../types';

// Mock the electronAPI
const mockFavorites = [] as IndexedImage[];
global.window = {
  electronAPI: {
    getFavorites: vi.fn().mockResolvedValue({ success: true, favorites: mockFavorites }),
    addFavorite: vi.fn().mockImplementation(async (image) => {
      if (!mockFavorites.some(f => f.id === image.id)) {
        mockFavorites.push(image);
      }
      return { success: true, favorites: [...mockFavorites] };
    }),
    removeFavorite: vi.fn().mockImplementation(async (imageId) => {
      const index = mockFavorites.findIndex(f => f.id === imageId);
      if (index > -1) {
        mockFavorites.splice(index, 1);
      }
      return { success: true, favorites: [...mockFavorites] };
    }),
  },
} as any;

const mockImage: IndexedImage = {
  id: 'test-image-1',
  name: 'test.png',
  directoryId: 'dir-1',
  lastModified: Date.now(),
  handle: {} as any,
  metadata: {},
};


describe('useFavoritesStore', () => {
  beforeEach(() => {
    // Reset store state and mocks before each test
    useFavoritesStore.setState({
        favorites: [],
        favoriteIds: new Set(),
        isLoaded: false,
    });
    mockFavorites.length = 0;
    vi.clearAllMocks();
  });

  it('should load favorites from the backend', async () => {
    mockFavorites.push(mockImage);
    await useFavoritesStore.getState().loadFavorites();
    expect(window.electronAPI.getFavorites).toHaveBeenCalledTimes(1);
    expect(useFavoritesStore.getState().favorites).toHaveLength(1);
    expect(useFavoritesStore.getState().favorites[0].id).toBe('test-image-1');
    expect(useFavoritesStore.getState().isFavorite('test-image-1')).toBe(true);
  });

  it('should add a favorite', async () => {
    await useFavoritesStore.getState().addFavorite(mockImage);
    expect(window.electronAPI.addFavorite).toHaveBeenCalledWith(mockImage);
    expect(useFavoritesStore.getState().favorites).toHaveLength(1);
    expect(useFavoritesStore.getState().isFavorite('test-image-1')).toBe(true);
  });

  it('should remove a favorite', async () => {
    // Add first
    await useFavoritesStore.getState().addFavorite(mockImage);
    expect(useFavoritesStore.getState().favorites).toHaveLength(1);

    // Then remove
    await useFavoritesStore.getState().removeFavorite(mockImage.id);
    expect(window.electronAPI.removeFavorite).toHaveBeenCalledWith(mockImage.id);
    expect(useFavoritesStore.getState().favorites).toHaveLength(0);
    expect(useFavoritesStore.getState().isFavorite('test-image-1')).toBe(false);
  });

  it('should toggle a favorite', async () => {
    // Add
    let isFav = await useFavoritesStore.getState().toggleFavorite(mockImage);
    expect(isFav).toBe(true);
    expect(useFavoritesStore.getState().isFavorite('test-image-1')).toBe(true);
    expect(useFavoritesStore.getState().favorites).toHaveLength(1);

    // Remove
    isFav = await useFavoritesStore.getState().toggleFavorite(mockImage);
    expect(isFav).toBe(false);
    expect(useFavoritesStore.getState().isFavorite('test-image-1')).toBe(false);
    expect(useFavoritesStore.getState().favorites).toHaveLength(0);
  });
});
