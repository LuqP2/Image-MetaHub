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
      getCacheSummary: vi.fn().mockResolvedValue({
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
});
