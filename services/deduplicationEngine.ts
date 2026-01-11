/**
 * Deduplication Engine
 *
 * Analyzes image clusters to suggest duplicates and recommend
 * which images to keep vs archive. Uses heuristics based on:
 * - User favorites (always keep)
 * - File size (larger = better quality)
 * - Creation time (earlier = original)
 */

import type { ImageCluster, IndexedImage, ClusterPreference } from '../types';

/**
 * Result of duplicate detection for a cluster
 */
export interface DeduplicationSuggestion {
  clusterId: string;
  bestImages: IndexedImage[];      // Recommended to keep (top 20%)
  duplicates: IndexedImage[];      // Suggested for archive/deletion
  userMarkedBest: IndexedImage[];  // User explicitly marked as best
  userArchived: IndexedImage[];    // User explicitly marked for archive
}

/**
 * Options for deduplication algorithm
 */
export interface DeduplicationOptions {
  keepPercentage?: number;         // What % to keep (default: 0.2 = 20%)
  minKeepCount?: number;           // Minimum images to keep (default: 1)
  maxKeepCount?: number;           // Maximum images to keep (default: 10)
  respectUserChoices?: boolean;    // Honor user's manual selections (default: true)
}

const DEFAULT_OPTIONS: Required<DeduplicationOptions> = {
  keepPercentage: 0.2,
  minKeepCount: 1,
  maxKeepCount: 10,
  respectUserChoices: true,
};

/**
 * Scoring function for image quality/importance
 * Higher score = more likely to keep
 */
function scoreImage(image: IndexedImage): number {
  let score = 0;

  // User favorites get highest priority
  if (image.isFavorite) {
    score += 10000;
  }

  // File size (larger typically means better quality)
  // Normalize to 0-100 range (assuming max ~50MB)
  if (image.fileSize) {
    score += Math.min((image.fileSize / (50 * 1024 * 1024)) * 100, 100);
  }

  // Earlier creation time gets slight preference (original vs variations)
  // Normalize to 0-50 range (more recent gets lower score)
  if (image.lastModified) {
    const ageInDays = (Date.now() - image.lastModified) / (1000 * 60 * 60 * 24);
    score += Math.min(ageInDays / 365, 1) * 50; // Older = higher score (up to 50 points)
  }

  return score;
}

/**
 * Sort images by quality/importance (descending)
 */
function sortImagesByQuality(images: IndexedImage[]): IndexedImage[] {
  return [...images].sort((a, b) => {
    const scoreA = scoreImage(a);
    const scoreB = scoreImage(b);
    return scoreB - scoreA; // Descending order
  });
}

/**
 * Analyze a cluster and suggest which images to keep vs archive
 *
 * @param cluster - The image cluster to analyze
 * @param images - All images in the cluster (must match cluster.imageIds)
 * @param existingPreference - Optional existing user preferences for this cluster
 * @param options - Deduplication options
 * @returns Suggestion with best images and duplicates
 */
export function suggestDuplicates(
  cluster: ImageCluster,
  images: IndexedImage[],
  existingPreference?: ClusterPreference | null,
  options: DeduplicationOptions = {}
): DeduplicationSuggestion {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Validate input
  if (images.length === 0) {
    return {
      clusterId: cluster.id,
      bestImages: [],
      duplicates: [],
      userMarkedBest: [],
      userArchived: [],
    };
  }

  // Extract user choices if they exist
  const userMarkedBest: IndexedImage[] = [];
  const userArchived: IndexedImage[] = [];

  if (opts.respectUserChoices && existingPreference) {
    const bestSet = new Set(existingPreference.bestImageIds);
    const archivedSet = new Set(existingPreference.archivedImageIds);

    images.forEach((img) => {
      if (bestSet.has(img.id)) {
        userMarkedBest.push(img);
      } else if (archivedSet.has(img.id)) {
        userArchived.push(img);
      }
    });
  }

  // Filter out user-marked images from algorithm processing
  const userMarkedIds = new Set([
    ...userMarkedBest.map(img => img.id),
    ...userArchived.map(img => img.id),
  ]);

  const remainingImages = images.filter(img => !userMarkedIds.has(img.id));

  // Sort remaining images by quality
  const sortedImages = sortImagesByQuality(remainingImages);

  // Calculate how many to keep (excluding user-marked best)
  const targetKeepCount = Math.max(
    opts.minKeepCount,
    Math.min(
      Math.ceil(sortedImages.length * opts.keepPercentage),
      opts.maxKeepCount
    )
  );

  // Split into best and duplicates
  const algorithmBest = sortedImages.slice(0, targetKeepCount);
  const algorithmDuplicates = sortedImages.slice(targetKeepCount);

  // Combine user-marked best with algorithm suggestions
  const allBestImages = [...userMarkedBest, ...algorithmBest];
  const allDuplicates = [...userArchived, ...algorithmDuplicates];

  return {
    clusterId: cluster.id,
    bestImages: allBestImages,
    duplicates: allDuplicates,
    userMarkedBest,
    userArchived,
  };
}

/**
 * Batch process multiple clusters for deduplication
 *
 * @param clusters - Array of clusters to process
 * @param imagesMap - Map of image IDs to IndexedImage objects
 * @param preferencesMap - Map of cluster IDs to ClusterPreference objects
 * @param options - Deduplication options
 * @returns Array of suggestions for each cluster
 */
export function batchSuggestDuplicates(
  clusters: ImageCluster[],
  imagesMap: Map<string, IndexedImage>,
  preferencesMap?: Map<string, ClusterPreference>,
  options: DeduplicationOptions = {}
): DeduplicationSuggestion[] {
  const suggestions: DeduplicationSuggestion[] = [];

  for (const cluster of clusters) {
    // Get images for this cluster
    const clusterImages = cluster.imageIds
      .map(id => imagesMap.get(id))
      .filter((img): img is IndexedImage => img !== undefined);

    // Skip if no images found
    if (clusterImages.length === 0) {
      continue;
    }

    // Get existing preference if available
    const preference = preferencesMap?.get(cluster.id);

    // Generate suggestion
    const suggestion = suggestDuplicates(cluster, clusterImages, preference, options);
    suggestions.push(suggestion);
  }

  return suggestions;
}

/**
 * Calculate statistics about deduplication suggestions
 *
 * @param suggestion - A deduplication suggestion
 * @returns Statistics object
 */
export interface DeduplicationStats {
  totalImages: number;
  bestCount: number;
  duplicateCount: number;
  userMarkedBestCount: number;
  userArchivedCount: number;
  potentialSpaceSaved: number; // In bytes
}

export function calculateDeduplicationStats(
  suggestion: DeduplicationSuggestion
): DeduplicationStats {
  const totalImages =
    suggestion.bestImages.length + suggestion.duplicates.length;

  const potentialSpaceSaved = suggestion.duplicates.reduce(
    (sum, img) => sum + (img.fileSize || 0),
    0
  );

  return {
    totalImages,
    bestCount: suggestion.bestImages.length,
    duplicateCount: suggestion.duplicates.length,
    userMarkedBestCount: suggestion.userMarkedBest.length,
    userArchivedCount: suggestion.userArchived.length,
    potentialSpaceSaved,
  };
}

/**
 * Format bytes to human-readable string
 *
 * @param bytes - Size in bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
