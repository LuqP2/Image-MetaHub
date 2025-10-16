import React, { useEffect, useState, FC } from 'react';
import { useImageStore } from '../store/useImageStore';
import { type IndexedImage, type BaseMetadata } from '../types';

// Helper component from ImageModal.tsx
const MetadataItem: FC<{ label: string; value?: string | number | any[]; isPrompt?: boolean; onCopy?: (value: string) => void }> = ({ label, value, isPrompt = false, onCopy }) => {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
    return null;
  }

  const displayValue = Array.isArray(value) ? value.join(', ') : String(value);

  return (
    <div className="bg-gray-900/50 p-3 rounded-md border border-gray-700/50 relative group">
      <div className="flex justify-between items-start">
        <p className="font-semibold text-gray-400 text-xs uppercase tracking-wider">{label}</p>
        {onCopy && (
            <button onClick={() => onCopy(displayValue)} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-white" title={`Copy ${label}`}>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 011-1h6a1 1 0 110 2H8a1 1 0 01-1-1zM5 5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H5z"></path></svg>
            </button>
        )}
      </div>
      {isPrompt ? (
        <pre className="text-gray-200 whitespace-pre-wrap break-words font-mono text-sm mt-1">{displayValue}</pre>
      ) : (
        <p className="text-gray-200 break-words font-mono text-sm mt-1">{displayValue}</p>
      )}
    </div>
  );
};

const ImagePreviewSidebar: React.FC = () => {
  const {
    previewImage,
    setPreviewImage,
    directories
  } = useImageStore();
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let currentUrl: string | null = null;

    if (previewImage) {
      const loadImage = async () => {
        if (!isMounted) return;
        
        // Revoke previous URL if it exists
        if (imageUrl && imageUrl.startsWith('blob:')) {
          URL.revokeObjectURL(imageUrl);
        }
        setImageUrl(null); // Reset while loading

        const directoryPath = directories.find(d => d.id === previewImage.directoryId)?.path;

        try {
          const fileHandle = previewImage.thumbnailHandle || previewImage.handle;
          if (fileHandle && typeof fileHandle.getFile === 'function') {
            const file = await fileHandle.getFile();
            if (isMounted) {
              currentUrl = URL.createObjectURL(file);
              setImageUrl(currentUrl);
            }
            return;
          }
          throw new Error('Image handle is not a valid FileSystemFileHandle.');
        } catch (handleError) {
          console.warn(`Could not load image with FileSystemFileHandle: ${(handleError as Error).message}. Attempting Electron fallback.`);
          if (isMounted && window.electronAPI && directoryPath) {
            try {
              const pathResult = await window.electronAPI.joinPaths(directoryPath, previewImage.name);
              if (!pathResult.success || !pathResult.path) {
                throw new Error(pathResult.error || 'Failed to construct image path.');
              }
              const fileResult = await window.electronAPI.readFile(pathResult.path);
              if (fileResult.success && fileResult.data && isMounted) {
                let dataUrl: string;
                if (typeof fileResult.data === 'string') {
                  const ext = previewImage.name.toLowerCase().endsWith('.jpg') || previewImage.name.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
                  dataUrl = `data:image/${ext};base64,${fileResult.data}`;
                } else if (fileResult.data instanceof Uint8Array) {
                  const binary = String.fromCharCode.apply(null, Array.from(fileResult.data));
                  const base64 = btoa(binary);
                  const ext = previewImage.name.toLowerCase().endsWith('.jpg') || previewImage.name.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
                  dataUrl = `data:image/${ext};base64,${base64}`;
                } else {
                  throw new Error('Unknown file data format.');
                }
                currentUrl = dataUrl;
                setImageUrl(dataUrl);
              } else {
                throw new Error(fileResult.error || 'Failed to read file via Electron API.');
              }
            } catch (electronError) {
              console.error('Electron fallback failed:', electronError);
              if (isMounted) setImageUrl(null);
            }
          } else if (isMounted) {
            setImageUrl(null);
          }
        }
      };

      loadImage();
    }

    return () => {
      isMounted = false;
      if (currentUrl && currentUrl.startsWith('blob:')) {
        // Small delay to ensure image is no longer being used before revoking
        setTimeout(() => {
          URL.revokeObjectURL(currentUrl);
        }, 100);
      }
    };
  }, [previewImage, directories]);

  if (!previewImage) {
    return null;
  }

  const nMeta: BaseMetadata | undefined = previewImage.metadata?.normalizedMetadata;

  const copyToClipboard = (text: string, type: string) => {
    if(!text) return;
    navigator.clipboard.writeText(text).then(() => {
      // You can add a notification here if you want
    }).catch(err => {
      console.error(`Failed to copy ${type}:`, err);
    });
  };

  return (
    <div data-area="preview" tabIndex={-1} className="fixed right-0 top-0 h-full w-96 bg-gray-800 border-l border-gray-700 z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-gray-200">Image Preview</h2>
        <button
          onClick={() => setPreviewImage(null)}
          className="text-gray-400 hover:text-white transition-colors"
          title="Close preview"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Image */}
        <div className="bg-black flex items-center justify-center rounded-lg">
          {imageUrl ? <img src={imageUrl} alt={previewImage.name} className="max-w-full max-h-96 object-contain" /> : <div className="w-full h-64 animate-pulse bg-gray-700 rounded-md"></div>}
        </div>

        {/* Metadata */}
        <div>
          <h2 className="text-lg font-bold text-gray-100 break-all">{previewImage.name}</h2>
          <p className="text-xs text-blue-400 font-mono break-all">{new Date(previewImage.lastModified).toLocaleString()}</p>
        </div>

        {nMeta ? (
          <>
            <h3 className="text-base font-semibold text-gray-300 border-b border-gray-600 pb-2">Metadata</h3>
            <div className="space-y-3">
              <MetadataItem label="Format" value={nMeta.format} onCopy={(v) => copyToClipboard(v, "Format")} />
              <MetadataItem label="Prompt" value={nMeta.prompt} isPrompt onCopy={(v) => copyToClipboard(v, "Prompt")} />
              <MetadataItem label="Negative Prompt" value={nMeta.negativePrompt} isPrompt onCopy={(v) => copyToClipboard(v, "Negative Prompt")} />
              <MetadataItem label="Model" value={nMeta.model} onCopy={(v) => copyToClipboard(v, "Model")} />

              <div className="grid grid-cols-2 gap-2 text-sm">
                  <MetadataItem label="Steps" value={nMeta.steps} />
                  <MetadataItem label="CFG Scale" value={nMeta.cfgScale} />
                  <MetadataItem label="Seed" value={nMeta.seed} />
                  <MetadataItem label="Dimensions" value={nMeta.width && nMeta.height ? `${nMeta.width}x${nMeta.height}` : undefined} />
                  <MetadataItem label="Sampler" value={nMeta.sampler} />
                  <MetadataItem label="Scheduler" value={nMeta.scheduler} />
              </div>
            </div>

            {nMeta.loras && nMeta.loras.length > 0 && (
               <>
                  <h3 className="text-base font-semibold text-gray-300 pt-2 border-b border-gray-600 pb-2">LoRAs</h3>
                  <MetadataItem label="LoRAs" value={nMeta.loras.map((lora: any) => typeof lora === 'string' ? lora : lora.model_name || 'Unknown LoRA').join(', ')} />
               </>
            )}
          </>
        ) : (
          <div className="bg-yellow-900/50 border border-yellow-700 text-yellow-300 px-4 py-3 rounded-lg text-sm">
              No normalized metadata available.
          </div>
        )}
      </div>
    </div>
  );
};

export default ImagePreviewSidebar;
