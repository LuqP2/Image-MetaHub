import React, { useState, useEffect } from 'react';
import Masonry from 'react-masonry-css';
import { type IndexedImage } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';
import { Check, Info } from 'lucide-react';

// --- ImageCard Component ---
interface ImageCardProps {
  image: IndexedImage;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  isSelected: boolean;
}

const ImageCard: React.FC<ImageCardProps> = ({ image, onImageClick, isSelected }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const setPreviewImage = useImageStore((state) => state.setPreviewImage);

  useEffect(() => {
    let isMounted = true;
    let currentUrl: string | null = null;
    const fileHandle = image.thumbnailHandle || image.handle;

    fileHandle.getFile().then(file => {
      if (isMounted) {
        currentUrl = URL.createObjectURL(file);
        setImageUrl(currentUrl);
      }
    }).catch(error => {
      console.error('Failed to load image:', error);
      if (image.thumbnailHandle && isMounted) {
        image.handle.getFile().then(file => {
          if (isMounted) {
            currentUrl = URL.createObjectURL(file);
            setImageUrl(currentUrl);
          }
        }).catch(err => {
          console.error('Failed to load fallback image:', err);
        });
      }
    });

    return () => {
      isMounted = false;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [image.handle, image.thumbnailHandle]);

  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewImage(image);
  };

  return (
    <div
      className={`bg-gray-800 rounded-lg overflow-hidden shadow-md cursor-pointer transform transition-all duration-300 hover:scale-105 hover:shadow-blue-500/30 group relative ${
        isSelected ? 'ring-4 ring-blue-500 ring-opacity-75' : ''
      }`}
      onClick={(e) => onImageClick(image, e)}
    >
      {isSelected && (
        <div className="absolute top-2 right-2 z-10">
          <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
            <Check className="w-4 h-4 text-white" />
          </div>
        </div>
      )}
      <button 
        onClick={handlePreviewClick}
        className="absolute top-2 left-2 z-10 p-1.5 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-500"
        title="Show details"
      >
        <Info className="h-4 w-4" />
      </button>

      {imageUrl ? (
        <img src={imageUrl} alt={image.name} className="w-full h-auto object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-48 animate-pulse bg-gray-700"></div>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <p className="text-white text-xs truncate">{image.name}</p>
      </div>
    </div>
  );
};

// --- ImageGrid Component ---
interface ImageGridProps {
  images: IndexedImage[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
}

const ImageGrid: React.FC<ImageGridProps> = ({ images, onImageClick, selectedImages }) => {
  const imageSize = useSettingsStore((state) => state.imageSize);

  if (images.length === 0) {
    return <div className="text-center py-16 text-gray-500">No images found. Try a different search term.</div>;
  }

  const breakpointColumnsObj = {
    default: Math.max(1, Math.floor(2000 / imageSize)),
    1536: Math.max(1, Math.floor(1536 / imageSize)),
    1280: Math.max(1, Math.floor(1280 / imageSize)),
    1024: Math.max(1, Math.floor(1024 / imageSize)),
    768: Math.max(1, Math.floor(768 / imageSize)),
    640: Math.max(1, Math.floor(640 / imageSize)),
  };

  return (
    <div className="h-full w-full overflow-y-auto">
      <Masonry
        breakpointCols={breakpointColumnsObj}
        className="masonry-grid"
        columnClassName="masonry-grid_column"
      >
        {images.map(image => (
          <ImageCard
            key={image.id}
            image={image}
            onImageClick={onImageClick}
            isSelected={selectedImages.has(image.id)}
          />
        ))}
      </Masonry>
    </div>
  );
};

export default ImageGrid;