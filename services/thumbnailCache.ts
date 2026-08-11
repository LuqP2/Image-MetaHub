import type { IndexedImage, ThumbnailCacheCandidate } from '../types';
import { isExternalResourceModel3DFileName } from '../utils/mediaTypes.js';

export const THUMBNAIL_CACHE_VERSION = 2;
export const THUMBNAIL_ALGORITHM_VERSION = `v${THUMBNAIL_CACHE_VERSION}`;

export const getLegacyThumbnailId = (image: Pick<IndexedImage, 'id' | 'lastModified'>): string =>
  `${image.id}-${image.lastModified}`;

export const getVersionedThumbnailId = (image: Pick<IndexedImage, 'id' | 'lastModified'>): string =>
  `${THUMBNAIL_ALGORITHM_VERSION}:${getLegacyThumbnailId(image)}`;

export type Model3DThumbnailVariant = 'grid' | 'table';

export const isModel3DThumbnailCacheSafe = (fileName: string): boolean =>
  !isExternalResourceModel3DFileName(fileName);

export const getModel3DThumbnailId = (
  image: Pick<IndexedImage, 'id' | 'lastModified' | 'contentModifiedMs' | 'fileSize'>,
  variant: Model3DThumbnailVariant
): string => {
  const contentModifiedMs = image.contentModifiedMs ?? image.lastModified;
  const fileSize = image.fileSize ?? 'unknown';
  return `${getVersionedThumbnailId(image)}:model3d:${variant}:${contentModifiedMs}:${fileSize}`;
};

export const getThumbnailCacheCandidate = (
  image: Pick<IndexedImage, 'id' | 'name' | 'lastModified' | 'contentModifiedMs' | 'fileSize'>
): ThumbnailCacheCandidate => ({
  requestId: image.id,
  imageId: image.id,
  originalRelativePath: image.name,
  lastModified: image.lastModified,
  contentModifiedMs: image.contentModifiedMs,
  fileSize: image.fileSize,
  thumbnailId: getVersionedThumbnailId(image),
  legacyThumbnailId: getLegacyThumbnailId(image),
  algorithmVersion: THUMBNAIL_ALGORITHM_VERSION,
});
