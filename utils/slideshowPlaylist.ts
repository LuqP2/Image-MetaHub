import type { IndexedImage } from '../types';
import { resolveMediaType } from './mediaTypes.js';

export type SlideshowPlaylistSource = 'selection' | 'scope';

export interface BuildSlideshowPlaylistArgs {
  scopeImages: IndexedImage[];
  selectedImageIds: Set<string>;
  allImages: IndexedImage[];
}

export interface SlideshowPlaylist {
  images: IndexedImage[];
  source: SlideshowPlaylistSource;
}

export const isSlideshowMedia = (image: IndexedImage): boolean => {
  const mediaType = resolveMediaType(image.name, image.fileType);
  return mediaType === 'image' || mediaType === 'video';
};

export const buildSlideshowPlaylist = ({
  scopeImages,
  selectedImageIds,
  allImages,
}: BuildSlideshowPlaylistArgs): SlideshowPlaylist => {
  if (selectedImageIds.size === 0) {
    return {
      images: scopeImages.filter(isSlideshowMedia),
      source: 'scope',
    };
  }

  const selectedInScope = scopeImages.filter(
    (image) => selectedImageIds.has(image.id) && isSlideshowMedia(image)
  );
  const usedIds = new Set(selectedInScope.map((image) => image.id));
  const allImageLookup = new Map(allImages.map((image) => [image.id, image]));
  const selectedOutOfScope: IndexedImage[] = [];

  for (const imageId of selectedImageIds) {
    if (usedIds.has(imageId)) {
      continue;
    }

    const image = allImageLookup.get(imageId);
    if (image && isSlideshowMedia(image)) {
      selectedOutOfScope.push(image);
      usedIds.add(image.id);
    }
  }

  return {
    images: [...selectedInScope, ...selectedOutOfScope],
    source: 'selection',
  };
};
