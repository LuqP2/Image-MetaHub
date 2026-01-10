import React, { useMemo, useEffect, useState } from 'react';
import { Layers, Sparkles } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { ImageCluster, IndexedImage } from '../types';
import StackCard from './StackCard';
import StackExpandedView from './StackExpandedView';

const DEFAULT_SIMILARITY_THRESHOLD = 0.88;

interface ClusterEntry {
  cluster: ImageCluster;
  images: IndexedImage[];
}

const SmartLibrary: React.FC = () => {
  const images = useImageStore((state) => state.images);
  const clusters = useImageStore((state) => state.clusters);
  const directories = useImageStore((state) => state.directories);
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const isClustering = useImageStore((state) => state.isClustering);
  const clusteringProgress = useImageStore((state) => state.clusteringProgress);
  const isAutoTagging = useImageStore((state) => state.isAutoTagging);
  const autoTaggingProgress = useImageStore((state) => state.autoTaggingProgress);
  const startClustering = useImageStore((state) => state.startClustering);
  const startAutoTagging = useImageStore((state) => state.startAutoTagging);

  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);

  const imageMap = useMemo(() => {
    return new Map(images.map((image) => [image.id, image]));
  }, [images]);

  const clusterEntries = useMemo(() => {
    return clusters
      .map((cluster) => ({
        cluster,
        images: cluster.imageIds
          .map((id) => imageMap.get(id))
          .filter((image): image is IndexedImage => Boolean(image)),
      }))
      .filter((entry) => entry.images.length > 0);
  }, [clusters, imageMap]);

  const sortedEntries = useMemo(() => {
    return [...clusterEntries].sort((a, b) => b.cluster.size - a.cluster.size);
  }, [clusterEntries]);

  useEffect(() => {
    if (expandedClusterId && !clusterEntries.some((entry) => entry.cluster.id === expandedClusterId)) {
      setExpandedClusterId(null);
    }
  }, [expandedClusterId, clusterEntries]);

  const activeCluster = expandedClusterId
    ? clusterEntries.find((entry) => entry.cluster.id === expandedClusterId) ?? null
    : null;

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

  return (
    <section className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">Smart Library</h2>
          <p className="text-xs text-gray-400">
            Visual stacks grouped by prompt similarity. Scrub to preview variations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateClusters}
            disabled={!hasDirectories || isClustering}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-xs font-semibold border transition-colors ${
              isClustering
                ? 'bg-blue-500/20 text-blue-200 border-blue-500/40'
                : 'bg-gray-900/60 text-gray-200 border-gray-700 hover:bg-gray-800/80'
            }`}
          >
            <Layers className="w-4 h-4" />
            {isClustering ? 'Clustering...' : 'Generate Clusters'}
          </button>
          <button
            onClick={handleGenerateAutoTags}
            disabled={!hasDirectories || isAutoTagging}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-xs font-semibold border transition-colors ${
              isAutoTagging
                ? 'bg-purple-500/20 text-purple-200 border-purple-500/40'
                : 'bg-gray-900/60 text-gray-200 border-gray-700 hover:bg-gray-800/80'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            {isAutoTagging ? 'Tagging...' : 'Generate Auto-Tags'}
          </button>
        </div>
      </div>

      {(clusteringProgress || autoTaggingProgress) && (
        <div className="grid gap-2 mb-3">
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

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {activeCluster ? (
          <StackExpandedView
            cluster={activeCluster.cluster}
            images={activeCluster.images}
            onBack={() => setExpandedClusterId(null)}
          />
        ) : sortedEntries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-400">
            <div className="w-14 h-14 rounded-full bg-gray-800/60 flex items-center justify-center mb-3">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-gray-200">No clusters yet</h3>
            <p className="text-xs max-w-md mt-2">
              Generate clusters to group similar prompts into visual stacks. This is fully virtual and
              does not move files.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {sortedEntries.map((entry) => (
              <StackCard
                key={entry.cluster.id}
                cluster={entry.cluster}
                images={entry.images}
                onOpen={() => setExpandedClusterId(entry.cluster.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default SmartLibrary;
