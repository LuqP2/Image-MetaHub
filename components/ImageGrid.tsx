
import React, { useState, useEffect, CSSProperties, memo } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { type IndexedImage } from '../types';

// --- ImageCard Component ---
// This component is now simpler and does not need to be aware of virtualization.
interface ImageCardProps {
  image: IndexedImage;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  isSelected: boolean;
}

const ImageCard: React.FC<ImageCardProps> = ({ image, onImageClick, isSelected }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fileHandle = image.thumbnailHandle || image.handle;

    fileHandle.getFile().then(file => {
      if (isMounted) {
        const url = URL.createObjectURL(file);
        setImageUrl(url);
      }
    }).catch(error => {
      console.error('Failed to load image:', error);
      if (image.thumbnailHandle && isMounted) {
        image.handle.getFile().then(file => {
          if (isMounted) {
            const url = URL.createObjectURL(file);
            setImageUrl(url);
          }
        });
      }
    });

    return () => {
      isMounted = false;
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [image.handle, image.thumbnailHandle]);

  return (
    <div
      className={`aspect-square bg-gray-800 rounded-lg overflow-hidden shadow-lg cursor-pointer transform transition-all duration-300 hover:scale-105 hover:shadow-blue-500/30 group relative h-full w-full ${
        isSelected ? 'ring-4 ring-blue-500 ring-opacity-75' : ''
      }`}
      onClick={(e) => onImageClick(image, e)}
    >
      {isSelected && (
        <div className="absolute top-2 right-2 z-10">
          <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      )}
      {imageUrl ? (
        <img src={imageUrl} alt={image.name} className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full animate-pulse bg-gray-700"></div>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <p className="text-white text-xs truncate">{image.name}</p>
      </div>
    </div>
  );
};


// --- GridCell Component ---
// This is the memoized cell renderer for react-window.
// It receives positioning `style` from the grid and `data` via the `itemData` prop.
const GridCell = memo(({ columnIndex, rowIndex, style, data }: {
  columnIndex: number;
  rowIndex: number;
  style: CSSProperties;
  data: {
    images: IndexedImage[];
    selectedImages: Set<string>;
    onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
    columnCount: number;
  };
}) => {
  const { images, selectedImages, onImageClick, columnCount } = data;
  const index = rowIndex * columnCount + columnIndex;

  if (index >= images.length) {
    return null; // Do not render anything for out-of-bounds indices
  }

  const image = images[index];
  const isSelected = selectedImages.has(image.id);

  return (
    <div style={style} className="p-1">
      <ImageCard
        image={image}
        onImageClick={onImageClick}
        isSelected={isSelected}
      />
    </div>
  );
});


// --- ImageGrid Component ---
// This component now correctly uses AutoSizer and FixedSizeGrid.
interface ImageGridProps {
  images: IndexedImage[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
}

const ImageGrid: React.FC<ImageGridProps> = ({ images, onImageClick, selectedImages }) => {
  if (images.length === 0) {
    return <div className="text-center py-16 text-gray-500">No images found. Try a different search term.</div>;
  }

  return (
    <div className="h-full w-full">
      <AutoSizer>
        {({ height, width }) => {
          const PADDING = 8; // p-1 on cell is 4px, so total gap is 8px
          const MIN_CARD_WIDTH = 120;

          const columnCount = Math.floor((width) / (MIN_CARD_WIDTH + PADDING)) || 1;
          const cardWidth = Math.floor((width - (columnCount - 1) * PADDING) / columnCount);
          const rowCount = Math.ceil(images.length / columnCount);

          const itemData = {
              images,
              selectedImages,
              onImageClick,
              columnCount
          };

          return (
            <Grid
              className="grid-container"
              columnCount={columnCount}
              columnWidth={cardWidth}
              height={height}
              rowCount={rowCount}
              rowHeight={cardWidth} // For square aspect ratio
              width={width}
              itemData={itemData}
            >
              {GridCell}
            </Grid>
          );
        }}
      </AutoSizer>
    </div>
  );
};

export default ImageGrid;
