import React, { useMemo, useEffect, useState } from 'react';
import { Layers, Sparkles } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageSelection } from '../hooks/useImageSelection';
import { useA1111ProgressContext } from '../contexts/A1111ProgressContext';
import { useGenerationQueueStore } from '../store/useGenerationQueueStore';
import { ImageCluster, IndexedImage } from '../types';
import StackCard from './StackCard';
import StackExpandedView from './StackExpandedView';
import ClusterUpgradeBanner from './ClusterUpgradeBanner';
import Footer from './Footer';

const DEFAULT_SIMILARITY_THRESHOLD = 0.88;

interface ClusterEntry {
  cluster: ImageCluster;
  images: IndexedImage[];
}

interface SmartLibraryProps {
  isQueueOpen?: boolean;
  onToggleQueue?: () => void;
  onBatchExport: () => void;
}

const SmartLibrary: React.FC<SmartLibraryProps> = ({ isQueueOpen = false, onToggleQueue, onBatchExport }) => {
  const filteredImages = useImageStore((state) => state.filteredImages);
  const clusters = useImageStore((state) => state.clusters);
  const directories = useImageStore((state) => state.directories);
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const isClustering = useImageStore((state) => state.isClustering);
  const clusteringProgress = useImageStore((state) => state.clusteringProgress);
  const clusteringMetadata = useImageStore((state) => state.clusteringMetadata);
  const isAutoTagging = useImageStore((state) => state.isAutoTagging);
  const autoTaggingProgress = useImageStore((state) => state.autoTaggingProgress);
  const startClustering = useImageStore((state) => state.startClustering);
  const startAutoTagging = useImageStore((state) => state.startAutoTagging);
  const setClusterNavigationContext = useImageStore((state) => state.setClusterNavigationContext);
  const selectedImages = useImageStore((state) => state.selectedImages);
  const selectionTotalImages = useImageStore((state) => state.selectionTotalImages);
  const selectionDirectoryCount = useImageStore((state) => state.selectionDirectoryCount);
  const enrichmentProgress = useImageStore((state) => state.enrichmentProgress);

  const { itemsPerPage, setItemsPerPage, viewMode, toggleViewMode } = useSettingsStore();
  const { handleDeleteSelectedImages, clearSelection } = useImageSelection();
  const { progressState: a1111Progress } = useA1111ProgressContext();
  const queueCount = useGenerationQueueStore((state) =>
    state.items.filter((item) => item.status === 'waiting' || item.status === 'processing').length
  );

  const safeFilteredImages = Array.isArray(filteredImages) ? filteredImages : [];
  const safeSelectedImages = selectedImages instanceof Set ? selectedImages : new Set<string>();

  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);
  const [stackPage, setStackPage] = useState(1);
  const [clusterPage, setClusterPage] = useState(1);
  const [sortBy, setSortBy] = useState<'count' | 'similarity'>('count');

  const imageMap = useMemo(() => {
    return new Map(safeFilteredImages.map((image) => [image.id, image]));
  }, [safeFilteredImages]);

  const clusterEntries = useMemo(() => {
    return clusters
      .map((cluster) => ({
        cluster,
        images: cluster.imageIds
          .map((id) => imageMap.get(id))
          .filter((image): image is IndexedImage => Boolean(image)),
      }))
      .filter((entry) => entry.images.length >= 3); // Minimum 3 images per cluster
  }, [clusters, imageMap]);

  const sortedEntries = useMemo(() => {
    // Separate locked and unlocked clusters
    const lockedImageIds = clusteringMetadata?.lockedImageIds || new Set();
    const unlocked: ClusterEntry[] = [];
    const locked: ClusterEntry[] = [];

    clusterEntries.forEach((entry) => {
      // Count how many images in this cluster are locked
      const lockedCount = entry.images.filter((img) => lockedImageIds.has(img.id)).length;
      const lockedPercentage = entry.images.length > 0 ? lockedCount / entry.images.length : 0;

      // If more than 50% of images are locked, mark cluster as locked
      if (lockedPercentage > 0.5) {
        locked.push(entry);
      } else {
        unlocked.push(entry);
      }
    });

    // Sort function based on selected sort mode
    const sortFunction = (a: ClusterEntry, b: ClusterEntry) => {
      if (sortBy === 'similarity') {
        // Sort by similarity (higher similarity first)
        return b.cluster.similarityThreshold - a.cluster.similarityThreshold;
      } else {
        // Sort by count (more images first)
        const imageCountDelta = b.images.length - a.images.length;
        if (imageCountDelta !== 0) {
          return imageCountDelta;
        }
        return b.cluster.size - a.cluster.size;
      }
    };

    unlocked.sort(sortFunction);
    locked.sort(sortFunction);

    // Limit locked preview to only 5 clusters (for teaser effect)
    const lockedPreview = locked.slice(0, 5);

    // Return unlocked first, then limited locked preview
    return [...unlocked, ...lockedPreview];
  }, [clusterEntries, clusteringMetadata, sortBy]);

  const stackTotalPages = Math.ceil(sortedEntries.length / itemsPerPage);
  const paginatedEntries = useMemo(() => {
    const start = (stackPage - 1) * itemsPerPage;
    return sortedEntries.slice(start, start + itemsPerPage);
  }, [sortedEntries, stackPage, itemsPerPage]);

  useEffect(() => {
    if (stackPage > stackTotalPages && stackTotalPages > 0) {
      setStackPage(1);
    }
  }, [stackPage, stackTotalPages]);

  useEffect(() => {
    if (expandedClusterId && !clusterEntries.some((entry) => entry.cluster.id === expandedClusterId)) {
      setExpandedClusterId(null);
    }
  }, [expandedClusterId, clusterEntries]);

  const activeCluster = expandedClusterId
    ? clusterEntries.find((entry) => entry.cluster.id === expandedClusterId) ?? null
    : null;

  const activeClusterImages = useMemo(() => {
    if (!activeCluster) {
      return [];
    }
    return [...activeCluster.images].sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0));
  }, [activeCluster]);

  const clusterTotalPages = Math.ceil(activeClusterImages.length / itemsPerPage);
  const paginatedClusterImages = useMemo(() => {
    const start = (clusterPage - 1) * itemsPerPage;
    return activeClusterImages.slice(start, start + itemsPerPage);
  }, [activeClusterImages, clusterPage, itemsPerPage]);

  useEffect(() => {
    if (clusterPage > clusterTotalPages && clusterTotalPages > 0) {
      setClusterPage(1);
    }
  }, [clusterPage, clusterTotalPages]);

  useEffect(() => {
    if (expandedClusterId) {
      setClusterPage(1);
    }
  }, [expandedClusterId]);

  const primaryPath = directories[0]?.path ?? '';
  const hasDirectories = directories.length > 0;

  const handleGenerateClusters = () => {
    if (!primaryPath) return;
    startClustering(primaryPath, scanSubfolders, DEFAULT_SIMILARITY_THRESHOLD);
  };

  const handleGenerateAutoTags = () => {
    if (!primaryPath) return;
    startAutoTagging(primaryPath, scanSubfolders);
  };

  const currentPage = activeCluster ? clusterPage : stackPage;
  const totalPages = activeCluster ? clusterTotalPages : stackTotalPages;
  const handlePageChange = (page: number) => {
    if (activeCluster) {
      setClusterPage(page);
    } else {
      setStackPage(page);
    }
  };

  return (
    <section className="flex flex-col h-full min-h-0">
      {(clusteringProgress || autoTaggingProgress) && (
        <div className="grid gap-2 mb-3 mt-2">
          {clusteringProgress && (
            <div className="px-3 py-2 rounded-md bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200">
              <div className="flex items-center justify-between mb-1">
                <span>{clusteringProgress.message}</span>
                <span>
                  {clusteringProgress.current}/{clusteringProgress.total}
                </span>
              </div>
              <div className="h-1.5 w-full bg-blue-900/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-400 transition-all duration-300"
                  style={{
                    width:
                      clusteringProgress.total > 0
                        ? `${(clusteringProgress.current / clusteringProgress.total) * 100}%`
                        : '0%',
                  }}
                />
              </div>
            </div>
          )}
          {autoTaggingProgress && (
            <div className="px-3 py-2 rounded-md bg-purple-500/10 border border-purple-500/20 text-xs text-purple-200">
              <div className="flex items-center justify-between mb-1">
                <span>{autoTaggingProgress.message}</span>
                <span>
                  {autoTaggingProgress.current}/{autoTaggingProgress.total}
                </span>
              </div>
              <div className="h-1.5 w-full bg-purple-900/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-400 transition-all duration-300"
                  style={{
                    width:
                      autoTaggingProgress.total > 0
                        ? `${(autoTaggingProgress.current / autoTaggingProgress.total) * 100}%`
                        : '0%',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0">
        {activeCluster ? (
          <StackExpandedView
            cluster={activeCluster.cluster}
            images={paginatedClusterImages}
            allImages={activeClusterImages}
            onBack={() => {
              setClusterNavigationContext(null);
              setExpandedClusterId(null);
            }}
            viewMode={viewMode}
            currentPage={clusterPage}
            totalPages={clusterTotalPages}
            onPageChange={setClusterPage}
            onBatchExport={onBatchExport}
          />
        ) : paginatedEntries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-400">
            <div className="w-14 h-14 rounded-full bg-gray-800/60 flex items-center justify-center mb-3">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-gray-200">No clusters yet</h3>
            <p className="text-xs max-w-md mt-2">
              Generate clusters to group similar prompts into visual stacks. This is fully virtual and does not move files.
            </p>
          </div>
        ) : (
          <div className="min-h-0 overflow-auto pr-1">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {paginatedEntries.map((entry) => {
                // Check if majority of images in this cluster are locked
                const lockedImageIds = clusteringMetadata?.lockedImageIds || new Set();
                const lockedCount = entry.images.filter((img) => lockedImageIds.has(img.id)).length;
                const lockedPercentage = entry.images.length > 0 ? lockedCount / entry.images.length : 0;
                const isLocked = lockedPercentage > 0.5;

                return (
                  <StackCard
                    key={entry.cluster.id}
                    cluster={entry.cluster}
                    images={entry.images}
                    onOpen={() => setExpandedClusterId(entry.cluster.id)}
                    isLocked={isLocked}
                  />
                );
              })}
            </div>

            {/* Upgrade banner */}
            {clusteringMetadata && clusteringMetadata.isLimited && (
              <ClusterUpgradeBanner
                processedCount={clusteringMetadata.processedCount}
                remainingCount={clusteringMetadata.remainingCount}
                clusterCount={sortedEntries.length}
              />
            )}
          </div>
        )}
      </div>

      <Footer
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        itemsPerPage={itemsPerPage}
        onItemsPerPageChange={setItemsPerPage}
        viewMode={viewMode}
        onViewModeChange={toggleViewMode}
        filteredCount={safeFilteredImages.length}
        totalCount={selectionTotalImages}
        directoryCount={selectionDirectoryCount}
        enrichmentProgress={enrichmentProgress}
        a1111Progress={a1111Progress}
        queueCount={queueCount}
        isQueueOpen={isQueueOpen}
        onToggleQueue={onToggleQueue}
      />
    </section>
  );
};

export default SmartLibrary;
