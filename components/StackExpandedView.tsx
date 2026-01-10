import React, { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ImageCluster, IndexedImage } from '../types';
import { useThumbnail } from '../hooks/useThumbnail';
import { useImageStore } from '../store/useImageStore';

interface StackExpandedViewProps {
  cluster: ImageCluster;
  images: IndexedImage[];
  onBack: () => void;
}

interface StackImageTileProps {
  image: IndexedImage;
  isSelected: boolean;
  onSelect: (image: IndexedImage, event: React.MouseEvent) => void;
}

const StackImageTile: React.FC<StackImageTileProps> = ({ image, isSelected, onSelect }) => {
  useThumbnail(image);
  const thumbnailUrl = image.thumbnailUrl;

  return (
    <button
      type="button"
      onClick={(event) => onSelect(image, event)}
      className={`relative overflow-hidden rounded-xl border transition-all ${
        isSelected
          ? 'border-blue-400 shadow-md shadow-blue-500/20'
          : 'border-gray-800 hover:border-gray-700'
      }`}
    >
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt={image.name} className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full bg-gray-800/70 flex items-center justify-center text-gray-500 text-xs">
          Loading...
        </div>
      )}
      {isSelected && (
        <div className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-blue-500 text-white shadow">
          Selected
        </div>
      )}
    </button>
  );
};

const StackExpandedView: React.FC<StackExpandedViewProps> = ({ cluster, images, onBack }) => {
  const selectedImages = useImageStore((state) => state.selectedImages);
  const setSelectedImage = useImageStore((state) => state.setSelectedImage);
  const toggleImageSelection = useImageStore((state) => state.toggleImageSelection);
  const clearImageSelection = useImageStore((state) => state.clearImageSelection);

  const sortedImages = useMemo(() => {
    return [...images].sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0));
  }, [images]);

  const handleSelect = (image: IndexedImage, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      toggleImageSelection(image.id);
      return;
    }

    clearImageSelection();
    setSelectedImage(image);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-semibold text-gray-300 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to stacks
        </button>
        <div className="text-xs text-gray-400">
          {sortedImages.length} images · similarity {Math.round(cluster.similarityThreshold * 100)}%
        </div>
      </div>
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-100 mb-1">Cluster prompt</h3>
        <p className="text-xs text-gray-300 leading-relaxed">{cluster.basePrompt}</p>
      </div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {sortedImages.map((image) => (
          <StackImageTile
            key={image.id}
            image={image}
            isSelected={selectedImages.has(image.id)}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  );
};

export default StackExpandedView;
