import { type IndexedImage } from '../types';
import { extractEmbeddedComfyWorkflow } from './comfyUIWorkflowBuilder';
import { hasCompactedRuntimeMetadata, hydrateImageRawMetadata } from './rawMetadataHydration';

export { hasCompactedRuntimeMetadata };

export async function hydrateImageForEmbeddedComfyWorkflow(
  image: IndexedImage,
  directoryPath?: string
): Promise<IndexedImage> {
  const embedded = extractEmbeddedComfyWorkflow(image);
  if (embedded.prompt || !hasCompactedRuntimeMetadata(image)) {
    return image;
  }

  return hydrateImageRawMetadata(image, directoryPath);
}
