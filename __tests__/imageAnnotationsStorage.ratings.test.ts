import { beforeEach, describe, expect, it } from 'vitest';
import {
  bulkSaveAnnotations,
  clearAllAnnotations,
  loadAllAnnotations,
  saveAnnotation,
} from '../services/imageAnnotationsStorage';

describe('imageAnnotationsStorage rating persistence', () => {
  beforeEach(async () => {
    await clearAllAnnotations();
  });

  it('loads legacy annotations without rating', async () => {
    await saveAnnotation({
      imageId: 'legacy-image',
      isFavorite: false,
      tags: ['portrait'],
      addedAt: 1,
      updatedAt: 1,
    });

    const annotations = await loadAllAnnotations();
    expect(annotations.get('legacy-image')).toEqual({
      imageId: 'legacy-image',
      isFavorite: false,
      tags: ['portrait'],
      addedAt: 1,
      updatedAt: 1,
    });
  });

  it('saves and reloads a single image rating', async () => {
    await saveAnnotation({
      imageId: 'rated-image',
      isFavorite: true,
      tags: ['keeper'],
      rating: 4,
      addedAt: 2,
      updatedAt: 3,
    });

    const annotations = await loadAllAnnotations();
    expect(annotations.get('rated-image')?.rating).toBe(4);
    expect(annotations.get('rated-image')?.isFavorite).toBe(true);
    expect(annotations.get('rated-image')?.tags).toEqual(['keeper']);
  });

  it('bulk saves ratings without breaking favorites or tags', async () => {
    await bulkSaveAnnotations([
      {
        imageId: 'img-1',
        isFavorite: true,
        tags: ['portrait'],
        rating: 5,
        addedAt: 1,
        updatedAt: 1,
      },
      {
        imageId: 'img-2',
        isFavorite: false,
        tags: ['landscape'],
        rating: 2,
        addedAt: 1,
        updatedAt: 1,
      },
    ]);

    const annotations = await loadAllAnnotations();
    expect(annotations.get('img-1')).toMatchObject({ isFavorite: true, tags: ['portrait'], rating: 5 });
    expect(annotations.get('img-2')).toMatchObject({ isFavorite: false, tags: ['landscape'], rating: 2 });
  });
});
