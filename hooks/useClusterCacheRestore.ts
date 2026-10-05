import { useEffect, useMemo, useRef, useState } from 'react';
import { useImageStore } from '../store/useImageStore';
import { useFeatureAccess } from './useFeatureAccess';
import { loadClusterCache, type ClusterCacheEntry } from '../services/clusterCacheManager';
import type { IndexedImage } from '../types';
import {
  buildClusterSourceSignatures,
  buildLegacyClusterSourceSignature,
  buildClusterStateSignature,
  buildClusteringMetadata,
  getPromptImagesForClustering,
  getClusterProcessingLimit,
  isClusterCacheCompatible,
  canRestoreClusterCacheSource,
} from '../utils/smartLibraryClusterState';

const EMPTY_IMAGES: IndexedImage[] = [];

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
  const enrichmentProgress = useImageStore((state) => state.enrichmentProgress);
  const primaryDirectoryProgress = useImageStore((state) =>
    state.directoryProgress[state.directories[0]?.id ?? ''] ?? null);
  const isClustering = useImageStore((state) => state.isClustering);
  const indexingState = useImageStore((state) => state.indexingState);
  const setClusters = useImageStore((state) => state.setClusters);
  const { canUseFullClustering, initialized: isLicenseInitialized } = useFeatureAccess();

  const clusterMetadataSignatureRef = useRef<string | null>(null);
  const hasObservedLibraryLoadRef = useRef(false);
  const [cacheProbe, setCacheProbe] = useState<{ key: string; cache: ClusterCacheEntry | null } | null>(null);

  const primaryPath = directories[0]?.path ?? '';
  const directoryCacheKey = `${primaryPath}::${scanSubfolders ? 'recursive' : 'flat'}`;
  // promptImages/clusterSourceSignature only feed the cache-restore effect
  // below, which is a no-op once clusters already exist. buildClusterSourceSignature
  // hashes every prompt character-by-character, so recomputing it on every
  // images change (e.g. one auto-watch add at a time) after clustering has
  // already run once is pure waste — skip it once clusters.length > 0.
  const hasClusters = clusters.length > 0;
  const promptImages = useMemo(
    () => (hasClusters ? EMPTY_IMAGES : getPromptImagesForClustering(images)),
    [images, hasClusters],
  );
  const clusterSourceSignatures = useMemo(
    () => (hasClusters ? { full: '', limited: '' } : buildClusterSourceSignatures(images, getClusterProcessingLimit(canUseFullClustering))),
    [images, hasClusters, canUseFullClustering],
  );
  const clusterSourceSignature = clusterSourceSignatures.limited;
  const currentClusteringMetadata = useMemo(
    () => buildClusteringMetadata(images, canUseFullClustering),
    [canUseFullClustering, images],
  );

  // Probe the cache as soon as the directory is known, independently of image
  // hydration. Explore can then distinguish a saved cache from an empty library.
  useEffect(() => {
    hasObservedLibraryLoadRef.current = false;
    if (!primaryPath) {
      setCacheProbe(null);
      useImageStore.setState({ clusterCacheLookup: null });
      return;
    }
    let cancelled = false;
    useImageStore.setState({ clusterCacheLookup: null });
    loadClusterCache(primaryPath, scanSubfolders)
      .then((cache) => {
        if (cancelled) return;
        setCacheProbe({ key: directoryCacheKey, cache });
        useImageStore.setState({
          clusterCacheLookup: { directoryPath: primaryPath, scanSubfolders, hasCache: Boolean(cache?.clusters?.length) },
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Failed to check cluster cache:', error);
        setCacheProbe({ key: directoryCacheKey, cache: null });
        useImageStore.setState({
          clusterCacheLookup: { directoryPath: primaryPath, scanSubfolders, hasCache: false },
        });
      });
    return () => { cancelled = true; };
  }, [directoryCacheKey, primaryPath, scanSubfolders]);

  useEffect(() => {
    if (isLoading || indexingState === 'indexing') {
      hasObservedLibraryLoadRef.current = true;
    }
  }, [indexingState, isLoading, directoryCacheKey]);

  useEffect(() => {
    const cache = cacheProbe?.key === directoryCacheKey ? cacheProbe.cache : null;
    if (!cache?.clusters?.length || clusters.length > 0 || !isLicenseInitialized ||
        isLoading || isClustering || indexingState === 'paused') {
      return;
    }

    if (promptImages.length === 0) {
      if (hasObservedLibraryLoadRef.current && !primaryDirectoryProgress && !enrichmentProgress) {
        useImageStore.setState({
          clusterCacheLookup: { directoryPath: primaryPath, scanSubfolders, hasCache: false },
        });
      }
      return;
    }
    if (indexingState === 'indexing') return;

    const currentImages = useImageStore.getState().images;
    // A full-run cache remains a valid superset when Pro/trial access expires.
    const acceptedSignatures = canUseFullClustering
      ? [clusterSourceSignature]
      : [clusterSourceSignature, clusterSourceSignatures.full];
    if (cache.clusterCacheVersion == null) {
      acceptedSignatures.push(buildLegacyClusterSourceSignature(currentImages));
    }
    const isCompatible = isClusterCacheCompatible({
      canUseFullClustering,
      processedImageCount: cache.processedImageCount,
      sourceImageCount: cache.sourceImageCount,
    }) && canRestoreClusterCacheSource(cache, currentImages, acceptedSignatures,
      getClusterProcessingLimit(canUseFullClustering));

    if (!isCompatible) {
      // Phase B may still be enriching prompts after isLoading becomes false.
      // Recheck when its image batches arrive, without rereading the cache.
      if (!enrichmentProgress) {
        useImageStore.setState({
          clusterCacheLookup: { directoryPath: primaryPath, scanSubfolders, hasCache: false },
        });
      }
      return;
    }

    const metadata = buildClusteringMetadata(currentImages, canUseFullClustering);
    clusterMetadataSignatureRef.current = buildClusterStateSignature(cache.clusters, metadata);
    setClusters(cache.clusters, metadata);
  }, [cacheProbe, canUseFullClustering, clusterSourceSignature, clusterSourceSignatures.full,
    clusters.length, directoryCacheKey, enrichmentProgress, indexingState, isClustering,
    isLicenseInitialized, isLoading, primaryDirectoryProgress, primaryPath, promptImages.length,
    scanSubfolders, setClusters]);

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
