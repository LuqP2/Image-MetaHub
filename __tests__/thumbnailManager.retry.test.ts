import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexedImage } from '../types';

const cacheMocks = vi.hoisted(() => ({
  getCachedThumbnail: vi.fn().mockResolvedValue(null),
  cacheThumbnail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/cacheManager', () => ({
  default: {
    getCachedThumbnail: cacheMocks.getCachedThumbnail,
    cacheThumbnail: cacheMocks.cacheThumbnail,
  },
}));

import { thumbnailManager } from '../services/thumbnailManager';

describe('thumbnailManager retry cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T21:00:00-03:00'));
    cacheMocks.getCachedThumbnail.mockClear();
    cacheMocks.cacheThumbnail.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a transient failure after the cooldown without retrying every viewport request', async () => {
    const getFile = vi.fn().mockRejectedValue(new Error('Temporary file access failure'));
    const image = {
      id: 'dir-1::transient-thumbnail.png',
      name: 'transient-thumbnail.png',
      lastModified: 123,
      handle: { getFile } as unknown as FileSystemFileHandle,
      metadata: {},
      metadataString: '',
      models: [],
      loras: [],
      directoryId: 'dir-1',
    } as IndexedImage;

    await thumbnailManager.ensureThumbnail(image);
    await Promise.resolve();
    expect(getFile).toHaveBeenCalledTimes(1);

    await thumbnailManager.ensureThumbnail(image);
    expect(getFile).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    await thumbnailManager.ensureThumbnail(image);
    await Promise.resolve();

    expect(getFile).toHaveBeenCalledTimes(2);
  });
});
