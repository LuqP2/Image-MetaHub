import type { IndexedImage } from '../types';

export const getRelativeImagePath = (image: Pick<IndexedImage, 'id' | 'name' | 'directoryId'>): string => {
  const id = image.id;
  if (!id) return image.name ?? '';

  // If we have directoryId, we can more reliably strip it as a prefix.
  // This handles cases where the directory path itself might contain '::'.
  const directoryId = image.directoryId;
  if (directoryId) {
    const prefix = `${directoryId}::`;
    if (id.startsWith(prefix)) {
      return id.slice(prefix.length) || image.name || '';
    }
  }

  const sepIndex = id.lastIndexOf('::');
  if (sepIndex === -1) return image.name || id || '';

  const relativePath = id.slice(sepIndex + 2);
  return relativePath || image.name || '';
};

export const splitRelativePath = (relativePath: string) => {
  if (!relativePath) {
    return { folderPath: '', fileName: '' };
  }

  const normalized = relativePath.indexOf('\\') !== -1
    ? relativePath.replace(/\\/g, '/')
    : relativePath;

  const lastSlashIndex = normalized.lastIndexOf('/');

  if (lastSlashIndex === -1) {
    return {
      folderPath: '',
      fileName: normalized,
    };
  }

  return {
    folderPath: normalized.slice(0, lastSlashIndex),
    fileName: normalized.slice(lastSlashIndex + 1),
  };
};
