import { describe, expect, it } from 'vitest';
import { calculateTopItems, truncateName } from '../utils/analyticsUtils';
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
});
