import { type IndexedImage } from '../types';
import { reparseIndexedImage } from './fileIndexer';

const getDirectoryPathForImage = (image: IndexedImage, directoryPath?: string): string => (
  directoryPath || image.directoryId || image.id.split('::')[0] || ''
);

export const hasCompactedRuntimeMetadata = (image: IndexedImage): boolean => (
  Boolean((image.metadata as Record<string, unknown> | undefined)?._rawMetadataCompacted)
);

export async function hydrateImageRawMetadata(
  image: IndexedImage,
  directoryPath?: string
): Promise<IndexedImage> {
  if (!hasCompactedRuntimeMetadata(image)) {
    return image;
  }

  const resolvedDirectoryPath = getDirectoryPathForImage(image, directoryPath);
  if (!resolvedDirectoryPath) {
    return image;
  }

  try {
    return await reparseIndexedImage(image, resolvedDirectoryPath, { compactRawMetadata: false }) || image;
  } catch (error) {
    console.warn('[RawMetadataHydration] Failed to reload full raw metadata:', error);
    return image;
  }
}
