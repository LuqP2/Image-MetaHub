import React, { useEffect, useState, FC, useCallback } from 'react';
import { type IndexedImage, type BaseMetadata, type LoRAInfo } from '../types';
import { FileOperations } from '../services/fileOperations';
import { copyImageToClipboard, showInExplorer } from '../utils/imageUtils';
import { Copy, Pencil, Trash2, ChevronDown, ChevronRight, Folder, Download, Clipboard, Sparkles, GitCompare, Star, X, Zap, CheckCircle, ArrowUp } from 'lucide-react';
import { useCopyToA1111 } from '../hooks/useCopyToA1111';
import { useGenerateWithA1111 } from '../hooks/useGenerateWithA1111';
import { useCopyToComfyUI } from '../hooks/useCopyToComfyUI';
import { useGenerateWithComfyUI } from '../hooks/useGenerateWithComfyUI';
import { useImageComparison } from '../hooks/useImageComparison';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { A1111GenerateModal, type GenerationParams as A1111GenerationParams } from './A1111GenerateModal';
import { ComfyUIGenerateModal, type GenerationParams as ComfyUIGenerationParams } from './ComfyUIGenerateModal';
import ProBadge from './ProBadge';
import hotkeyManager from '../services/hotkeyManager';
import { useImageStore } from '../store/useImageStore';
import { hasVerifiedTelemetry } from '../utils/telemetryDetection';

const TAG_SUGGESTION_LIMIT = 5;

const buildTagSuggestions = (
  recentTags: string[],
  availableTags: { name: string }[],
  currentTags: string[],
): string[] => {
  const suggestions: string[] = [];

  for (const tag of recentTags) {
    if (!currentTags.includes(tag) && !suggestions.includes(tag)) {
      suggestions.push(tag);
      if (suggestions.length >= TAG_SUGGESTION_LIMIT) {
        return suggestions;
      }
    }
  }

  for (const tag of availableTags) {
    if (!currentTags.includes(tag.name) && !suggestions.includes(tag.name)) {
      suggestions.push(tag.name);
      if (suggestions.length >= TAG_SUGGESTION_LIMIT) {
        break;
      }
    }
  }

  return suggestions;
};

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

// Helper function to format LoRA with weight
const formatLoRA = (lora: string | LoRAInfo): string => {
  if (typeof lora === 'string') {
    return lora;
  }

  const name = lora.name || lora.model_name || 'Unknown LoRA';
  const weight = lora.weight ?? lora.model_weight;

  if (weight !== undefined && weight !== null) {
    return `${name} (${weight})`;
  }

  return name;
};

// Format generation time: 87ms, 1.5s, or 2m 15s
const formatGenerationTime = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

// Format VRAM: "8.0 GB / 24 GB (33%)" or "8.0 GB"
const formatVRAM = (vramMb: number, gpuDevice?: string | null): string => {
  const vramGb = vramMb / 1024;

  // Known GPU VRAM mappings
  const gpuVramMap: Record<string, number> = {
    '4090': 24, '3090': 24, '3080': 10, '3070': 8, '3060': 12,
    'A100': 40, 'A6000': 48, 'V100': 16,
  };

  let totalVramGb: number | null = null;
  if (gpuDevice) {
    for (const [model, vram] of Object.entries(gpuVramMap)) {
      if (gpuDevice.includes(model)) {
        totalVramGb = vram;
        break;
      }
    }
  }

  if (totalVramGb !== null && vramGb <= totalVramGb) {
    const percentage = ((vramGb / totalVramGb) * 100).toFixed(0);
    return `${vramGb.toFixed(1)} GB / ${totalVramGb} GB (${percentage}%)`;
  }

  return `${vramGb.toFixed(1)} GB`;
};

const resolveImageMimeType = (fileName: string): string => {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  return 'image/png';
};

const createImageUrlFromFileData = (data: unknown, fileName: string): { url: string; revoke: boolean } => {
  const mimeType = resolveImageMimeType(fileName);

  if (typeof data === 'string') {
    return { url: `data:${mimeType};base64,${data}`, revoke: false };
  }

  if (data instanceof ArrayBuffer) {
    const blob = new Blob([data], { type: mimeType });
    return { url: URL.createObjectURL(blob), revoke: true };
  }

  if (ArrayBuffer.isView(data)) {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const blob = new Blob([view], { type: mimeType });
    return { url: URL.createObjectURL(blob), revoke: true };
  }

  if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as { data: unknown }).data)) {
    const view = new Uint8Array((data as { data: number[] }).data);
    const blob = new Blob([view], { type: mimeType });
    return { url: URL.createObjectURL(blob), revoke: true };
  }

  throw new Error('Unknown file data format.');
};

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
  const [newName, setNewName] = useState(image.name.replace(/\.(png|jpg|jpeg|webp)$/i, ''));
  const [showRawMetadata, setShowRawMetadata] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const [showDetails, setShowDetails] = useState(true);
  const [showPerformance, setShowPerformance] = useState(true);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isComfyUIGenerateModalOpen, setIsComfyUIGenerateModalOpen] = useState(false);

  // Zoom and pan states
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // A1111 integration hooks
  const { copyToA1111, isCopying, copyStatus } = useCopyToA1111();
  const { generateWithA1111, isGenerating, generateStatus } = useGenerateWithA1111();

  // ComfyUI integration hooks
  const { copyToComfyUI, isCopying: isCopyingComfyUI, copyStatus: copyStatusComfyUI } = useCopyToComfyUI();
  const { generateWithComfyUI, isGenerating: isGeneratingComfyUI, generateStatus: generateStatusComfyUI } = useGenerateWithComfyUI();

  // Image comparison hook
  const { addImage, comparisonCount } = useImageComparison();

  // Feature access (license/trial gating)
  const { canUseA1111, canUseComfyUI, canUseComparison, showProModal, initialized } = useFeatureAccess();

  // Annotations hooks
  const toggleFavorite = useImageStore((state) => state.toggleFavorite);
  const addTagToImage = useImageStore((state) => state.addTagToImage);
  const removeTagFromImage = useImageStore((state) => state.removeTagFromImage);
  const removeAutoTagFromImage = useImageStore((state) => state.removeAutoTagFromImage);
  const availableTags = useImageStore((state) => state.availableTags);
  const recentTags = useImageStore((state) => state.recentTags);

  // Get live tags and favorite status from store instead of props
  const imageFromStore = useImageStore((state) =>
    state.images.find(img => img.id === image.id) ||
    state.filteredImages.find(img => img.id === image.id)
  );
  const currentTags = imageFromStore?.tags || image.tags || [];
  const currentAutoTags = imageFromStore?.autoTags || image.autoTags || [];
  const currentIsFavorite = imageFromStore?.isFavorite ?? image.isFavorite ?? false;
  const preferredThumbnailUrl = imageFromStore?.thumbnailUrl ?? image.thumbnailUrl;
  const tagSuggestions = buildTagSuggestions(recentTags, availableTags, currentTags);

  // State for tag input
  const [tagInput, setTagInput] = useState('');
  const [showTagAutocomplete, setShowTagAutocomplete] = useState(false);

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

  // Reset zoom and pan when image changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [image.id]);

  // Reset zoom and pan when entering/exiting fullscreen
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [isFullscreen]);

  // Zoom handlers
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    const delta = e.deltaY * -0.01;
    const newZoom = Math.min(Math.max(1, zoom + delta), 5); // Min 1x, Max 5x

    setZoom(newZoom);

    // Reset pan if zooming out to 1x
    if (newZoom === 1) {
      setPan({ x: 0, y: 0 });
    }
  }, [zoom]);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom > 1 && e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    }
  }, [zoom, pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  }, [isDragging, dragStart, zoom]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.5, 5));
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(zoom - 0.5, 1);
    setZoom(newZoom);
    if (newZoom === 1) {
      setPan({ x: 0, y: 0 });
    }
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    let isMounted = true;
    let createdUrl: string | null = null;
    const hasPreview = Boolean(preferredThumbnailUrl);

    setImageUrl(preferredThumbnailUrl ?? null);

    const loadImage = async () => {
      if (!isMounted) return;

      // Validate directoryPath before attempting to load (prevents recursion)
      if (!directoryPath && window.electronAPI) {
        console.error('Cannot load image: directoryPath is undefined');
        if (isMounted && !hasPreview) {
          setImageUrl(null);
          alert('Failed to load image: Directory path is not available.');
        }
        return;
      }

      const setResolvedUrl = (url: string, revoke: boolean) => {
        if (!isMounted) return;
        if (createdUrl) {
          URL.revokeObjectURL(createdUrl);
          createdUrl = null;
        }
        if (revoke) {
          createdUrl = url;
        }
        setImageUrl(url);
      };

      try {
        const primaryHandle = image.handle;
        const fallbackHandle = image.thumbnailHandle;
        const fileHandle =
          primaryHandle && typeof primaryHandle.getFile === 'function'
            ? primaryHandle
            : fallbackHandle && typeof fallbackHandle.getFile === 'function'
              ? fallbackHandle
              : null;

        if (fileHandle) {
          const file = await fileHandle.getFile();
          if (isMounted) {
            const url = URL.createObjectURL(file);
            setResolvedUrl(url, true);
          }
          return; // Success, no need for fallback
        }
        throw new Error('Image handle is not a valid FileSystemFileHandle.');
      } catch (handleError) {
        const message = handleError instanceof Error ? handleError.message : String(handleError);
        console.warn(`Could not load image with FileSystemFileHandle: ${message}. Attempting Electron fallback.`);
        if (isMounted && window.electronAPI && directoryPath) {
          try {
            const pathResult = await window.electronAPI.joinPaths(directoryPath, image.name);
            if (!pathResult.success || !pathResult.path) {
              throw new Error(pathResult.error || 'Failed to construct image path.');
            }
            const fileResult = await window.electronAPI.readFile(pathResult.path);
            if (fileResult.success && fileResult.data && isMounted) {
              const { url, revoke } = createImageUrlFromFileData(fileResult.data, image.name);
              setResolvedUrl(url, revoke);
            } else {
              throw new Error(fileResult.error || 'Failed to read file via Electron API.');
            }
          } catch (electronError) {
            console.error('Electron fallback failed:', electronError);
            if (isMounted && !hasPreview) {
              setImageUrl(null); // Explicitly set to null on failure
              const errorMessage = electronError instanceof Error ? electronError.message : String(electronError);
              alert(`Failed to load image: ${errorMessage}`);
            }
          }
        } else if (isMounted && !hasPreview) {
          // If no fallback is available
          setImageUrl(null);
          alert('Failed to load image: No valid file handle and not in a compatible Electron environment.');
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [image.id, image.handle, image.thumbnailHandle, image.name, directoryPath, preferredThumbnailUrl]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't handle navigation keys if hotkeys are paused (e.g., GenerateModal is open)
      if (hotkeyManager.areHotkeysPaused()) {
        return;
      }

      if (isRenaming) return;

      // Alt+Enter = Toggle fullscreen (works in both grid and modal)
      if (event.key === 'Enter' && event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        toggleFullscreen(); // Toggle fullscreen ON/OFF
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
    };
  }, [hideContextMenu, isFullscreen, isRenaming, onClose, onNavigateNext, onNavigatePrevious, toggleFullscreen]);

  // Separate effect for wheel event listener to avoid image reloading on zoom changes
  useEffect(() => {
    const imageContainer = document.getElementById('image-zoom-container');
    if (imageContainer) {
      imageContainer.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      if (imageContainer) {
        imageContainer.removeEventListener('wheel', handleWheel);
      }
    };
  }, [handleWheel]);

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

  // Tag management handlers
  const handleAddTag = () => {
    if (!tagInput.trim()) return;
    addTagToImage(image.id, tagInput);
    setTagInput('');
    setShowTagAutocomplete(false);
  };

  const handleRemoveTag = (tag: string) => {
    removeTagFromImage(image.id, tag);
  };

  const handleRemoveAutoTag = (tag: string) => {
    removeAutoTagFromImage(image.id, tag);
  };

  const handlePromoteAutoTag = async (tag: string) => {
    // Add as manual tag and remove from auto-tags
    await addTagToImage(image.id, tag);
    removeAutoTagFromImage(image.id, tag);
  };

  const handleToggleFavorite = () => {
    toggleFavorite(image.id);
  };

  // Filter autocomplete tags
  const autocompleteOptions = tagInput
    ? availableTags
        .filter(tag =>
          tag.name.includes(tagInput.toLowerCase()) &&
          !currentTags.includes(tag.name)
        )
        .slice(0, 5)
    : [];

  return (
    <div
      className={`fixed inset-0 ${isFullscreen ? 'bg-black' : 'bg-black/80'} flex items-center justify-center z-50 ${isFullscreen ? '' : 'backdrop-blur-sm'} ${isFullscreen ? 'p-0' : ''}`}
      onClick={onClose}
    >
      <div
        className={`${isFullscreen ? 'w-full h-full' : 'bg-gray-800 rounded-lg shadow-2xl w-full max-w-7xl h-full max-h-[95vh]'} flex flex-col md:flex-row overflow-hidden`}
        onClick={(e) => {
          e.stopPropagation();
          hideContextMenu();
        }}
      >
        {/* Image Display Section */}
        <div
          id="image-zoom-container"
          className={`w-full ${isFullscreen ? 'h-full' : 'md:w-3/4 h-1/2 md:h-full'} bg-black flex items-center justify-center ${isFullscreen ? 'p-0' : 'p-2'} relative group overflow-hidden`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={image.name}
              className="max-w-full max-h-full object-contain select-none"
              onContextMenu={handleContextMenu}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
              }}
              draggable={false}
            />
          ) : (
            <div className="w-full h-full animate-pulse bg-gray-700 rounded-md"></div>
          )}

          {onNavigatePrevious && <button onClick={onNavigatePrevious} className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-black/50 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">←</button>}
          {onNavigateNext && <button onClick={onNavigateNext} className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black/50 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">→</button>}

          <div className="absolute top-4 left-4 bg-black/60 text-white px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm border border-white/20">
            {currentIndex + 1} / {totalImages}
          </div>

          {/* Zoom Controls */}
          <div className="absolute bottom-4 left-4 flex flex-col gap-2 bg-black/60 rounded-lg p-2 backdrop-blur-sm border border-white/20 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleZoomIn}
              disabled={zoom >= 5}
              className="text-white p-2 hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="Zoom In"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <div className="text-white text-xs text-center font-mono">{Math.round(zoom * 100)}%</div>
            <button
              onClick={handleZoomOut}
              disabled={zoom <= 1}
              className="text-white p-2 hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="Zoom Out"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <button
              onClick={handleResetZoom}
              disabled={zoom <= 1}
              className="text-white p-2 hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-all text-xs"
              title="Reset Zoom"
            >
              Reset
            </button>
          </div>

          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button onClick={toggleFullscreen} className="bg-black/60 text-white rounded-full px-3 py-2 text-sm opacity-0 group-hover:opacity-100 transition-opacity">
              {isFullscreen ? 'Exit' : 'Fullscreen'}
            </button>
            <button
              onClick={onClose}
              className="bg-black/60 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Close image"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Metadata Panel */}
        <div className={`w-full ${isFullscreen ? 'hidden' : 'md:w-1/4 h-1/2 md:h-full'} p-6 overflow-y-auto space-y-4`}>
          <div>
            {isRenaming ? (
              <div className="flex gap-2">
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="bg-gray-900 text-white border border-gray-600 rounded-lg px-2 py-1 w-full" autoFocus onKeyDown={e => e.key === 'Enter' && confirmRename()}/>
                <button onClick={confirmRename} className="bg-green-600 text-white px-3 py-1 rounded-lg">Save</button>
                <button onClick={() => setIsRenaming(false)} className="bg-gray-600 text-white px-3 py-1 rounded-lg">Cancel</button>
              </div>
            ) : (
              <h2 className="text-xl font-bold text-gray-100 break-all flex items-center gap-2 flex-wrap">
                <span className="break-all">{image.name}</span>
                {hasVerifiedTelemetry(image) && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-400 border border-green-500/30 shadow-sm shadow-green-500/20"
                    title="Verified Telemetry - Generated with MetaHub Save Node. Includes accurate performance metrics: generation time, VRAM usage, GPU device, and software versions."
                  >
                    <CheckCircle size={14} className="flex-shrink-0" />
                    <span className="whitespace-nowrap">Verified Telemetry</span>
                  </span>
                )}
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

          {/* Annotations Section */}
          <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700/50 space-y-2">
            {/* Favorite and Tags Row */}
            <div className="flex items-start gap-3">
              {/* Favorite Star - Discrete */}
              <button
                onClick={handleToggleFavorite}
                className={`p-1.5 rounded transition-all ${
                  currentIsFavorite
                    ? 'text-yellow-400 hover:text-yellow-300'
                    : 'text-gray-500 hover:text-yellow-400'
                }`}
                title={currentIsFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star className={`w-5 h-5 ${currentIsFavorite ? 'fill-current' : ''}`} />
              </button>

              {/* Tags Pills */}
              <div className="flex-1 space-y-2">
                {/* Current Tags */}
                {currentTags && currentTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {currentTags.map(tag => (
                      <button
                        key={tag}
                        onClick={() => handleRemoveTag(tag)}
                        className="flex items-center gap-1 bg-blue-600/20 border border-blue-500/50 text-blue-300 px-2 py-0.5 rounded-full text-xs hover:bg-red-600/20 hover:border-red-500/50 hover:text-red-300 transition-all"
                        title="Click to remove"
                      >
                        {tag}
                        <X size={12} />
                      </button>
                    ))}
                  </div>
                )}

                {/* Add Tag Input */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Add tag..."
                    value={tagInput}
                    onChange={(e) => {
                      setTagInput(e.target.value);
                      setShowTagAutocomplete(e.target.value.length > 0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTag();
                      }
                      if (e.key === 'Escape') {
                        setTagInput('');
                        setShowTagAutocomplete(false);
                      }
                    }}
                    onFocus={() => tagInput && setShowTagAutocomplete(true)}
                    onBlur={() => setTimeout(() => setShowTagAutocomplete(false), 200)}
                    className="w-full bg-gray-700/50 text-gray-200 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
                  />

                  {/* Autocomplete Dropdown */}
                  {showTagAutocomplete && autocompleteOptions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                      {autocompleteOptions.map(tag => (
                        <button
                          key={tag.name}
                          onClick={() => {
                            addTagToImage(image.id, tag.name);
                            setTagInput('');
                            setShowTagAutocomplete(false);
                          }}
                          className="w-full text-left px-2 py-1.5 text-xs text-gray-200 hover:bg-gray-700 flex justify-between items-center"
                        >
                          <span>{tag.name}</span>
                          <span className="text-xs text-gray-500">({tag.count})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tag Suggestions */}
                {tagInput.trim().length === 0 && tagSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tagSuggestions.map(tag => (
                      <button
                        key={tag}
                        onClick={() => addTagToImage(image.id, tag)}
                        className="text-xs bg-gray-700/30 text-gray-400 px-1.5 py-0.5 rounded hover:bg-gray-600 hover:text-gray-200"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}

                {currentAutoTags && currentAutoTags.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-purple-300">Auto tags</p>
                    <div className="flex flex-wrap gap-1.5">
                      {currentAutoTags.map(tag => (
                        <div key={`auto-${tag}`} className="inline-flex items-center bg-purple-600/20 border border-purple-500/40 rounded-full overflow-hidden">
                          <button
                            onClick={() => handlePromoteAutoTag(tag)}
                            className="px-2 py-0.5 text-purple-300 hover:bg-blue-600/30 hover:text-blue-200 transition-all"
                            title="Promote to manual tag"
                          >
                            <ArrowUp size={12} />
                          </button>
                          <span className="text-purple-300 text-xs">{tag}</span>
                          <button
                            onClick={() => handleRemoveAutoTag(tag)}
                            className="px-2 py-0.5 text-purple-300 hover:bg-red-600/30 hover:text-red-200 transition-all"
                            title="Remove auto-tag"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* MetaHub Save Node Notes - Only if present */}
          {nMeta?.notes && (
            <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700/50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Notes (MetaHub Save Node)</span>
              </div>
              <pre className="text-gray-200 whitespace-pre-wrap break-words font-mono text-sm bg-gray-800/50 p-2 rounded">{nMeta.notes}</pre>
            </div>
          )}

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
                    {((nMeta as any).vae || (nMeta as any).vaes?.[0]?.name) && (
                      <MetadataItem label="VAE" value={(nMeta as any).vae || (nMeta as any).vaes?.[0]?.name} />
                    )}
                    {nMeta.loras && nMeta.loras.length > 0 && (
                      <MetadataItem label="LoRAs" value={nMeta.loras.map(formatLoRA).join(', ')} />
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <MetadataItem label="Steps" value={nMeta.steps} />
                      <MetadataItem label="CFG Scale" value={nMeta.cfgScale} />
                      <MetadataItem label="Seed" value={nMeta.seed} onCopy={(v) => copyToClipboard(v, "Seed")} />
                      <MetadataItem label="Sampler" value={nMeta.sampler} />
                      <MetadataItem label="Scheduler" value={nMeta.scheduler} />
                      <MetadataItem label="Dimensions" value={nMeta.width && nMeta.height ? `${nMeta.width}×${nMeta.height}` : undefined} />
                      {(nMeta as any).denoise != null && (nMeta as any).denoise < 1 && (
                        <MetadataItem label="Denoise" value={(nMeta as any).denoise} />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Performance Section - Collapsible */}
              {nMeta && nMeta._analytics && (
                <div>
                  <button
                    onClick={() => setShowPerformance(!showPerformance)}
                    className="text-gray-300 text-sm w-full text-left py-2 border-t border-gray-700 flex items-center justify-between hover:text-white transition-colors"
                  >
                    <span className="font-semibold flex items-center gap-2">
                      <Zap size={16} className="text-yellow-400" />
                      Performance
                    </span>
                    {showPerformance ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>

                  {showPerformance && (
                    <div className="space-y-3 mt-3">
                      {/* Tier 1: CRITICAL */}
                      <div className="grid grid-cols-2 gap-2">
                        {nMeta._analytics.generation_time_ms != null && nMeta._analytics.generation_time_ms > 0 && (
                          <MetadataItem
                            label="Generation Time"
                            value={formatGenerationTime(nMeta._analytics.generation_time_ms)}
                          />
                        )}
                        {nMeta._analytics.vram_peak_mb != null && (
                          <MetadataItem
                            label="VRAM Peak"
                            value={formatVRAM(nMeta._analytics.vram_peak_mb, nMeta._analytics.gpu_device)}
                          />
                        )}
                      </div>

                      {nMeta._analytics.gpu_device && (
                        <MetadataItem label="GPU Device" value={nMeta._analytics.gpu_device} />
                      )}

                      {/* Tier 2: VERY USEFUL */}
                      <div className="grid grid-cols-2 gap-2">
                        {nMeta._analytics.steps_per_second != null && (
                          <MetadataItem
                            label="Speed"
                            value={`${nMeta._analytics.steps_per_second.toFixed(2)} steps/s`}
                          />
                        )}
                        {nMeta._analytics.comfyui_version && (
                          <MetadataItem label="ComfyUI" value={nMeta._analytics.comfyui_version} />
                        )}
                      </div>

                      {/* Tier 3: NICE-TO-HAVE (small text) */}
                      {(nMeta._analytics.torch_version || nMeta._analytics.python_version) && (
                        <div className="text-xs text-gray-500 border-t border-gray-700/50 pt-2 space-y-1">
                          {nMeta._analytics.torch_version && <div>PyTorch: {nMeta._analytics.torch_version}</div>}
                          {nMeta._analytics.python_version && <div>Python: {nMeta._analytics.python_version}</div>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
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
            <button
              onClick={() => {
                if (!canUseComparison) {
                  showProModal('comparison');
                  return;
                }
                const added = addImage(image);
                if (added && comparisonCount === 1) {
                  onClose(); // Close ImageModal, ComparisonModal will auto-open
                }
              }}
              disabled={canUseComparison && comparisonCount >= 2}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
              title={!canUseComparison ? "Comparison (Pro Feature)" : comparisonCount >= 2 ? "Comparison queue full" : "Add to comparison"}
            >
              <GitCompare className="w-3 h-3" />
              Add to Compare {canUseComparison && comparisonCount > 0 && `(${comparisonCount}/2)`}
              {!canUseComparison && initialized && <ProBadge size="sm" />}
            </button>
          </div>

          {/* A1111 Integration - Separate Buttons with Visual Hierarchy */}
          {nMeta && (
            <div className="mt-3 space-y-2">
              {/* Hero Button: Generate Variation */}
              <button
                onClick={() => {
                  if (!canUseA1111) {
                    showProModal('a1111');
                    return;
                  }
                  setIsGenerateModalOpen(true);
                }}
                disabled={canUseA1111 && !nMeta.prompt}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                {isGenerating && canUseA1111 ? (
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
                    <span>Generate with A1111</span>
                    {!canUseA1111 && initialized && <ProBadge size="sm" />}
                  </>
                )}
              </button>

              {/* Utility Button: Copy to A1111 */}
              <button
                onClick={() => {
                  if (!canUseA1111) {
                    showProModal('a1111');
                    return;
                  }
                  copyToA1111(image);
                }}
                disabled={canUseA1111 && (isCopying || !nMeta.prompt)}
                className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-all duration-200 border border-gray-600"
              >
                {isCopying && canUseA1111 ? (
                  <>
                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Copying...</span>
                  </>
                ) : (
                  <>
                    <Clipboard className="w-3 h-3" />
                    <span>Copy Parameters</span>
                    {!canUseA1111 && initialized && <ProBadge size="sm" />}
                  </>
                )}
              </button>

              {/* Status messages */}
              {(copyStatus || generateStatus) && (
                <div className={`mt-2 p-2 rounded text-xs ${
                  (copyStatus?.success || generateStatus?.success)
                    ? 'bg-green-900/50 border border-green-700 text-green-300'
                    : 'bg-red-900/50 border border-red-700 text-red-300'
                }`}>
                  {copyStatus?.message || generateStatus?.message}
                </div>
              )}

              {/* Generate Variation Modal */}
              {isGenerateModalOpen && nMeta && (
                <A1111GenerateModal
                  isOpen={isGenerateModalOpen}
                  onClose={() => setIsGenerateModalOpen(false)}
                  image={image}
                  onGenerate={async (params: A1111GenerationParams) => {
                    const customMetadata: Partial<BaseMetadata> = {
                      prompt: params.prompt,
                      negativePrompt: params.negativePrompt,
                      cfg_scale: params.cfgScale,
                      steps: params.steps,
                      seed: params.randomSeed ? -1 : params.seed,
                      width: params.width,
                      height: params.height,
                      model: params.model || nMeta?.model,
                      ...(params.sampler ? { sampler: params.sampler } : {}),
                    };
                    await generateWithA1111(image, customMetadata, params.numberOfImages);
                    setIsGenerateModalOpen(false);
                  }}
                  isGenerating={isGenerating}
                />
              )}
            </div>
          )}

          {/* ComfyUI Integration */}
          {nMeta && (
            <div className="mt-3 pt-3 border-t border-gray-700">
              <h4 className="text-xs text-gray-400 uppercase tracking-wider mb-2">ComfyUI</h4>

              {/* Generate Button */}
              <button
                onClick={() => {
                  if (!canUseComfyUI) {
                    showProModal('comfyui');
                    return;
                  }
                  setIsComfyUIGenerateModalOpen(true);
                }}
                disabled={canUseComfyUI && !nMeta.prompt}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 shadow-lg hover:shadow-xl mb-2"
              >
                {isGeneratingComfyUI && canUseComfyUI ? (
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
                    <span>Generate with ComfyUI</span>
                    {!canUseComfyUI && initialized && <ProBadge size="sm" />}
                  </>
                )}
              </button>

              {/* Copy Workflow Button */}
              <button
                onClick={() => {
                  if (!canUseComfyUI) {
                    showProModal('comfyui');
                    return;
                  }
                  copyToComfyUI(image);
                }}
                disabled={canUseComfyUI && (isCopyingComfyUI || !nMeta.prompt)}
                className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-all duration-200 border border-gray-600"
              >
                {isCopyingComfyUI && canUseComfyUI ? (
                  <>
                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Copying...</span>
                  </>
                ) : (
                  <>
                    <Clipboard className="w-3 h-3" />
                    <span>Copy Workflow JSON</span>
                    {!canUseComfyUI && initialized && <ProBadge size="sm" />}
                  </>
                )}
              </button>

              {/* Status messages */}
              {(copyStatusComfyUI || generateStatusComfyUI) && (
                <div className={`mt-2 p-2 rounded text-xs ${
                  (copyStatusComfyUI?.success || generateStatusComfyUI?.success)
                    ? 'bg-green-900/50 border border-green-700 text-green-300'
                    : 'bg-red-900/50 border border-red-700 text-red-300'
                }`}>
                  {copyStatusComfyUI?.message || generateStatusComfyUI?.message}
                </div>
              )}

              {/* ComfyUI Generate Modal */}
              {isComfyUIGenerateModalOpen && nMeta && (
                <ComfyUIGenerateModal
                  isOpen={isComfyUIGenerateModalOpen}
                  onClose={() => setIsComfyUIGenerateModalOpen(false)}
                  image={image}
                  onGenerate={async (params: ComfyUIGenerationParams) => {
                    const customMetadata: Partial<BaseMetadata> = {
                      prompt: params.prompt,
                      negativePrompt: params.negativePrompt,
                      cfg_scale: params.cfgScale,
                      steps: params.steps,
                      seed: params.randomSeed ? -1 : params.seed,
                      width: params.width,
                      height: params.height,
                      batch_size: params.numberOfImages,
                      ...(params.sampler ? { sampler: params.sampler } : {}),
                      ...(params.scheduler ? { scheduler: params.scheduler } : {}),
                    };
                    await generateWithComfyUI(image, {
                      customMetadata,
                      overrides: {
                        model: params.model,
                        loras: params.loras,
                      },
                    });
                    setIsComfyUIGenerateModalOpen(false);
                  }}
                  isGenerating={isGeneratingComfyUI}
                />
              )}
            </div>
          )}

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

  // Helper to compare tag arrays
  const tagsEqual = (tags1?: string[], tags2?: string[]) => {
    if (!tags1 && !tags2) return true;
    if (!tags1 || !tags2) return false;
    if (tags1.length !== tags2.length) return false;
    return tags1.every((tag, index) => tag === tags2[index]);
  };

  const propsEqual =
    prevProps.image.id === nextProps.image.id &&
    prevProps.image.isFavorite === nextProps.image.isFavorite &&
    tagsEqual(prevProps.image.tags, nextProps.image.tags) &&
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
