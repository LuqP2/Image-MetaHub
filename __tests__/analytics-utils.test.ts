import { describe, expect, it } from 'vitest';
import { buildAnalyticsExplorerData, calculateTopItems, getUniquePeriodCount, truncateName } from '../utils/analyticsUtils';
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

  it('buildAnalyticsExplorerData correctly calculates curation metrics in a single pass', () => {
    const images: IndexedImage[] = [
      createImage({ id: '1', rating: 5, isFavorite: true }),
      createImage({ id: '2', rating: 5, isFavorite: false }),
      createImage({ id: '3', rating: 4, isFavorite: true }),
      createImage({ id: '4', rating: undefined, isFavorite: true }), // Unrated favorite
      createImage({ id: '5', rating: undefined, isFavorite: false }), // Unrated non-favorite
      createImage({ id: '6', rating: 1, isFavorite: false }),
    ];

    const data = buildAnalyticsExplorerData({
      scopeImages: images,
      allImages: images,
      scopeMode: 'library',
    });

    expect(data.curation.favoritesCount).toBe(3);
    expect(data.curation.unratedCount).toBe(2);
    expect(data.curation.favoriteRate).toBe(3 / 6);

    const dist = data.curation.ratingDistribution;

    // Check 5 star rating
    const r5 = dist.find(d => d.key === '5');
    expect(r5).toBeDefined();
    expect(r5?.count).toBe(2);
    expect(r5?.favorites).toBe(1);
    expect(r5?.keeperRate).toBe(0.5);

    // Check 4 star rating
    const r4 = dist.find(d => d.key === '4');
    expect(r4).toBeDefined();
    expect(r4?.count).toBe(1);
    expect(r4?.favorites).toBe(1);
    expect(r4?.keeperRate).toBe(1);

    // Check 1 star rating
    const r1 = dist.find(d => d.key === '1');
    expect(r1).toBeDefined();
    expect(r1?.count).toBe(1);
    expect(r1?.favorites).toBe(0);
    expect(r1?.keeperRate).toBe(0);

    // Check Unrated
    const unrated = dist.find(d => d.key === 'unrated');
    expect(unrated).toBeDefined();
    expect(unrated?.count).toBe(2);
    expect(unrated?.favorites).toBe(1);
    expect(unrated?.keeperRate).toBe(0.5);

    // Ensure 2 and 3 star ratings are NOT in distribution (count 0)
    expect(dist.find(d => d.key === '2')).toBeUndefined();
    expect(dist.find(d => d.key === '3')).toBeUndefined();
  });

  describe('getUniquePeriodCount', () => {
    it('correctly counts unique models in a period', () => {
      const now = Date.now();
      const images: IndexedImage[] = [
        createImage({ id: '1', models: ['Model A', 'Model B'], lastModified: now }),
        createImage({ id: '2', models: ['Model A'], lastModified: now }),
        createImage({ id: '3', models: ['Model C'], lastModified: now - 60 * 24 * 60 * 60 * 1000 }), // Outside 30 days
      ];

      expect(getUniquePeriodCount(images, 'models', 30)).toBe(2); // Model A, Model B
    });

    it('correctly counts unique loras in a period', () => {
      const now = Date.now();
      const images: IndexedImage[] = [
        createImage({ id: '1', loras: ['Lora A', 'Lora B'], lastModified: now }),
        createImage({ id: '2', loras: [{ name: 'Lora A' } as any], lastModified: now }),
        createImage({ id: '3', loras: ['Lora C'], lastModified: now }),
      ];

      expect(getUniquePeriodCount(images, 'loras', 30)).toBe(3); // Lora A, Lora B, Lora C
    });
  });
});
