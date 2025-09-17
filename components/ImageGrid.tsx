
import React, { useState, useEffect, useRef } from 'react';
import { type IndexedImage } from '../types';

interface ImageCardProps {
  image: IndexedImage;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  isSelected: boolean;
}

const ImageCard: React.FC<ImageCardProps> = ({ image, onImageClick, isSelected }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          let isMounted = true;
          
          // Use thumbnail if available, otherwise use original image
          const fileHandle = image.thumbnailHandle || image.handle;
          
          fileHandle.getFile().then(file => {
            if (isMounted) {
              const url = URL.createObjectURL(file);
              setImageUrl(url);
            }
          }).catch(error => {
            console.error('Failed to load image:', error);
            // Fallback to original image if thumbnail fails
            if (image.thumbnailHandle && isMounted) {
              image.handle.getFile().then(file => {
                if (isMounted) {
                  const url = URL.createObjectURL(file);
                  setImageUrl(url);
                }
              });
            }
          });
          observer.disconnect();

          return () => {
            isMounted = false;
          };
        }
      },
      { rootMargin: '200px' }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
      observer.disconnect();
    };
  }, [image.handle, image.thumbnailHandle, imageUrl]);

  return (
    <div
      ref={ref}
      className={`aspect-square bg-gray-800 rounded-lg overflow-hidden shadow-lg cursor-pointer transform transition-all duration-300 hover:scale-105 hover:shadow-blue-500/30 group relative ${
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
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
      {images.map((image) => (
        <ImageCard 
          key={image.id} 
          image={image} 
          onImageClick={onImageClick}
          isSelected={selectedImages.has(image.id)}
        />
      ))}
    </div>
  );
};

export default ImageGrid;
