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
  rating: 5,
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
  rating: 3,
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
  rating: 1,
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

const imageE = createImage({
  name: 'e.png',
  metadata: { normalizedMetadata: { generator: 'ComfyUI', _analytics: { gpu_device: 'RTX 4090', generation_time_ms: 4200, steps_per_second: 9.5, vram_peak_mb: 6144 } } } as any,
});

const imageF = createImage({
  name: 'f.png',
  metadata: { normalizedMetadata: { generator: 'InvokeAI', _analytics: { gpu_device: 'RTX 3060', generation_time_ms: 900, steps_per_second: 3.2, vram_peak_mb: 3072 } } } as any,
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
    images: [imageA, imageB, imageC, imageD, imageE, imageF],
    filteredImages: [imageA, imageB, imageC, imageD, imageE, imageF],
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
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['b.png', 'd.png', 'e.png', 'f.png']);
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

    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['a.png', 'd.png', 'e.png', 'f.png']);
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

  it('filters by multiple selected ratings with OR logic', () => {
    useImageStore.getState().setSelectedRatings([1, 3]);
    expect(useImageStore.getState().selectedRatings).toEqual([1, 3]);
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['b.png', 'c.png']);

    useImageStore.getState().setSelectedRatings([3, 3, 1]);
    expect(useImageStore.getState().selectedRatings).toEqual([1, 3]);
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['b.png', 'c.png']);

    useImageStore.getState().setSelectedRatings([]);
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png']);
  });

  it('sets and bulk updates ratings without affecting favorites or tags', async () => {
    await useImageStore.getState().setImageRating(imageD.id, 4);

    const updatedD = useImageStore.getState().images.find((image) => image.id === imageD.id);
    expect(updatedD?.rating).toBe(4);
    expect(useImageStore.getState().annotations.get(imageD.id)?.rating).toBe(4);
    expect(updatedD?.isFavorite).toBeFalsy();

    await useImageStore.getState().bulkSetImageRating([imageB.id, imageD.id], 2);

    const updatedImages = useImageStore.getState().images.filter((image) => [imageB.id, imageD.id].includes(image.id));
    expect(updatedImages.map((image) => image.rating)).toEqual([2, 2]);
    expect(useImageStore.getState().images.find((image) => image.id === imageB.id)?.tags).toEqual(['portrait']);
  });

  it('filters by generator, gpu, and analytics numeric ranges', () => {
    useImageStore.getState().setSelectedFilters({
      generators: ['ComfyUI'],
      gpuDevices: ['RTX 4090'],
    });
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['e.png']);

    useImageStore.getState().setSelectedFilters({
      generators: [],
      gpuDevices: [],
    });
    useImageStore.getState().setAdvancedFilters({
      generationTimeMs: { min: 1000, max: null },
    });
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['e.png']);

    useImageStore.getState().setAdvancedFilters({
      stepsPerSecond: { min: 3, max: 4 },
    });
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['f.png']);

    useImageStore.getState().setAdvancedFilters({
      vramPeakMb: { min: 5000, max: null },
    });
    expect(useImageStore.getState().filteredImages.map((image) => image.name)).toEqual(['e.png']);
  });
});
