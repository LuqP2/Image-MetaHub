import { useEffect, useMemo, useRef } from 'react';
import { useImageStore } from '../store/useImageStore';
import { useFeatureAccess } from './useFeatureAccess';
import { loadClusterCache } from '../services/clusterCacheManager';
import {
  buildClusterSourceSignature,
  buildClusterStateSignature,
  buildClusteringMetadata,
  getPromptImagesForClustering,
  isClusterCacheCompatible,
} from '../utils/smartLibraryClusterState';

/**
 * Restores compatible cached clusters on launch and keeps their access-gated metadata in sync.
 * This used to live in SmartLibrary; it now runs app-wide (the Explore Clusters dimension only
 * reads the in-memory `clusters` array), so cached clusters survive restarts without regenerating.
 */
export function useClusterCacheRestore(): void {
  const images = useImageStore((state) => state.images);
  const clusters = useImageStore((state) => state.clusters);
  const directories = useImageStore((state) => state.directories);
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const isLoading = useImageStore((state) => state.isLoading);
  const isClustering = useImageStore((state) => state.isClustering);
  const indexingState = useImageStore((state) => state.indexingState);
  const setClusters = useImageStore((state) => state.setClusters);
  const { canUseFullClustering, initialized: isLicenseInitialized } = useFeatureAccess();

  const restoredClusterCacheKeyRef = useRef<string | null>(null);
  const clusterMetadataSignatureRef = useRef<string | null>(null);

  const primaryPath = directories[0]?.path ?? '';
  const promptImages = useMemo(() => getPromptImagesForClustering(images), [images]);
  const clusterSourceSignature = useMemo(() => buildClusterSourceSignature(images), [images]);
  const currentClusteringMetadata = useMemo(
    () => buildClusteringMetadata(images, canUseFullClustering),
    [canUseFullClustering, images],
  );

  useEffect(() => {
    if (
      !primaryPath ||
      !isLicenseInitialized ||
      isLoading ||
      clusters.length > 0 ||
      isClustering ||
      indexingState === 'indexing' ||
      indexingState === 'paused' ||
      promptImages.length === 0
    ) {
      return;
    }

    const cacheKey = [
      primaryPath,
      scanSubfolders ? 'recursive' : 'flat',
      clusterSourceSignature,
      canUseFullClustering ? 'full' : 'limited',
    ].join('::');
    if (restoredClusterCacheKeyRef.current === cacheKey) {
      return;
    }

    let cancelled = false;

    loadClusterCache(primaryPath, scanSubfolders, clusterSourceSignature)
      .then((cache) => {
        if (cancelled) {
          return;
        }

        restoredClusterCacheKeyRef.current = cacheKey;
        if (
          !cache?.clusters?.length ||
          !isClusterCacheCompatible({
            canUseFullClustering,
            processedImageCount: cache.processedImageCount,
            sourceImageCount: cache.sourceImageCount,
          })
        ) {
          return;
        }

        clusterMetadataSignatureRef.current = buildClusterStateSignature(cache.clusters, currentClusteringMetadata);
        setClusters(cache.clusters, currentClusteringMetadata);
      })
      .catch((error) => {
        console.warn('Failed to restore cluster cache:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [
    canUseFullClustering,
    clusterSourceSignature,
    clusters.length,
    currentClusteringMetadata,
    indexingState,
    isClustering,
    isLicenseInitialized,
    isLoading,
    primaryPath,
    promptImages.length,
    scanSubfolders,
    setClusters,
  ]);

  // Keep the access-gated metadata (locked-preview state) aligned with the current clusters.
  useEffect(() => {
    if (clusters.length === 0 || isClustering || !isLicenseInitialized) {
      return;
    }

    const signature = buildClusterStateSignature(clusters, currentClusteringMetadata);
    if (clusterMetadataSignatureRef.current === signature) {
      return;
    }

    clusterMetadataSignatureRef.current = signature;
    setClusters(clusters, currentClusteringMetadata);
  }, [clusters, currentClusteringMetadata, isClustering, isLicenseInitialized, setClusters]);
}
