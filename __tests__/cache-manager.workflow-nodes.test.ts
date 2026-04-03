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
});
