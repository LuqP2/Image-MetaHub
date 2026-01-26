import { describe, it, expect } from 'vitest';
import { cacheManager, CacheImageMetadata } from './cacheManager';

describe('CacheManager', () => {
  describe('validateCacheAndGetDiff', () => {
    it('should force re-indexing for files in "catalog" state', async () => {
      // Mock cached data
      const mockCachedMetadata: CacheImageMetadata[] = [
        {
          id: '1',
          name: 'ready.png',
          metadataString: '{}',
          metadata: {},
          lastModified: 1000,
          models: [],
          loras: [],
          scheduler: '',
          enrichmentState: 'enriched', // Valid entry
        },
        {
          id: '2',
          name: 'incomplete.png',
          metadataString: '{}',
          metadata: {},
          lastModified: 1000,
          models: [],
          loras: [],
          scheduler: '',
          enrichmentState: 'catalog', // Incomplete entry (stub)
        },
      ];

      // Mock cacheManager.getCachedData to return our mock data
      cacheManager.getCachedData = async () => ({
        id: 'test-cache',
        directoryPath: '/test',
        directoryName: 'test',
        lastScan: Date.now(),
        imageCount: 2,
        metadata: mockCachedMetadata,
      });

      // Current files on disk (same timestamps as cache)
      const currentFiles = [
        {
          name: 'ready.png',
          lastModified: 1000,
          size: 100,
          type: 'image/png',
          birthtimeMs: 1000,
        },
        {
          name: 'incomplete.png',
          lastModified: 1000,
          size: 100,
          type: 'image/png',
          birthtimeMs: 1000,
        },
      ];

      const diff = await cacheManager.validateCacheAndGetDiff(
        '/test',
        'test',
        currentFiles,
        false
      );

      // Expect 'ready.png' to be in cachedImages (unchanged)
      expect(diff.cachedImages).toHaveLength(1);
      expect(diff.cachedImages[0].name).toBe('ready.png');

      // Expect 'incomplete.png' to be in newAndModifiedFiles (needs re-indexing)
      expect(diff.newAndModifiedFiles).toHaveLength(1);
      expect(diff.newAndModifiedFiles[0].name).toBe('incomplete.png');
    });
  });
});
