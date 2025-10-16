import React, { useState, useEffect, useRef } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { type IndexedImage } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';
import { Check, Info } from 'lucide-react';

// --- ImageCard Component (with slight modifications) ---
interface ImageCardProps {
  image: IndexedImage;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  isSelected: boolean;
  style: React.CSSProperties; // Added for react-virtualized
  onImageLoad: () => void; // Added to notify parent of image load
}

const ImageCard: React.FC<ImageCardProps> = ({ image, onImageClick, isSelected, style, onImageLoad }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const setPreviewImage = useImageStore((state) => state.setPreviewImage);

  useEffect(() => {
    let isMounted = true;
    let currentUrl: string | null = null;
    const fileHandle = image.thumbnailHandle || image.handle;

    // Check if we can actually load this image
    const isElectron = typeof window !== 'undefined' && window.electronAPI;
    if (!isElectron && (!fileHandle || typeof fileHandle.getFile !== 'function')) {
      // In browser mode with invalid handles, don't try to load
      return;
    }

    fileHandle.getFile().then(file => {
      if (isMounted) {
        currentUrl = URL.createObjectURL(file);
        setImageUrl(currentUrl);
      }
    }).catch(error => {
      // Only log error if we're in Electron mode - browser mode failures are expected
      if (isElectron) {
        console.error('Failed to load image:', error);
      }
      if (image.thumbnailHandle && isMounted) {
        image.handle.getFile().then(file => {
          if (isMounted) {
            currentUrl = URL.createObjectURL(file);
            setImageUrl(currentUrl);
          }
        }).catch(err => {
          if (isElectron) {
            console.error('Failed to load fallback image:', err);
          }
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
      style={style}
      className={`bg-gray-800 rounded-lg overflow-hidden shadow-md cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/30 group relative masonry-cell ${
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
        <img
          src={imageUrl}
          alt={image.name}
          className="w-full h-auto object-cover"
          loading="lazy"
          onLoad={onImageLoad}
        />
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

const GUTTER_SIZE = 8; // Space between images

const ImageGrid: React.FC<ImageGridProps> = ({ images, onImageClick, selectedImages }) => {
  const imageSize = useSettingsStore((state) => state.imageSize);

  if (images.length === 0) {
    return <div className="text-center py-16 text-gray-500">No images found. Try a different search term.</div>;
  }

  return (
    <div className="h-full w-full p-1" style={{ minWidth: 0, minHeight: 0 }} data-area="grid" tabIndex={-1}>
      <AutoSizer>
        {({ height, width }) => {
          if (width === 0 || height === 0) return null;
          // Calculate columns based on available width and image size
          const columnCount = Math.max(1, Math.floor(width / (imageSize + GUTTER_SIZE)));
          const rowCount = Math.ceil(images.length / columnCount);

          return (
            <Grid
              columnCount={columnCount}
              rowCount={rowCount}
              columnWidth={imageSize + GUTTER_SIZE}
              rowHeight={imageSize + GUTTER_SIZE}
              height={height}
              width={width}
              itemData={{ images, onImageClick, selectedImages, imageSize, columnCount }}
              overscanRowCount={4}
              overscanColumnCount={2}
            >
              {GridCell}
            </Grid>
          );
        }}
      </AutoSizer>
    </div>
  );
};

// Cell renderer for react-window grid
const GridCell = ({ columnIndex, rowIndex, style, data }: any) => {
  const { images, onImageClick, selectedImages, imageSize, columnCount } = data;
  const index = rowIndex * columnCount + columnIndex;
  const image = images[index];
  if (!image) return null;
  return (
    <div style={{ ...style, padding: GUTTER_SIZE / 2 }}>
      <ImageCard
        image={image}
        onImageClick={onImageClick}
        isSelected={selectedImages.has(image.id)}
        style={{ width: '100%' }}
        onImageLoad={() => {}}
      />
    </div>
  );
};

export default ImageGrid;