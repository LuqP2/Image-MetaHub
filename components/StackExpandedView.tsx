import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ImageCluster, IndexedImage, ClusterPreference } from '../types';
import { useImageStore } from '../store/useImageStore';
import ImageGrid from './ImageGrid';
import ImageTable from './ImageTable';
import DeduplicationHelper from './DeduplicationHelper';
import { getClusterPreference } from '../services/imageAnnotationsStorage';

interface StackExpandedViewProps {
  cluster: ImageCluster;
  images: IndexedImage[];
  allImages: IndexedImage[];
  viewMode: 'grid' | 'list';
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onBack: () => void;
  onBatchExport: () => void;
}

const StackExpandedView: React.FC<StackExpandedViewProps> = ({
  cluster,
  images,
  allImages,
  viewMode,
  currentPage,
  totalPages,
  onPageChange,
  onBack,
  onBatchExport,
}) => {
  const selectedImage = useImageStore((state) => state.selectedImage);
  const selectedImages = useImageStore((state) => state.selectedImages);
  const setSelectedImage = useImageStore((state) => state.setSelectedImage);
  const toggleImageSelection = useImageStore((state) => state.toggleImageSelection);
  const clearImageSelection = useImageStore((state) => state.clearImageSelection);
  const setFocusedImageIndex = useImageStore((state) => state.setFocusedImageIndex);
  const setClusterNavigationContext = useImageStore((state) => state.setClusterNavigationContext);

  const [clusterPreference, setClusterPreference] = useState<ClusterPreference | null>(null);
  const [preferenceLoading, setPreferenceLoading] = useState(true);

  const safeSelectedImages = selectedImages instanceof Set ? selectedImages : new Set<string>();

  // Load cluster preference on mount
  useEffect(() => {
    let isMounted = true;

    const loadPreference = async () => {
      setPreferenceLoading(true);
      try {
        const preference = await getClusterPreference(cluster.id);
        if (isMounted) {
          setClusterPreference(preference);
        }
      } catch (error) {
        console.error('Failed to load cluster preference:', error);
      } finally {
        if (isMounted) {
          setPreferenceLoading(false);
        }
      }
    };

    loadPreference();

    return () => {
      isMounted = false;
    };
  }, [cluster.id]);

  // Callback to refresh preference after updates
  const handlePreferenceUpdated = useCallback(async () => {
    try {
      const updated = await getClusterPreference(cluster.id);
      setClusterPreference(updated);
    } catch (error) {
      console.error('Failed to refresh cluster preference:', error);
    }
  }, [cluster.id]);

  const promptLabel = useMemo(() => {
    return cluster.basePrompt || allImages[0]?.prompt || 'Untitled stack';
  }, [cluster.basePrompt, allImages]);

  // Create Sets for deduplication markers
  const markedBestIds = useMemo(() => {
    if (!clusterPreference || !clusterPreference.bestImageIds) {
      return undefined;
    }
    return new Set(clusterPreference.bestImageIds);
  }, [clusterPreference]);

  const markedArchivedIds = useMemo(() => {
    if (!clusterPreference || !clusterPreference.archivedImageIds) {
      return undefined;
    }
    return new Set(clusterPreference.archivedImageIds);
  }, [clusterPreference]);

  const handleImageClick = useCallback(
    (image: IndexedImage, event: React.MouseEvent) => {
      const clickedIndex = allImages.findIndex((img) => img.id === image.id);
      if (clickedIndex !== -1) {
        setFocusedImageIndex(clickedIndex);
      }

      if (event.shiftKey && selectedImage) {
        const lastSelectedIndex = allImages.findIndex((img) => img.id === selectedImage.id);
        if (lastSelectedIndex !== -1 && clickedIndex !== -1) {
          const start = Math.min(lastSelectedIndex, clickedIndex);
          const end = Math.max(lastSelectedIndex, clickedIndex);
          const rangeIds = allImages.slice(start, end + 1).map((img) => img.id);
          const newSelection = new Set(safeSelectedImages);
          rangeIds.forEach((id) => newSelection.add(id));
          useImageStore.setState({ selectedImages: newSelection });
          return;
        }
      }

      if (event.ctrlKey || event.metaKey) {
        toggleImageSelection(image.id);
        return;
      }

      clearImageSelection();
      setClusterNavigationContext(allImages);
      setSelectedImage(image);
    },
    [
      allImages,
      clearImageSelection,
      safeSelectedImages,
      selectedImage,
      setFocusedImageIndex,
      setSelectedImage,
      toggleImageSelection,
      setClusterNavigationContext,
    ]
  );

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-semibold text-gray-300 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to stacks
        </button>
        <div className="text-xs text-gray-400">
          {allImages.length} images | similarity {Math.round(cluster.similarityThreshold * 100)}%
        </div>
      </div>
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-100 mb-1">Cluster prompt</h3>
        <p className="text-xs text-gray-300 leading-relaxed">{promptLabel}</p>
      </div>
      {!preferenceLoading && (
        <div className="flex-shrink-0">
          <DeduplicationHelper
            cluster={cluster}
            images={allImages}
            existingPreference={clusterPreference}
            onPreferenceUpdated={handlePreferenceUpdated}
          />
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        {viewMode === 'grid' ? (
          <ImageGrid
            images={images}
            onImageClick={handleImageClick}
            selectedImages={safeSelectedImages}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={onPageChange}
            onBatchExport={onBatchExport}
            markedBestIds={markedBestIds}
            markedArchivedIds={markedArchivedIds}
          />
        ) : (
          <ImageTable
            images={images}
            onImageClick={handleImageClick}
            selectedImages={safeSelectedImages}
            onBatchExport={onBatchExport}
          />
        )}
      </div>
    </div>
  );
};

export default StackExpandedView;
