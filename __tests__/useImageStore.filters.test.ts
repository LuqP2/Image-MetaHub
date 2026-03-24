import { beforeEach, describe, expect, it } from 'vitest';
import type { Directory, IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

const directory: Directory = {
  id: 'dir-1',
  name: 'Library',
  path: 'D:/library',
  handle: {} as FileSystemDirectoryHandle,
  visible: true,
};

const createImage = (
  id: string,
  name: string,
  options: {
    isFavorite?: boolean;
    tags?: string[];
  } = {}
): IndexedImage => ({
  id,
  name,
  handle: {} as FileSystemFileHandle,
  metadata: {} as IndexedImage['metadata'],
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  directoryId: directory.id,
  directoryName: directory.name,
  isFavorite: options.isFavorite,
  tags: options.tags,
});

const images: IndexedImage[] = [
  createImage('dir-1::favorite-portrait.png', 'favorite-portrait.png', {
    isFavorite: true,
    tags: ['portrait', 'warm'],
  }),
  createImage('dir-1::portrait.png', 'portrait.png', {
    tags: ['portrait'],
  }),
  createImage('dir-1::landscape.png', 'landscape.png', {
    isFavorite: true,
    tags: ['landscape'],
  }),
  createImage('dir-1::untagged.png', 'untagged.png'),
];

describe('useImageStore filter toggles', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      enableSafeMode: false,
      blurSensitiveImages: true,
      sensitiveTags: ['nsfw', 'private', 'hidden'],
    });

    useImageStore.getState().resetState();
    useImageStore.setState({
      directories: [directory],
      images,
      filteredImages: images,
      isAnnotationsLoaded: true,
    });
    useImageStore.getState().filterAndSortImages();
  });

  it('includes and excludes favorites with the tri-state filter', () => {
    useImageStore.getState().setFavoriteFilterMode('include');
    expect(useImageStore.getState().filteredImages.map((image) => image.id)).toEqual([
      'dir-1::landscape.png',
      'dir-1::favorite-portrait.png',
    ]);

    useImageStore.getState().setFavoriteFilterMode('exclude');
    expect(useImageStore.getState().filteredImages.map((image) => image.id)).toEqual([
      'dir-1::untagged.png',
      'dir-1::portrait.png',
    ]);

    useImageStore.getState().setFavoriteFilterMode('neutral');
    expect(useImageStore.getState().filteredImages).toHaveLength(4);
  });

  it('combines included and excluded tag filters', () => {
    useImageStore.getState().setSelectedTags(['portrait']);
    expect(useImageStore.getState().filteredImages.map((image) => image.id)).toEqual([
      'dir-1::portrait.png',
      'dir-1::favorite-portrait.png',
    ]);

    useImageStore.getState().setExcludedTags(['warm']);
    expect(useImageStore.getState().filteredImages.map((image) => image.id)).toEqual([
      'dir-1::portrait.png',
    ]);

    useImageStore.getState().setSelectedTags([]);
    useImageStore.getState().setExcludedTags(['portrait']);
    expect(useImageStore.getState().filteredImages.map((image) => image.id)).toEqual([
      'dir-1::untagged.png',
      'dir-1::landscape.png',
    ]);
  });
});
