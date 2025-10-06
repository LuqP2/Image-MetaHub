import React, 'react';
import { IndexedImage } from '../../types';
import { useImageLoader } from '../../hooks/useImageLoader';

interface ImageThumbnailProps {
  image: IndexedImage;
  isSelected: boolean;
  onClick: (event: React.MouseEvent<HTMLDivElement, MouseEvent>, imageId: string) => void;
}

const ImageThumbnail: React.FC<ImageThumbnailProps> = ({ image, isSelected, onClick }) => {
  const { getImageUrl } = useImageLoader();
  const imageUrl = getImageUrl(image);

  const selectionClass = isSelected
    ? 'border-2 border-blue-500'
    : 'border border-transparent hover:border-gray-300 hover:shadow-sm';

  return (
    <div
      className={`group relative aspect-square cursor-pointer overflow-hidden rounded-md bg-gray-200 ${selectionClass}`}
      onClick={(e) => onClick(e, image.id)}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={image.name}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center bg-gray-200">
          <span className="text-xs text-gray-500">Loading...</span>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-2 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <p className="truncate text-xs font-medium">{image.name}</p>
      </div>
    </div>
  );
};

interface ImageGridProps {
  images: IndexedImage[];
  onImageClick: (event: React.MouseEvent<HTMLDivElement, MouseEvent>, imageId: string) => void;
  selectedImages: Set<string>;
}

const ImageGrid: React.FC<ImageGridProps> = ({ images, onImageClick, selectedImages }) => {
  if (images.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-500">No images found.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
      {images.map(image => (
        <ImageThumbnail
          key={image.id}
          image={image}
          isSelected={selectedImages.has(image.id)}
          onClick={onImageClick}
        />
      ))}
    </div>
  );
};

export default ImageGrid;