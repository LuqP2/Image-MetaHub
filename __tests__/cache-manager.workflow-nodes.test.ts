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
          parserVersion: 6,
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
              parserVersion: 6,
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
              parserVersion: 6,
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
});
