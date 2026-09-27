import { afterEach, describe, expect, it, vi } from 'vitest';
import { useImageStore } from '../store/useImageStore';
import type { IndexedImage } from '../types';
import { saveAutoTagCache } from '../services/clusterCacheManager';
import cacheManager from '../services/cacheManager';

vi.mock('../services/clusterCacheManager', () => ({ saveAutoTagCache: vi.fn() }));
vi.mock('../services/cacheManager', () => ({
  PARSER_VERSION: 1,
  default: { patchCachedImages: vi.fn().mockResolvedValue(true) },
}));

class MockAutoTagWorker {
  static instance: MockAutoTagWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    MockAutoTagWorker.instance = this;
  }

  complete(autoTags: Record<string, Array<{ tag: string }>>) {
    this.onmessage?.({
      data: {
        type: 'complete',
        payload: {
          autoTags,
          tfidfModel: { vocabulary: [], idfScores: new Map(), documentCount: 2 },
        },
      },
    } as MessageEvent);
  }
}

const image = (id: string, autoTags: string[]): IndexedImage => ({
  id,
  name: `${id}.png`,
  directoryId: 'synthetic',
  handle: {} as FileSystemFileHandle,
  metadata: {} as IndexedImage['metadata'],
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  sampler: '',
  scheduler: '',
  autoTags,
});

describe('Auto-Tag regeneration', () => {
  afterEach(() => {
    useImageStore.getState().resetState();
    vi.unstubAllGlobals();
  });

  it('generates tags for one image without changing the other image or saving a partial library cache', async () => {
    vi.stubGlobal('Worker', MockAutoTagWorker);
    vi.mocked(saveAutoTagCache).mockClear();
    useImageStore.getState().resetState();
    useImageStore.setState({
      images: [
        { ...image('one', ['old tag']), prompt: 'pine forest' },
        { ...image('two', ['keep tag']), prompt: 'mountain trail' },
      ],
    });

    const completion = useImageStore.getState().startAutoTaggingForImage('one');
    expect(MockAutoTagWorker.instance.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'start',
      payload: expect.objectContaining({ targetImageId: 'one', images: expect.arrayContaining([
        expect.objectContaining({ id: 'one' }),
        expect.objectContaining({ id: 'two' }),
      ]), excludeTags: ['old tag'] }),
    }));
    MockAutoTagWorker.instance.complete({ one: [{ tag: 'pine forest' }] });

    await expect(completion).resolves.toBe(true);
    expect(useImageStore.getState().images.map(item => item.autoTags)).toEqual([
      ['pine forest'], ['keep tag'],
    ]);
    expect(saveAutoTagCache).not.toHaveBeenCalled();
  });

  it('persists individual replacements in the image metadata cache', async () => {
    vi.stubGlobal('Worker', MockAutoTagWorker);
    vi.mocked(cacheManager.patchCachedImages).mockClear();
    useImageStore.getState().resetState();
    useImageStore.setState({
      directories: [{
        id: 'synthetic', name: 'Synthetic', path: 'D:/synthetic',
        handle: {} as FileSystemDirectoryHandle,
      }],
      images: [{ ...image('one', ['old tag']), prompt: 'pine forest' }],
    });

    const completion = useImageStore.getState().startAutoTaggingForImage('one');
    MockAutoTagWorker.instance.complete({ one: [{ tag: 'pine forest' }] });
    await expect(completion).resolves.toBe(true);
    await vi.waitFor(() => expect(cacheManager.patchCachedImages).toHaveBeenCalledWith(
      'D:/synthetic', 'Synthetic',
      [expect.objectContaining({ id: 'one', autoTags: ['pine forest'] })],
      expect.any(Boolean),
    ));

    useImageStore.getState().removeAutoTagFromImage('one', 'pine forest');
    await vi.waitFor(() => expect(cacheManager.patchCachedImages).toHaveBeenCalledWith(
      'D:/synthetic', 'Synthetic',
      [expect.objectContaining({ id: 'one', autoTags: [] })],
      expect.any(Boolean),
    ));
  });

  it('settles an individual request when tagging is cancelled', async () => {
    vi.stubGlobal('Worker', MockAutoTagWorker);
    useImageStore.getState().resetState();
    useImageStore.setState({ images: [{ ...image('one', ['old tag']), prompt: 'pine forest' }] });

    const completion = useImageStore.getState().startAutoTaggingForImage('one');
    useImageStore.getState().cancelAutoTagging();

    await expect(completion).resolves.toBe(false);
    expect(useImageStore.getState().images[0].autoTags).toEqual(['old tag']);
    expect(useImageStore.getState().isAutoTagging).toBe(false);
  });

  it('replaces old tags, removes vanished selections and reapplies surviving filters', async () => {
    vi.stubGlobal('Worker', MockAutoTagWorker);
    useImageStore.getState().resetState();
    const images = [image('one', ['old tag']), image('two', ['old tag'])];
    useImageStore.setState({
      directories: [{
        id: 'synthetic', name: 'Synthetic', path: 'D:/synthetic', visible: true,
        handle: {} as FileSystemDirectoryHandle,
      }],
      images,
      filteredImages: images,
      selectedAutoTags: ['old tag', 'pine forest'],
      excludedAutoTags: ['obsolete tag'],
    });

    const completion = useImageStore.getState().startAutoTagging('D:/synthetic', false);
    MockAutoTagWorker.instance.complete({
      one: [{ tag: 'pine forest' }],
      two: [{ tag: 'mountain trail' }],
    });
    await expect(completion).resolves.toBe(true);

    const state = useImageStore.getState();
    expect(state.images.map(item => item.autoTags)).toEqual([
      ['pine forest'], ['mountain trail'],
    ]);
    expect(state.selectedAutoTags).toEqual(['pine forest']);
    expect(state.excludedAutoTags).toEqual([]);
    expect(state.filteredImages.map(item => item.id)).toEqual(['one']);
    expect(state.images.every(item => item.autoTagsGeneratedAt !== undefined)).toBe(true);
  });
});
