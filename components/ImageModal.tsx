
import React, { useEffect, useState } from 'react';
import { type IndexedImage } from '../types';

interface ImageModalProps {
  image: IndexedImage;
  onClose: () => void;
}

const ImageModal: React.FC<ImageModalProps> = ({ image, onClose }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    let isMounted = true;
    image.handle.getFile().then(file => {
      if(isMounted) {
          const url = URL.createObjectURL(file);
          setImageUrl(url);
      }
    });

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      isMounted = false;
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.handle, onClose]);
  
  const renderMetadataValue = (value: any): string => {
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-6xl h-full max-h-[90vh] flex flex-col md:flex-row overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full md:w-2/3 h-1/2 md:h-full bg-black flex items-center justify-center p-4">
          {imageUrl ? (
            <img src={imageUrl} alt={image.name} className="max-w-full max-h-full object-contain" />
          ) : (
            <div className="w-full h-full animate-pulse bg-gray-700 rounded-md"></div>
          )}
        </div>
        <div className="w-full md:w-1/3 h-1/2 md:h-full p-6 overflow-y-auto">
          <h2 className="text-xl font-bold mb-1 text-gray-100 break-words">{image.name}</h2>
          <p className="text-sm text-blue-400 font-mono mb-4 break-all">{image.id}</p>
          <div className="space-y-3 text-sm">
            {Object.entries(image.metadata).map(([key, value]) => (
              <div key={key} className="bg-gray-900 p-3 rounded-md">
                <p className="font-semibold text-gray-400 capitalize">{key.replace(/_/g, ' ')}</p>
                <pre className="text-gray-200 whitespace-pre-wrap break-words font-mono text-xs mt-1">{renderMetadataValue(value)}</pre>
              </div>
            ))}
          </div>
        </div>
      </div>
      <button
        className="absolute top-4 right-4 text-white text-3xl hover:text-gray-400 transition-colors"
        onClick={onClose}
      >
        &times;
      </button>
    </div>
  );
};

export default ImageModal;
