import { describe, expect, it } from 'vitest';
import { buildAnalyticsExplorerData, calculateTopItems, truncateName } from '../utils/analyticsUtils';
import { type IndexedImage } from '../types';

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: 'id',
  name: 'name',
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: Date.now(),
  models: [],
  loras: [],
  scheduler: '',
  ...overrides,
});

describe('analyticsUtils', () => {
  it('handles non-string model and scheduler values without breaking analytics', () => {
    const images: IndexedImage[] = [
      createImage({ id: '1', models: [{ name: 'Flux' } as any], scheduler: 'Euler a' }),
      createImage({ id: '2', models: ['Flux', 123 as any], scheduler: 123 as any }),
      createImage({ id: '3', models: [null as any, undefined as any], scheduler: '' as any }),
    ];

    const topModels = calculateTopItems(images, 'models');
    expect(topModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Flux', total: 2 }),
        expect.objectContaining({ name: '123', total: 1 }),
      ])
    );

    const topSchedulers = calculateTopItems(images, 'scheduler');
    expect(topSchedulers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Euler a', total: 1 }),
        expect.objectContaining({ name: '123', total: 1 }),
      ])
    );
  });

  it('truncateName safely formats non-string inputs', () => {
    expect(truncateName(12345, 4)).toBe('1...');
    expect(truncateName({ foo: 'bar' } as any, 6)).toBe('[ob...');
    expect(truncateName(null as any, 10)).toBe('');
  });

  it('tracks keeper rate and rating averages from real annotations', () => {
    const images: IndexedImage[] = [
      createImage({ id: '1', models: ['Flux'], isFavorite: true, rating: 5 }),
      createImage({ id: '2', models: ['Flux'], isFavorite: false, rating: 3 }),
      createImage({ id: '3', models: ['SDXL'], isFavorite: true, rating: 4 }),
    ];

    const topModels = calculateTopItems(images, 'models');
    expect(topModels[0]).toMatchObject({
      name: 'Flux',
      total: 2,
      favorites: 1,
      keeperRate: 50,
      averageRating: 4,
      ratingCount: 2,
    });
  });

  it('builds explorer data with cohorts, sessions, and telemetry buckets', () => {
    const baseTime = new Date('2026-03-01T10:00:00Z').getTime();
    const images: IndexedImage[] = [
      createImage({
        id: '1',
        lastModified: baseTime,
        models: ['Flux'],
        loras: ['detail'],
        metadata: { normalizedMetadata: { generator: 'ComfyUI', _analytics: { gpu_device: 'RTX 4090', generation_time_ms: 4200, steps_per_second: 12.5, vram_peak_mb: 6144 } } } as any,
        isFavorite: true,
        rating: 5,
      }),
      createImage({
        id: '2',
        lastModified: baseTime + 20 * 60 * 1000,
        models: ['Flux'],
        loras: ['detail'],
        metadata: { normalizedMetadata: { generator: 'ComfyUI', _analytics: { gpu_device: 'RTX 4090', generation_time_ms: 5200, steps_per_second: 11.5, vram_peak_mb: 6656 } } } as any,
        rating: 4,
      }),
      createImage({
        id: '3',
        lastModified: baseTime + 3 * 60 * 60 * 1000,
        models: ['SDXL'],
        metadata: { normalizedMetadata: { generator: 'InvokeAI' } } as any,
      }),
    ];

    const data = buildAnalyticsExplorerData({
      scopeImages: images,
      allImages: images,
      scopeMode: 'context',
      compare: {
        dimension: 'generator',
        leftKey: 'ComfyUI',
        rightKey: 'InvokeAI',
      },
    });

    expect(data.resources.generators[0]).toMatchObject({ key: 'ComfyUI', count: 2 });
    expect(data.time.sessions).toHaveLength(2);
    expect(data.performance.byGPU[0]).toMatchObject({ name: 'RTX 4090', count: 2 });
    expect(data.curation.ratingDistribution.map((item) => item.key)).toContain('unrated');
    expect(data.compare?.left).toMatchObject({ key: 'ComfyUI', count: 2 });
  });
});
