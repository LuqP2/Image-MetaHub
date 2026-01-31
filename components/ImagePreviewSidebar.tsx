import React, { useEffect, useState, FC } from 'react';
import { Clipboard, Sparkles, ChevronDown, ChevronRight, Star, X, Zap, CheckCircle, ArrowUp } from 'lucide-react';
import { useImageStore } from '../store/useImageStore';
import { type IndexedImage, type BaseMetadata, type LoRAInfo } from '../types';
import { useCopyToA1111 } from '../hooks/useCopyToA1111';
import { useGenerateWithA1111 } from '../hooks/useGenerateWithA1111';
import { useCopyToComfyUI } from '../hooks/useCopyToComfyUI';
import { useGenerateWithComfyUI } from '../hooks/useGenerateWithComfyUI';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { A1111GenerateModal, type GenerationParams as A1111GenerationParams } from './A1111GenerateModal';
import { ComfyUIGenerateModal, type GenerationParams as ComfyUIGenerationParams } from './ComfyUIGenerateModal';
import ProBadge from './ProBadge';
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

// Helper function to format generation time: 87ms, 1.5s, or 2m 15s
const formatGenerationTime = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

// Helper function to format VRAM: "8.0 GB / 24 GB (33%)" or "8.0 GB"
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

const formatDurationSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov', '.avi'];

const isVideoFileName = (fileName: string, fileType?: string | null): boolean => {
  if (fileType && fileType.startsWith('video/')) {
    return true;
  }
  const lower = fileName.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

const resolveImageMimeType = (fileName: string): string => {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.mp4')) return 'video/mp4';
  if (lowerName.endsWith('.webm')) return 'video/webm';
  if (lowerName.endsWith('.mkv')) return 'video/x-matroska';
  if (lowerName.endsWith('.mov')) return 'video/quicktime';
  if (lowerName.endsWith('.avi')) return 'video/x-msvideo';
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
    const safeView = new Uint8Array(view);
    const blob = new Blob([safeView], { type: mimeType });
    return { url: URL.createObjectURL(blob), revoke: true };
  }

  if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as { data: unknown }).data)) {
    const view = new Uint8Array((data as { data: number[] }).data);
    const blob = new Blob([view], { type: mimeType });
    return { url: URL.createObjectURL(blob), revoke: true };
  }

  throw new Error('Unknown file data format.');
};

// Helper component from ImageModal.tsx
const MetadataItem: FC<{ label: string; value?: string | number | any[]; isPrompt?: boolean; onCopy?: (value: string) => void }> = ({ label, value, isPrompt = false, onCopy }) => {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
    return null;
  }

  const displayValue = Array.isArray(value) ? value.join(', ') : String(value);

  return (
    <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-md border border-gray-200 dark:border-gray-700/50 relative group">
      <div className="flex justify-between items-start">
        <p className="font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{label}</p>
        {onCopy && (
            <button onClick={() => onCopy(displayValue)} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-50" title={`Copy ${label}`}>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 011-1h6a1 1 0 110 2H8a1 1 0 01-1-1zM5 5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H5z"></path></svg>
            </button>
        )}
      </div>
      {isPrompt ? (
        <pre className="text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words font-mono text-sm mt-1">{displayValue}</pre>
      ) : (
        <p className="text-gray-700 dark:text-gray-200 break-words font-mono text-sm mt-1">{displayValue}</p>
      )}
    </div>
  );
};

const ImagePreviewSidebar: React.FC = () => {
  const {
    previewImage,
    setPreviewImage,
    directories,
    toggleFavorite,
    addTagToImage,
    removeTagFromImage,
    removeAutoTagFromImage,
    availableTags
  } = useImageStore();
  const recentTags = useImageStore((state) => state.recentTags);
  const previewImageFromStore = useImageStore((state) => {
    if (!state.previewImage) return null;
    const id = state.previewImage.id;
    return state.images.find(img => img.id === id) ||
      state.filteredImages.find(img => img.id === id) ||
      null;
  });
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isComfyUIGenerateModalOpen, setIsComfyUIGenerateModalOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [showTagAutocomplete, setShowTagAutocomplete] = useState(false);
  const [showPerformance, setShowPerformance] = useState(true);

  const { copyToA1111, isCopying, copyStatus } = useCopyToA1111();
  const { generateWithA1111, isGenerating, generateStatus } = useGenerateWithA1111();
  const { copyToComfyUI, isCopying: isCopyingComfyUI, copyStatus: copyStatusComfyUI } = useCopyToComfyUI();
  const { generateWithComfyUI, isGenerating: isGeneratingComfyUI, generateStatus: generateStatusComfyUI } = useGenerateWithComfyUI();

  // Feature access (license/trial gating)
  const { canUseA1111, canUseComfyUI, showProModal, initialized } = useFeatureAccess();

  const activeImage = previewImageFromStore || previewImage;
  const isVideo = !!activeImage && isVideoFileName(activeImage.name, activeImage.fileType);
  const preferredThumbnailUrl = activeImage?.thumbnailUrl ?? null;
  const tagSuggestions = buildTagSuggestions(recentTags, availableTags, activeImage?.tags ?? []);

  useEffect(() => {
    let isMounted = true;
    let createdUrl: string | null = null;

    if (!activeImage) {
      setImageUrl(null);
      return () => {
        isMounted = false;
        if (createdUrl) {
          URL.revokeObjectURL(createdUrl);
        }
      };
    }

    const hasPreview = Boolean(preferredThumbnailUrl);
    setImageUrl(isVideo ? null : preferredThumbnailUrl);

    const loadImage = async () => {
      if (!isMounted) return;

      const directoryPath = directories.find(d => d.id === activeImage.directoryId)?.path;

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
        const primaryHandle = activeImage.thumbnailHandle;
        const fallbackHandle = activeImage.handle;
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
          return;
        }
        throw new Error('Image handle is not a valid FileSystemFileHandle.');
      } catch (handleError) {
        const message = handleError instanceof Error ? handleError.message : String(handleError);
        console.warn(`Could not load image with FileSystemFileHandle: ${message}. Attempting Electron fallback.`);
        if (isMounted && window.electronAPI && directoryPath) {
          try {
            const pathResult = await window.electronAPI.joinPaths(directoryPath, activeImage.name);
            if (!pathResult.success || !pathResult.path) {
              throw new Error(pathResult.error || 'Failed to construct image path.');
            }
            const fileResult = await window.electronAPI.readFile(pathResult.path);
            if (fileResult.success && fileResult.data && isMounted) {
              const { url, revoke } = createImageUrlFromFileData(fileResult.data, activeImage.name);
              setResolvedUrl(url, revoke);
            } else {
              throw new Error(fileResult.error || 'Failed to read file via Electron API.');
            }
          } catch (electronError) {
            console.error('Electron fallback failed:', electronError);
            if (isMounted && !hasPreview) setImageUrl(null);
          }
        } else if (isMounted && !hasPreview) {
          setImageUrl(null);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
      if (createdUrl) {
        // Small delay to ensure image is no longer being used before revoking
        setTimeout(() => {
          URL.revokeObjectURL(createdUrl);
        }, 100);
      }
    };
  }, [activeImage?.id, activeImage?.handle, activeImage?.thumbnailHandle, activeImage?.name, activeImage?.directoryId, directories, preferredThumbnailUrl, isVideo]);
  if (!activeImage) {
    return null;
  }

  const nMeta: BaseMetadata | undefined = activeImage.metadata?.normalizedMetadata;
  const videoInfo = (nMeta as any)?.video;
  const motionModel = (nMeta as any)?.motion_model;

  const copyToClipboard = (text: string, type: string) => {
    if(!text) return;
    navigator.clipboard.writeText(text).then(() => {
      // You can add a notification here if you want
    }).catch(err => {
      console.error(`Failed to copy ${type}:`, err);
    });
  };

  // Tag management handlers
  const handleAddTag = () => {
    if (!tagInput.trim() || !activeImage) return;
    addTagToImage(activeImage.id, tagInput);
    setTagInput('');
    setShowTagAutocomplete(false);
  };

  const handleRemoveTag = (tag: string) => {
    if (!activeImage) return;
    removeTagFromImage(activeImage.id, tag);
  };

  const handleRemoveAutoTag = (tag: string) => {
    if (!activeImage) return;
    removeAutoTagFromImage(activeImage.id, tag);
  };

  const handlePromoteAutoTag = async (tag: string) => {
    if (!activeImage) return;
    // Add as manual tag and remove from auto-tags
    await addTagToImage(activeImage.id, tag);
    removeAutoTagFromImage(activeImage.id, tag);
  };

  const handleToggleFavorite = () => {
    if (!activeImage) return;
    toggleFavorite(activeImage.id);
  };

  // Filter autocomplete tags
  const autocompleteOptions = tagInput && activeImage
    ? availableTags
        .filter(tag =>
          tag.name.includes(tagInput.toLowerCase()) &&
          !(activeImage.tags || []).includes(tag.name)
        )
        .slice(0, 5)
    : [];

  return (
    <div data-area="preview" tabIndex={-1} className="fixed right-0 top-0 h-full w-96 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 z-40 flex flex-col shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Image Preview</h2>
        <button
          onClick={() => setPreviewImage(null)}
          className="text-gray-400 hover:text-gray-50 transition-colors"
          title="Close preview"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Image */}
        <div className="bg-black flex items-center justify-center rounded-lg">
          {imageUrl ? (
            isVideo ? (
              <video
                src={imageUrl}
                className="max-w-full max-h-96 object-contain"
                controls
                playsInline
                poster={preferredThumbnailUrl ?? undefined}
              />
            ) : (
              <img src={imageUrl} alt={activeImage.name} className="max-w-full max-h-96 object-contain" />
            )
          ) : (
            <div className="w-full h-64 animate-pulse bg-gray-700 rounded-md"></div>
          )}
        </div>

        {/* Metadata */}
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 break-all">{activeImage.name}</h2>
            {hasVerifiedTelemetry(activeImage) && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-400 border border-green-500/30 shadow-sm shadow-green-500/20"
                title="Verified Telemetry - Generated with MetaHub Save Node. Includes accurate performance metrics: generation time, VRAM usage, GPU device, and software versions."
              >
                <CheckCircle size={12} className="flex-shrink-0" />
                <span className="whitespace-nowrap">Verified</span>
              </span>
            )}
          </div>
          <p className="text-xs text-blue-400 font-mono break-all">{new Date(activeImage.lastModified).toLocaleString()}</p>
        </div>

        {/* Annotations Section */}
        <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-lg border border-gray-200 dark:border-gray-700/50 space-y-2">
          {/* Favorite and Tags Row */}
          <div className="flex items-start gap-3">
            {/* Favorite Star - Discrete */}
            <button
              onClick={handleToggleFavorite}
              className={`p-1.5 rounded transition-all ${
                activeImage.isFavorite
                  ? 'text-yellow-400 hover:text-yellow-300'
                  : 'text-gray-500 hover:text-yellow-400'
              }`}
              title={activeImage.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className={`w-5 h-5 ${activeImage.isFavorite ? 'fill-current' : ''}`} />
            </button>

            {/* Tags Pills */}
            <div className="flex-1 space-y-2">
              {/* Current Tags */}
              {activeImage.tags && activeImage.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {activeImage.tags.map(tag => (
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
                  className="w-full bg-white dark:bg-gray-700/50 text-gray-900 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-400 dark:placeholder-gray-500"
                />

                {/* Autocomplete Dropdown */}
                {showTagAutocomplete && autocompleteOptions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                    {autocompleteOptions.map(tag => (
                      <button
                        key={tag.name}
                        onClick={() => {
                          addTagToImage(activeImage.id, tag.name);
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
                      onClick={() => addTagToImage(activeImage.id, tag)}
                      className="text-xs bg-gray-200 dark:bg-gray-700/30 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded hover:bg-gray-300 dark:hover:bg-gray-600 hover:text-gray-800 dark:hover:text-gray-200"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}

              {activeImage.autoTags && activeImage.autoTags.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-purple-300">Auto tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {activeImage.autoTags.map(tag => (
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

        {nMeta ? (
          <>
            <h3 className="text-base font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600 pb-2">Metadata</h3>
            <div className="space-y-3">
              <MetadataItem label="Format" value={nMeta.format} onCopy={(v) => copyToClipboard(v, "Format")} />
              <MetadataItem label="Prompt" value={nMeta.prompt} isPrompt onCopy={(v) => copyToClipboard(v, "Prompt")} />
              <MetadataItem label="Negative Prompt" value={nMeta.negativePrompt} isPrompt onCopy={(v) => copyToClipboard(v, "Negative Prompt")} />
              <MetadataItem label="Model" value={nMeta.model} onCopy={(v) => copyToClipboard(v, "Model")} />
              {((nMeta as any).vae || (nMeta as any).vaes?.[0]?.name) && (
                <MetadataItem label="VAE" value={(nMeta as any).vae || (nMeta as any).vaes?.[0]?.name} />
              )}

              <div className="grid grid-cols-2 gap-2 text-sm">
                  <MetadataItem label="Steps" value={nMeta.steps} />
                  <MetadataItem label="CFG Scale" value={nMeta.cfgScale} />
                  <MetadataItem label="Seed" value={nMeta.seed} />
                  <MetadataItem label="Dimensions" value={nMeta.width && nMeta.height ? `${nMeta.width}x${nMeta.height}` : undefined} />
                  <MetadataItem label="Sampler" value={nMeta.sampler} />
                  <MetadataItem label="Scheduler" value={nMeta.scheduler} />
                  {(nMeta as any).denoise != null && (nMeta as any).denoise < 1 && (
                    <MetadataItem label="Denoise" value={(nMeta as any).denoise} />
                  )}
              </div>
              {videoInfo && (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <MetadataItem label="Frames" value={videoInfo.frame_count} />
                  <MetadataItem label="FPS" value={videoInfo.frame_rate != null ? Number(videoInfo.frame_rate).toFixed(2) : undefined} />
                  {videoInfo.duration_seconds != null && (
                    <MetadataItem label="Duration" value={formatDurationSeconds(Number(videoInfo.duration_seconds))} />
                  )}
                  <MetadataItem label="Video Codec" value={videoInfo.codec} />
                  <MetadataItem label="Video Format" value={videoInfo.format} />
                </div>
              )}
              {motionModel?.name && (
                <MetadataItem label="Motion Model" value={motionModel.name} />
              )}
              {motionModel?.hash && (
                <MetadataItem label="Motion Model Hash" value={motionModel.hash} />
              )}
              {(nMeta as any)?._metahub_pro?.project_name && (
                <MetadataItem label="Project" value={(nMeta as any)._metahub_pro.project_name} />
              )}
            </div>

            {nMeta.loras && nMeta.loras.length > 0 && (
               <>
                  <h3 className="text-base font-semibold text-gray-700 dark:text-gray-300 pt-2 border-b border-gray-200 dark:border-gray-600 pb-2">LoRAs</h3>
                  <MetadataItem label="LoRAs" value={nMeta.loras.map(formatLoRA).join(', ')} />
               </>
            )}

            {/* MetaHub Save Node Notes */}
            {nMeta.notes && (
              <div className="bg-gray-900/50 p-3 rounded-md border border-gray-700/50">
                <p className="font-semibold text-purple-300 text-xs uppercase tracking-wider mb-2">Notes (MetaHub Save Node)</p>
                <pre className="text-gray-200 whitespace-pre-wrap break-words font-mono text-sm bg-gray-800/50 p-2 rounded">{nMeta.notes}</pre>
              </div>
            )}

            {/* Performance Section - Collapsible */}
            {nMeta && nMeta._analytics && (
              <div>
                <button
                  onClick={() => setShowPerformance(!showPerformance)}
                  className="text-gray-600 dark:text-gray-300 text-sm w-full text-left py-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between hover:text-gray-900 dark:hover:text-white transition-colors"
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
                      <div className="text-xs text-gray-400 dark:text-gray-500 border-t border-gray-200 dark:border-gray-700/50 pt-2 space-y-1">
                        {nMeta._analytics.torch_version && <div>PyTorch: {nMeta._analytics.torch_version}</div>}
                        {nMeta._analytics.python_version && <div>Python: {nMeta._analytics.python_version}</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* A1111 Actions - Separate Buttons with Visual Hierarchy */}
            {!isVideo && (
              <div className="mt-4 space-y-2">
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
                className="w-full bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 disabled:bg-gray-100 dark:disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed border border-blue-200 dark:border-blue-500/50 hover:border-blue-300 dark:hover:border-blue-400 text-blue-700 dark:text-blue-100 px-4 py-3 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200"
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
                  copyToA1111(activeImage);
                }}
                disabled={canUseA1111 && (isCopying || !nMeta.prompt)}
                className="w-full bg-gray-50 hover:bg-gray-100 dark:bg-white/5 dark:hover:bg-white/10 disabled:bg-gray-100 dark:disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-all duration-200"
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
                <div className={`p-2 rounded text-xs ${
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
                  image={activeImage}
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
                    await generateWithA1111(activeImage, customMetadata, params.numberOfImages);
                    setIsGenerateModalOpen(false);
                  }}
                  isGenerating={isGenerating}
                />
              )}
            </div>
            )}

            {/* ComfyUI Actions */}
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <h4 className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">ComfyUI</h4>

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
                className="w-full bg-purple-50 hover:bg-purple-100 dark:bg-purple-500/10 dark:hover:bg-purple-500/20 disabled:bg-gray-100 dark:disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed border border-purple-200 dark:border-purple-500/50 hover:border-purple-300 dark:hover:border-purple-400 text-purple-700 dark:text-purple-100 px-4 py-3 rounded-md text-sm font-semibold flex items-center justify-center gap-2 mb-2 transition-all duration-200"
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
                  copyToComfyUI(activeImage);
                }}
                disabled={canUseComfyUI && (isCopyingComfyUI || !nMeta.prompt)}
                className="w-full bg-gray-50 hover:bg-gray-100 dark:bg-white/5 dark:hover:bg-white/10 disabled:bg-gray-100 dark:disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-all duration-200"
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
                  image={activeImage}
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
                    await generateWithComfyUI(activeImage, {
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

// Memoize to prevent unnecessary re-renders
export default React.memo(ImagePreviewSidebar);
