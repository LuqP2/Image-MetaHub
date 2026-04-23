import type { IndexedImage } from '../types';
import cacheManager from './cacheManager';
import { transferImagePersistence } from './imageAnnotationsStorage';
import { FileOperations } from './fileOperations';
import { useImageStore } from '../store/useImageStore';
import { getRelativeImagePath, splitRelativePath } from '../utils/imagePaths';

export interface RenameImageResult {
  success: boolean;
  error?: string;
  newImageId?: string;
  newRelativePath?: string;
  image?: IndexedImage;
}

const extensionOf = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(dotIndex) : '';
};

export const getRenameBasename = (image: IndexedImage) => {
  const { fileName } = splitRelativePath(getRelativeImagePath(image));
  const extension = extensionOf(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
};

export const buildRenamedRelativePath = (image: IndexedImage, nextName: string) => {
  const { folderPath, fileName } = splitRelativePath(getRelativeImagePath(image));
  const extension = extensionOf(fileName);
  const trimmedName = nextName.trim();
  const nextFileName = extension && !trimmedName.toLowerCase().endsWith(extension.toLowerCase())
    ? `${trimmedName}${extension}`
    : trimmedName;

  return folderPath ? `${folderPath}/${nextFileName}` : nextFileName;
};

export async function renameIndexedImage(
  image: IndexedImage,
  nextName: string,
): Promise<RenameImageResult> {
  const normalizedName = nextName.trim();
  const validation = FileOperations.validateFilename(normalizedName);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const oldImageId = image.id;
  const oldRelativePath = getRelativeImagePath(image);
  const newRelativePath = buildRenamedRelativePath(image, normalizedName);
  if (newRelativePath === oldRelativePath) {
    return { success: true, newImageId: oldImageId, newRelativePath, image };
  }

  if (image.directoryId) {
    const newImageId = `${image.directoryId}::${newRelativePath}`;
    const targetAlreadyIndexed = useImageStore
      .getState()
      .images
      .some((entry) => entry.id === newImageId && entry.id !== oldImageId);

    if (targetAlreadyIndexed) {
      return { success: false, error: 'An image with that filename already exists in this folder.' };
    }
  }

  const { fileName: newFileName } = splitRelativePath(newRelativePath);
  const renameResult = await FileOperations.renameFile(image, newFileName);
  if (!renameResult.success) {
    return { success: false, error: renameResult.error || 'Failed to rename image.' };
  }

  const renamedImage = useImageStore.getState().renameImageRecord(oldImageId, newRelativePath);
  if (!renamedImage) {
    return { success: false, error: 'Renamed file, but failed to update the library record.' };
  }

  await transferImagePersistence(oldImageId, renamedImage.id, 'move');

  const directory = useImageStore.getState().directories.find((entry) => entry.id === renamedImage.directoryId);
  if (directory) {
    await cacheManager.replaceCachedImages(
      directory.path,
      directory.name,
      [renamedImage],
      [oldImageId],
      [oldRelativePath],
      useImageStore.getState().scanSubfolders,
    );
  }

  return {
    success: true,
    newImageId: renamedImage.id,
    newRelativePath,
    image: renamedImage,
  };
}
