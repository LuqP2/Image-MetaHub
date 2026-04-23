import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Directory, IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

const directory: Directory = {
  id: 'dir-1',
  name: 'Library',
  path: 'D:/library',
  handle: {} as FileSystemDirectoryHandle,
  visible: true,
};

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: `dir-1::${overrides.name ?? 'image.png'}`,
  name: overrides.name ?? 'image.png',
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  sampler: '',
  scheduler: '',
  directoryId: 'dir-1',
  ...overrides,
});

const mockWorkerInstances: MockSearchWorker[] = [];

class MockSearchWorker {
  onmessage: ((event: MessageEvent<any>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly postMessage = vi.fn((message: any) => {
    if (message?.type === 'syncDataset') {
      this.dataset = message.payload.images;
      return;
    }

    if (message?.type === 'compute') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            type: 'complete',
            payload: {
              criteriaKey: message.payload.criteriaKey,
              filteredIds: this.dataset.map((image) => image.id),
              facets: {
                availableModels: [],
                availableLoras: [],
                availableSamplers: [],
                availableSchedulers: [],
                availableGenerators: [],
                availableGpuDevices: [],
                availableDimensions: [],
                modelFacetCounts: [],
                loraFacetCounts: [],
                samplerFacetCounts: [],
                schedulerFacetCounts: [],
              },
            },
          },
        } as MessageEvent);
      });
    }
  });
  readonly terminate = vi.fn();
  private dataset: Array<Record<string, unknown>> = [];

  constructor() {
    mockWorkerInstances.push(this);
  }
}

const flushWorker = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('useImageStore search worker sync', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', MockSearchWorker as unknown as typeof Worker);
    mockWorkerInstances.length = 0;
    useSettingsStore.setState({
      enableSafeMode: false,
      blurSensitiveImages: true,
      sensitiveTags: [],
    });

    useImageStore.getState().resetState();
    useImageStore.setState({
      directories: [directory],
      images: [
        createImage({
          id: 'dir-1::cat.png',
          name: 'cat.png',
          prompt: 'cat portrait',
          models: ['NovaXL'],
          loras: ['detailer'],
          scheduler: 'karras',
          workflowNodes: ['KSampler'],
          metadataString: '{"workflow":{"secret":"should-not-sync"}}',
          enrichmentState: 'enriched',
        }),
      ],
      filteredImages: [],
      sortOrder: 'asc',
    });
  });

  afterEach(() => {
    useImageStore.getState().resetState();
    vi.unstubAllGlobals();
    mockWorkerInstances.length = 0;
  });

  it('syncs the dataset once and only recomputes on subsequent query edits', async () => {
    useImageStore.getState().setSearchQuery('cat');
    await flushWorker();

    const worker = mockWorkerInstances[0];
    expect(worker).toBeTruthy();
    expect(worker.postMessage.mock.calls.map(([message]) => message.type)).toEqual(['syncDataset', 'compute']);

    useImageStore.getState().setSearchQuery('portrait');
    await flushWorker();

    expect(worker.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
      'syncDataset',
      'compute',
      'compute',
    ]);
  });

  it('forces exactly one dataset re-sync after image data changes', async () => {
    useImageStore.getState().setSearchQuery('cat');
    await flushWorker();

    const worker = mockWorkerInstances[0];
    expect(worker.postMessage.mock.calls.filter(([message]) => message.type === 'syncDataset')).toHaveLength(1);

    useImageStore.getState().setImages([
      ...useImageStore.getState().images,
      createImage({
        id: 'dir-1::dog.png',
        name: 'dog.png',
        prompt: 'dog portrait',
        enrichmentState: 'enriched',
      }),
    ]);

    useImageStore.getState().setSearchQuery('dog');
    await flushWorker();

    expect(worker.postMessage.mock.calls.filter(([message]) => message.type === 'syncDataset')).toHaveLength(2);
    expect(worker.postMessage.mock.calls.filter(([message]) => message.type === 'compute')).toHaveLength(2);
  });

  it('sends a compact capped search payload without raw metadata blobs', async () => {
    const hugeMarker = 'raw-json-only-marker';
    const giantMetadata = `{"workflow":"${hugeMarker.repeat(2000)}"}`;
    useImageStore.getState().setImages([
      createImage({
        id: 'dir-1::huge.png',
        name: 'huge.png',
        prompt: 'sunset vista',
        metadataString: giantMetadata,
        models: ['NovaXL'],
        loras: ['detailer'],
        workflowNodes: ['KSampler'],
        enrichmentState: 'enriched',
      }),
    ]);

    useImageStore.getState().setSearchQuery('sunset');
    await flushWorker();

    const worker = mockWorkerInstances[0];
    const syncMessage = worker.postMessage.mock.calls.find(([message]) => message.type === 'syncDataset')?.[0];
    const syncedImage = syncMessage?.payload?.images?.[0];

    expect(syncedImage).toBeTruthy();
    expect('metadataString' in syncedImage).toBe(false);
    expect(syncedImage.searchText).toContain('sunset vista');
    expect(syncedImage.searchText).toContain('novaxl');
    expect(syncedImage.searchText).not.toContain(hugeMarker);
    expect(syncedImage.searchText.length).toBeLessThanOrEqual(8192);
  });
});
