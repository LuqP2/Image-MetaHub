import type { IndexedImage } from '../types';
import cacheManager from './cacheManager';
import { transferImagePersistence } from './imageAnnotationsStorage';
import { FileOperations } from './fileOperations';
import { useImageStore } from '../store/useImageStore';

export interface RenameImageResult {
  success: boolean;
  error?: string;
  newImageId?: string;
  newRelativePath?: string;
  image?: IndexedImage;
}

const splitRelativePath = (relativePath: string) => {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const fileName = segments.pop() || normalized;
  return {
    folderPath: segments.join('/'),
    fileName,
  };
};

const extensionOf = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(dotIndex) : '';
};

export const getRenameBasename = (image: IndexedImage) => {
  const { fileName } = splitRelativePath(image.name);
  const extension = extensionOf(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
};

export const buildRenamedRelativePath = (image: IndexedImage, nextName: string) => {
  const { folderPath, fileName } = splitRelativePath(image.name);
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
  const oldRelativePath = image.name;
  const newRelativePath = buildRenamedRelativePath(image, normalizedName);
  if (newRelativePath === oldRelativePath) {
    return { success: true, newImageId: oldImageId, newRelativePath, image };
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
    await cacheManager.removeCachedImages(
      directory.path,
      directory.name,
      [oldImageId],
      [oldRelativePath],
      useImageStore.getState().scanSubfolders,
    );
    await cacheManager.appendToCache(
      directory.path,
      directory.name,
      [renamedImage],
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
