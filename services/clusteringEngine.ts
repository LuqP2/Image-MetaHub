/**
 * Clustering Engine
 *
 * Groups images by prompt similarity using hybrid algorithm:
 * - Phase 1: Exact matching (O(n) - fast path)
 * - Phase 2: Token bucketing (reduces comparisons by ~90%)
 * - Phase 3: Similarity clustering (Jaccard + Levenshtein)
 * - Phase 4: Cluster refinement
 *
 * Performance target: 35k images in < 30 seconds
 */

import { IndexedImage, ImageCluster } from '../types';
import {
  normalizePrompt,
  generatePromptHash,
  hybridSimilarity,
  shareKeywords,
  extractKeywords,
} from '../utils/similarityMetrics';

/**
 * Clustering options
 */
export interface ClusteringOptions {
  threshold: number; // Similarity threshold (0.85-0.90 recommended)
  minClusterSize?: number; // Minimum images per cluster (default: 1)
  maxClusterSize?: number; // Maximum images per cluster (default: unlimited)
}

/**
 * Lightweight image data for clustering (reduces memory usage)
 */
export interface LightweightImage {
  id: string;
  prompt: string;
  lastModified: number;
}

/**
 * Internal cluster representation during building
 */
interface ClusterBuilder {
  promptHash: string;
  basePrompt: string;
  imageIds: string[];
  imageTimestamps: Map<string, number>; // For sorting
}

/**
 * Main clustering function
 * Groups images by prompt similarity
 */
export async function generateClusters(
  images: IndexedImage[],
  options: ClusteringOptions
): Promise<ImageCluster[]> {
  const { threshold, minClusterSize = 1, maxClusterSize = Infinity } = options;

  // Convert to lightweight representation
  const lightweightImages = images
    .filter((img) => img.prompt && img.prompt.trim().length > 0)
    .map((img) => ({
      id: img.id,
      prompt: img.prompt!,
      lastModified: img.lastModified,
    }));

  console.log(`Clustering ${lightweightImages.length} images with threshold ${threshold}`);

  // Phase 1: Exact matching (fast path)
  const exactClusters = performExactMatching(lightweightImages);
  console.log(`Phase 1 complete: ${exactClusters.size} exact match groups`);

  // Phase 2: Token bucketing
  const buckets = performTokenBucketing(lightweightImages, exactClusters);
  console.log(`Phase 2 complete: ${buckets.length} token buckets`);

  // Phase 3: Similarity clustering within buckets
  const similarityClusters = performSimilarityClustering(
    lightweightImages,
    buckets,
    exactClusters,
    threshold
  );
  console.log(`Phase 3 complete: ${similarityClusters.length} similarity clusters`);

  // Phase 4: Cluster refinement
  const refinedClusters = refineClusters(similarityClusters, maxClusterSize);
  console.log(`Phase 4 complete: ${refinedClusters.length} refined clusters`);

  // Convert to final format
  const finalClusters = refinedClusters
    .filter((cluster) => cluster.imageIds.length >= minClusterSize)
    .map((cluster) => convertToFinalCluster(cluster, threshold));

  console.log(`Final: ${finalClusters.length} clusters created`);

  return finalClusters;
}

/**
 * Phase 1: Exact Matching
 * Groups images with identical normalized prompts
 * Complexity: O(n)
 */
function performExactMatching(
  images: LightweightImage[]
): Map<string, ClusterBuilder> {
  const clusters = new Map<string, ClusterBuilder>();

  for (const image of images) {
    const normalized = normalizePrompt(image.prompt);
    const hash = generatePromptHash(image.prompt);

    if (!clusters.has(hash)) {
      clusters.set(hash, {
        promptHash: hash,
        basePrompt: normalized,
        imageIds: [],
        imageTimestamps: new Map(),
      });
    }

    const cluster = clusters.get(hash)!;
    cluster.imageIds.push(image.id);
    cluster.imageTimestamps.set(image.id, image.lastModified);
  }

  return clusters;
}

/**
 * Phase 2: Token Bucketing
 * Groups clusters by shared keywords to reduce comparison space
 * Only clusters with 2+ shared keywords are compared in Phase 3
 */
function performTokenBucketing(
  images: LightweightImage[],
  exactClusters: Map<string, ClusterBuilder>
): string[][] {
  // Create keyword index: keyword -> cluster hashes
  const keywordIndex = new Map<string, Set<string>>();

  for (const [hash, cluster] of exactClusters.entries()) {
    const keywords = extractKeywords(cluster.basePrompt, 10);

    for (const keyword of keywords) {
      if (!keywordIndex.has(keyword)) {
        keywordIndex.set(keyword, new Set());
      }
      keywordIndex.get(keyword)!.add(hash);
    }
  }

  // Create buckets: groups of cluster hashes that share keywords
  const buckets: string[][] = [];
  const processed = new Set<string>();

  for (const [hash, cluster] of exactClusters.entries()) {
    if (processed.has(hash)) continue;

    const bucket = new Set<string>([hash]);
    processed.add(hash);

    const keywords = extractKeywords(cluster.basePrompt, 10);

    // Find all clusters sharing at least 2 keywords
    for (const keyword of keywords) {
      const relatedHashes = keywordIndex.get(keyword);
      if (!relatedHashes) continue;

      for (const relatedHash of relatedHashes) {
        if (relatedHash === hash || processed.has(relatedHash)) continue;

        const relatedCluster = exactClusters.get(relatedHash)!;
        if (shareKeywords(cluster.basePrompt, relatedCluster.basePrompt, 2)) {
          bucket.add(relatedHash);
        }
      }
    }

    buckets.push([...bucket]);
  }

  return buckets;
}

/**
 * Phase 3: Similarity Clustering
 * Compares prompts within each bucket using hybrid similarity
 * Merges clusters above threshold
 */
function performSimilarityClustering(
  images: LightweightImage[],
  buckets: string[][],
  exactClusters: Map<string, ClusterBuilder>,
  threshold: number
): ClusterBuilder[] {
  const mergedClusters = new Map<string, ClusterBuilder>();
  const mergeMap = new Map<string, string>(); // old hash -> new hash

  for (const bucket of buckets) {
    if (bucket.length === 1) {
      // Singleton bucket - no merging needed
      const hash = bucket[0];
      const cluster = exactClusters.get(hash)!;
      mergedClusters.set(hash, cluster);
      continue;
    }

    // Compare all pairs within bucket
    const bucketClusters = bucket.map((hash) => exactClusters.get(hash)!);
    const merged = mergeSimilarClusters(bucketClusters, threshold);

    // Add to merged clusters
    for (const cluster of merged) {
      const newHash = generatePromptHash(cluster.basePrompt);
      mergedClusters.set(newHash, cluster);

      // Track merge mapping
      for (const oldHash of bucket) {
        mergeMap.set(oldHash, newHash);
      }
    }
  }

  return [...mergedClusters.values()];
}

/**
 * Merge similar clusters within a bucket
 * Uses union-find approach for transitive merging
 */
function mergeSimilarClusters(
  clusters: ClusterBuilder[],
  threshold: number
): ClusterBuilder[] {
  if (clusters.length === 0) return [];
  if (clusters.length === 1) return clusters;

  // Union-Find data structure
  const parent = new Map<number, number>();
  for (let i = 0; i < clusters.length; i++) {
    parent.set(i, i);
  }

  function find(i: number): number {
    if (parent.get(i) !== i) {
      parent.set(i, find(parent.get(i)!));
    }
    return parent.get(i)!;
  }

  function union(i: number, j: number) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent.set(rootI, rootJ);
    }
  }

  // Compare all pairs
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const similarity = hybridSimilarity(
        clusters[i].basePrompt,
        clusters[j].basePrompt
      );

      if (similarity >= threshold) {
        union(i, j);
      }
    }
  }

  // Group by root
  const groups = new Map<number, number[]>();
  for (let i = 0; i < clusters.length; i++) {
    const root = find(i);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)!.push(i);
  }

  // Merge clusters in each group
  const merged: ClusterBuilder[] = [];
  for (const [root, indices] of groups.entries()) {
    const mergedCluster: ClusterBuilder = {
      promptHash: clusters[root].promptHash,
      basePrompt: clusters[root].basePrompt,
      imageIds: [],
      imageTimestamps: new Map(),
    };

    for (const idx of indices) {
      const cluster = clusters[idx];
      mergedCluster.imageIds.push(...cluster.imageIds);
      for (const [id, timestamp] of cluster.imageTimestamps.entries()) {
        mergedCluster.imageTimestamps.set(id, timestamp);
      }
    }

    merged.push(mergedCluster);
  }

  return merged;
}

/**
 * Phase 4: Cluster Refinement
 * - Splits large clusters if needed
 * - Sorts images within clusters by timestamp
 */
function refineClusters(
  clusters: ClusterBuilder[],
  maxClusterSize: number
): ClusterBuilder[] {
  const refined: ClusterBuilder[] = [];

  for (const cluster of clusters) {
    if (cluster.imageIds.length <= maxClusterSize) {
      // Sort by timestamp (earliest first for cover image)
      cluster.imageIds.sort((a, b) => {
        const timeA = cluster.imageTimestamps.get(a) || 0;
        const timeB = cluster.imageTimestamps.get(b) || 0;
        return timeA - timeB;
      });

      refined.push(cluster);
    } else {
      // Split large cluster
      // TODO: Implement smart splitting based on sub-similarity
      // For now, just keep as-is with warning
      console.warn(
        `Cluster with ${cluster.imageIds.length} images exceeds max size ${maxClusterSize}`
      );

      cluster.imageIds.sort((a, b) => {
        const timeA = cluster.imageTimestamps.get(a) || 0;
        const timeB = cluster.imageTimestamps.get(b) || 0;
        return timeA - timeB;
      });

      refined.push(cluster);
    }
  }

  return refined;
}

/**
 * Convert internal cluster to final format
 */
function convertToFinalCluster(
  builder: ClusterBuilder,
  threshold: number
): ImageCluster {
  const now = Date.now();

  return {
    id: builder.promptHash,
    promptHash: builder.promptHash,
    basePrompt: builder.basePrompt,
    imageIds: builder.imageIds,
    coverImageId: builder.imageIds[0], // First image chronologically
    size: builder.imageIds.length,
    similarityThreshold: threshold,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Add a single image to existing clusters (incremental update)
 * Returns cluster ID and whether it's a new cluster
 */
export async function addImageToClusters(
  image: IndexedImage,
  existingClusters: ImageCluster[],
  threshold: number = 0.87
): Promise<{ clusterId: string; isNewCluster: boolean }> {
  if (!image.prompt || image.prompt.trim().length === 0) {
    // No prompt - create singleton cluster
    const clusterId = `no-prompt-${image.id}`;
    return { clusterId, isNewCluster: true };
  }

  const normalized = normalizePrompt(image.prompt);
  const hash = generatePromptHash(image.prompt);

  // Try exact match first
  const exactMatch = existingClusters.find((c) => c.promptHash === hash);
  if (exactMatch) {
    return { clusterId: exactMatch.id, isNewCluster: false };
  }

  // Try similarity match
  for (const cluster of existingClusters) {
    const similarity = hybridSimilarity(normalized, cluster.basePrompt);
    if (similarity >= threshold) {
      return { clusterId: cluster.id, isNewCluster: false };
    }
  }

  // No match - create new cluster
  return { clusterId: hash, isNewCluster: true };
}

/**
 * Calculate cluster position for an image
 * 0 = cover image, 1+ = other positions
 */
export function calculateClusterPosition(
  imageId: string,
  cluster: ImageCluster
): number {
  return cluster.imageIds.indexOf(imageId);
}

/**
 * Remove deleted images from clusters
 * Called when file watcher detects deletions
 * Returns updated clusters (empty clusters are removed)
 */
export function removeImagesFromClusters(
  deletedImageIds: string[],
  existingClusters: ImageCluster[]
): ImageCluster[] {
  const deletedSet = new Set(deletedImageIds);
  const updatedClusters: ImageCluster[] = [];

  for (const cluster of existingClusters) {
    // Filter out deleted images
    const remainingImageIds = cluster.imageIds.filter((id) => !deletedSet.has(id));

    // Skip empty clusters
    if (remainingImageIds.length === 0) {
      console.log(`Cluster ${cluster.id} is now empty and will be removed`);
      continue;
    }

    // Update cluster with remaining images
    const updatedCluster: ImageCluster = {
      ...cluster,
      imageIds: remainingImageIds,
      size: remainingImageIds.length,
      coverImageId: remainingImageIds[0], // Update cover if needed
      updatedAt: Date.now(),
    };

    // Only keep clusters with 1+ images (configurable threshold)
    if (updatedCluster.size >= 1) {
      updatedClusters.push(updatedCluster);
    }
  }

  console.log(
    `Removed ${deletedImageIds.length} images from clusters. ` +
      `${existingClusters.length - updatedClusters.length} clusters removed (empty)`
  );

  return updatedClusters;
}
