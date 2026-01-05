import React, { useEffect, useState, FC } from 'react';
import { Clipboard, Sparkles, ChevronDown, ChevronRight, Star, X, Zap, CheckCircle } from 'lucide-react';
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
            <button onClick={() => onCopy(displayValue)} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-50" title={`Copy ${label}`}>
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
    directories,
    toggleFavorite,
    addTagToImage,
    removeTagFromImage,
    availableTags
  } = useImageStore();
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
                  const lowerName = previewImage.name.toLowerCase();
                  const ext = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
                    ? 'jpeg'
                    : lowerName.endsWith('.webp')
                      ? 'webp'
                      : 'png';
                  dataUrl = `data:image/${ext};base64,${fileResult.data}`;
                } else if (fileResult.data instanceof Uint8Array) {
                  const binary = String.fromCharCode.apply(null, Array.from(fileResult.data));
                  const base64 = btoa(binary);
                  const lowerName = previewImage.name.toLowerCase();
                  const ext = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
                    ? 'jpeg'
                    : lowerName.endsWith('.webp')
                      ? 'webp'
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

  // Tag management handlers
  const handleAddTag = () => {
    if (!tagInput.trim() || !previewImage) return;
    addTagToImage(previewImage.id, tagInput);
    setTagInput('');
    setShowTagAutocomplete(false);
  };

  const handleRemoveTag = (tag: string) => {
    if (!previewImage) return;
    removeTagFromImage(previewImage.id, tag);
  };

  const handleToggleFavorite = () => {
    if (!previewImage) return;
    toggleFavorite(previewImage.id);
  };

  // Filter autocomplete tags
  const autocompleteOptions = tagInput && previewImage
    ? availableTags
        .filter(tag =>
          tag.name.includes(tagInput.toLowerCase()) &&
          !(previewImage.tags || []).includes(tag.name)
        )
        .slice(0, 5)
    : [];

  return (
    <div data-area="preview" tabIndex={-1} className="fixed right-0 top-0 h-full w-96 bg-gray-800 border-l border-gray-700 z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-gray-200">Image Preview</h2>
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
          {imageUrl ? <img src={imageUrl} alt={previewImage.name} className="max-w-full max-h-96 object-contain" /> : <div className="w-full h-64 animate-pulse bg-gray-700 rounded-md"></div>}
        </div>

        {/* Metadata */}
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-lg font-bold text-gray-100 break-all">{previewImage.name}</h2>
            {hasVerifiedTelemetry(previewImage) && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-400 border border-green-500/30 shadow-sm shadow-green-500/20"
                title="Verified Telemetry - Generated with MetaHub Save Node. Includes accurate performance metrics: generation time, VRAM usage, GPU device, and software versions."
              >
                <CheckCircle size={12} className="flex-shrink-0" />
                <span className="whitespace-nowrap">Verified</span>
              </span>
            )}
          </div>
          <p className="text-xs text-blue-400 font-mono break-all">{new Date(previewImage.lastModified).toLocaleString()}</p>
        </div>

        {/* Annotations Section */}
        <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700/50 space-y-2">
          {/* Favorite and Tags Row */}
          <div className="flex items-start gap-3">
            {/* Favorite Star - Discrete */}
            <button
              onClick={handleToggleFavorite}
              className={`p-1.5 rounded transition-all ${
                previewImage.isFavorite
                  ? 'text-yellow-400 hover:text-yellow-300'
                  : 'text-gray-500 hover:text-yellow-400'
              }`}
              title={previewImage.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className={`w-5 h-5 ${previewImage.isFavorite ? 'fill-current' : ''}`} />
            </button>

            {/* Tags Pills */}
            <div className="flex-1 space-y-2">
              {/* Current Tags */}
              {previewImage.tags && previewImage.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {previewImage.tags.map(tag => (
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
                          addTagToImage(previewImage.id, tag.name);
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
              {(!previewImage.tags || previewImage.tags.length === 0) && availableTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {availableTags.slice(0, 5).map(tag => (
                    <button
                      key={tag.name}
                      onClick={() => addTagToImage(previewImage.id, tag.name)}
                      className="text-xs bg-gray-700/30 text-gray-400 px-1.5 py-0.5 rounded hover:bg-gray-600 hover:text-gray-200"
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {nMeta ? (
          <>
            <h3 className="text-base font-semibold text-gray-300 border-b border-gray-600 pb-2">Metadata</h3>
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
            </div>

            {nMeta.loras && nMeta.loras.length > 0 && (
               <>
                  <h3 className="text-base font-semibold text-gray-300 pt-2 border-b border-gray-600 pb-2">LoRAs</h3>
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

            {/* A1111 Actions - Separate Buttons with Visual Hierarchy */}
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
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-3 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 shadow-lg hover:shadow-xl"
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
                    <span>Generate Variation</span>
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
                  copyToA1111(previewImage);
                }}
                disabled={canUseA1111 && (isCopying || !nMeta.prompt)}
                className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed px-3 py-2 rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-all duration-200 border border-gray-600"
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
                  image={previewImage}
                  onGenerate={async (params: A1111GenerationParams) => {
                    const customMetadata: Partial<BaseMetadata> = {
                      prompt: params.prompt,
                      negativePrompt: params.negativePrompt,
                      cfg_scale: params.cfgScale,
                      steps: params.steps,
                      seed: params.randomSeed ? -1 : params.seed,
                    };
                    await generateWithA1111(previewImage, customMetadata, params.numberOfImages);
                    setIsGenerateModalOpen(false);
                  }}
                  isGenerating={isGenerating}
                />
              )}
            </div>

            {/* ComfyUI Actions */}
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
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-3 rounded-md text-sm font-semibold flex items-center justify-center gap-2 mb-2 transition-all duration-200 shadow-lg hover:shadow-xl"
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
                  copyToComfyUI(previewImage);
                }}
                disabled={canUseComfyUI && (isCopyingComfyUI || !nMeta.prompt)}
                className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed px-3 py-2 rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-all duration-200 border border-gray-600"
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
                  image={previewImage}
                    onGenerate={async (params: ComfyUIGenerationParams) => {
                      const customMetadata: Partial<BaseMetadata> = {
                        prompt: params.prompt,
                        negativePrompt: params.negativePrompt,
                        cfg_scale: params.cfgScale,
                        steps: params.steps,
                        seed: params.randomSeed ? -1 : params.seed,
                        width: params.width,
                        height: params.height,
                      };
                    await generateWithComfyUI(previewImage, {
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
