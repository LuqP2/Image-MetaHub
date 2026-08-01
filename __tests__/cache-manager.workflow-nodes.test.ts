import { afterEach, describe, expect, it, vi } from 'vitest';
import cacheManager, { PARSER_VERSION } from '../services/cacheManager';

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
          parserVersion: PARSER_VERSION,
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
              parserVersion: PARSER_VERSION,
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
              parserVersion: PARSER_VERSION,
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
      parserVersion: PARSER_VERSION,
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

  it('patches only the chunk holding a reparsed image without rewriting the whole cache', async () => {
    const getCacheChunk = vi.fn().mockImplementation(async ({ chunkIndex }) => {
      if (chunkIndex === 0) {
        return {
          success: true,
          data: [
            {
              id: 'dir-1::a.png',
              name: 'a.png',
              metadataString: '{"old":"a"}',
              metadata: {},
              lastModified: 1,
              models: [],
              loras: [],
              scheduler: '',
              workflowNodes: ['OldA'],
            },
          ],
        };
      }
      return {
        success: true,
        data: [
          {
            id: 'dir-1::b.png',
            name: 'b.png',
            metadataString: '{"keep":"b"}',
            metadata: {},
            lastModified: 1,
            models: [],
            loras: [],
            scheduler: '',
            workflowNodes: ['KeepB'],
          },
        ],
      };
    });
    const writeCacheChunk = vi.fn().mockResolvedValue({ success: true });
    const finalizeCacheWrite = vi.fn().mockResolvedValue({ success: true });
    const readCacheIndex = vi.fn().mockResolvedValue({ success: true, data: null });
    const writeCacheIndex = vi.fn().mockResolvedValue({ success: true });

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
              imageCount: 2,
              chunkCount: 2,
              parserVersion: PARSER_VERSION,
            },
          };
        }
        return { success: true, data: null };
      }),
      getCacheChunk,
      writeCacheChunk,
      finalizeCacheWrite,
      readCacheIndex,
      writeCacheIndex,
    };
    (cacheManager as any).isElectron = true;

    const patched = await cacheManager.patchCachedImages(
      'D:/library',
      'Library',
      [
        {
          id: 'dir-1::b.png',
          name: 'b.png',
          handle: {} as any,
          metadata: {},
          metadataString: '{"new":"b"}',
          lastModified: 2,
          models: [],
          loras: [],
          scheduler: '',
          workflowNodes: ['NewB'],
        } as any,
      ],
      false
    );

    expect(patched).toBe(true);
    // Only the chunk that actually contains b.png is written back.
    expect(writeCacheChunk).toHaveBeenCalledTimes(1);
    expect(writeCacheChunk.mock.calls[0][0].chunkIndex).toBe(1);
    expect(writeCacheChunk.mock.calls[0][0].data[0].id).toBe('dir-1::b.png');
    expect(writeCacheChunk.mock.calls[0][0].data[0].metadataString).toBe('{"new":"b"}');
    // The record is refreshed in place (no chunk swap => no sourceCacheId).
    expect(finalizeCacheWrite).toHaveBeenCalledTimes(1);
    expect(finalizeCacheWrite.mock.calls[0][0].sourceCacheId).toBeUndefined();
    expect(finalizeCacheWrite.mock.calls[0][0].record.chunkCount).toBe(2);
    expect(finalizeCacheWrite.mock.calls[0][0].record.imageCount).toBe(2);
    // The fallback scan (no index yet) rebuilds and persists the id->chunk index.
    expect(writeCacheIndex).toHaveBeenCalledTimes(1);
    expect(writeCacheIndex.mock.calls[0][0].data.chunkCount).toBe(2);
    expect(writeCacheIndex.mock.calls[0][0].data.ids).toEqual({
      'dir-1::a.png': 0,
      'dir-1::b.png': 1,
    });
  });

  it('reads only the target chunk when a valid id->chunk index exists', async () => {
    const getCacheChunk = vi.fn().mockImplementation(async ({ chunkIndex }) => ({
      success: true,
      data: [
        {
          id: `dir-1::img-${chunkIndex}.png`,
          name: `img-${chunkIndex}.png`,
          metadataString: '{}',
          metadata: {},
          lastModified: 1,
          models: [],
          loras: [],
          scheduler: '',
        },
      ],
    }));
    const writeCacheChunk = vi.fn().mockResolvedValue({ success: true });
    const finalizeCacheWrite = vi.fn().mockResolvedValue({ success: true });
    const writeCacheIndex = vi.fn().mockResolvedValue({ success: true });
    const readCacheIndex = vi.fn().mockResolvedValue({
      success: true,
      data: {
        lastScan: 1,
        chunkCount: 5,
        ids: {
          'dir-1::img-0.png': 0,
          'dir-1::img-1.png': 1,
          'dir-1::img-2.png': 2,
          'dir-1::img-3.png': 3,
          'dir-1::img-4.png': 4,
        },
      },
    });

    window.electronAPI = {
      getCacheSummary: vi.fn().mockImplementation(async (cacheId: string) =>
        cacheId === 'D:/library-flat'
          ? {
              success: true,
              data: {
                id: 'D:/library-flat',
                directoryPath: 'D:/library',
                directoryName: 'Library',
                lastScan: 1,
                imageCount: 5,
                chunkCount: 5,
                parserVersion: PARSER_VERSION,
              },
            }
          : { success: true, data: null }
      ),
      getCacheChunk,
      writeCacheChunk,
      finalizeCacheWrite,
      readCacheIndex,
      writeCacheIndex,
    };
    (cacheManager as any).isElectron = true;

    await cacheManager.patchCachedImages(
      'D:/library',
      'Library',
      [
        {
          id: 'dir-1::img-3.png',
          name: 'img-3.png',
          handle: {} as any,
          metadata: {},
          metadataString: '{"new":true}',
          lastModified: 2,
          models: [],
          loras: [],
          scheduler: '',
        } as any,
      ],
      false
    );

    // The index points straight at chunk 3, so no other chunk is read.
    expect(getCacheChunk).toHaveBeenCalledTimes(1);
    expect(getCacheChunk.mock.calls[0][0].chunkIndex).toBe(3);
    expect(writeCacheChunk).toHaveBeenCalledTimes(1);
    expect(writeCacheChunk.mock.calls[0][0].chunkIndex).toBe(3);
    expect(finalizeCacheWrite).toHaveBeenCalledTimes(1);
  });

  it('falls back to a full scan when the index is stale (lastScan mismatch)', async () => {
    const getCacheChunk = vi.fn().mockImplementation(async ({ chunkIndex }) => ({
      success: true,
      data: [
        {
          id: `dir-1::img-${chunkIndex}.png`,
          name: `img-${chunkIndex}.png`,
          metadataString: '{}',
          metadata: {},
          lastModified: 1,
          models: [],
          loras: [],
          scheduler: '',
        },
      ],
    }));
    const writeCacheChunk = vi.fn().mockResolvedValue({ success: true });
    const finalizeCacheWrite = vi.fn().mockResolvedValue({ success: true });
    const writeCacheIndex = vi.fn().mockResolvedValue({ success: true });
    // Index built against an older scan; must be ignored.
    const readCacheIndex = vi.fn().mockResolvedValue({
      success: true,
      data: { lastScan: 999, chunkCount: 3, ids: { 'dir-1::img-1.png': 1 } },
    });

    window.electronAPI = {
      getCacheSummary: vi.fn().mockImplementation(async (cacheId: string) =>
        cacheId === 'D:/library-flat'
          ? {
              success: true,
              data: {
                id: 'D:/library-flat',
                directoryPath: 'D:/library',
                directoryName: 'Library',
                lastScan: 1,
                imageCount: 3,
                chunkCount: 3,
                parserVersion: PARSER_VERSION,
              },
            }
          : { success: true, data: null }
      ),
      getCacheChunk,
      writeCacheChunk,
      finalizeCacheWrite,
      readCacheIndex,
      writeCacheIndex,
    };
    (cacheManager as any).isElectron = true;

    await cacheManager.patchCachedImages(
      'D:/library',
      'Library',
      [
        {
          id: 'dir-1::img-1.png',
          name: 'img-1.png',
          handle: {} as any,
          metadata: {},
          metadataString: '{"new":true}',
          lastModified: 2,
          models: [],
          loras: [],
          scheduler: '',
        } as any,
      ],
      false
    );

    // Stale index rejected => full scan of all 3 chunks, then index rebuilt.
    expect(getCacheChunk).toHaveBeenCalledTimes(3);
    expect(writeCacheChunk).toHaveBeenCalledTimes(1);
    expect(writeCacheChunk.mock.calls[0][0].chunkIndex).toBe(1);
    expect(writeCacheIndex).toHaveBeenCalledTimes(1);
    expect(writeCacheIndex.mock.calls[0][0].data.ids).toEqual({
      'dir-1::img-0.png': 0,
      'dir-1::img-1.png': 1,
      'dir-1::img-2.png': 2,
    });
  });

  it('falls back to a full scan when the index points at the wrong chunk', async () => {
    // Layout changed but chunkCount/lastScan happen to match: the index says
    // img-2.png is in chunk 0, but it is actually in chunk 2.
    const getCacheChunk = vi.fn().mockImplementation(async ({ chunkIndex }) => ({
      success: true,
      data: [
        {
          id: `dir-1::img-${chunkIndex}.png`,
          name: `img-${chunkIndex}.png`,
          metadataString: '{}',
          metadata: {},
          lastModified: 1,
          models: [],
          loras: [],
          scheduler: '',
        },
      ],
    }));
    const writeCacheChunk = vi.fn().mockResolvedValue({ success: true });
    const finalizeCacheWrite = vi.fn().mockResolvedValue({ success: true });
    const writeCacheIndex = vi.fn().mockResolvedValue({ success: true });
    const readCacheIndex = vi.fn().mockResolvedValue({
      success: true,
      data: { lastScan: 1, chunkCount: 3, ids: { 'dir-1::img-2.png': 0 } },
    });

    window.electronAPI = {
      getCacheSummary: vi.fn().mockImplementation(async (cacheId: string) =>
        cacheId === 'D:/library-flat'
          ? {
              success: true,
              data: {
                id: 'D:/library-flat',
                directoryPath: 'D:/library',
                directoryName: 'Library',
                lastScan: 1,
                imageCount: 3,
                chunkCount: 3,
                parserVersion: PARSER_VERSION,
              },
            }
          : { success: true, data: null }
      ),
      getCacheChunk,
      writeCacheChunk,
      finalizeCacheWrite,
      readCacheIndex,
      writeCacheIndex,
    };
    (cacheManager as any).isElectron = true;

    const patched = await cacheManager.patchCachedImages(
      'D:/library',
      'Library',
      [
        {
          id: 'dir-1::img-2.png',
          name: 'img-2.png',
          handle: {} as any,
          metadata: {},
          metadataString: '{"new":true}',
          lastModified: 2,
          models: [],
          loras: [],
          scheduler: '',
        } as any,
      ],
      false
    );

    expect(patched).toBe(true);
    // Chunk 0 read via the (wrong) index, verification fails, then full scan.
    expect(writeCacheChunk).toHaveBeenCalledTimes(1);
    expect(writeCacheChunk.mock.calls[0][0].chunkIndex).toBe(2);
    expect(writeCacheChunk.mock.calls[0][0].data[0].metadataString).toBe('{"new":true}');
  });

  it('does not write anything when the reparsed image is not in the cache variant', async () => {
    const getCacheChunk = vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          id: 'dir-1::other.png',
          name: 'other.png',
          metadataString: '{}',
          metadata: {},
          lastModified: 1,
          models: [],
          loras: [],
          scheduler: '',
        },
      ],
    });
    const writeCacheChunk = vi.fn().mockResolvedValue({ success: true });
    const finalizeCacheWrite = vi.fn().mockResolvedValue({ success: true });

    window.electronAPI = {
      getCacheSummary: vi.fn().mockImplementation(async (cacheId: string) =>
        cacheId === 'D:/library-flat'
          ? {
              success: true,
              data: {
                id: 'D:/library-flat',
                directoryPath: 'D:/library',
                directoryName: 'Library',
                lastScan: 1,
                imageCount: 1,
                chunkCount: 1,
                parserVersion: PARSER_VERSION,
              },
            }
          : { success: true, data: null }
      ),
      getCacheChunk,
      writeCacheChunk,
      finalizeCacheWrite,
    };
    (cacheManager as any).isElectron = true;

    const patched = await cacheManager.patchCachedImages(
      'D:/library',
      'Library',
      [
        {
          id: 'dir-1::missing.png',
          name: 'missing.png',
          handle: {} as any,
          metadata: {},
          metadataString: '{}',
          lastModified: 2,
          models: [],
          loras: [],
          scheduler: '',
        } as any,
      ],
      false
    );

    expect(patched).toBe(false);
    expect(writeCacheChunk).not.toHaveBeenCalled();
    expect(finalizeCacheWrite).not.toHaveBeenCalled();
  });

  it('patches inline-metadata caches without touching chunk files', async () => {
    const cacheData = vi.fn().mockResolvedValue({ success: true });
    const writeCacheChunk = vi.fn().mockResolvedValue({ success: true });

    window.electronAPI = {
      getCacheSummary: vi.fn().mockImplementation(async (cacheId: string) =>
        cacheId === 'D:/library-flat'
          ? {
              success: true,
              data: {
                id: 'D:/library-flat',
                directoryPath: 'D:/library',
                directoryName: 'Library',
                lastScan: 1,
                imageCount: 2,
                parserVersion: PARSER_VERSION,
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
                  },
                ],
              },
            }
          : { success: true, data: null }
      ),
      cacheData,
      writeCacheChunk,
    };
    (cacheManager as any).isElectron = true;

    const patched = await cacheManager.patchCachedImages(
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
      false
    );

    expect(patched).toBe(true);
    expect(writeCacheChunk).not.toHaveBeenCalled();
    expect(cacheData).toHaveBeenCalledTimes(1);
    const written = cacheData.mock.calls[0][0].data.metadata;
    expect(written.map((entry: any) => entry.id)).toEqual(['dir-1::keep.png', 'dir-1::update.png']);
    expect(written[1].metadataString).toBe('{"new":true}');
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
          parserVersion: PARSER_VERSION,
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

  it('does not remove a different cached image that shares the upserted file name', async () => {
    const writeCacheChunk = vi.fn().mockResolvedValue({ success: true });
    const finalizeCacheWrite = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = {
      getCacheSummary: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'D:/library-recursive',
          directoryPath: 'D:/library',
          directoryName: 'Library',
          lastScan: 1,
          imageCount: 2,
          parserVersion: PARSER_VERSION,
          metadata: [
            {
              id: 'dir-1::sub1/image.png',
              name: 'image.png',
              metadataString: '{"folder":1}',
              metadata: {},
              lastModified: 1,
              models: [],
              loras: [],
              scheduler: '',
            },
            {
              id: 'dir-1::sub2/image.png',
              name: 'image.png',
              metadataString: '{"folder":2}',
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

    await cacheManager.applyChunkedCacheDelta(
      'D:/library',
      'Library',
      [
        {
          id: 'dir-1::sub1/image.png',
          name: 'image.png',
          handle: {} as any,
          metadata: {},
          metadataString: '{"updated":true}',
          lastModified: 2,
          models: [],
          loras: [],
          scheduler: '',
        } as any,
      ],
      [],
      [],
      true
    );

    expect(writeCacheChunk.mock.calls[0][0].data.map((entry: any) => entry.id)).toEqual([
      'dir-1::sub2/image.png',
      'dir-1::sub1/image.png',
    ]);
    expect(finalizeCacheWrite.mock.calls[0][0].record.imageCount).toBe(2);
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
          parserVersion: PARSER_VERSION,
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

  it('serializes concurrent cache delta upserts for the same directory', async () => {
    let persistedMetadata: any[] = [];
    const temporaryChunks = new Map<string, any[][]>();
    let releaseFirstFinalize: (() => void) | undefined;
    const firstFinalizeGate = new Promise<void>((resolve) => {
      releaseFirstFinalize = resolve;
    });
    let finalizeCount = 0;

    window.electronAPI = {
      getCacheSummary: vi.fn().mockImplementation(async () => ({
        success: true,
        data: {
          id: 'D:/library-flat',
          directoryPath: 'D:/library',
          directoryName: 'Library',
          lastScan: 1,
          imageCount: persistedMetadata.length,
          parserVersion: PARSER_VERSION,
          metadata: persistedMetadata,
        },
      })),
      writeCacheChunk: vi.fn().mockImplementation(async ({ cacheId, chunkIndex, data }) => {
        const chunks = temporaryChunks.get(cacheId) ?? [];
        chunks[chunkIndex] = data;
        temporaryChunks.set(cacheId, chunks);
        return { success: true };
      }),
      finalizeCacheWrite: vi.fn().mockImplementation(async ({ sourceCacheId }) => {
        finalizeCount += 1;
        if (finalizeCount === 1) {
          await firstFinalizeGate;
        }
        persistedMetadata = (temporaryChunks.get(sourceCacheId) ?? []).flat();
        return { success: true };
      }),
    };
    (cacheManager as any).isElectron = true;

    const createImage = (name: string) => ({
      id: `dir-1::${name}`,
      name,
      handle: {} as any,
      metadata: {},
      metadataString: '{}',
      lastModified: 1,
      models: [],
      loras: [],
      scheduler: '',
    } as any);

    const first = cacheManager.applyChunkedCacheDelta(
      'D:/library',
      'Library',
      [createImage('first.png')],
      [],
      [],
      false
    );

    await vi.waitFor(() => {
      expect(window.electronAPI.finalizeCacheWrite).toHaveBeenCalledTimes(1);
    });

    const second = cacheManager.applyChunkedCacheDelta(
      'D:/library',
      'Library',
      [createImage('second.png')],
      [],
      [],
      false
    );

    expect(window.electronAPI.getCacheSummary).toHaveBeenCalledTimes(1);
    releaseFirstFinalize?.();
    await Promise.all([first, second]);

    expect(window.electronAPI.getCacheSummary).toHaveBeenCalledTimes(2);
    expect(persistedMetadata.map((entry) => entry.id)).toEqual([
      'dir-1::first.png',
      'dir-1::second.png',
    ]);
  });

  it('uses the complete in-memory directory snapshot when rebuilding a missing cache', async () => {
    const cacheData = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = {
      getCacheSummary: vi.fn().mockResolvedValue({ success: true, data: null }),
      cacheData,
    };
    (cacheManager as any).isElectron = true;

    const createImage = (name: string, lastModified: number) => ({
      id: `dir-1::${name}`,
      name,
      handle: {} as any,
      metadata: {},
      metadataString: '{}',
      lastModified,
      models: [],
      loras: [],
      scheduler: '',
    } as any);
    const existing = createImage('existing.png', 1);
    const generated = createImage('generated.png', 2);

    await cacheManager.applyChunkedCacheDelta(
      'D:/library',
      'Library',
      [generated],
      [],
      [],
      false,
      { fallbackImages: [existing, generated] }
    );

    expect(cacheData).toHaveBeenCalledTimes(1);
    expect(cacheData.mock.calls[0][0].data.metadata.map((entry: any) => entry.id)).toEqual([
      'dir-1::existing.png',
      'dir-1::generated.png',
    ]);
    expect(cacheData.mock.calls[0][0].data.imageCount).toBe(2);
  });

  it('does not create a missing cache variant when fallback creation is disabled', async () => {
    const cacheData = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = {
      getCacheSummary: vi.fn().mockResolvedValue({ success: true, data: null }),
      cacheData,
    };
    (cacheManager as any).isElectron = true;

    await cacheManager.applyChunkedCacheDelta(
      'D:/library',
      'Library',
      [
        {
          id: 'dir-1::image.png',
          name: 'image.png',
          handle: {} as any,
          metadata: {},
          metadataString: '{}',
          lastModified: 1,
          models: [],
          loras: [],
          scheduler: '',
        } as any,
      ],
      [],
      [],
      true,
      { fallbackImages: [], createIfMissing: false }
    );

    expect(cacheData).not.toHaveBeenCalled();
  });

  it('preserves nested same-name files when rebuilding a missing cache after a root removal', async () => {
    const cacheData = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI = {
      getCacheSummary: vi.fn().mockResolvedValue({ success: true, data: null }),
      cacheData,
    };
    (cacheManager as any).isElectron = true;

    const createImage = (id: string) => ({
      id,
      name: 'image.png',
      handle: {} as any,
      metadata: {},
      metadataString: '{}',
      lastModified: 1,
      models: [],
      loras: [],
      scheduler: '',
    } as any);

    await cacheManager.applyChunkedCacheDelta(
      'D:/library',
      'Library',
      [],
      ['dir-1::image.png'],
      ['image.png'],
      true,
      {
        fallbackImages: [
          createImage('dir-1::image.png'),
          createImage('dir-1::nested/image.png'),
        ],
      }
    );

    expect(cacheData.mock.calls[0][0].data.metadata.map((entry: any) => entry.id)).toEqual([
      'dir-1::nested/image.png',
    ]);
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
          parserVersion: PARSER_VERSION,
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

  it('tops off the last existing chunk before creating a new one, and updates the id->chunk index', async () => {
    const getCacheChunk = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 'dir-1::existing.png', name: 'existing.png', metadataString: '{}', metadata: {}, lastModified: 1, models: [], loras: [], scheduler: '' }],
    });
    const writeCacheChunk = vi.fn().mockResolvedValue({ success: true });
    const finalizeCacheWrite = vi.fn().mockResolvedValue({ success: true });
    const writeCacheIndex = vi.fn().mockResolvedValue({ success: true });
    const readCacheIndex = vi.fn().mockResolvedValue({
      success: true,
      data: { lastScan: 1, chunkCount: 1, ids: { 'dir-1::existing.png': 0 } },
    });

    window.electronAPI = {
      getCacheSummary: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'D:/library-flat',
          directoryPath: 'D:/library',
          directoryName: 'Library',
          lastScan: 1,
          imageCount: 1,
          chunkCount: 1,
          parserVersion: PARSER_VERSION,
        },
      }),
      getCacheChunk,
      writeCacheChunk,
      finalizeCacheWrite,
      readCacheIndex,
      writeCacheIndex,
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
      { chunkSize: 5 }
    );

    // Room in chunk 0 (1 entry, chunkSize 5) => topped off, no new chunk created.
    expect(writeCacheChunk).toHaveBeenCalledTimes(1);
    expect(writeCacheChunk.mock.calls[0][0].chunkIndex).toBe(0);
    expect(writeCacheChunk.mock.calls[0][0].data.map((entry: any) => entry.id)).toEqual([
      'dir-1::existing.png',
      'dir-1::new.png',
    ]);
    expect(finalizeCacheWrite.mock.calls[0][0].record.imageCount).toBe(2);
    expect(finalizeCacheWrite.mock.calls[0][0].record.chunkCount).toBe(1);
    expect(writeCacheIndex).toHaveBeenCalledTimes(1);
    expect(writeCacheIndex.mock.calls[0][0].data.ids).toEqual({
      'dir-1::existing.png': 0,
      'dir-1::new.png': 0,
    });
  });

  describe('tombstoned removals', () => {
    const makeEntry = (id: string, name: string) => ({
      id,
      name,
      metadataString: '{}',
      metadata: {},
      lastModified: 1,
      models: [],
      loras: [],
      scheduler: '',
    });

    // Two chunks, one entry each: a.png in chunk 0, b.png in chunk 1.
    const setupTwoChunkCache = (overrides: {
      imageCount?: number;
      tombstoneCount?: number;
      tombstoneIds?: string[] | null;
      indexIds?: Record<string, number>;
    } = {}) => {
      const getCacheChunk = vi.fn().mockImplementation(async ({ chunkIndex }) => ({
        success: true,
        data: chunkIndex === 0
          ? [makeEntry('dir-1::a.png', 'a.png')]
          : [makeEntry('dir-1::b.png', 'b.png')],
      }));
      const api = {
        getCacheSummary: vi.fn().mockImplementation(async (cacheId: string) =>
          cacheId === 'D:/library-flat'
            ? {
                success: true,
                data: {
                  id: 'D:/library-flat',
                  directoryPath: 'D:/library',
                  directoryName: 'Library',
                  lastScan: 1,
                  imageCount: overrides.imageCount ?? 2,
                  chunkCount: 2,
                  tombstoneCount: overrides.tombstoneCount ?? 0,
                  parserVersion: PARSER_VERSION,
                },
              }
            : { success: true, data: null }
        ),
        getCacheChunk,
        writeCacheChunk: vi.fn().mockResolvedValue({ success: true }),
        finalizeCacheWrite: vi.fn().mockResolvedValue({ success: true }),
        writeCacheIndex: vi.fn().mockResolvedValue({ success: true }),
        readCacheIndex: vi.fn().mockResolvedValue({
          success: true,
          data: {
            lastScan: 1,
            chunkCount: 2,
            ids: overrides.indexIds ?? { 'dir-1::a.png': 0, 'dir-1::b.png': 1 },
          },
        }),
        readCacheTombstones: vi.fn().mockResolvedValue({
          success: true,
          data: overrides.tombstoneIds === null || overrides.tombstoneIds === undefined
            ? null
            : { chunkCount: 2, ids: overrides.tombstoneIds },
        }),
      };
      window.electronAPI = api as any;
      (cacheManager as any).isElectron = true;
      return api;
    };

    it('records a removal in the sidecar without touching any chunk file', async () => {
      const api = setupTwoChunkCache();

      await cacheManager.removeCachedImages('D:/library', 'Library', ['dir-1::b.png'], [], false);

      expect(api.getCacheChunk).not.toHaveBeenCalled();
      expect(api.writeCacheChunk).not.toHaveBeenCalled();
      const finalized = api.finalizeCacheWrite.mock.calls[0][0];
      expect(finalized.tombstones).toEqual({ chunkCount: 2, ids: ['dir-1::b.png'] });
      expect(finalized.record.imageCount).toBe(1);
      expect(finalized.record.chunkCount).toBe(2);
      // lastScan is left alone so the id->chunk index stays valid for the next delete.
      expect(finalized.record.lastScan).toBe(1);
      expect(api.writeCacheIndex).not.toHaveBeenCalled();
    });

    it('resolves removals passed by name through the id->chunk index', async () => {
      const api = setupTwoChunkCache();

      await cacheManager.removeCachedImages('D:/library', 'Library', [], ['b.png'], false);

      expect(api.getCacheChunk).not.toHaveBeenCalled();
      expect(api.finalizeCacheWrite.mock.calls[0][0].tombstones.ids).toEqual(['dir-1::b.png']);
    });

    it('appends to the existing sidecar instead of replacing it', async () => {
      const api = setupTwoChunkCache({
        imageCount: 1,
        tombstoneCount: 1,
        tombstoneIds: ['dir-1::b.png'],
      });

      await cacheManager.removeCachedImages('D:/library', 'Library', ['dir-1::a.png'], [], false);

      const finalized = api.finalizeCacheWrite.mock.calls[0][0];
      expect(finalized.tombstones.ids).toEqual(['dir-1::b.png', 'dir-1::a.png']);
      expect(finalized.record.imageCount).toBe(0);
    });

    it('writes nothing when the id is already tombstoned', async () => {
      const api = setupTwoChunkCache({
        imageCount: 1,
        tombstoneCount: 1,
        tombstoneIds: ['dir-1::b.png'],
      });

      await cacheManager.removeCachedImages('D:/library', 'Library', ['dir-1::b.png'], [], false);

      expect(api.finalizeCacheWrite).not.toHaveBeenCalled();
      expect(api.writeCacheChunk).not.toHaveBeenCalled();
    });

    it('rewrites the cache when the sidecar is missing but the record expects one', async () => {
      const api = setupTwoChunkCache({
        imageCount: 1,
        tombstoneCount: 1,
        tombstoneIds: null,
      });

      await cacheManager.removeCachedImages('D:/library', 'Library', ['dir-1::a.png'], [], false);

      // Full rewrite: every chunk read, and the surviving entries written back.
      expect(api.getCacheChunk).toHaveBeenCalledTimes(2);
      const written = api.writeCacheChunk.mock.calls.flatMap((call: any) => call[0].data.map((entry: any) => entry.id));
      // The unusable sidecar is ignored, so b.png comes back rather than being
      // silently dropped along with the entries it could not account for.
      expect(written).toEqual(['dir-1::b.png']);
      const finalized = api.finalizeCacheWrite.mock.calls[0][0];
      expect(finalized.tombstones).toBeUndefined();
    });

    it('compacts instead of tombstoning once the sidecar grows past the budget', async () => {
      const staleIds = Array.from({ length: 500 }, (_, index) => `dir-1::stale-${index}.png`);
      const indexIds: Record<string, number> = { 'dir-1::a.png': 0, 'dir-1::b.png': 1 };
      for (const id of staleIds) indexIds[id] = 0;
      const api = setupTwoChunkCache({
        imageCount: 2,
        tombstoneCount: 500,
        tombstoneIds: staleIds,
        indexIds,
      });
      api.readCacheTombstones.mockResolvedValue({
        success: true,
        data: { chunkCount: 2, ids: staleIds },
      });

      await cacheManager.removeCachedImages('D:/library', 'Library', ['dir-1::b.png'], [], false);

      // 501 tombstones would exceed the budget, so the delete pays for the
      // rewrite that drops them all and clears the sidecar.
      expect(api.getCacheChunk).toHaveBeenCalledTimes(2);
      const finalized = api.finalizeCacheWrite.mock.calls[0][0];
      expect(finalized.tombstones).toBeUndefined();
      expect(finalized.record.imageCount).toBe(1);
    });

    it('drops tombstoned entries when a delta rewrite streams the chunks out', async () => {
      const api = setupTwoChunkCache({
        imageCount: 1,
        tombstoneCount: 1,
        tombstoneIds: ['dir-1::b.png'],
      });

      await cacheManager.applyChunkedCacheDelta('D:/library', 'Library', [], ['dir-1::a.png'], [], false);

      const written = api.writeCacheChunk.mock.calls.flatMap((call: any) => call[0].data.map((entry: any) => entry.id));
      expect(written).toEqual([]);
      const finalized = api.finalizeCacheWrite.mock.calls[0][0];
      expect(finalized.record.imageCount).toBe(0);
      expect(finalized.tombstones).toBeUndefined();
    });

    it('serves every cached entry when the sidecar disagrees with the record', async () => {
      const api = setupTwoChunkCache({
        imageCount: 1,
        tombstoneCount: 2,
        tombstoneIds: ['dir-1::b.png'],
      });

      const delivered: string[] = [];
      await cacheManager.iterateCachedMetadata('D:/library', false, (chunk) => {
        delivered.push(...chunk.map((entry) => entry.id));
      });

      expect(api.readCacheTombstones).toHaveBeenCalled();
      expect(delivered).toEqual(['dir-1::a.png', 'dir-1::b.png']);
    });

    it('hides tombstoned entries from the cache load path', async () => {
      setupTwoChunkCache({
        imageCount: 1,
        tombstoneCount: 1,
        tombstoneIds: ['dir-1::b.png'],
      });

      const delivered: string[] = [];
      await cacheManager.iterateCachedMetadata('D:/library', false, (chunk) => {
        delivered.push(...chunk.map((entry) => entry.id));
      });
      expect(delivered).toEqual(['dir-1::a.png']);

      const cached = await cacheManager.getCachedData('D:/library', false);
      expect(cached?.metadata.map((entry) => entry.id)).toEqual(['dir-1::a.png']);
      expect(cached?.imageCount).toBe(1);
    });

    it('rewrites the cache when a tombstoned id is added back', async () => {
      const api = setupTwoChunkCache({
        imageCount: 1,
        tombstoneCount: 1,
        tombstoneIds: ['dir-1::b.png'],
      });

      await cacheManager.appendToCache(
        'D:/library',
        'Library',
        [{ ...makeEntry('dir-1::b.png', 'b.png'), handle: {} as any, lastModified: 5 } as any],
        false
      );

      // The dead b.png entry is still sitting in chunk 1, so an incremental
      // append would leave two entries for the same id.
      const written = api.writeCacheChunk.mock.calls.flatMap((call: any) => call[0].data.map((entry: any) => entry.id));
      expect(written).toEqual(['dir-1::a.png', 'dir-1::b.png']);
      const finalized = api.finalizeCacheWrite.mock.calls[0][0];
      expect(finalized.record.imageCount).toBe(2);
      expect(finalized.tombstones).toBeUndefined();
    });

    it('carries the sidecar forward across an ordinary append', async () => {
      const api = setupTwoChunkCache({
        imageCount: 1,
        tombstoneCount: 1,
        tombstoneIds: ['dir-1::b.png'],
      });

      await cacheManager.appendToCache(
        'D:/library',
        'Library',
        [{ ...makeEntry('dir-1::c.png', 'c.png'), handle: {} as any } as any],
        false,
        { chunkSize: 1 }
      );

      const finalized = api.finalizeCacheWrite.mock.calls[0][0];
      expect(finalized.tombstones).toEqual({
        chunkCount: finalized.record.chunkCount,
        ids: ['dir-1::b.png'],
      });
    });
  });

  it('removeCachedImages falls back to a full scan when no id->chunk index exists', async () => {
    const getCacheChunk = vi.fn().mockImplementation(async ({ chunkIndex }) => ({
      success: true,
      data: chunkIndex === 0
        ? [{ id: 'dir-1::a.png', name: 'a.png', metadataString: '{}', metadata: {}, lastModified: 1, models: [], loras: [], scheduler: '' }]
        : [{ id: 'dir-1::b.png', name: 'b.png', metadataString: '{}', metadata: {}, lastModified: 1, models: [], loras: [], scheduler: '' }],
    }));
    const writeCacheChunk = vi.fn().mockResolvedValue({ success: true });
    const finalizeCacheWrite = vi.fn().mockResolvedValue({ success: true });
    const writeCacheIndex = vi.fn().mockResolvedValue({ success: true });
    const readCacheIndex = vi.fn().mockResolvedValue({ success: true, data: null });

    window.electronAPI = {
      getCacheSummary: vi.fn().mockImplementation(async (cacheId: string) =>
        cacheId === 'D:/library-flat'
          ? {
              success: true,
              data: {
                id: 'D:/library-flat',
                directoryPath: 'D:/library',
                directoryName: 'Library',
                lastScan: 1,
                imageCount: 2,
                chunkCount: 2,
                parserVersion: PARSER_VERSION,
              },
            }
          : { success: true, data: null }
      ),
      getCacheChunk,
      writeCacheChunk,
      finalizeCacheWrite,
      readCacheIndex,
      writeCacheIndex,
    };
    (cacheManager as any).isElectron = true;

    await cacheManager.removeCachedImages('D:/library', 'Library', ['dir-1::b.png'], ['b.png'], false);

    // No usable index => both chunks are scanned via the applyChunkedCacheDelta fallback.
    expect(getCacheChunk).toHaveBeenCalledTimes(2);
    const survivingIds = writeCacheChunk.mock.calls.flatMap((call: any) => call[0].data.map((entry: any) => entry.id));
    expect(survivingIds).toEqual(['dir-1::a.png']);
  });
});
