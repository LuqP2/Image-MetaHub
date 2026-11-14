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

// The workspace needs the saved UI graph, including node placement, when it exists.
export async function getOriginalComfyUIWorkflowJson(
  image: IndexedImage,
  directoryPath?: string,
): Promise<string> {
  let { workflow, prompt } = extractEmbeddedComfyWorkflow(image);
  if (!Array.isArray(workflow?.nodes) && hasCompactedRuntimeMetadata(image)) {
    const hydrated = await hydrateImageRawMetadata(image, directoryPath);
    const embedded = extractEmbeddedComfyWorkflow(hydrated);
    workflow = embedded.workflow;
    prompt = embedded.prompt ?? prompt;
  }
  if (Array.isArray(workflow?.nodes)) return JSON.stringify(workflow);
  if (prompt) return JSON.stringify({ prompt });
  throw new Error('This image has no original ComfyUI workflow.');
}
