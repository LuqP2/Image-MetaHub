import React, { useEffect, useState, FC } from 'react';
import { Clipboard, Sparkles, ChevronDown } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { type IndexedImage, type BaseMetadata } from '../types';
import { useCopyToA1111 } from '../hooks/useCopyToA1111';
import { useGenerateWithA1111 } from '../hooks/useGenerateWithA1111';

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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const { copyToA1111, isCopying, copyStatus } = useCopyToA1111();
  const { generateWithA1111, isGenerating, generateStatus } = useGenerateWithA1111();

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

            {/* A1111 Actions - Split Button */}
            <div className="mt-4 space-y-2 relative">
              <div className="flex gap-1">
                {/* Primary action: Copy to A1111 */}
                <button
                  onClick={() => copyToA1111(previewImage)}
                  disabled={isCopying || !nMeta.prompt}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded-l-md text-sm font-medium flex items-center justify-center gap-2 transition-all duration-200"
                >
                  {isCopying ? (
                    <>
                      {/* Spinner Animation */}
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Copying...</span>
                    </>
                  ) : (
                    <>
                      <Clipboard className="w-4 h-4" />
                      <span>Copy to A1111</span>
                    </>
                  )}
                </button>

                {/* Dropdown trigger */}
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  disabled={!nMeta.prompt}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-2 rounded-r-md transition-all duration-200 border-l border-blue-500"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              {/* Dropdown menu */}
              {isDropdownOpen && (
                <div className="absolute right-0 mt-1 w-full bg-gray-800 border border-gray-700 rounded-md shadow-lg z-50">
                  <button
                    onClick={() => {
                      generateWithA1111(previewImage);
                      setIsDropdownOpen(false);
                    }}
                    disabled={isGenerating || !nMeta.prompt}
                    className="w-full px-4 py-2 text-sm font-medium text-left hover:bg-gray-700 disabled:bg-gray-800 disabled:cursor-not-allowed flex items-center gap-2 rounded-md transition-colors"
                  >
                    {isGenerating ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Quick Generate</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Status messages */}
              {(copyStatus || generateStatus) && (
                <div className={`p-2 rounded text-xs ${
                  (copyStatus?.success || generateStatus?.success)
                    ? 'bg-green-900/50 border border-green-700 text-green-300'
                    : 'bg-red-900/50 border border-red-700 text-red-300'
                }`}>
                  {copyStatus?.message || generateStatus?.message}
                </div>
              )}
            </div>
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
