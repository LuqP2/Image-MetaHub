import type { IndexedImage } from '../types';

export const getRelativeImagePath = (image: Pick<IndexedImage, 'id' | 'name'>): string => {
  const [, relativePath = ''] = image.id.split('::');
  return relativePath || image.name;
};

export const splitRelativePath = (relativePath: string) => {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const fileName = segments.pop() || normalized;
  return {
    folderPath: segments.join('/'),
    fileName,
  };
};
