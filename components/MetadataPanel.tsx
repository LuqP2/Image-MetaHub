import React from 'react';
import { IndexedImage, BaseMetadata } from '../types';
import { useImageLoader } from '../hooks/useImageLoader';

// --- Icons ---
const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);
const ChevronLeftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);
const ChevronRightIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);
const TrashIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
);


// --- Metadata Entry Component ---
const MetadataEntry: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="py-1.5">
    <dt className="text-xs text-gray-600 uppercase tracking-wider">{label}</dt>
    <dd className="text-sm text-gray-800 break-words">{value}</dd>
  </div>
);

// --- Main Panel Component ---
interface MetadataPanelProps {
  image: IndexedImage;
  onClose: () => void;
  onImageDeleted: (imageId: string) => void;
  onImageRenamed: (imageId: string, newName: string) => void;
  currentIndex: number;
  totalImages: number;
  onNavigateNext: () => void;
  onNavigatePrevious: () => void;
  directoryPath: string;
}

const MetadataPanel: React.FC<MetadataPanelProps> = ({
  image,
  onClose,
  onImageDeleted,
  onNavigateNext,
  onNavigatePrevious,
}) => {
  const { getImageUrl } = useImageLoader();
  const imageUrl = getImageUrl(image, true); // Get full resolution image

  const { normalizedMetadata } = image.metadata as { normalizedMetadata?: BaseMetadata };

  return (
    <aside className="w-80 flex-shrink-0 border-l border-gray-200 bg-white flex flex-col">
      {/* Header */}
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-gray-200 px-2">
        <div className="flex items-center gap-1">
            <button onClick={onNavigatePrevious} className="p-1.5 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <ChevronLeftIcon />
            </button>
            <button onClick={onNavigateNext} className="p-1.5 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <ChevronRightIcon />
            </button>
        </div>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <CloseIcon />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Image Preview */}
        <div className="aspect-square w-full bg-gray-100 p-2">
          {imageUrl ? (
            <img src={imageUrl} alt={image.name} className="h-full w-full object-contain" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-sm text-gray-500">Loading Preview...</div>
          )}
        </div>

        {/* Metadata List */}
        <div className="p-4">
          <h3 className="text-base font-semibold text-gray-800 mb-2 truncate" title={image.name}>{image.name}</h3>
          <dl className="divide-y divide-gray-200">
            {normalizedMetadata?.prompt && (
              <MetadataEntry label="Prompt" value={<p className="whitespace-pre-wrap">{normalizedMetadata.prompt}</p>} />
            )}
            {normalizedMetadata?.negativePrompt && (
              <MetadataEntry label="Negative Prompt" value={<p className="whitespace-pre-wrap">{normalizedMetadata.negativePrompt}</p>} />
            )}
            {normalizedMetadata?.model && <MetadataEntry label="Model" value={normalizedMetadata.model} />}
            {normalizedMetadata?.loras && normalizedMetadata.loras.length > 0 && (
                <MetadataEntry label="LoRAs" value={normalizedMetadata.loras.join(', ')} />
            )}
            {normalizedMetadata?.scheduler && <MetadataEntry label="Scheduler" value={normalizedMetadata.scheduler} />}
            <MetadataEntry label="Dimensions" value={`${normalizedMetadata?.width}x${normalizedMetadata?.height}`} />
            {normalizedMetadata?.steps && <MetadataEntry label="Steps" value={normalizedMetadata.steps} />}
            {normalizedMetadata?.cfg_scale && <MetadataEntry label="CFG Scale" value={normalizedMetadata.cfg_scale} />}
            {normalizedMetadata?.seed && <MetadataEntry label="Seed" value={normalizedMetadata.seed} />}
          </dl>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex-shrink-0 border-t border-gray-200 p-2">
        <button
          onClick={() => onImageDeleted(image.id)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-white border border-gray-300 rounded hover:bg-red-50 hover:border-red-300 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <TrashIcon />
          Delete
        </button>
      </div>
    </aside>
  );
};

export default MetadataPanel;