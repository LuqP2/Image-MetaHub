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

const createImage = (name: string, models: string[] = []): IndexedImage => ({
  id: `dir-1::${name}`,
  name,
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  models,
  loras: [],
  sampler: '',
  scheduler: '',
  directoryId: 'dir-1',
});

describe('useImageStore active image scope', () => {
  // The scope is a descriptor ({ type, id, label }) that resolves to the set of images it
  // targets and is intersected with filteredImages. Here a model scope targets second + third.
  const first = createImage('first.png', ['base']);
  const second = createImage('second.png', ['scoped']);
  const third = createImage('third.png', ['scoped']);

  beforeEach(() => {
    useImageStore.getState().resetState();
    useImageStore.setState({
      directories: [directory],
      images: [first, second, third],
      filteredImages: [first, second, third],
      activeImageScope: { type: 'model', id: 'scoped', label: 'scoped' },
      selectedImages: new Set(),
      selectedImage: second,
      clusterNavigationContext: null,
    });
  });

  it('resolves the scoped filtered images from the descriptor', () => {
    expect(useImageStore.getState().getScopedFilteredImages().map((image) => image.id)).toEqual([
      second.id,
      third.id,
    ]);
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

  it('auto-clears the scope with a toast when the target no longer exists', () => {
    useImageStore.setState({
      activeImageScope: { type: 'collection', id: 'missing-collection', label: 'Gone' },
    });
    useImageStore.getState().validateActiveImageScope();
    expect(useImageStore.getState().activeImageScope).toBeNull();
    expect(useImageStore.getState().success).toBe('Scope removed: the collection no longer exists');
  });
});
