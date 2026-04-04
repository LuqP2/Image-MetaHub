import { beforeEach, describe, expect, it } from 'vitest';
import { useImageStore } from '../store/useImageStore';
import { IndexedImage } from '../types';

const createImage = (id: string): IndexedImage => ({
  id,
  name: `${id}.png`,
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  sampler: '',
  scheduler: '',
  directoryId: 'dir-1',
});

describe('useImageStore comparison actions', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
  });

  it('stores up to four unique images when starting a comparison', () => {
    const images = [
      createImage('img-1'),
      createImage('img-2'),
      createImage('img-2'),
      createImage('img-3'),
      createImage('img-4'),
      createImage('img-5'),
    ];

    useImageStore.getState().setComparisonImages(images);

    expect(useImageStore.getState().comparisonImages.map((image) => image.id)).toEqual([
      'img-1',
      'img-2',
      'img-3',
      'img-4',
    ]);
  });

  it('can append, swap, and remove comparison images in list mode', () => {
    const store = useImageStore.getState();
    const first = createImage('img-1');
    const second = createImage('img-2');
    const third = createImage('img-3');

    store.addImageToComparison(first);
    store.addImageToComparison(second);
    store.addImageToComparison(third);
    store.swapComparisonImages();

    expect(useImageStore.getState().comparisonImages.map((image) => image.id)).toEqual([
      'img-2',
      'img-1',
      'img-3',
    ]);

    useImageStore.getState().removeImageFromComparison(1);

    expect(useImageStore.getState().comparisonImages.map((image) => image.id)).toEqual([
      'img-2',
      'img-3',
    ]);
  });
});
