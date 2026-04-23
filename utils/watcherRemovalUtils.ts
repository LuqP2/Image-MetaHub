import type { Directory, IndexedImage } from '../types';

export interface WatchedFilesRemovedPayload {
  files?: Array<{ name: string; path?: string; relativePath?: string }>;
  folders?: Array<{ path?: string; relativePath?: string }>;
}

const normalizeFolderPath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');

const normalizeRelativeImageName = (value: string) => normalizeFolderPath(value).replace(/^\/+/, '');

const getRelativeImagePath = (image: Pick<IndexedImage, 'id' | 'name'>): string => {
  const [, relativePath = ''] = image.id.split('::');
  return relativePath || image.name;
};

export const resolveWatchedRemovalIdsForDirectory = (
  directory: Directory,
  payload: WatchedFilesRemovedPayload,
  images: IndexedImage[],
) => {
  const removedNames = new Set<string>();
  for (const file of payload.files ?? []) {
    removedNames.add(normalizeRelativeImageName(file.relativePath || file.name));
  }

  const removedFolders = (payload.folders ?? [])
    .map((folder) => {
      const relativePath = Object.prototype.hasOwnProperty.call(folder, 'relativePath')
        ? folder.relativePath ?? ''
        : (folder.path ? folder.path.replace(/\\/g, '/').slice(normalizeFolderPath(directory.path).length + 1) : null);
      if (relativePath === null) {
        return null;
      }
      return normalizeRelativeImageName(relativePath);
    })
    .filter((folder): folder is string => folder !== null);

  const removedIds = images
    .filter((image) => {
      if (image.directoryId !== directory.id) {
        return false;
      }

      const imageRelativePath = normalizeRelativeImageName(getRelativeImagePath(image));
      return removedFolders.includes('') ||
        removedNames.has(imageRelativePath) ||
        removedFolders.some((folder) => imageRelativePath === folder || imageRelativePath.startsWith(`${folder}/`));
    })
    .map((image) => image.id);

  return {
    removedIds,
    removedNames: [
      ...removedNames,
      ...removedFolders,
    ],
  };
};
