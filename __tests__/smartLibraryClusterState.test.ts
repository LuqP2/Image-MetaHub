import { describe, expect, it } from 'vitest';
import type { ImageCluster, IndexedImage } from '../types';
import {
  buildClusteringMetadata,
  buildClusterSourceSignature,
  isClusterCacheCompatible,
  limitClustersForAccess,
} from '../utils/smartLibraryClusterState';

const makeImage = (index: number, prompt = `prompt ${index}`): IndexedImage => ({
  id: `img-${index}`,
  name: `image-${index}.png`,
  path: `/library/image-${index}.png`,
  directoryId: 'dir',
  directoryName: 'Library',
  lastModified: index,
  prompt,
  models: [],
  loras: [],
  hash: `hash-${index}`,
  handle: {} as FileSystemFileHandle,
  thumbnailStatus: 'pending',
}) as IndexedImage;

const makeCluster = (id: string, imageIds: string[]): ImageCluster => ({
  id,
  promptHash: id,
  basePrompt: id,
  imageIds,
  coverImageId: imageIds[0],
  size: imageIds.length,
  similarityThreshold: 0.98,
  createdAt: 1,
  updatedAt: 1,
});

describe('smart library cluster state', () => {
  it('changes the cache source signature when prompt-bearing images change', () => {
    const images = [makeImage(1), makeImage(2)];
    const baseline = buildClusterSourceSignature(images);

    expect(buildClusterSourceSignature([...images, makeImage(3)])).not.toBe(baseline);
    expect(buildClusterSourceSignature([makeImage(1, 'changed'), makeImage(2)])).not.toBe(baseline);
    expect(buildClusterSourceSignature([makeImage(2), makeImage(1)])).not.toBe(baseline);
  });

  it('trims restored clusters to the free preview range', () => {
    const images = Array.from({ length: 510 }, (_, index) => makeImage(index));
    const clusters = [
      makeCluster('inside', ['img-0', 'img-1', 'img-2']),
      makeCluster('mixed', ['img-498', 'img-500', 'img-501']),
      makeCluster('outside', ['img-500', 'img-501', 'img-502']),
    ];

    const limited = limitClustersForAccess(clusters, images, false);

    expect(limited.map((cluster) => cluster.id)).toEqual(['inside', 'mixed']);
    expect(limited.find((cluster) => cluster.id === 'mixed')?.imageIds).toEqual(['img-498']);
    expect(limited.find((cluster) => cluster.id === 'mixed')?.size).toBe(1);
  });

  it('builds free-tier lock metadata for preview images only', () => {
    const metadata = buildClusteringMetadata(
      Array.from({ length: 510 }, (_, index) => makeImage(index)),
      false
    );

    expect(metadata.processedCount).toBe(300);
    expect(metadata.remainingCount).toBe(10);
    expect(metadata.isLimited).toBe(true);
    expect(metadata.lockedImageIds.has('img-299')).toBe(false);
    expect(metadata.lockedImageIds.has('img-300')).toBe(true);
    expect(metadata.lockedImageIds.has('img-499')).toBe(true);
    expect(metadata.lockedImageIds.has('img-500')).toBe(false);
  });

  it('rejects limited caches when full clustering is available', () => {
    expect(isClusterCacheCompatible({
      canUseFullClustering: true,
      processedImageCount: 500,
      sourceImageCount: 600,
    })).toBe(false);

    expect(isClusterCacheCompatible({
      canUseFullClustering: true,
      processedImageCount: 600,
      sourceImageCount: 600,
    })).toBe(true);

    expect(isClusterCacheCompatible({
      canUseFullClustering: false,
      processedImageCount: 500,
      sourceImageCount: 600,
    })).toBe(true);
  });
});
