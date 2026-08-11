import type { IndexedImage, ThumbnailCacheCandidate } from '../types';

export const THUMBNAIL_CACHE_VERSION = 2;
export const THUMBNAIL_ALGORITHM_VERSION = `v${THUMBNAIL_CACHE_VERSION}`;

export const getLegacyThumbnailId = (image: Pick<IndexedImage, 'id' | 'lastModified'>): string =>
  `${image.id}-${image.lastModified}`;

export const getVersionedThumbnailId = (image: Pick<IndexedImage, 'id' | 'lastModified'>): string =>
  `${THUMBNAIL_ALGORITHM_VERSION}:${getLegacyThumbnailId(image)}`;

export type Model3DThumbnailVariant = 'grid' | 'table';

export const getModel3DThumbnailId = (
  image: Pick<IndexedImage, 'id' | 'lastModified'>,
  variant: Model3DThumbnailVariant
): string => `${getVersionedThumbnailId(image)}:model3d:${variant}`;

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
