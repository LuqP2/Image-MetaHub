import { type IndexedImage } from '../types';
import { extractEmbeddedComfyWorkflow } from './comfyUIWorkflowBuilder';
import { reparseIndexedImage } from './fileIndexer';

const getDirectoryPathForImage = (image: IndexedImage, directoryPath?: string): string => (
  directoryPath || image.directoryId || image.id.split('::')[0] || ''
);

export const hasCompactedRuntimeMetadata = (image: IndexedImage): boolean => (
  Boolean((image.metadata as Record<string, unknown> | undefined)?._rawMetadataCompacted)
);

export async function hydrateImageForEmbeddedComfyWorkflow(
  image: IndexedImage,
  directoryPath?: string
): Promise<IndexedImage> {
  const embedded = extractEmbeddedComfyWorkflow(image);
  if (embedded.prompt || !hasCompactedRuntimeMetadata(image)) {
    return image;
  }

  const resolvedDirectoryPath = getDirectoryPathForImage(image, directoryPath);
  if (!resolvedDirectoryPath) {
    return image;
  }

  try {
    return await reparseIndexedImage(image, resolvedDirectoryPath, { compactRawMetadata: false }) || image;
  } catch (error) {
    console.warn('[ComfyUI] Failed to reload full embedded workflow metadata:', error);
    return image;
  }
}
