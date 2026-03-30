import { beforeEach, describe, expect, it } from 'vitest';
import { ImageAnnotations, IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';
import {
  bulkSaveAnnotations,
  clearAllAnnotations,
  deleteManualTag,
  ensureManualTagExists,
  getAllManualTagNames,
} from '../services/imageAnnotationsStorage';

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: overrides.id ?? 'img-1',
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

const imageCatalog = [
  { id: 'img-1', name: 'one.png' },
  { id: 'img-2', name: 'two.png' },
];

const resetTagStorage = async () => {
  await clearAllAnnotations();
  const manualTags = await getAllManualTagNames();
  for (const tagName of manualTags) {
    await deleteManualTag(tagName);
  }
};

const seedStore = async (annotations: ImageAnnotations[], manualTags: string[] = []) => {
  await resetTagStorage();
  useImageStore.getState().resetState();

  for (const tagName of manualTags) {
    await ensureManualTagExists(tagName);
  }

  if (annotations.length > 0) {
    await bulkSaveAnnotations(annotations);
  }

  const annotationMap = new Map(annotations.map((annotation) => [annotation.imageId, annotation]));
  const images = imageCatalog.map(({ id, name }) =>
    createImage({
      id,
      name,
      tags: annotationMap.get(id)?.tags ?? [],
    }),
  );

  useImageStore.setState({
    images,
    filteredImages: images,
    annotations: annotationMap,
    sortOrder: 'asc',
  });

  await useImageStore.getState().refreshAvailableTags();
};

describe('useImageStore manual tag catalog actions', () => {
  beforeEach(async () => {
    await seedStore([]);
  });

  it('includes zero-use persisted tags in availableTags', async () => {
    await ensureManualTagExists('ghost-tag');
    await useImageStore.getState().refreshAvailableTags();

    expect(useImageStore.getState().availableTags).toEqual([
      { name: 'ghost-tag', count: 0 },
    ]);
  });

  it('renames tags across annotations and merges into an existing tag', async () => {
    await seedStore([
      { imageId: 'img-1', isFavorite: false, tags: ['typo', 'portrait'], addedAt: 1, updatedAt: 1 },
      { imageId: 'img-2', isFavorite: false, tags: ['typo'], addedAt: 1, updatedAt: 1 },
    ], ['typo', 'portrait']);

    await useImageStore.getState().renameTag('typo', 'portrait');

    expect(useImageStore.getState().annotations.get('img-1')?.tags).toEqual(['portrait']);
    expect(useImageStore.getState().annotations.get('img-2')?.tags).toEqual(['portrait']);
    expect(useImageStore.getState().availableTags).toEqual([
      { name: 'portrait', count: 2 },
    ]);
  });

  it('clears a tag from all images but keeps it as an empty tag', async () => {
    await seedStore([
      { imageId: 'img-1', isFavorite: false, tags: ['cleanup'], addedAt: 1, updatedAt: 1 },
      { imageId: 'img-2', isFavorite: false, tags: ['cleanup'], addedAt: 1, updatedAt: 1 },
    ], ['cleanup']);

    await useImageStore.getState().clearTag('cleanup');

    expect(useImageStore.getState().annotations.get('img-1')?.tags).toEqual([]);
    expect(useImageStore.getState().annotations.get('img-2')?.tags).toEqual([]);
    expect(useImageStore.getState().availableTags).toEqual([
      { name: 'cleanup', count: 0 },
    ]);
  });

  it('deletes only empty tags and leaves used tags intact', async () => {
    await seedStore([
      { imageId: 'img-1', isFavorite: false, tags: ['used-tag'], addedAt: 1, updatedAt: 1 },
    ], ['used-tag', 'empty-tag']);

    await useImageStore.getState().deleteTag('used-tag');
    expect(useImageStore.getState().availableTags).toEqual([
      { name: 'empty-tag', count: 0 },
      { name: 'used-tag', count: 1 },
    ]);

    await useImageStore.getState().deleteTag('empty-tag');
    expect(useImageStore.getState().availableTags).toEqual([
      { name: 'used-tag', count: 1 },
    ]);
  });

  it('purges a tag by clearing assignments and deleting it from the catalog', async () => {
    await seedStore([
      { imageId: 'img-1', isFavorite: false, tags: ['purge-me'], addedAt: 1, updatedAt: 1 },
      { imageId: 'img-2', isFavorite: false, tags: ['purge-me'], addedAt: 1, updatedAt: 1 },
    ], ['purge-me']);

    await useImageStore.getState().purgeTag('purge-me');

    expect(useImageStore.getState().annotations.get('img-1')?.tags).toEqual([]);
    expect(useImageStore.getState().annotations.get('img-2')?.tags).toEqual([]);
    expect(useImageStore.getState().availableTags).toEqual([]);
  });
});
