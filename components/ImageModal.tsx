import React, { useEffect, useState, useCallback } from 'react';
import { type IndexedImage } from '../types';

// Simplified metadata row component
const MetadataRow = ({ label, value }) => {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="mb-2">
      <p className="text-xs text-gray-600 dark:text-gray-400 font-medium uppercase">{label}</p>
      <p className="text-sm text-gray-800 dark:text-gray-200 break-words">{String(value)}</p>
    </div>
  );
};

const ImageModal = ({
  image,
  onClose,
  onImageDeleted,
  currentIndex,
  totalImages,
  onNavigateNext,
  onNavigatePrevious,
  directoryPath
}) => {
  const [imageUrl, setImageUrl] = useState(null);

  // Memoized keydown handler for navigation and closing
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && onNavigateNext) onNavigateNext();
      if (e.key === 'ArrowLeft' && onNavigatePrevious) onNavigatePrevious();
    },
    [onClose, onNavigateNext, onNavigatePrevious]
  );

  useEffect(() => {
    let isMounted = true;
    let objectUrl = null;

    // Simplified image loading logic
    const loadImage = async () => {
        try {
            const handle = image.handle;
            if (handle && typeof handle.getFile === 'function') {
                const file = await handle.getFile();
                if (isMounted) {
                    objectUrl = URL.createObjectURL(file);
                    setImageUrl(objectUrl);
                }
            } else if (window.electronAPI && directoryPath) {
                // Electron fallback
                const dataUrl = await window.electronAPI.readFileAsDataURL(directoryPath, image.name);
                if (isMounted) setImageUrl(dataUrl);
            }
        } catch (error) {
            console.error("Failed to load image in modal:", error);
            if (isMounted) setImageUrl(null); // Show placeholder on error
        }
    };

    loadImage();
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      isMounted = false;
      window.removeEventListener('keydown', handleKeyDown);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [image, directoryPath, handleKeyDown]);

  const buttonStyle = `
    px-4 py-2 rounded-sm text-sm
    bg-gray-200 text-black
    dark:bg-gray-700 dark:text-gray-100
    hover:bg-gray-300 dark:hover:bg-gray-600
    focus:outline-none focus:ring-2 focus:ring-blue-500
    disabled:opacity-50 disabled:cursor-not-allowed
  `;

  const nMeta = image.metadata?.normalizedMetadata || {};

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-sm shadow-sm w-full max-w-6xl h-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-2 border-b border-gray-300 dark:border-gray-700">
          <h2 className="text-lg font-semibold truncate" title={image.name}>{image.name}</h2>
          <button onClick={onClose} className="text-2xl font-bold hover:text-red-500 transition-colors p-1 leading-none">&times;</button>
        </div>

        {/* Content */}
        <div className="flex-1 flex min-h-0">
          {/* Image Preview */}
          <div className="flex-1 flex items-center justify-center p-4 bg-gray-100 dark:bg-gray-900">
            {imageUrl ? (
              <img src={imageUrl} alt={image.name} className="max-w-full max-h-full object-contain" />
            ) : (
              <div className="text-gray-500">Loading...</div>
            )}
          </div>

          {/* Metadata Sidebar */}
          <aside className="w-80 p-4 border-l border-gray-300 dark:border-gray-700 flex flex-col">
            <h3 className="text-md font-semibold mb-3">Metadata</h3>
            <div className="flex-1 overflow-y-auto pr-1 space-y-2">
              <MetadataRow label="Prompt" value={nMeta.prompt} />
              <MetadataRow label="Negative Prompt" value={nMeta.negativePrompt} />
              <MetadataRow label="Model" value={nMeta.model} />
              <MetadataRow label="Seed" value={nMeta.seed} />
              <MetadataRow label="Sampler" value={nMeta.sampler} />
              <MetadataRow label="Steps" value={nMeta.steps} />
              <MetadataRow label="CFG Scale" value={nMeta.cfgScale} />
              <MetadataRow label="Dimensions" value={nMeta.width && nMeta.height ? `${nMeta.width}x${nMeta.height}` : ''} />
              <MetadataRow label="LoRAs" value={nMeta.loras?.join(', ')} />
            </div>
          </aside>
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-gray-300 dark:border-gray-700 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <button onClick={onNavigatePrevious} disabled={currentIndex <= 0} className={buttonStyle}>&larr; Prev</button>
            <span>{currentIndex + 1} / {totalImages}</span>
            <button onClick={onNavigateNext} disabled={currentIndex >= totalImages - 1} className={buttonStyle}>Next &rarr;</button>
          </div>
          <div className="flex items-center gap-2">
            {onImageDeleted && (
                <button
                    onClick={() => {
                        if (window.confirm('Are you sure you want to delete this image?')) {
                            onImageDeleted(image.id);
                        }
                    }}
                    className={`${buttonStyle} bg-red-500/80 text-white hover:bg-red-600 dark:bg-red-600/80 dark:hover:bg-red-700`}
                >
                    Delete
                </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageModal;