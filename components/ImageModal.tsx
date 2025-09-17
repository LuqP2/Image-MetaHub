
import React, { useEffect, useState } from 'react';
import { type IndexedImage } from '../types';

interface ImageModalProps {
  image: IndexedImage;
  onClose: () => void;
}

const ImageModal: React.FC<ImageModalProps> = ({ image, onClose }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Function to export metadata as TXT
  const exportToTxt = () => {
    const filename = `${image.name.replace('.png', '')}_metadata.txt`;
    let content = `Image Metadata Export\n`;
    content += `========================\n`;
    content += `File: ${image.name}\n`;
    content += `Image ID: ${image.id}\n`;
    content += `Last Modified: ${new Date(image.lastModified).toLocaleString()}\n\n`;
    
    // Add models
    if (image.models && image.models.length > 0) {
      content += `Models Used:\n`;
      image.models.forEach((model, index) => {
        content += `  ${index + 1}. ${model}\n`;
      });
      content += `\n`;
    }
    
    // Add LoRAs
    if (image.loras && image.loras.length > 0) {
      content += `LoRAs Used:\n`;
      image.loras.forEach((lora, index) => {
        content += `  ${index + 1}. ${lora}\n`;
      });
      content += `\n`;
    }
    
    // Add scheduler
    if (image.scheduler) {
      content += `Scheduler: ${image.scheduler}\n\n`;
    }
    
    // Add all metadata
    content += `Complete Metadata:\n`;
    content += `==================\n`;
    Object.entries(image.metadata).forEach(([key, value]) => {
      content += `${key.replace(/_/g, ' ').toUpperCase()}:\n`;
      if (typeof value === 'object' && value !== null) {
        content += `${JSON.stringify(value, null, 2)}\n\n`;
      } else {
        content += `${String(value)}\n\n`;
      }
    });
    
    // Create and download file
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Function to export metadata as JSON
  const exportToJson = () => {
    const filename = `${image.name.replace('.png', '')}_metadata.json`;
    const exportData = {
      export_info: {
        exported_at: new Date().toISOString(),
        source_file: image.name,
        image_id: image.id,
        last_modified: new Date(image.lastModified).toISOString()
      },
      extracted_data: {
        models: image.models,
        loras: image.loras,
        scheduler: image.scheduler
      },
      raw_metadata: image.metadata,
      metadata_string: image.metadataString
    };
    
    // Create and download file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

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
          <div className="flex flex-col gap-3 mb-4">
            <h2 className="text-xl font-bold text-gray-100 break-words">{image.name}</h2>
            <p className="text-sm text-blue-400 font-mono break-all">{image.id}</p>
            
            {/* Export Buttons */}
            <div className="flex gap-2">
              <button
                onClick={exportToTxt}
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm font-medium transition-colors duration-200 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                title="Export metadata as readable text file"
              >
                📄 Export to TXT
              </button>
              <button
                onClick={exportToJson}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm font-medium transition-colors duration-200 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                title="Export metadata as JSON file"
              >
                📦 Export to JSON
              </button>
            </div>
          </div>
          
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
