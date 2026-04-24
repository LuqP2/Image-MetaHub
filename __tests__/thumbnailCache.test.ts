import { describe, expect, it } from 'vitest';
import {
  getLegacyThumbnailId,
  getThumbnailCacheCandidate,
  getVersionedThumbnailId,
  THUMBNAIL_ALGORITHM_VERSION,
} from '../services/thumbnailCache';

describe('thumbnail cache keys', () => {
  const image = {
    id: 'dir-1::sub/image.png',
    name: 'sub/image.png',
    lastModified: 1710000000000,
    contentModifiedMs: 1710000000123,
    fileSize: 123456,
  };

  it('keeps legacy keys available for existing cache entries', () => {
    expect(getLegacyThumbnailId(image)).toBe('dir-1::sub/image.png-1710000000000');
  });

  it('builds versioned keys without losing the legacy fallback key', () => {
    expect(getVersionedThumbnailId(image)).toBe(`${THUMBNAIL_ALGORITHM_VERSION}:dir-1::sub/image.png-1710000000000`);

    expect(getThumbnailCacheCandidate(image)).toMatchObject({
      requestId: image.id,
      imageId: image.id,
      originalRelativePath: image.name,
      lastModified: image.lastModified,
      contentModifiedMs: image.contentModifiedMs,
      fileSize: image.fileSize,
      thumbnailId: getVersionedThumbnailId(image),
      legacyThumbnailId: getLegacyThumbnailId(image),
      algorithmVersion: THUMBNAIL_ALGORITHM_VERSION,
    });
  });
});
