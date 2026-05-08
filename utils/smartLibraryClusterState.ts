import type { ImageCluster, IndexedImage } from '../types';
import { CLUSTERING_FREE_TIER_LIMIT, CLUSTERING_PREVIEW_LIMIT } from '../hooks/useFeatureAccess';

export interface SmartLibraryClusteringMetadata {
  processedCount: number;
  remainingCount: number;
  isLimited: boolean;
  lockedImageIds: Set<string>;
}

export interface ClusterCacheCompatibilityInput {
  canUseFullClustering: boolean;
  processedImageCount?: number;
  sourceImageCount?: number;
}

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

const updateHash = (hash: number, value: string): number => {
  let nextHash = hash;
  for (let index = 0; index < value.length; index += 1) {
    nextHash ^= value.charCodeAt(index);
    nextHash = Math.imul(nextHash, FNV_PRIME);
  }
  return nextHash;
};

const toHashString = (hash: number): string => (hash >>> 0).toString(16).padStart(8, '0');

export const getPromptImagesForClustering = (images: IndexedImage[]): IndexedImage[] =>
  images.filter((image) => image.prompt && image.prompt.trim().length > 0);

export const getClusterProcessingLimit = (canUseFullClustering: boolean): number =>
  canUseFullClustering ? Infinity : CLUSTERING_PREVIEW_LIMIT;

export const buildClusterSourceSignature = (images: IndexedImage[]): string => {
  const promptImages = getPromptImagesForClustering(images);
  let hash = updateHash(FNV_OFFSET, `${promptImages.length}`);

  for (const image of promptImages) {
    hash = updateHash(hash, '\u0000');
    hash = updateHash(hash, image.id);
    hash = updateHash(hash, '\u0001');
    hash = updateHash(hash, String(image.lastModified ?? 0));
    hash = updateHash(hash, '\u0001');
    hash = updateHash(hash, image.prompt?.trim() ?? '');
  }

  return `${promptImages.length}:${toHashString(hash)}`;
};

export const buildClusteringMetadata = (
  images: IndexedImage[],
  canUseFullClustering: boolean,
): SmartLibraryClusteringMetadata => {
  const promptImages = getPromptImagesForClustering(images);
  const processingLimit = getClusterProcessingLimit(canUseFullClustering);
  const limitedImages = promptImages.slice(0, processingLimit);
  const lockedImageIds = new Set<string>();

  if (!canUseFullClustering && promptImages.length > CLUSTERING_FREE_TIER_LIMIT) {
    promptImages
      .slice(CLUSTERING_FREE_TIER_LIMIT, processingLimit)
      .forEach((image) => lockedImageIds.add(image.id));
  }

  return {
    processedCount: Math.min(limitedImages.length, CLUSTERING_FREE_TIER_LIMIT),
    remainingCount: Math.max(0, promptImages.length - processingLimit),
    isLimited: promptImages.length > processingLimit,
    lockedImageIds,
  };
};

export const limitClustersForAccess = (
  clusters: ImageCluster[],
  images: IndexedImage[],
  canUseFullClustering: boolean,
): ImageCluster[] => {
  const promptImages = getPromptImagesForClustering(images);
  const processingLimit = getClusterProcessingLimit(canUseFullClustering);
  const allowedImageIds = new Set(
    promptImages.slice(0, processingLimit).map((image) => image.id)
  );

  return clusters.flatMap((cluster) => {
    const imageIds = cluster.imageIds.filter((imageId) => allowedImageIds.has(imageId));
    if (imageIds.length === 0) {
      return [];
    }

    return [{
      ...cluster,
      imageIds,
      coverImageId: imageIds.includes(cluster.coverImageId) ? cluster.coverImageId : imageIds[0],
      size: imageIds.length,
    }];
  });
};

export const isClusterCacheCompatible = ({
  canUseFullClustering,
  processedImageCount,
  sourceImageCount,
}: ClusterCacheCompatibilityInput): boolean => {
  if (typeof processedImageCount !== 'number' || typeof sourceImageCount !== 'number') {
    return false;
  }

  return !canUseFullClustering || processedImageCount >= sourceImageCount;
};

export const buildClusterStateSignature = (
  clusters: ImageCluster[],
  metadata: SmartLibraryClusteringMetadata,
): string => {
  let hash = updateHash(FNV_OFFSET, `${clusters.length}`);

  for (const cluster of clusters) {
    hash = updateHash(hash, '\u0000');
    hash = updateHash(hash, cluster.id);
    hash = updateHash(hash, '\u0001');
    hash = updateHash(hash, cluster.imageIds.join(','));
    hash = updateHash(hash, '\u0001');
    hash = updateHash(hash, cluster.coverImageId);
  }

  hash = updateHash(hash, '\u0002');
  hash = updateHash(hash, String(metadata.processedCount));
  hash = updateHash(hash, '\u0001');
  hash = updateHash(hash, String(metadata.remainingCount));
  hash = updateHash(hash, '\u0001');
  hash = updateHash(hash, metadata.isLimited ? 'limited' : 'unlimited');
  hash = updateHash(hash, '\u0001');
  hash = updateHash(hash, Array.from(metadata.lockedImageIds).join(','));

  return toHashString(hash);
};
