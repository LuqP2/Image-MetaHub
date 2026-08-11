import type { IndexedImage } from '../types';
import { isExternalResourceModel3DFileName } from './mediaTypes.js';

const hasExternalResourceModel = (images: Array<Pick<IndexedImage, 'name'>>): boolean =>
  images.some((image) => isExternalResourceModel3DFileName(image.name));

export const getUnsupportedModel3DTransferError = (
  images: Array<Pick<IndexedImage, 'name'>>,
): string | null => {
  if (!hasExternalResourceModel(images)) return null;

  return 'GLTF and OBJ transfers are not available because these models can depend on sibling buffers, materials, and textures. Move or copy the containing folder in your system file manager to preserve all required files.';
};

export const getUnsupportedModel3DBatchExportError = (
  images: Array<Pick<IndexedImage, 'name'>>,
): string | null => {
  if (!hasExternalResourceModel(images)) return null;

  return 'GLTF and OBJ batch export is not available because these models can depend on sibling buffers, materials, and textures. Export or copy the containing folder in your system file manager to preserve all required files.';
};
