import { beforeEach, describe, expect, it } from 'vitest';
import { type Directory, type IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';

const directory: Directory = {
  id: 'dir-1',
  name: 'Library',
  path: 'D:/library',
  handle: {} as FileSystemDirectoryHandle,
  visible: true,
};

const createImage = (name: string): IndexedImage => ({
  id: `dir-1::${name}`,
  name,
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

describe('useImageStore active image scope', () => {
  const first = createImage('first.png');
  const second = createImage('second.png');
  const third = createImage('third.png');

  beforeEach(() => {
    useImageStore.getState().resetState();
    useImageStore.setState({
      directories: [directory],
      images: [first, second, third],
      filteredImages: [first, second, third],
      activeImageScope: [second, third],
      selectedImages: new Set(),
      selectedImage: second,
      clusterNavigationContext: null,
    });
  });

  it('selects all images from the active scope', () => {
    useImageStore.getState().selectAllImages();
    expect(Array.from(useImageStore.getState().selectedImages)).toEqual([
      second.id,
      third.id,
    ]);
  });

  it('navigates within the active scope when no cluster context is set', () => {
    useImageStore.getState().handleNavigateNext();
    expect(useImageStore.getState().selectedImage?.id).toBe(third.id);

    useImageStore.getState().handleNavigatePrevious();
    expect(useImageStore.getState().selectedImage?.id).toBe(second.id);
  });
});
