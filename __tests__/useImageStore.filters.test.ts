import { beforeEach, describe, expect, it } from 'vitest';
import { Directory, IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

const directory: Directory = {
  id: 'dir-1',
  name: 'Library',
  path: 'D:/library',
  handle: {} as FileSystemDirectoryHandle,
  visible: true,
};

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: `dir-1::${overrides.name ?? 'image.png'}`,
  name: overrides.name ?? 'image.png',
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  sampler: '',
  scheduler: '',
  directoryId: 'dir-1',
  ...overrides,
});

const imageA = createImage({
  name: 'a.png',
  isFavorite: true,
  tags: ['portrait', 'warm'],
  autoTags: ['cinematic'],
  models: ['modelA'],
  loras: ['loraA'],
  steps: 20,
  cfgScale: 7,
  sampler: 'euler_a',
  scheduler: 'euler',
});

const imageB = createImage({
  name: 'b.png',
  isFavorite: false,
  tags: ['portrait'],
  autoTags: ['studio'],
  models: ['modelB'],
  loras: ['loraB'],
  steps: 35,
  cfgScale: 5,
  sampler: 'dpmpp_2m',
  scheduler: 'ddim',
});

const imageC = createImage({
  name: 'c.png',
  isFavorite: true,
  tags: ['landscape'],
  autoTags: ['cinematic', 'nature'],
  models: ['modelA'],
  loras: ['loraC'],
  steps: 50,
  cfgScale: 9,
  sampler: 'dpmpp_2m',
  scheduler: 'ddim',
});

const imageD = createImage({
  name: 'd.png',
  isFavorite: false,
});

const seedStore = () => {
  useSettingsStore.setState({
    enableSafeMode: false,
    blurSensitiveImages: true,
    sensitiveTags: ['nsfw', 'private', 'hidden'],
  });

  useImageStore.getState().resetState();
  useImageStore.setState({
    directories: [directory],
    images: [imageA, imageB, imageC, imageD],
    filteredImages: [imageA, imageB, imageC, imageD],
    sortOrder: 'asc',
  });
  useImageStore.getState().filterAndSortImages();
};

describe('useImageStore tri-state filters', () => {
  beforeEach(() => {
    seedStore();
  });

  it('filters favorites with include and exclude modes', () => {
    useImageStore.getState().setFavoriteFilterMode('include');
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['a.png', 'c.png']);

    useImageStore.getState().setFavoriteFilterMode('exclude');
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['b.png', 'd.png']);
  });

  it('supports include and exclude for tags and auto-tags', () => {
    useImageStore.getState().setSelectedTags(['portrait']);
    useImageStore.getState().setExcludedTags(['warm']);
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['b.png']);

    useImageStore.getState().setSelectedTags([]);
    useImageStore.getState().setExcludedTags([]);
    useImageStore.getState().setSelectedAutoTags(['cinematic']);
    useImageStore.getState().setExcludedAutoTags(['nature']);
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['a.png']);
  });

  it('supports include and exclude for checkpoints, loras, samplers, and schedulers', () => {
    useImageStore.getState().setSelectedFilters({
      models: ['modelA'],
      excludedModels: ['modelB'],
      loras: ['loraA', 'loraC'],
      excludedLoras: ['loraC'],
      samplers: ['euler_a', 'dpmpp_2m'],
      excludedSamplers: ['dpmpp_2m'],
      schedulers: ['euler', 'ddim'],
      excludedSchedulers: ['ddim'],
    });

    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['a.png']);
  });

  it('treats sampler as an independent filter from scheduler', () => {
    useImageStore.getState().setSelectedFilters({
      samplers: ['dpmpp_2m'],
      schedulers: ['ddim'],
    });

    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['b.png', 'c.png']);

    useImageStore.getState().setSelectedFilters({
      samplers: ['euler_a'],
      schedulers: ['ddim'],
    });

    expect(useImageStore.getState().filteredImages).toEqual([]);
  });

  it('keeps images without sampler when only excluded samplers are active', () => {
    useImageStore.getState().setSelectedFilters({
      excludedSamplers: ['dpmpp_2m'],
    });

    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['a.png', 'd.png']);
  });

  it('supports open-ended advanced ranges for steps and cfg', () => {
    useImageStore.getState().setAdvancedFilters({
      steps: { min: 30, max: null },
    });
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['b.png', 'c.png']);

    useImageStore.getState().setAdvancedFilters({
      steps: { min: null, max: 35 },
    });
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['a.png', 'b.png']);

    useImageStore.getState().setAdvancedFilters({
      cfg: { min: 6, max: null },
    });
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['a.png', 'c.png']);

    useImageStore.getState().setAdvancedFilters({
      cfg: { min: null, max: 7 },
    });
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['a.png', 'b.png']);
  });
});
