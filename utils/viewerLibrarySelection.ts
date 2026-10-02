import type { IndexedImage } from '../types';

/** Keep the preview and keyboard anchor together without touching bulk selection. */
export function viewerLibrarySelection(image: IndexedImage, displayedImages: IndexedImage[]) {
  return {
    selectedImage: image,
    previewImage: image,
    focusedImageIndex: displayedImages.findIndex((candidate) => candidate.id === image.id),
  };
}
