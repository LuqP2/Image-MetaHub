import { GenerationQueueItem } from '../store/useGenerationQueueStore';

export const getDisplayCurrentImage = (item: GenerationQueueItem): number | null => {
  if (!item.totalImages || item.totalImages <= 1) {
    return null;
  }

  if (item.currentImage && item.currentImage > 1) {
    return Math.min(item.currentImage, item.totalImages);
  }

  if (item.progress >= 1) {
    return item.totalImages;
  }

  return Math.min(
    item.totalImages,
    Math.max(1, Math.floor(item.progress * item.totalImages) + 1)
  );
};
