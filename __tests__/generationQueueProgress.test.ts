import { describe, expect, it } from 'vitest';
import { GenerationQueueItem } from '../store/useGenerationQueueStore';
import { getDisplayCurrentImage } from '../utils/generationQueueProgress';

const createItem = (progress: number): GenerationQueueItem => ({
  id: 'job',
  provider: 'a1111',
  imageId: 'image',
  imageName: 'image.png',
  status: 'processing',
  progress,
  totalImages: 4,
  createdAt: 1,
  updatedAt: 1,
});

describe('getDisplayCurrentImage', () => {
  it.each([
    [0, 1],
    [0.26, 2],
    [0.51, 3],
    [0.76, 4],
    [1, 4],
  ])('maps progress %s to image %s/4', (progress, expectedImage) => {
    expect(getDisplayCurrentImage(createItem(progress))).toBe(expectedImage);
  });
});
