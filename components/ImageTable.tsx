import React, { useState, useEffect } from 'react';
import { type IndexedImage } from '../types';

interface ImageTableProps {
  images: IndexedImage[];
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  selectedImages: Set<string>;
}

const ImageTable: React.FC<ImageTableProps> = ({ images, onImageClick, selectedImages }) => {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
          <tr>
            <th className="px-4 py-2 text-left">Preview</th>
            <th className="px-4 py-2 text-left">Filename</th>
            <th className="px-4 py-2 text-left">Prompt</th>
            <th className="px-4 py-2 text-left">Model</th>
            <th className="px-4 py-2 text-left">Size</th>
          </tr>
        </thead>
        <tbody>
          {images.map((image) => (
            <ImageTableRow
              key={image.id}
              image={image}
              onImageClick={onImageClick}
              isSelected={selectedImages.has(image.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Componente separado para cada linha da tabela com preview
interface ImageTableRowProps {
  image: IndexedImage;
  onImageClick: (image: IndexedImage, event: React.MouseEvent) => void;
  isSelected: boolean;
}

const ImageTableRow: React.FC<ImageTableRowProps> = ({ image, onImageClick, isSelected }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let currentUrl: string | null = null;
    const fileHandle = image.thumbnailHandle || image.handle;

    // Check if we can actually load this image
    const isElectron = typeof window !== 'undefined' && window.electronAPI;
    if (!isElectron && (!fileHandle || typeof fileHandle.getFile !== 'function')) {
      // In browser mode with invalid handles, don't try to load
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    fileHandle.getFile().then(file => {
      if (isMounted) {
        currentUrl = URL.createObjectURL(file);
        setImageUrl(currentUrl);
        setIsLoading(false);
      }
    }).catch(error => {
      // Only log error if we're in Electron mode - browser mode failures are expected
      if (isElectron) {
        console.error('Failed to load image:', error);
      }
      if (image.thumbnailHandle && isMounted) {
        // Fallback to original image if thumbnail fails
        image.handle.getFile().then(file => {
          if (isMounted) {
            currentUrl = URL.createObjectURL(file);
            setImageUrl(currentUrl);
            setIsLoading(false);
          }
        }).catch(err => {
          if (isElectron) {
            console.error('Failed to load fallback image:', err);
          }
          setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [image.thumbnailHandle, image.handle]);

  return (
    <tr
      className={`border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer ${
        isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
      }`}
      onClick={(e) => onImageClick(image, e)}
    >
      <td className="px-4 py-2">
        <div className="w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden flex items-center justify-center">
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={image.handle.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="text-xs text-gray-500">ERR</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2 font-medium">
        {image.handle.name}
      </td>
      <td className="px-4 py-2 max-w-xs truncate">
        {image.prompt || image.metadata?.prompt?.substring(0, 50) || 'No prompt'}...
      </td>
      <td className="px-4 py-2">
        {image.models?.[0] || 'Unknown'}
      </td>
      <td className="px-4 py-2">
        {image.dimensions || 'Unknown'}
      </td>
    </tr>
  );
};

export default ImageTable;