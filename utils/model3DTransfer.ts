import type { IndexedImage } from '../types';
import { getFileExtension } from './mediaTypes.js';

const EXTERNAL_RESOURCE_MODEL_EXTENSIONS = new Set(['.gltf', '.obj']);

export const getUnsupportedModel3DTransferError = (
  images: Array<Pick<IndexedImage, 'name'>>,
): string | null => {
  const hasExternalResourceModel = images.some((image) =>
    EXTERNAL_RESOURCE_MODEL_EXTENSIONS.has(getFileExtension(image.name))
  );
  if (!hasExternalResourceModel) return null;

  return 'GLTF and OBJ transfers are not available because these models can depend on sibling buffers, materials, and textures. Move or copy the containing folder in your system file manager to preserve all required files.';
};
