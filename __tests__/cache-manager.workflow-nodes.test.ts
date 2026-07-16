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
  });

  it('stops reading chunks once every reparsed image has been located', async () => {
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

    // Chunks 0 and 1 are read; chunk 1 holds the target, so reading stops early.
    expect(getCacheChunk).toHaveBeenCalledTimes(2);
    expect(writeCacheChunk).toHaveBeenCalledTimes(1);
    expect(writeCacheChunk.mock.calls[0][0].chunkIndex).toBe(1);
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
});
