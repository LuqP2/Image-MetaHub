import React, { useEffect, useState, FC, useCallback } from 'react';
import { type IndexedImage, type BaseMetadata } from '../types';
import { FileOperations } from '../services/fileOperations';
import { copyImageToClipboard, showInExplorer } from '../utils/imageUtils';
import { Copy, Pencil, Trash2, ChevronDown, ChevronRight, Folder, Download } from 'lucide-react';

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
  isIndexing?: boolean;
}

// Helper component for consistently rendering metadata items
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
                <Copy className="w-4 h-4" />
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


const ImageModal: React.FC<ImageModalProps> = ({
  image,
  onClose,
  onImageDeleted,
  onImageRenamed,
  currentIndex = 0,
  totalImages = 0,
  onNavigateNext,
  onNavigatePrevious,
  directoryPath,
  isIndexing = false
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(image.name.replace(/\.(png|jpg|jpeg)$/i, ''));
  const [showRawMetadata, setShowRawMetadata] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const [showDetails, setShowDetails] = useState(true);

  // Full screen toggle - calls Electron API for actual fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (window.electronAPI?.toggleFullscreen) {
      const result = await window.electronAPI.toggleFullscreen();
      if (result.success) {
        setIsFullscreen(result.isFullscreen);
      }
    }
  }, []);

  // Listen for fullscreen changes from Electron
  useEffect(() => {
    // Listen for fullscreen-changed events from Electron (when user presses F11 or uses menu)
    const unsubscribeFullscreenChanged = window.electronAPI?.onFullscreenChanged?.((data) => {
      setIsFullscreen(data.isFullscreen);
    });

    // Listen for fullscreen-state-check events (periodic check for state changes)
    const unsubscribeFullscreenStateCheck = window.electronAPI?.onFullscreenStateCheck?.((data) => {
      setIsFullscreen(data.isFullscreen);
    });

    return () => {
      unsubscribeFullscreenChanged?.();
      unsubscribeFullscreenStateCheck?.();
    };
  }, []);

  // Initialize fullscreen mode from sessionStorage (backward compatibility)
  useEffect(() => {
    const shouldStartFullscreen = sessionStorage.getItem('openImageFullscreen') === 'true';
    if (shouldStartFullscreen) {
      sessionStorage.removeItem('openImageFullscreen');
      setTimeout(() => {
        if (window.electronAPI?.toggleFullscreen) {
          window.electronAPI.toggleFullscreen().then((result) => {
            if (result?.success) {
              setIsFullscreen(result.isFullscreen);
            }
          });
        }
      }, 100);
    }
  }, []);

  const nMeta: BaseMetadata | undefined = image.metadata?.normalizedMetadata;

  const copyToClipboard = (text: string, type: string) => {
    if(!text) {
        alert(`No ${type} to copy.`);
        return;
    }
    navigator.clipboard.writeText(text).then(() => {
      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      notification.textContent = `${type} copied to clipboard!`;
      document.body.appendChild(notification);
      setTimeout(() => document.body.removeChild(notification), 2000);
    }).catch(err => {
      console.error(`Failed to copy ${type}:`, err);
      alert(`Failed to copy ${type}.`);
    });
  };

  const copyToClipboardElectron = async (text: string, type: string) => {
    if (!text) {
      alert(`No ${type} to copy.`);
      return;
    }

    try {
      // Usar navigator.clipboard (funciona tanto no Electron quanto no browser)
      await navigator.clipboard.writeText(text);

      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      notification.textContent = `${type} copied to clipboard!`;
      document.body.appendChild(notification);
      setTimeout(() => document.body.removeChild(notification), 2000);
    } catch (err) {
      console.error(`Failed to copy ${type}:`, err);
      alert(`Failed to copy ${type}.`);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      visible: true
    });
  };

  const hideContextMenu = () => {
    setContextMenu({ x: 0, y: 0, visible: false });
  };

  const copyPrompt = () => {
    copyToClipboardElectron(nMeta?.prompt || '', 'Prompt');
    hideContextMenu();
  };

  const copyNegativePrompt = () => {
    copyToClipboardElectron(nMeta?.negativePrompt || '', 'Negative Prompt');
    hideContextMenu();
  };

  const copySeed = () => {
    copyToClipboardElectron(String(nMeta?.seed || ''), 'Seed');
    hideContextMenu();
  };

  const copyImage = async () => {
    hideContextMenu();
    const result = await copyImageToClipboard(image);
    if (result.success) {
      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50';
      notification.textContent = 'Image copied to clipboard!';
      document.body.appendChild(notification);
      setTimeout(() => document.body.removeChild(notification), 2000);
    } else {
      alert(`Failed to copy image to clipboard: ${result.error}`);
    }
  };

  const copyModel = () => {
    copyToClipboardElectron(nMeta?.model || '', 'Model');
    hideContextMenu();
  };

  const showInFolder = () => {
    hideContextMenu();
    if (!directoryPath) {
      alert('Cannot determine file location: directory path is missing.');
      return;
    }
    // The showInExplorer utility can handle the full path directly
    showInExplorer(`${directoryPath}/${image.name}`);
  };

  const exportImage = async () => {
    hideContextMenu();
    
    if (!window.electronAPI) {
      alert('Export feature is only available in the desktop app version.');
      return;
    }
    
    if (!directoryPath) {
      alert('Cannot export image: source directory path is missing.');
      return;
    }

    try {
      // 1. Ask user for destination directory
      const destResult = await window.electronAPI.showDirectoryDialog();
      if (destResult.canceled || !destResult.path) {
        return; // User cancelled
      }
      const destDir = destResult.path;
      // Get safe paths using joinPaths
      const sourcePathResult = await window.electronAPI.joinPaths(directoryPath, image.name);
      if (!sourcePathResult.success || !sourcePathResult.path) {
        throw new Error(`Failed to construct source path: ${sourcePathResult.error}`);
      }
      const destPathResult = await window.electronAPI.joinPaths(destDir, image.name);
      if (!destPathResult.success || !destPathResult.path) {
        throw new Error(`Failed to construct destination path: ${destPathResult.error}`);
      }

      const sourcePath = sourcePathResult.path;
      const destPath = destPathResult.path;

      // 2. Read the source file
      const readResult = await window.electronAPI.readFile(sourcePath);
      if (!readResult.success || !readResult.data) {
        alert(`Failed to read original file: ${readResult.error}`);
        return;
      }

      // 3. Write the new file
      const writeResult = await window.electronAPI.writeFile(destPath, readResult.data);
      if (!writeResult.success) {
        alert(`Failed to export image: ${writeResult.error}`);
        return;
      }

      // 4. Success!
      alert(`Image exported successfully to: ${destPath}`);

    } catch (error) {
      console.error('Export error:', error);
      alert(`An unexpected error occurred during export: ${error.message}`);
    }
  };

  useEffect(() => {
    let isMounted = true;
    let currentUrl: string | null = null;
    // Reset imageUrl whenever the image prop changes
    setImageUrl(null);

    const loadImage = async () => {
      if (!isMounted) return;

      // Validate directoryPath before attempting to load (prevents recursion)
      if (!directoryPath && window.electronAPI) {
        console.error('Cannot load image: directoryPath is undefined');
        if (isMounted) {
          setImageUrl(null);
          alert('Failed to load image: Directory path is not available.');
        }
        return;
      }

      try {
        // Primary method: Use thumbnail if available, otherwise full image
        const fileHandle = image.thumbnailHandle || image.handle;

        if (fileHandle && typeof fileHandle.getFile === 'function') {
          const file = await fileHandle.getFile();
          if (isMounted) {
            currentUrl = URL.createObjectURL(file);
            setImageUrl(currentUrl);
          }
          return; // Success, no need for fallback
        }
        throw new Error('Image handle is not a valid FileSystemFileHandle.');
      } catch (handleError) {
        // Fallback method: Use Electron API if available
        console.warn(`Could not load image with FileSystemFileHandle: ${handleError.message}. Attempting Electron fallback.`);
        if (isMounted && window.electronAPI && directoryPath) {
          try {
            const pathResult = await window.electronAPI.joinPaths(directoryPath, image.name);
            if (!pathResult.success || !pathResult.path) {
              throw new Error(pathResult.error || 'Failed to construct image path.');
            }
            const fileResult = await window.electronAPI.readFile(pathResult.path);
            if (fileResult.success && fileResult.data && isMounted) {
              // fileResult.data is expected to be a base64 string or Uint8Array
              let dataUrl: string;
              if (typeof fileResult.data === 'string') {
                // Assume base64 string
                const ext = image.name.toLowerCase().endsWith('.jpg') || image.name.toLowerCase().endsWith('.jpeg')
                  ? 'jpeg'
                  : 'png';
                dataUrl = `data:image/${ext};base64,${fileResult.data}`;
              } else if (fileResult.data instanceof Uint8Array) {
                // Convert Uint8Array to base64
                const binary = String.fromCharCode.apply(null, Array.from(fileResult.data));
                const base64 = btoa(binary);
                const ext = image.name.toLowerCase().endsWith('.jpg') || image.name.toLowerCase().endsWith('.jpeg')
                  ? 'jpeg'
                  : 'png';
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
            if (isMounted) {
              setImageUrl(null); // Explicitly set to null on failure
              alert(`Failed to load image: ${electronError.message}`);
            }
          }
        } else if (isMounted) {
            // If no fallback is available
            setImageUrl(null);
            alert(`Failed to load image: No valid file handle and not in a compatible Electron environment.`);
        }
      }
    };

    loadImage();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isRenaming) return;

      // Alt+Enter = Toggle fullscreen (works in both grid and modal)
      if (event.key === 'Enter' && event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        toggleFullscreen();
        return;
      }

      // Escape = Exit fullscreen first, then close modal
      if (event.key === 'Escape') {
        if (isFullscreen) {
          // Call toggleFullscreen to actually exit Electron fullscreen
          toggleFullscreen();
        } else {
          onClose();
        }
        return;
      }

      if (event.key === 'ArrowLeft') onNavigatePrevious?.();
      if (event.key === 'ArrowRight') onNavigateNext?.();
    };

    const handleClickOutside = () => {
      hideContextMenu();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleClickOutside);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClickOutside);
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
      isMounted = false;
    };
  }, [image, onClose, isRenaming, isFullscreen, onNavigatePrevious, onNavigateNext, directoryPath, toggleFullscreen]);

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
      className={`fixed inset-0 ${isFullscreen ? 'bg-black' : 'bg-black/80'} flex items-center justify-center z-50 ${isFullscreen ? '' : 'backdrop-blur-sm'} ${isFullscreen ? 'p-0' : ''}`}
      onClick={onClose}
    >
      <div
        className={`${isFullscreen ? 'w-full h-full' : 'bg-gray-800 rounded-lg shadow-2xl w-full max-w-6xl h-full max-h-[90vh]'} flex flex-col md:flex-row overflow-hidden`}
        onClick={(e) => {
          e.stopPropagation();
          hideContextMenu();
        }}
      >
        {/* Image Display Section */}
        <div className={`w-full ${isFullscreen ? 'h-full' : 'md:w-2/3 h-1/2 md:h-full'} bg-black flex items-center justify-center ${isFullscreen ? 'p-0' : 'p-4'} relative group`}>
          {imageUrl ? <img src={imageUrl} alt={image.name} className="max-w-full max-h-full object-contain" onContextMenu={handleContextMenu} /> : <div className="w-full h-full animate-pulse bg-gray-700 rounded-md"></div>}

          {onNavigatePrevious && <button onClick={onNavigatePrevious} className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-black/50 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">←</button>}
          {onNavigateNext && <button onClick={onNavigateNext} className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black/50 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">→</button>}

          <div className="absolute top-4 left-4 bg-black/60 text-white px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm border border-white/20">
            {currentIndex + 1} / {totalImages}
          </div>
          <button onClick={toggleFullscreen} className="absolute top-4 right-4 bg-black/60 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">{isFullscreen ? 'Exit' : 'Fullscreen'}</button>
        </div>

        {/* Metadata Panel */}
        <div className={`w-full ${isFullscreen ? 'hidden' : 'md:w-1/3 h-1/2 md:h-full'} p-6 overflow-y-auto space-y-4`}>
          <div>
            {isRenaming ? (
              <div className="flex gap-2">
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="bg-gray-900 text-white border border-gray-600 rounded-lg px-2 py-1 w-full" autoFocus onKeyDown={e => e.key === 'Enter' && confirmRename()}/>
                <button onClick={confirmRename} className="bg-green-600 text-white px-3 py-1 rounded-lg">Save</button>
                <button onClick={() => setIsRenaming(false)} className="bg-gray-600 text-white px-3 py-1 rounded-lg">Cancel</button>
              </div>
            ) : (
              <h2 className="text-xl font-bold text-gray-100 break-all flex items-center gap-2">
                {image.name}
                <button 
                  onClick={() => setIsRenaming(true)} 
                  disabled={isIndexing}
                  className={`p-1 ${isIndexing ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-orange-400'}`}
                  title={isIndexing ? "Cannot rename during indexing" : "Rename image"}
                >
                  <Pencil size={16} />
                </button>
                <button 
                  onClick={handleDelete} 
                  disabled={isIndexing}
                  className={`p-1 ${isIndexing ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-red-400'}`}
                  title={isIndexing ? "Cannot delete during indexing" : "Delete image"}
                >
                  <Trash2 size={16} />
                </button>
              </h2>
            )}
            <p className="text-xs text-blue-400 font-mono break-all">{new Date(image.lastModified).toLocaleString()}</p>
          </div>

          {nMeta ? (
            <div className="space-y-4">
              {/* Prompt Section - Always Visible */}
              <div className="space-y-3">
                <MetadataItem label="Prompt" value={nMeta.prompt} isPrompt onCopy={(v) => copyToClipboard(v, "Prompt")} />
                <MetadataItem label="Negative Prompt" value={nMeta.negativePrompt} isPrompt onCopy={(v) => copyToClipboard(v, "Negative Prompt")} />
              </div>

              {/* Details Section - Collapsible */}
              <div>
                <button 
                  onClick={() => setShowDetails(!showDetails)} 
                  className="text-gray-300 text-sm w-full text-left py-2 border-t border-gray-700 flex items-center justify-between hover:text-white transition-colors"
                >
                  <span className="font-semibold">Generation Details</span>
                  {showDetails ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                {showDetails && (
                  <div className="space-y-3 mt-3">
                    <MetadataItem label="Model" value={nMeta.model} onCopy={(v) => copyToClipboard(v, "Model")} />
                    {nMeta.generator && (
                      <MetadataItem label="Generator" value={nMeta.generator} />
                    )}
                    {nMeta.loras && nMeta.loras.length > 0 && (
                      <MetadataItem label="LoRAs" value={nMeta.loras.map((lora: any) => typeof lora === 'string' ? lora : lora.model_name || 'Unknown LoRA').join(', ')} />
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <MetadataItem label="Steps" value={nMeta.steps} />
                      <MetadataItem label="CFG Scale" value={nMeta.cfgScale} />
                      <MetadataItem label="Seed" value={nMeta.seed} />
                      <MetadataItem label="Sampler" value={nMeta.sampler} />
                      <MetadataItem label="Scheduler" value={nMeta.scheduler} />
                      <MetadataItem label="Dimensions" value={nMeta.width && nMeta.height ? `${nMeta.width}×${nMeta.height}` : undefined} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-yellow-900/50 border border-yellow-700 text-yellow-300 px-4 py-3 rounded-lg text-sm">
                No normalized metadata available.
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button onClick={() => copyToClipboard(nMeta?.prompt || '', 'Prompt')} className="bg-accent hover:bg-blue-700 text-white px-3 py-1 rounded-lg text-xs font-medium transition-all duration-200 hover:shadow-lg hover:shadow-accent/30">Copy Prompt</button>
            <button onClick={() => copyToClipboard(JSON.stringify(image.metadata, null, 2), 'Raw Metadata')} className="bg-accent hover:bg-blue-700 text-white px-3 py-1 rounded-lg text-xs font-medium transition-all duration-200 hover:shadow-lg hover:shadow-accent/30">Copy Raw Metadata</button>
            <button onClick={async () => {
              if (!directoryPath) {
                alert('Cannot determine file location: directory path is missing.');
                return;
              }
              await showInExplorer(`${directoryPath}/${image.name}`);
            }} className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded-lg text-xs font-medium transition-colors">Show in Folder</button>
          </div>

          <div>
            <button onClick={() => setShowRawMetadata(!showRawMetadata)} className="text-gray-400 text-sm w-full text-left mt-4 py-1 border-t border-gray-700 flex items-center gap-1">
              {showRawMetadata ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Raw Metadata
            </button>
            {showRawMetadata && (
              <pre className="bg-black/50 p-2 rounded-lg text-xs text-gray-300 whitespace-pre-wrap break-all max-h-64 overflow-y-auto mt-2">
                {JSON.stringify(image.metadata, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className="fixed z-[60] bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={copyImage}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
          >
            <Copy className="w-4 h-4" />
            Copy to Clipboard
          </button>
          
          <div className="border-t border-gray-600 my-1"></div>
          
          <button
            onClick={copyPrompt}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!nMeta?.prompt}
          >
            <Copy className="w-4 h-4" />
            Copy Prompt
          </button>
          <button
            onClick={copyNegativePrompt}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!nMeta?.negativePrompt}
          >
            <Copy className="w-4 h-4" />
            Copy Negative Prompt
          </button>
          <button
            onClick={copySeed}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!nMeta?.seed}
          >
            <Copy className="w-4 h-4" />
            Copy Seed
          </button>
          <button
            onClick={copyModel}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
            disabled={!nMeta?.model}
          >
            <Copy className="w-4 h-4" />
            Copy Model
          </button>
          
          <div className="border-t border-gray-600 my-1"></div>
          
          <button
            onClick={showInFolder}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
          >
            <Folder className="w-4 h-4" />
            Show in Folder
          </button>
          
          <button
            onClick={exportImage}
            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export Image
          </button>
        </div>
      )}
    </div>
  );
};

// Wrap with React.memo to prevent re-renders during Phase B metadata updates
// Custom comparator: only compare image.id, onClose, and isIndexing
// This prevents flickering when the image object reference changes but the ID stays the same
export default React.memo(ImageModal, (prevProps, nextProps) => {
  // Return true if props are EQUAL (skip re-render)
  // Return false if props are DIFFERENT (re-render)

  const propsEqual =
    prevProps.image.id === nextProps.image.id &&
    prevProps.onClose === nextProps.onClose &&
    prevProps.onImageDeleted === nextProps.onImageDeleted &&
    prevProps.onImageRenamed === nextProps.onImageRenamed &&
    prevProps.currentIndex === nextProps.currentIndex &&
    prevProps.totalImages === nextProps.totalImages &&
    prevProps.onNavigateNext === nextProps.onNavigateNext &&
    prevProps.onNavigatePrevious === nextProps.onNavigatePrevious &&
    prevProps.directoryPath === nextProps.directoryPath &&
    prevProps.isIndexing === nextProps.isIndexing;

  return propsEqual; // true = skip re-render, false = re-render
});