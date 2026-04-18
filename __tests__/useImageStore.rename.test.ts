import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexedImage, SmartCollection } from '../types';
import { useImageStore } from '../store/useImageStore';

vi.mock('../services/folderSelectionStorage', () => ({
  loadSelectedFolders: vi.fn().mockResolvedValue([]),
  saveSelectedFolders: vi.fn().mockResolvedValue(undefined),
  loadExcludedFolders: vi.fn().mockResolvedValue([]),
  saveExcludedFolders: vi.fn().mockResolvedValue(undefined),
}));

const createImage = (id: string, name: string): IndexedImage => ({
  id,
  name,
  handle: { name: name.split('/').pop() || name } as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  directoryId: 'dir-1',
});

const createCollection = (overrides: Partial<SmartCollection>): SmartCollection => ({
  id: 'collection-1',
  kind: 'manual',
  name: 'Collection',
  sortIndex: 0,
  imageCount: 0,
  imageIds: [],
  snapshotImageIds: [],
  excludedImageIds: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('renameImageRecord', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
  });

  it('remaps collection image references when the image id changes', () => {
    const image = createImage('dir-1::old.png', 'old.png');
    useImageStore.setState({
      images: [image],
      filteredImages: [image],
      collections: [
        createCollection({
          imageIds: ['dir-1::old.png'],
          snapshotImageIds: ['dir-1::old.png'],
          excludedImageIds: ['dir-1::old.png'],
          coverImageId: 'dir-1::old.png',
          thumbnailId: 'dir-1::old.png',
        }),
      ],
    } as any);

    const renamedImage = useImageStore.getState().renameImageRecord('dir-1::old.png', 'new.png');
    const collection = useImageStore.getState().collections[0];

    expect(renamedImage?.id).toBe('dir-1::new.png');
    expect(collection.imageIds).toEqual(['dir-1::new.png']);
    expect(collection.snapshotImageIds).toEqual(['dir-1::new.png']);
    expect(collection.excludedImageIds).toEqual(['dir-1::new.png']);
    expect(collection.coverImageId).toBe('dir-1::new.png');
    expect(collection.thumbnailId).toBe('dir-1::new.png');
  });
});
