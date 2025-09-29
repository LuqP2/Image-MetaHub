import React, { useEffect, useState, FC } from 'react';
import { type IndexedImage, type BaseMetadata } from '../types';
import { FileOperations } from '../services/fileOperations';
import { copyImageToClipboard, showInExplorer, copyFilePathToClipboard } from '../utils/imageUtils';
import { X, Copy, Download, Folder } from 'lucide-react';

// Interface for ImageModal props
interface ImageModalProps {
  image: IndexedImage;
  onClose: () => void;
  onImageDeleted?: (imageId: string) => void;
  onImageRenamed?: (imageId: string, newName: string) => void;
  currentIndex?: number;
  totalImages?: number;
  onNavigateNext?: () => void;
  onNavigatePrevious?: () => void;
  directoryPath?: string;
}

// Helper component for consistently rendering metadata items
const MetadataItem: FC<{ label: string; value?: string | number | any[]; isPrompt?: boolean; onCopy?: (value: string) => void }> = ({ label, value, isPrompt = false, onCopy }) => {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
    return null;
  }

  const displayValue = Array.isArray(value) ? value.join(', ') : String(value);

  return (
    <div className="bg-gray-50/50 dark:bg-slate-700/50 rounded-lg p-4">
      <div className="flex justify-between items-center mb-1">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
        {onCopy && (
          <button onClick={() => onCopy(displayValue)} className="text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors" title={`Copy ${label}`}>
            <Copy className="w-4 h-4" />
          </button>
        )}
      </div>
      {isPrompt ? (
        <pre className="text-sm leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words font-sans">{displayValue}</pre>
      ) : (
        <p className="text-sm text-gray-800 dark:text-gray-200 break-words">{displayValue}</p>
      )}
    </div>
  );
};


const ImageModal: React.FC<ImageModalProps> = ({
  image,
  onClose,
  onImageDeleted,
  onImageRenamed,
  currentIndex = 0,
  totalImages = 0,
  onNavigateNext,
  onNavigatePrevious,
  directoryPath
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(image.name.replace(/\.(png|jpg|jpeg)$/i, ''));
  const [showRawMetadata, setShowRawMetadata] = useState(false);

  const nMeta: BaseMetadata | undefined = image.metadata?.normalizedMetadata;

  const copyToClipboard = (text: string, type: string) => {
    if(!text) {
        alert(`No ${type} to copy.`);
        return;
    }
    navigator.clipboard.writeText(text).then(() => {
      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50';
      notification.textContent = `${type} copied to clipboard!`;
      document.body.appendChild(notification);
      setTimeout(() => document.body.removeChild(notification), 2000);
    }).catch(err => {
      console.error(`Failed to copy ${type}:`, err);
      alert(`Failed to copy ${type}.`);
    });
  };

  useEffect(() => {
    let isMounted = true;
    image.handle.getFile().then(file => {
      if(isMounted) {
          const url = URL.createObjectURL(file);
          setImageUrl(url);
      }
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isRenaming) return;
      if (event.key === 'Escape') {
        onClose();
      }
      if (event.key === 'ArrowLeft') onNavigatePrevious?.();
      if (event.key === 'ArrowRight') onNavigateNext?.();
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
      isMounted = false;
    };
  }, [image.handle, onClose, isRenaming, onNavigatePrevious, onNavigateNext, imageUrl]);

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this image? This action cannot be undone.')) {
      const result = await FileOperations.deleteFile(image);
      if (result.success) {
        onImageDeleted?.(image.id);
        onClose();
      } else {
        alert(`Failed to delete file: ${result.error}`);
      }
    }
  };

  const confirmRename = async () => {
    if (!newName.trim() || !FileOperations.validateFilename(newName).valid) {
      alert('Invalid filename.');
      return;
    }
    const result = await FileOperations.renameFile(image, newName);
    if (result.success) {
      onImageRenamed?.(image.id, `${newName}.${image.name.split('.').pop()}`);
      setIsRenaming(false);
    } else {
      alert(`Failed to rename file: ${result.error}`);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full p-2 transition-colors"
          aria-label="Close modal"
        >
          <X className="w-5 h-5 text-gray-800 dark:text-gray-200" />
        </button>

        {/* Image Display Section */}
        <div className="w-full md:w-2/3 h-1/2 md:h-full bg-black flex items-center justify-center p-4 relative group rounded-l-3xl">
          {imageUrl ? <img src={imageUrl} alt={image.name} className="max-w-full max-h-full object-contain" /> : <div className="w-full h-full animate-pulse bg-gray-700 rounded-md"></div>}

          {onNavigatePrevious && <button onClick={onNavigatePrevious} className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-black/50 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">←</button>}
          {onNavigateNext && <button onClick={onNavigateNext} className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black/50 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">→</button>}

          <div className="absolute top-4 left-4 bg-black/60 text-white px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm border border-white/20">
            {currentIndex + 1} / {totalImages}
          </div>
        </div>

        {/* Metadata Panel */}
        <div className="w-full md:w-1/3 h-1/2 md:h-full flex flex-col overflow-hidden">
          <div className="bg-gray-50/80 dark:bg-slate-700/50 backdrop-blur-sm px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            {isRenaming ? (
              <div className="flex gap-2">
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="bg-gray-900 text-white border border-gray-600 rounded px-2 py-1 w-full" autoFocus onKeyDown={e => e.key === 'Enter' && confirmRename()}/>
                <button onClick={confirmRename} className="bg-green-600 text-white px-3 py-1 rounded">Save</button>
                <button onClick={() => setIsRenaming(false)} className="bg-gray-600 text-white px-3 py-1 rounded">Cancel</button>
              </div>
            ) : (
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 break-all flex items-center gap-2">
                {image.name}
                <button onClick={() => setIsRenaming(true)} className="text-gray-400 hover:text-orange-400 p-1">✏️</button>
                <button onClick={handleDelete} className="text-gray-400 hover:text-red-400 p-1">🗑️</button>
              </h2>
            )}
            <p className="text-xs text-blue-500 dark:text-blue-400 font-mono break-all">{new Date(image.lastModified).toLocaleString()}</p>
          </div>
          <div className="p-6 overflow-y-auto space-y-4">

          {nMeta ? (
            <>
              <h3 className="text-base font-semibold text-gray-300 border-b border-gray-600 pb-2">📋 METADATA</h3>
              <div className="space-y-3">
                <MetadataItem label="Format" value={nMeta.format} onCopy={(v) => copyToClipboard(v, "Format")} />
                <MetadataItem label="Prompt" value={nMeta.prompt} isPrompt onCopy={(v) => copyToClipboard(v, "Prompt")} />
                <MetadataItem label="Negative Prompt" value={nMeta.negativePrompt} isPrompt onCopy={(v) => copyToClipboard(v, "Negative Prompt")} />

                <div>
                  <div className="flex flex-wrap gap-2">
                    {nMeta.model && (
                      <span className="inline-flex items-center bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-medium px-3 py-1 rounded-full">
                        {nMeta.model}
                      </span>
                    )}
                    {nMeta.loras && nMeta.loras.map((lora: any, index: number) => (
                      <span key={index} className="inline-flex items-center bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 text-xs font-medium px-3 py-1 rounded-full">
                        {typeof lora === 'string' ? lora : lora.model_name || 'Unknown LoRA'}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                    <MetadataItem label="Steps" value={nMeta.steps} />
                    <MetadataItem label="CFG Scale" value={nMeta.cfgScale} />
                    <MetadataItem label="Seed" value={nMeta.seed} />
                    <MetadataItem label="Dimensions" value={nMeta.width && nMeta.height ? `${nMeta.width}×${nMeta.height}` : undefined} />
                    <MetadataItem label="Sampler" value={nMeta.sampler} />
                    <MetadataItem label="Scheduler" value={nMeta.scheduler} />
                </div>
              </div>
            </>
          ) : (
            <div className="bg-yellow-900/50 border border-yellow-700 text-yellow-300 px-4 py-3 rounded-lg text-sm">
                No normalized metadata available.
            </div>
          )}

          <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => copyToClipboard(nMeta?.prompt || '', 'Prompt')}
              className="flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-sm bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 transition-all"
            >
              <Copy className="w-4 h-4" />
              Copy Prompt
            </button>
            <button
              onClick={async () => {
                const file = await image.handle.getFile();
                const url = URL.createObjectURL(file);
                const a = document.createElement('a');
                a.href = url;
                a.download = image.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-sm bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-all"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
            <button
              onClick={() => showInExplorer(image)}
              className="flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-sm bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 transition-all"
            >
              <Folder className="w-4 h-4" />
              Show in Folder
            </button>
            <button
              onClick={() => copyToClipboard(JSON.stringify(image.metadata, null, 2), 'Raw Metadata')}
              className="flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-sm bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 transition-all"
            >
              <Copy className="w-4 h-4" />
              Copy Raw
            </button>
          </div>

          <div>
            <button onClick={() => setShowRawMetadata(!showRawMetadata)} className="text-gray-400 text-sm w-full text-left mt-4 py-1 border-t border-gray-700 flex items-center gap-1">
              {showRawMetadata ? '▼' : '▶'} Raw Metadata
            </button>
            {showRawMetadata && (
              <pre className="bg-black/50 p-2 rounded text-xs text-gray-300 whitespace-pre-wrap break-all max-h-64 overflow-y-auto mt-2">
                {JSON.stringify(image.metadata, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageModal;