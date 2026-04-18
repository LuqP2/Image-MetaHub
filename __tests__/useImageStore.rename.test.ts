import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageCluster, IndexedImage, SmartCollection } from '../types';
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

const createCluster = (overrides: Partial<ImageCluster>): ImageCluster => ({
  id: 'cluster-1',
  promptHash: 'hash-1',
  basePrompt: 'prompt',
  imageIds: [],
  coverImageId: '',
  size: 0,
  similarityThreshold: 0.8,
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

  it('remaps clustering references when the image id changes', () => {
    const image = createImage('dir-1::old.png', 'old.png');
    const sibling = createImage('dir-1::sibling.png', 'sibling.png');
    useImageStore.setState({
      images: [image, sibling],
      filteredImages: [image, sibling],
      activeImageScope: [image, sibling],
      clusterNavigationContext: [image, sibling],
      clusters: [
        createCluster({
          imageIds: ['dir-1::old.png', 'dir-1::sibling.png'],
          coverImageId: 'dir-1::old.png',
          size: 2,
        }),
      ],
      clusteringMetadata: {
        processedCount: 2,
        remainingCount: 0,
        isLimited: false,
        lockedImageIds: new Set(['dir-1::old.png']),
      },
    } as any);

    useImageStore.getState().renameImageRecord('dir-1::old.png', 'new.png');
    const state = useImageStore.getState();

    expect(state.clusters[0].imageIds).toEqual(['dir-1::new.png', 'dir-1::sibling.png']);
    expect(state.clusters[0].coverImageId).toBe('dir-1::new.png');
    expect(Array.from(state.clusteringMetadata?.lockedImageIds ?? [])).toEqual(['dir-1::new.png']);
    expect(state.activeImageScope?.map((entry) => entry.id)).toEqual(['dir-1::new.png', 'dir-1::sibling.png']);
    expect(state.clusterNavigationContext?.map((entry) => entry.id)).toEqual(['dir-1::new.png', 'dir-1::sibling.png']);
  });

  it('rejects renames that would collide with an existing image id', () => {
    const image = createImage('dir-1::old.png', 'old.png');
    const existingTarget = createImage('dir-1::target.png', 'target.png');
    useImageStore.setState({
      images: [image, existingTarget],
      filteredImages: [image, existingTarget],
      selectedImages: new Set(['dir-1::old.png']),
    } as any);

    const renamedImage = useImageStore.getState().renameImageRecord('dir-1::old.png', 'target.png');
    const state = useImageStore.getState();

    expect(renamedImage).toBeNull();
    expect(state.images.map((entry) => entry.id)).toEqual(['dir-1::old.png', 'dir-1::target.png']);
    expect(Array.from(state.selectedImages)).toEqual(['dir-1::old.png']);
  });
});
