import { afterEach, describe, expect, it, vi } from 'vitest';
import cacheManager from '../services/cacheManager';

declare global {
  interface Window {
    electronAPI?: any;
  }
}

describe('cacheManager workflowNodes hydration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.electronAPI;
  });

  it('preserves workflowNodes when hydrating unchanged cached images', async () => {
    window.electronAPI = {
      getCacheSummary: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'D:/library-flat',
          directoryPath: 'D:/library',
          directoryName: 'Library',
          lastScan: Date.now(),
          imageCount: 1,
          parserVersion: 7,
          metadata: [
            {
              id: 'dir-1::a.png',
              name: 'a.png',
              metadataString: '{"workflow":true}',
              metadata: {},
              lastModified: 1,
              models: [],
              loras: [],
              scheduler: '',
              workflowNodes: ['KSampler', 'LoraLoader'],
              enrichmentState: 'enriched',
            },
          ],
        },
      }),
    };
    (cacheManager as any).isElectron = true;

    const diff = await cacheManager.validateCacheAndGetDiff(
      'D:/library',
      'Library',
      [{ name: 'a.png', lastModified: 1 }],
      false
    );

    expect(diff.newAndModifiedFiles).toEqual([]);
    expect(diff.cachedImages).toHaveLength(1);
    expect(diff.cachedImages[0].workflowNodes).toEqual(['KSampler', 'LoraLoader']);
  });

  it('updates cached metadata entries for reparsed images', async () => {
    const cacheData = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = {
      getCacheSummary: vi.fn().mockImplementation(async (cacheId: string) => {
        if (cacheId === 'D:/library-flat') {
          return {
            success: true,
            data: {
              id: 'D:/library-flat',
              directoryPath: 'D:/library',
              directoryName: 'Library',
              lastScan: 1,
              imageCount: 1,
              parserVersion: 7,
              metadata: [
                {
                  id: 'dir-1::a.png',
                  name: 'a.png',
                  metadataString: '{"workflow":true}',
                  metadata: {},
                  lastModified: 1,
                  models: [],
                  loras: [],
                  scheduler: '',
                  workflowNodes: ['OldNode'],
                  enrichmentState: 'enriched',
                },
              ],
            },
          };
        }

        return { success: true, data: null };
      }),
      cacheData,
    };
    (cacheManager as any).isElectron = true;

    await cacheManager.updateCachedImages(
      'D:/library',
      'Library',
      [
        {
          id: 'dir-1::a.png',
          name: 'a.png',
          handle: {} as any,
          metadata: {},
          metadataString: '{"workflow":true}',
          lastModified: 1,
          models: [],
          loras: [],
          scheduler: '',
          workflowNodes: ['KSampler', 'LoadImage'],
        } as any,
      ],
      false
    );

    expect(cacheData).toHaveBeenCalledTimes(1);
    expect(cacheData.mock.calls[0][0].data.metadata[0].workflowNodes).toEqual(['KSampler', 'LoadImage']);
  });

  it('updates existing cache variants even when scanSubfolders no longer matches the loaded cache', async () => {
    const cacheData = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = {
      getCacheSummary: vi.fn().mockImplementation(async (cacheId: string) => {
        if (cacheId === 'D:/library-recursive') {
          return {
            success: true,
            data: {
              id: 'D:/library-recursive',
              directoryPath: 'D:/library',
              directoryName: 'Library',
              lastScan: 1,
              imageCount: 1,
              parserVersion: 7,
              metadata: [
                {
                  id: 'dir-1::a.png',
                  name: 'a.png',
                  metadataString: '{"workflow":true}',
                  metadata: {},
                  lastModified: 1,
                  models: [],
                  loras: [],
                  scheduler: '',
                  workflowNodes: ['OldNode'],
                  enrichmentState: 'enriched',
                },
              ],
            },
          };
        }

        return { success: true, data: null };
      }),
      cacheData,
    };
    (cacheManager as any).isElectron = true;

    await cacheManager.updateCachedImages(
      'D:/library',
      'Library',
      [
        {
          id: 'dir-1::a.png',
          name: 'a.png',
          handle: {} as any,
          metadata: {},
          metadataString: '{"workflow":true}',
          lastModified: 1,
          models: [],
          loras: [],
          scheduler: '',
          workflowNodes: ['KSampler', 'LoadImage'],
        } as any,
      ],
      false
    );

    expect(cacheData).toHaveBeenCalledTimes(1);
    expect(cacheData.mock.calls[0][0].cacheId).toBe('D:/library-recursive');
    expect(cacheData.mock.calls[0][0].data.metadata[0].workflowNodes).toEqual(['KSampler', 'LoadImage']);
  });

  it('replaces renamed cached entries in every existing cache variant that had the old entry', async () => {
    const cacheData = vi.fn().mockResolvedValue({ success: true });
    const makeEntry = (cacheId: string) => ({
      id: cacheId,
      directoryPath: 'D:/library',
      directoryName: 'Library',
      lastScan: 1,
      imageCount: 2,
      parserVersion: 7,
      metadata: [
        {
          id: 'dir-1::old.png',
          name: 'old.png',
          metadataString: '',
          metadata: {},
          lastModified: 1,
          models: [],
          loras: [],
          scheduler: '',
        },
        {
          id: 'dir-1::other.png',
          name: 'other.png',
          metadataString: '',
          metadata: {},
          lastModified: 1,
          models: [],
          loras: [],
          scheduler: '',
        },
      ],
    });

    window.electronAPI = {
      getCacheSummary: vi.fn().mockImplementation(async (cacheId: string) => {
        if (cacheId === 'D:/library-flat' || cacheId === 'D:/library-recursive') {
          return { success: true, data: makeEntry(cacheId) };
        }
        return { success: true, data: null };
      }),
      cacheData,
    };
    (cacheManager as any).isElectron = true;

    await cacheManager.replaceCachedImages(
      'D:/library',
      'Library',
      [
        {
          id: 'dir-1::new.png',
          name: 'new.png',
          handle: {} as any,
          metadata: {},
          metadataString: '',
          lastModified: 2,
          models: [],
          loras: [],
          scheduler: '',
        } as any,
      ],
      ['dir-1::old.png'],
      ['old.png'],
      false
    );

    expect(cacheData).toHaveBeenCalledTimes(2);
    const writtenCacheIds = cacheData.mock.calls.map((call) => call[0].cacheId).sort();
    expect(writtenCacheIds).toEqual(['D:/library-flat', 'D:/library-recursive']);
    for (const call of cacheData.mock.calls) {
      expect(call[0].data.metadata.map((entry: any) => entry.id).sort()).toEqual([
        'dir-1::new.png',
        'dir-1::other.png',
      ]);
    }
  });

  it('preserves unchanged inline metadata when applying a chunked cache delta', async () => {
    const writeCacheChunk = vi.fn().mockResolvedValue({ success: true });
    const finalizeCacheWrite = vi.fn().mockResolvedValue({ success: true });

    window.electronAPI = {
      getCacheSummary: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'D:/library-flat',
          directoryPath: 'D:/library',
          directoryName: 'Library',
          lastScan: 1,
          imageCount: 2,
          parserVersion: 7,
          metadata: [
            {
              id: 'dir-1::keep.png',
              name: 'keep.png',
              metadataString: '{"keep":true}',
              metadata: {},
              lastModified: 1,
              models: [],
              loras: [],
              scheduler: '',
              enrichmentState: 'enriched',
            },
            {
              id: 'dir-1::update.png',
              name: 'update.png',
              metadataString: '{"old":true}',
              metadata: {},
              lastModified: 1,
              models: [],
              loras: [],
              scheduler: '',
              enrichmentState: 'enriched',
            },
          ],
        },
      }),
      writeCacheChunk,
      finalizeCacheWrite,
    };
    (cacheManager as any).isElectron = true;

    await cacheManager.applyChunkedCacheDelta(
      'D:/library',
      'Library',
      [
        {
          id: 'dir-1::update.png',
          name: 'update.png',
          handle: {} as any,
          metadata: {},
          metadataString: '{"new":true}',
          lastModified: 2,
          models: [],
          loras: [],
          scheduler: '',
        } as any,
      ],
      [],
      [],
      false
    );

    expect(writeCacheChunk).toHaveBeenCalledTimes(1);
    expect(writeCacheChunk.mock.calls[0][0].data.map((entry: any) => entry.id)).toEqual([
      'dir-1::keep.png',
      'dir-1::update.png',
    ]);
    expect(writeCacheChunk.mock.calls[0][0].data[1].metadataString).toBe('{"new":true}');
    expect(finalizeCacheWrite.mock.calls[0][0].record.imageCount).toBe(2);
    expect(finalizeCacheWrite.mock.calls[0][0].record.chunkCount).toBe(1);
  });

  it('writes chunked cache deltas to a temporary cache before replacing the source chunks', async () => {
    const writeCacheChunk = vi.fn().mockResolvedValue({ success: true });
    const finalizeCacheWrite = vi.fn().mockResolvedValue({ success: true });
    const originalCacheId = 'D:/library-flat';
    const firstChunk = Array.from({ length: 1024 }, (_, index) => ({
      id: `dir-1::chunk-0-${index}.png`,
      name: `chunk-0-${index}.png`,
      metadataString: '',
      metadata: {},
      lastModified: 1,
      models: [],
      loras: [],
      scheduler: '',
    }));
    const secondChunk = [
      {
        id: 'dir-1::chunk-1.png',
        name: 'chunk-1.png',
        metadataString: '',
        metadata: {},
        lastModified: 1,
        models: [],
        loras: [],
        scheduler: '',
      },
    ];

    window.electronAPI = {
      getCacheSummary: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: originalCacheId,
          directoryPath: 'D:/library',
          directoryName: 'Library',
          lastScan: 1,
          imageCount: 1025,
          parserVersion: 7,
          chunkCount: 2,
        },
      }),
      getCacheChunk: vi.fn().mockImplementation(async ({ cacheId, chunkIndex }) => {
        expect(cacheId).toBe(originalCacheId);
        return {
          success: true,
          data: chunkIndex === 0 ? firstChunk : secondChunk,
        };
      }),
      writeCacheChunk,
      finalizeCacheWrite,
    };
    (cacheManager as any).isElectron = true;

    await cacheManager.applyChunkedCacheDelta(
      'D:/library',
      'Library',
      [],
      ['dir-1::chunk-1.png'],
      ['chunk-1.png'],
      false
    );

    expect(window.electronAPI.getCacheChunk).toHaveBeenCalledTimes(2);
    expect(writeCacheChunk).toHaveBeenCalled();
    for (const call of writeCacheChunk.mock.calls) {
      expect(call[0].cacheId).not.toBe(originalCacheId);
      expect(call[0].cacheId).toMatch(/^D:\/library-flat-delta-/);
    }
    expect(finalizeCacheWrite).toHaveBeenCalledWith(expect.objectContaining({
      cacheId: originalCacheId,
      sourceCacheId: writeCacheChunk.mock.calls[0][0].cacheId,
    }));
    expect(finalizeCacheWrite.mock.calls[0][0].record.imageCount).toBe(1024);
  });

  it('migrates inline metadata before appending new cache chunks', async () => {
    const writeCacheChunk = vi.fn().mockResolvedValue({ success: true });
    const finalizeCacheWrite = vi.fn().mockResolvedValue({ success: true });

    window.electronAPI = {
      getCacheSummary: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'D:/library-flat',
          directoryPath: 'D:/library',
          directoryName: 'Library',
          lastScan: 1,
          imageCount: 1,
          parserVersion: 7,
          metadata: [
            {
              id: 'dir-1::existing.png',
              name: 'existing.png',
              metadataString: '{"existing":true}',
              metadata: {},
              lastModified: 1,
              models: [],
              loras: [],
              scheduler: '',
            },
          ],
        },
      }),
      writeCacheChunk,
      finalizeCacheWrite,
    };
    (cacheManager as any).isElectron = true;

    await cacheManager.appendToCache(
      'D:/library',
      'Library',
      [
        {
          id: 'dir-1::new.png',
          name: 'new.png',
          handle: {} as any,
          metadata: {},
          metadataString: '{"new":true}',
          lastModified: 2,
          models: [],
          loras: [],
          scheduler: '',
        } as any,
      ],
      false,
      { chunkSize: 1 }
    );

    expect(writeCacheChunk).toHaveBeenCalledTimes(2);
    expect(writeCacheChunk.mock.calls[0][0]).toMatchObject({
      chunkIndex: 0,
      data: [expect.objectContaining({ id: 'dir-1::existing.png' })],
    });
    expect(writeCacheChunk.mock.calls[1][0]).toMatchObject({
      chunkIndex: 1,
      data: [expect.objectContaining({ id: 'dir-1::new.png' })],
    });
    expect(finalizeCacheWrite.mock.calls[0][0].record.imageCount).toBe(2);
    expect(finalizeCacheWrite.mock.calls[0][0].record.chunkCount).toBe(2);
  });
});
