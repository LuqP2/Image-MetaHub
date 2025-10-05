
import React, { useState, useEffect } from 'react';
import { type IndexedImage } from '../types';

// Simplified thumbnail component, co-located as it's only used here.
const ImageThumbnail = ({ image, isSelected, onClick }) => {
  const [imageUrl, setImageUrl] = useState(null);

  useEffect(() => {
    let isMounted = true;
    let objectUrl = null;

    // Use a simplified image loading logic that prefers the thumbnail handle.
    const handle = image.thumbnailHandle || image.handle;
    if (handle && typeof handle.getFile === 'function') {
      handle.getFile()
        .then(file => {
          if (isMounted) {
            objectUrl = URL.createObjectURL(file);
            setImageUrl(objectUrl);
          }
        })
        .catch(err => console.error("Error loading image file:", err));
    }

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [image.handle, image.thumbnailHandle]);

  // Use a simple ring for selection to avoid layout shifts.
  const selectionClass = isSelected
    ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-100 dark:ring-offset-gray-900'
    : 'ring-2 ring-transparent';

  return (
    <div
      className={`relative group cursor-pointer aspect-square bg-gray-200 dark:bg-gray-700 rounded-sm overflow-hidden transition-all duration-150 ${selectionClass}`}
      onClick={onClick}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={image.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full bg-gray-300 dark:bg-gray-600" /> // Simple placeholder
      )}
      <div className="absolute bottom-0 left-0 right-0 p-1 bg-black bg-opacity-50 text-white text-xs truncate opacity-0 group-hover:opacity-100 transition-opacity">
        {image.name}
      </div>
    </div>
  );
};

// Main grid component, simplified to use native scrolling.
interface ImageGridProps {
  images: IndexedImage[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
}

const ImageGrid: React.FC<ImageGridProps> = ({ images, onImageClick, selectedImages }) => {
  if (images.length === 0) {
    return <div className="text-center py-16 text-gray-500 dark:text-gray-400">No images found.</div>;
  }

  return (
    <div className="h-full w-full overflow-y-auto p-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
        {images.map((image) => (
          <ImageThumbnail
            key={image.id}
            image={image}
            isSelected={selectedImages.has(image.id)}
            onClick={(e) => onImageClick(image, e)}
          />
        ))}
      </div>
    </div>
  );
};

export default ImageGrid;
