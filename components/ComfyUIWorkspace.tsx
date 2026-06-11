import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  GitCompare,
  Heart,
  ImageIcon,
  Info,
  Loader2,
  Package,
  Play,
  RefreshCw,
  Rocket,
  Square,
  Star,
  SlidersHorizontal,
  Tag,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import { BaseMetadata, ComfyUIViewLoadFailure, ComfyUIViewState, Directory, ImageRating, IndexedImage } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGenerateWithComfyUI } from '../hooks/useGenerateWithComfyUI';
import { useCopyToComfyUI } from '../hooks/useCopyToComfyUI';
import { type GenerationParams as ComfyUIGenerationParams } from './ComfyUIGenerateModal';
import ComfyUIWorkflowWorkspace from './ComfyUIWorkflowWorkspace';
import { hasVerifiedTelemetry } from '../utils/telemetryDetection';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import { useThumbnail } from '../hooks/useThumbnail';
import { formatImageForComfyUI } from '../utils/comfyUIFormatter';
import { FileOperations } from '../services/fileOperations';
import { useImageStore } from '../store/useImageStore';
import TagManagerModal from './TagManagerModal';

interface ComfyUIWorkspaceProps {
  image: IndexedImage | null;
  directoryPath?: string;
  navigationImages?: IndexedImage[];
  directoryPathByImageId?: Record<string, string>;
  currentIndex?: number;
  isActive: boolean;
  suspendBrowser?: boolean;
  onNavigatePrevious?: () => void;
  onNavigateNext?: () => void;
  onGenerationStateChange?: (isGenerating: boolean) => void;
  onOpenQueue: () => void;
  onOpenSettings: () => void;
  directories?: Directory[];
  selectedDirectoryId?: string;
  onSelectDirectory?: (directoryId: string | null) => void;
  applyLibraryFilters?: boolean;
  onApplyLibraryFiltersChange?: (applyFilters: boolean) => void;
  onInspectImage?: (image: IndexedImage) => void;
  onViewFullMetadata?: (image: IndexedImage) => void;
  onOpenCompare?: (images: IndexedImage[]) => void;
  workflowLoadRequest?: {
    id: number;
    imageId: string;
    title: string;
    preferNewTab: boolean;
  } | null;
  onWorkflowLoadRequestHandled?: (requestId: number) => void;
}

const DEFAULT_VIEW_STATE: ComfyUIViewState = {
  url: '',
  title: '',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  visible: false,
  lastLoadFailed: false,
};

const PANEL_COLLAPSED_STORAGE_KEY = 'image-metahub-comfyui-workspace-panel-collapsed';
const THUMB_RAIL_COLLAPSED_STORAGE_KEY = 'image-metahub-comfyui-workspace-thumb-rail-collapsed';
const THUMB_RAIL_WIDTH_STORAGE_KEY = 'image-metahub-comfyui-workspace-thumb-rail-width';
const ASSET_CONTEXT_MENU_WIDTH = 224;
const ASSET_CONTEXT_MENU_HEIGHT = 304;
const clampThumbRailWidth = (width: number) => Math.min(Math.max(Math.round(width) || 108, 76), 360);
const OPEN_BATCH_EXPORT_EVENT = 'imagemetahub:open-batch-export';

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return 'Not found';
  }
  return String(value);
};

const getImageDimensionsLabel = (image: IndexedImage): string => {
  const metadata = image.metadata?.normalizedMetadata as BaseMetadata | undefined;
  const width = Number(metadata?.width);
  const height = Number(metadata?.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return `${Math.round(width)}x${Math.round(height)}`;
  }

  const dimensions = typeof image.dimensions === 'string' ? image.dimensions.trim() : '';
  if (dimensions) {
    return dimensions.replace(/\s+/g, '');
  }

  return '';
};

const getImagePrompt = (image: IndexedImage): string => {
  const metadata = image.metadata?.normalizedMetadata as BaseMetadata | undefined;
  return (metadata?.prompt || image.prompt || '').trim();
};

const hasMetadataValue = (value: unknown): boolean => (
  value !== null && value !== undefined && value !== ''
);

const MetadataLine: React.FC<{
  label: string;
  value: unknown;
  onCopy?: (label: string, value: string) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLElement>, label: string, value: string) => void;
}> = ({ label, value, onCopy, onContextMenu }) => {
  const displayValue = formatValue(value);
  const canCopy = hasMetadataValue(value);

  return (
    <div
      className="group rounded-md border border-gray-800 bg-gray-950/60 px-3 py-2"
      onContextMenu={(event) => {
        if (canCopy) {
          onContextMenu?.(event, label, displayValue);
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
        {canCopy && onCopy && (
          <button
            type="button"
            onClick={() => onCopy(label, displayValue)}
            className="text-gray-500 opacity-0 transition-opacity hover:text-gray-100 group-hover:opacity-100 focus:opacity-100"
            title={`Copy ${label}`}
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-1 truncate font-mono text-xs text-gray-200" title={formatValue(value)}>
        {displayValue}
      </div>
    </div>
  );
};

const MetadataTextBlock: React.FC<{
  label: string;
  value: unknown;
  maxHeightClass: string;
  onCopy: (label: string, value: string) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>, label: string, value: string) => void;
}> = ({ label, value, maxHeightClass, onCopy, onContextMenu }) => {
  const displayValue = formatValue(value);
  const canCopy = hasMetadataValue(value);

  return (
    <div
      className="group rounded-lg border border-gray-800 bg-gray-950/80 p-3"
      onContextMenu={(event) => {
        if (canCopy) {
          onContextMenu(event, label, displayValue);
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
        {canCopy && (
          <button
            type="button"
            onClick={() => onCopy(label, displayValue)}
            className="text-gray-500 opacity-0 transition-opacity hover:text-gray-100 group-hover:opacity-100 focus:opacity-100"
            title={`Copy ${label}`}
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className={`mt-2 overflow-y-auto whitespace-pre-wrap break-words text-xs text-gray-200 ${maxHeightClass}`}>
        {displayValue}
      </p>
    </div>
  );
};

const WorkspaceThumbnailButton: React.FC<{
  image: IndexedImage;
  isActive: boolean;
  isSelected: boolean;
  directoryPath?: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleSelected: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleFavorite: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDragStart: (event: React.DragEvent<HTMLElement>, image: IndexedImage, directoryPath?: string) => void;
}> = ({ image, isActive, isSelected, directoryPath, onClick, onToggleSelected, onToggleFavorite, onContextMenu, onDragStart }) => {
  useThumbnail(image);
  const thumbnail = useResolvedThumbnail(image);
  const dimensionsLabel = getImageDimensionsLabel(image);

  return (
    <div className="group w-full shrink-0">
      <div className="relative aspect-square w-full">
        <button
          onClick={onClick}
          onContextMenu={onContextMenu}
          className={`h-full w-full overflow-hidden rounded-md border bg-black transition-colors ${
            isSelected
              ? 'border-blue-400 ring-2 ring-blue-400/70'
              : isActive
                ? 'border-purple-400 ring-1 ring-purple-400/60'
                : 'border-gray-700 hover:border-gray-500'
          }`}
          title={`Preview ${image.name}`}
          aria-label={`Preview ${image.name}`}
          draggable={Boolean(directoryPath && window.electronAPI?.startFileDrag)}
          onDragStart={(event) => onDragStart(event, image, directoryPath)}
        >
          {thumbnail?.thumbnailUrl ? (
            <img src={thumbnail.thumbnailUrl} alt="" className="h-full w-full object-cover image-alpha-grid" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-600">
              <ImageIcon className="h-5 w-5" />
            </div>
          )}
        </button>
        <button
          onClick={onToggleSelected}
          className={`absolute left-1.5 top-1.5 rounded bg-gray-950/80 p-1 shadow transition-opacity ${
            isSelected ? 'text-blue-300 opacity-100' : 'text-gray-300 opacity-0 group-hover:opacity-100'
          }`}
          title={isSelected ? 'Deselect image' : 'Select image'}
          aria-label={isSelected ? 'Deselect image' : 'Select image'}
        >
          {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
        </button>
        <button
          onClick={onToggleFavorite}
          className={`absolute right-1.5 top-1.5 rounded bg-gray-950/80 p-1 shadow transition-opacity ${
            image.isFavorite ? 'text-pink-300 opacity-100' : 'text-gray-300 opacity-0 group-hover:opacity-100 hover:text-pink-300'
          }`}
          title={image.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-label={image.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart className={`h-4 w-4 ${image.isFavorite ? 'fill-current' : ''}`} />
        </button>
        {dimensionsLabel && (
          <div
            className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] leading-none text-gray-100 shadow"
            title={`Dimensions: ${dimensionsLabel}`}
          >
            {dimensionsLabel}
          </div>
        )}
      </div>
      <div className="mt-1 truncate text-[11px] leading-4 text-gray-400" title={image.name}>
        {image.name}
      </div>
    </div>
  );
};

const hasSelectedTextWithin = (container: HTMLElement | null): boolean => {
  if (!container || typeof window === 'undefined') {
    return false;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.toString().trim().length === 0) {
    return false;
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    try {
      if (range.intersectsNode(container)) {
        return true;
      }
    } catch {
      const ancestor = range.commonAncestorContainer;
      const ancestorElement = ancestor.nodeType === Node.ELEMENT_NODE
        ? ancestor
        : ancestor.parentElement;
      if (ancestorElement instanceof Node && container.contains(ancestorElement)) {
        return true;
      }
    }
  }

  return false;
};

const WorkspaceImagePreviewModal: React.FC<{
  images: IndexedImage[];
  initialIndex: number;
  onClose: () => void;
  onInspectImage?: (image: IndexedImage) => void;
  onOpenWorkflow?: (image: IndexedImage) => void;
  onViewFullMetadata?: (image: IndexedImage) => void;
}> = ({ images, initialIndex, onClose, onInspectImage, onOpenWorkflow, onViewFullMetadata }) => {
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)));
  const [isMetadataExpanded, setIsMetadataExpanded] = useState(false);
  const [parameterCopyStatus, setParameterCopyStatus] = useState('');
  const onInspectImageRef = useRef(onInspectImage);
  const metadataPanelRef = useRef<HTMLDivElement>(null);
  const current = images[index];
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const hasMultiple = images.length > 1;
  const currentImageId = current?.id ?? '';
  const metadata = current?.metadata?.normalizedMetadata as BaseMetadata | undefined;
  const prompt = current ? getImagePrompt(current) : '';
  const negativePrompt = metadata?.negativePrompt || '';
  const dimensionsLabel = current ? getImageDimensionsLabel(current) : '';
  const seedLabel = hasMetadataValue(metadata?.seed) ? String(metadata?.seed) : '';
  const stepsLabel = hasMetadataValue(metadata?.steps) ? String(metadata?.steps) : '';
  const cfgLabel = hasMetadataValue(metadata?.cfg_scale ?? (metadata as any)?.cfgScale)
    ? String(metadata?.cfg_scale ?? (metadata as any)?.cfgScale)
    : '';
  const samplerLabel = (metadata?.sampler || metadata?.scheduler || '').trim();
  const parameterText = useMemo(() => {
    const lines = [
      metadata?.model ? `Model: ${metadata.model}` : '',
      seedLabel ? `Seed: ${seedLabel}` : '',
      stepsLabel ? `Steps: ${stepsLabel}` : '',
      cfgLabel ? `CFG: ${cfgLabel}` : '',
      samplerLabel ? `Sampler: ${samplerLabel}` : '',
      dimensionsLabel ? `Size: ${dimensionsLabel}` : '',
      prompt ? `Prompt: ${prompt}` : '',
      negativePrompt ? `Negative prompt: ${negativePrompt}` : '',
    ].filter(Boolean);

    return lines.join('\n');
  }, [cfgLabel, dimensionsLabel, metadata?.model, negativePrompt, prompt, samplerLabel, seedLabel, stepsLabel]);

  useEffect(() => {
    onInspectImageRef.current = onInspectImage;
  }, [onInspectImage]);

  useEffect(() => {
    if (current) {
      onInspectImageRef.current?.(current);
      setParameterCopyStatus('');
    }
  }, [current, currentImageId]);

  useEffect(() => {
    setIndex((currentIndex) => Math.min(Math.max(currentIndex, 0), Math.max(images.length - 1, 0)));
  }, [images.length]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let isDisposed = false;

    const loadImage = async () => {
      if (!current?.handle) {
        setImageUrl(null);
        return;
      }

      try {
        const file = await current.handle.getFile();
        if (isDisposed) {
          return;
        }
        objectUrl = URL.createObjectURL(file);
        setImageUrl(objectUrl);
      } catch {
        if (!isDisposed) {
          setImageUrl(null);
        }
      }
    };

    void loadImage();

    return () => {
      isDisposed = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [current]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        setIndex((currentIndex) => Math.max(0, currentIndex - 1));
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        setIndex((currentIndex) => Math.min(images.length - 1, currentIndex + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [images.length, onClose]);

  if (!current) {
    return null;
  }

  const copyParameters = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!parameterText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(parameterText);
      setParameterCopyStatus('Copied');
    } catch (error) {
      console.error('Failed to copy preview parameters:', error);
      setParameterCopyStatus('Copy failed');
    }
  };

  const handleMetadataPanelClick = () => {
    if (hasSelectedTextWithin(metadataPanelRef.current)) {
      return;
    }

    setIsMetadataExpanded((expanded) => !expanded);
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/95"
      onMouseDown={onClose}
      role="dialog"
      aria-label="Workspace image preview"
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3 sm:p-6">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={current.name}
            className="pointer-events-auto max-h-full max-w-full object-contain image-alpha-grid"
            onMouseDown={(event) => event.stopPropagation()}
          />
        ) : (
          <div
            className="pointer-events-auto rounded border border-gray-800 bg-gray-950/90 p-8 text-sm text-gray-400"
            onMouseDown={(event) => event.stopPropagation()}
          >
            Image preview is not available.
          </div>
        )}
      </div>

      {hasMultiple && (
        <>
          <button
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setIndex((currentIndex) => Math.max(0, currentIndex - 1))}
            disabled={index === 0}
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 p-3 text-gray-100 ring-1 ring-white/10 transition-colors hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Previous image"
            title="Previous"
          >
            <ChevronLeft size={28} />
          </button>
          <button
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setIndex((currentIndex) => Math.min(images.length - 1, currentIndex + 1))}
            disabled={index === images.length - 1}
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 p-3 text-gray-100 ring-1 ring-white/10 transition-colors hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Next image"
            title="Next"
          >
            <ChevronRight size={28} />
          </button>
        </>
      )}

      <div
        className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-gray-200 ring-1 ring-white/10 backdrop-blur"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {hasMultiple && <span>{index + 1}/{images.length}</span>}
        {hasMultiple && <span className="h-1 w-1 rounded-full bg-gray-500" />}
        <span className="max-w-[48vw] truncate" title={current.name}>{current.name}</span>
      </div>

      <div
        ref={metadataPanelRef}
        className={`group absolute bottom-4 left-4 z-10 max-w-[min(44rem,calc(100vw-2rem))] rounded-lg border border-white/10 bg-black/55 p-3 text-gray-100 shadow-2xl backdrop-blur transition-colors hover:bg-black/75 ${
          isMetadataExpanded ? 'bg-black/80' : ''
        }`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={handleMetadataPanelClick}
        tabIndex={0}
        role="button"
        aria-label="Toggle metadata"
        aria-expanded={isMetadataExpanded}
        title="Toggle metadata"
      >
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {metadata?.model && (
            <span className="rounded-full bg-white/10 px-2 py-1 font-medium">{metadata.model}</span>
          )}
          {seedLabel && <span className="rounded-full bg-white/10 px-2 py-1 font-mono">Seed {seedLabel}</span>}
          {dimensionsLabel && <span className="rounded-full bg-white/10 px-2 py-1 font-mono">{dimensionsLabel}</span>}
          {hasVerifiedTelemetry(current) && (
            <span className="inline-flex items-center gap-1 rounded-full border border-green-400/30 bg-green-500/15 px-2 py-1 text-green-200">
              <CheckCircle className="h-3.5 w-3.5" />
              Verified
            </span>
          )}
        </div>
        {prompt && (
          <p className={`mt-2 text-sm leading-5 text-gray-200 ${isMetadataExpanded ? 'line-clamp-none' : 'line-clamp-2'}`}>
            {prompt}
          </p>
        )}
        {isMetadataExpanded && (
          <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-xs text-gray-300">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {stepsLabel && <span>Steps: {stepsLabel}</span>}
                {cfgLabel && <span>CFG: {cfgLabel}</span>}
                {samplerLabel && <span>Sampler: {samplerLabel}</span>}
              </div>
              {parameterText && (
                <button
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={copyParameters}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded border border-white/10 px-2 py-1 font-semibold text-gray-200 hover:bg-white/10"
                  aria-label="Copy preview parameters"
                  title="Copy parameters"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {parameterCopyStatus || 'Copy'}
                </button>
              )}
            </div>
            {negativePrompt && (
              <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-gray-400">
                Negative: {negativePrompt}
              </p>
            )}
            {onViewFullMetadata && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onViewFullMetadata(current);
                }}
                className="inline-flex items-center gap-2 rounded border border-white/10 px-2 py-1 font-semibold text-gray-200 hover:bg-white/10"
              >
                <FileText className="h-3.5 w-3.5" />
                Full metadata
              </button>
            )}
          </div>
        )}
      </div>

      <div
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute right-4 top-4 z-10 flex items-center gap-2"
      >
        {onOpenWorkflow && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onOpenWorkflow(current);
            }}
            className="inline-flex items-center gap-2 rounded-full bg-purple-600/80 px-3 py-2 text-sm font-semibold text-white ring-1 ring-purple-300/30 transition-colors hover:bg-purple-500"
            aria-label="Open workflow in ComfyUI"
            title="Open workflow in ComfyUI"
          >
            <Workflow size={18} />
            <span className="hidden sm:inline">Open workflow</span>
          </button>
        )}
        <button
          onClick={onClose}
          className="rounded-full bg-black/55 p-2 text-gray-200 ring-1 ring-white/10 transition-colors hover:bg-black/80 hover:text-white"
          aria-label="Close image preview"
          title="Close"
        >
          <X size={22} />
        </button>
      </div>
    </div>
  );
};

const getBounds = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
};

const getWorkflowMetadata = (image: IndexedImage | null): BaseMetadata | null =>
  (image?.metadata?.normalizedMetadata as BaseMetadata | undefined) ?? null;

type WorkspaceAssetContextMenu = {
  image: IndexedImage;
  x: number;
  y: number;
} | null;

type InspectorContextMenu = {
  x: number;
  y: number;
  label: string;
  value: string;
} | null;

const getSameOriginUrl = (candidateUrl: string, configuredUrl: string): string => {
  try {
    const candidate = new URL(candidateUrl);
    const configured = new URL(configuredUrl);

    return candidate.origin === configured.origin ? candidate.toString() : configured.toString();
  } catch {
    return configuredUrl;
  }
};

const ComfyUIWorkspace: React.FC<ComfyUIWorkspaceProps> = ({
  image,
  directoryPath,
  navigationImages = [],
  directoryPathByImageId = {},
  currentIndex = -1,
  isActive,
  suspendBrowser = false,
  onNavigatePrevious,
  onNavigateNext,
  onGenerationStateChange,
  onOpenQueue,
  onOpenSettings,
  directories = [],
  selectedDirectoryId = '',
  onSelectDirectory,
  applyLibraryFilters = false,
  onApplyLibraryFiltersChange,
  onInspectImage,
  onViewFullMetadata,
  onOpenCompare,
  workflowLoadRequest,
  onWorkflowLoadRequestHandled,
}) => {
  const browserHostRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const thumbRailResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const lastSelectedThumbIndexRef = useRef<number | null>(null);
  const handledWorkflowLoadRequestIdRef = useRef<number | null>(null);
  const [viewState, setViewState] = useState<ComfyUIViewState>(DEFAULT_VIEW_STATE);
  const [loadFailure, setLoadFailure] = useState<ComfyUIViewLoadFailure | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string>('');
  const [activeInspectorTab, setActiveInspectorTab] = useState<'image' | 'metadata' | 'workflow'>('image');
  const [workspacePreviewIndex, setWorkspacePreviewIndex] = useState<number | null>(null);
  const [assetContextMenu, setAssetContextMenu] = useState<WorkspaceAssetContextMenu>(null);
  const [inspectorContextMenu, setInspectorContextMenu] = useState<InspectorContextMenu>(null);
  const [assetActionMessage, setAssetActionMessage] = useState<string>('');
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [isRatingMenuOpen, setIsRatingMenuOpen] = useState(false);
  const [thumbRailWidth, setThumbRailWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return 108;
    }
    return clampThumbRailWidth(Number(window.localStorage.getItem(THUMB_RAIL_WIDTH_STORAGE_KEY)) || 108);
  });
  const [isThumbRailCollapsed, setIsThumbRailCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(THUMB_RAIL_COLLAPSED_STORAGE_KEY) === 'true';
  });
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(PANEL_COLLAPSED_STORAGE_KEY) === 'true';
  });

  const comfyUIServerUrl = useSettingsStore((state) => state.comfyUIServerUrl);
  const comfyUILastConnectionStatus = useSettingsStore((state) => state.comfyUILastConnectionStatus);
  const setComfyUIConnectionStatus = useSettingsStore((state) => state.setComfyUIConnectionStatus);
  const comfyUIWorkspaceLastUrl = useSettingsStore((state) => state.comfyUIWorkspaceLastUrl);
  const setComfyUIWorkspaceLastUrl = useSettingsStore((state) => state.setComfyUIWorkspaceLastUrl);
  const panelWidth = useSettingsStore((state) => state.comfyUIWorkspacePanelWidth);
  const setPanelWidth = useSettingsStore((state) => state.setComfyUIWorkspacePanelWidth);
  const removeImages = useImageStore((state) => state.removeImages);
  const selectedImages = useImageStore((state) => state.selectedImages);
  const toggleImageSelection = useImageStore((state) => state.toggleImageSelection);
  const clearImageSelection = useImageStore((state) => state.clearImageSelection);
  const bulkToggleFavorite = useImageStore((state) => state.bulkToggleFavorite);
  const toggleFavorite = useImageStore((state) => state.toggleFavorite);
  const bulkSetImageRating = useImageStore((state) => state.bulkSetImageRating);

  const { generateWithComfyUI, isGenerating, generateStatus } = useGenerateWithComfyUI();
  const { copyToComfyUI, isCopying, copyStatus } = useCopyToComfyUI();
  const thumbnail = useResolvedThumbnail(image);
  const metadata = getWorkflowMetadata(image);
  const normalizedNavigationImages = useMemo(
    () => (navigationImages.length > 0 ? navigationImages : image ? [image] : []),
    [image, navigationImages],
  );
  const currentPosition = currentIndex >= 0 ? currentIndex + 1 : 0;
  const canNavigatePrevious = currentIndex > 0;
  const canNavigateNext = currentIndex >= 0 && currentIndex < normalizedNavigationImages.length - 1;
  const visibleNavigationImages = useMemo(() => {
    if (normalizedNavigationImages.length <= 140) {
      return normalizedNavigationImages;
    }

    const visibleIndexes = new Set<number>();
    const lastIndex = normalizedNavigationImages.length - 1;

    for (let index = 0; index < 60; index += 1) {
      visibleIndexes.add(index);
      visibleIndexes.add(lastIndex - index);
    }

    if (currentIndex >= 0) {
      const startIndex = Math.max(0, currentIndex - 20);
      const endIndex = Math.min(normalizedNavigationImages.length, currentIndex + 21);
      for (let index = startIndex; index < endIndex; index += 1) {
        visibleIndexes.add(index);
      }
    }

    return Array.from(visibleIndexes)
      .sort((a, b) => a - b)
      .map((index) => normalizedNavigationImages[index])
      .filter((candidate): candidate is IndexedImage => Boolean(candidate));
  }, [currentIndex, normalizedNavigationImages]);
  const selectedWorkspaceImages = useMemo(
    () => visibleNavigationImages.filter((candidate) => selectedImages.has(candidate.id)),
    [selectedImages, visibleNavigationImages],
  );
  const selectedWorkspaceIds = useMemo(
    () => selectedWorkspaceImages.map((candidate) => candidate.id),
    [selectedWorkspaceImages],
  );
  const selectedWorkspaceCount = selectedWorkspaceImages.length;
  const allSelectedWorkspaceFavorites = selectedWorkspaceCount > 0 && selectedWorkspaceImages.every((candidate) => candidate.isFavorite);
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.comfyUIViewOpen);
  const targetUrl = comfyUIWorkspaceLastUrl
    ? getSameOriginUrl(comfyUIWorkspaceLastUrl, comfyUIServerUrl)
    : comfyUIServerUrl;
  const hasBrowserLoadFailure = Boolean(loadFailure || viewState.lastLoadFailed);
  const shouldShowBrowser = isActive && !suspendBrowser && workspacePreviewIndex === null && !hasBrowserLoadFailure;
  const shouldShowBrowserFallback = suspendBrowser || hasBrowserLoadFailure || !viewState.visible;

  useEffect(() => {
    onGenerationStateChange?.(isGenerating);

    return () => {
      onGenerationStateChange?.(false);
    };
  }, [isGenerating, onGenerationStateChange]);

  useEffect(() => {
    if (!assetContextMenu) {
      return;
    }

    const close = () => setAssetContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [assetContextMenu]);

  useEffect(() => {
    if (!inspectorContextMenu) {
      return;
    }

    const close = () => setInspectorContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [inspectorContextMenu]);

  const togglePanelCollapsed = useCallback(() => {
    setIsPanelCollapsed((current) => {
      const next = !current;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(PANEL_COLLAPSED_STORAGE_KEY, String(next));
      }
      return next;
    });
  }, []);

  const connectionClasses = useMemo(() => {
    if (comfyUILastConnectionStatus === 'connected') {
      return 'border-green-500/30 bg-green-500/10 text-green-200';
    }
    if (comfyUILastConnectionStatus === 'error' || loadFailure) {
      return 'border-red-500/30 bg-red-500/10 text-red-200';
    }
    return 'border-gray-700 bg-gray-900 text-gray-300';
  }, [comfyUILastConnectionStatus, loadFailure]);

  const syncBounds = useCallback(async () => {
    if (!shouldShowBrowser || !isElectron || !browserHostRef.current) {
      return;
    }

    const bounds = getBounds(browserHostRef.current);
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    await window.electronAPI?.comfyUIViewSetBounds({ bounds });
  }, [isElectron, shouldShowBrowser]);

  const openEmbeddedView = useCallback(async () => {
    if (!shouldShowBrowser || !isElectron || !browserHostRef.current) {
      return;
    }

    const bounds = getBounds(browserHostRef.current);
    const result = await window.electronAPI?.comfyUIViewOpen({ url: targetUrl, bounds });
    if (result?.success && result.state) {
      setViewState(result.state);
      setLoadFailure(null);
      setConnectionMessage('');
    } else if (result?.error) {
      if (!result.error.includes('ERR_ABORTED')) {
        setConnectionMessage(result.error);
      }
    }
  }, [isElectron, shouldShowBrowser, targetUrl]);

  useEffect(() => {
    if (!shouldShowBrowser || !isElectron) {
      if (suspendBrowser) {
        window.electronAPI?.comfyUIViewSuspend?.();
      } else {
        window.electronAPI?.comfyUIViewHide?.();
      }
      return;
    }

    void openEmbeddedView();

    const host = browserHostRef.current;
    if (!host) {
      return;
    }

    const observer = new ResizeObserver(() => {
      void syncBounds();
    });
    observer.observe(host);

    const handleResize = () => {
      void syncBounds();
    };
    window.addEventListener('resize', handleResize);
    const unsubscribeZoom = window.electronAPI?.onZoomFactorChanged?.(() => {
      window.requestAnimationFrame(() => {
        void syncBounds();
      });
    });

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      unsubscribeZoom?.();
      window.electronAPI?.comfyUIViewHide?.();
    };
  }, [isElectron, openEmbeddedView, shouldShowBrowser, suspendBrowser, syncBounds]);

  useEffect(() => {
    const unsubscribeState = window.electronAPI?.onComfyUIViewStateChanged?.((state) => {
      setViewState(state);
      if (state.url) {
        setComfyUIWorkspaceLastUrl(state.url);
      }
    });
    const unsubscribeFailure = window.electronAPI?.onComfyUIViewLoadFailed?.((failure) => {
      if (failure.errorCode === -3) {
        return;
      }
      setLoadFailure(failure);
      setComfyUIConnectionStatus('error');
      window.electronAPI?.comfyUIViewHide?.();
    });

    window.electronAPI?.comfyUIViewGetState?.().then((result) => {
      if (result?.state) {
        setViewState(result.state);
      }
    });

    return () => {
      unsubscribeState?.();
      unsubscribeFailure?.();
    };
  }, [setComfyUIConnectionStatus, setComfyUIWorkspaceLastUrl]);

  useEffect(() => {
    if (!shouldShowBrowser || !isElectron || viewState.visible || loadFailure) {
      return;
    }

    void openEmbeddedView();
  }, [isElectron, loadFailure, openEmbeddedView, shouldShowBrowser, viewState]);

  const openExternally = async () => {
    const result = await window.electronAPI?.openExternalUrl?.(targetUrl);
    if (!result?.success) {
      setConnectionMessage(result?.error || 'Failed to open ComfyUI externally.');
    }
  };

  const reloadEmbeddedView = async () => {
    setConnectionMessage('');
    setLoadFailure(null);
    setViewState((current) => ({ ...current, lastLoadFailed: false, visible: false }));
    const bounds = browserHostRef.current ? getBounds(browserHostRef.current) : undefined;
    const result = await window.electronAPI?.comfyUIViewReload?.({ url: targetUrl, bounds });
    if (result?.state) {
      setViewState(result.state);
    }
    if (!result?.success) {
      setConnectionMessage(result?.error || 'Failed to reload ComfyUI.');
    }
  };

  useEffect(() => {
    if (!workflowLoadRequest || handledWorkflowLoadRequestIdRef.current === workflowLoadRequest.id) {
      return;
    }

    const workflowImage =
      image?.id === workflowLoadRequest.imageId
        ? image
        : normalizedNavigationImages.find((candidate) => candidate.id === workflowLoadRequest.imageId) ?? null;

    if (!workflowImage) {
      return;
    }

    handledWorkflowLoadRequestIdRef.current = workflowLoadRequest.id;
    onWorkflowLoadRequestHandled?.(workflowLoadRequest.id);
    setActiveInspectorTab('workflow');
    setConnectionMessage('Loading workflow in ComfyUI...');
    setLoadFailure(null);

    const loadWorkflow = async () => {
      if (!isElectron || !window.electronAPI?.comfyUIViewLoadWorkflow) {
        setConnectionMessage('Embedded ComfyUI workflow loading is only available in the desktop app.');
        return;
      }

      try {
        const bounds = browserHostRef.current ? getBounds(browserHostRef.current) : undefined;
        const workflowJson = formatImageForComfyUI(workflowImage);
        const result = await window.electronAPI.comfyUIViewLoadWorkflow({
          url: targetUrl,
          bounds,
          workflow: workflowJson,
          title: workflowLoadRequest.title || workflowImage.name,
          preferNewTab: workflowLoadRequest.preferNewTab,
        });

        if (result?.state) {
          setViewState(result.state);
        }

        if (result?.success) {
          setComfyUIConnectionStatus('connected');
          setConnectionMessage(
            result.message ||
            (result.loadedInNewTab
              ? 'Workflow opened in a new ComfyUI tab.'
              : 'Workflow loaded into the current ComfyUI canvas.')
          );
          return;
        }

        setConnectionMessage(result?.error || 'Failed to load workflow in ComfyUI.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load workflow in ComfyUI.';
        setConnectionMessage(message);
      }
    };

    void loadWorkflow();
  }, [
    image,
    isElectron,
    normalizedNavigationImages,
    setComfyUIConnectionStatus,
    onWorkflowLoadRequestHandled,
    targetUrl,
    workflowLoadRequest,
  ]);

  const generateFromMetadata = async () => {
    if (!image || !metadata) {
      return;
    }
    await generateWithComfyUI(image);
  };

  const handleGenerateFromWorkspace = async (params: ComfyUIGenerationParams) => {
    if (!image || !metadata) {
      return;
    }

    const customMetadata: Partial<BaseMetadata> = {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      cfg_scale: params.cfgScale,
      steps: params.steps,
      seed: params.randomSeed ? -1 : params.seed,
      width: params.width,
      height: params.height,
      batch_size: params.numberOfImages,
      model: params.model?.name || metadata.model,
      ...(params.sampler ? { sampler: params.sampler } : {}),
      ...(params.scheduler ? { scheduler: params.scheduler } : {}),
    };

    await generateWithComfyUI(image, {
      customMetadata,
      overrides: {
        model: params.model || undefined,
        loras: params.loras,
      },
      workflowMode: params.workflowMode,
      sourceImagePolicy: params.sourceImagePolicy,
      advancedPromptJson: params.advancedPromptJson,
      advancedWorkflowJson: params.advancedWorkflowJson,
      maskFile: params.maskFile,
    });
  };

  const beginPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: panelWidth,
    };
  };

  const handlePanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isPanelCollapsed) {
      return;
    }
    const resizeState = resizeStateRef.current;
    if (!resizeState) {
      return;
    }
    setPanelWidth(resizeState.startWidth - (event.clientX - resizeState.startX));
  };

  const endPanelResize = () => {
    resizeStateRef.current = null;
    void syncBounds();
  };

  const beginThumbRailResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    thumbRailResizeStateRef.current = {
      startX: event.clientX,
      startWidth: thumbRailWidth,
    };
  };

  const handleThumbRailResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const resizeState = thumbRailResizeStateRef.current;
    if (!resizeState) {
      return;
    }
    const nextWidth = clampThumbRailWidth(resizeState.startWidth + event.clientX - resizeState.startX);
    setThumbRailWidth(nextWidth);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THUMB_RAIL_WIDTH_STORAGE_KEY, String(nextWidth));
    }
  };

  const endThumbRailResize = () => {
    thumbRailResizeStateRef.current = null;
    void syncBounds();
  };

  const inspectorTabs = [
    { id: 'image' as const, label: 'Image', icon: ImageIcon },
    { id: 'metadata' as const, label: 'Metadata', icon: Info },
    { id: 'workflow' as const, label: 'Workflow', icon: Workflow },
  ];

  const startImageFileDrag = useCallback((
    event: React.DragEvent<HTMLElement>,
    dragImage: IndexedImage,
    dragDirectoryPath?: string,
  ) => {
    if (!dragDirectoryPath || !window.electronAPI?.startFileDrag) {
      return;
    }

    const [, relativeFromId] = dragImage.id.split('::');
    const relativePath = relativeFromId || dragImage.name;

    event.preventDefault();
    event.dataTransfer.effectAllowed = 'copy';
    window.electronAPI.startFileDrag({ directoryPath: dragDirectoryPath, relativePath });
  }, []);

  const copyInspectorValue = useCallback((label: string, value: string) => {
    const text = value.trim();
    if (!text || text === 'Not found') {
      return;
    }

    navigator.clipboard.writeText(text)
      .then(() => {
        setAssetActionMessage(`${label} copied.`);
      })
      .catch((error) => {
        console.error(`Failed to copy ${label}:`, error);
        setAssetActionMessage(`Failed to copy ${label}.`);
      });
  }, []);

  const copyAssetPrompt = useCallback((contextImage: IndexedImage) => {
    const prompt = getImagePrompt(contextImage);
    setAssetContextMenu(null);
    copyInspectorValue('Prompt', prompt);
  }, [copyInspectorValue]);

  const showInspectorFieldContextMenu = useCallback((
    event: React.MouseEvent<HTMLElement>,
    label: string,
    value: string,
  ) => {
    const selection = window.getSelection()?.toString().trim();
    event.preventDefault();
    event.stopPropagation();
    setAssetContextMenu(null);
    setInspectorContextMenu({
      x: event.clientX,
      y: event.clientY,
      label: selection ? 'Selection' : label,
      value: selection || value,
    });
  }, []);

  const showInspectorSelectionContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select, [contenteditable="true"]')) {
      return;
    }

    const selection = window.getSelection()?.toString().trim();
    if (!selection) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setAssetContextMenu(null);
    setInspectorContextMenu({
      x: event.clientX,
      y: event.clientY,
      label: 'Selection',
      value: selection,
    });
  }, []);

  const copyInspectorContextValue = useCallback(() => {
    if (!inspectorContextMenu) {
      return;
    }

    copyInspectorValue(inspectorContextMenu.label, inspectorContextMenu.value);
    setInspectorContextMenu(null);
  }, [copyInspectorValue, inspectorContextMenu]);

  const toggleThumbRailCollapsed = useCallback(() => {
    setIsThumbRailCollapsed((current) => {
      const next = !current;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(THUMB_RAIL_COLLAPSED_STORAGE_KEY, String(next));
      }
      window.requestAnimationFrame(() => {
        void syncBounds();
      });
      return next;
    });
  }, [syncBounds]);

  const inspectWorkspaceImage = useCallback((nextImage: IndexedImage) => {
    onInspectImage?.(nextImage);
    setActiveInspectorTab('metadata');
  }, [onInspectImage]);

  const openWorkspacePreview = useCallback((visibleIndex: number) => {
    const selectedImage = visibleNavigationImages[visibleIndex];
    if (selectedImage) {
      inspectWorkspaceImage(selectedImage);
      setWorkspacePreviewIndex(visibleIndex);
    }
  }, [inspectWorkspaceImage, visibleNavigationImages]);

  const updateThumbSelection = useCallback((event: React.MouseEvent, contextImage: IndexedImage, visibleIndex: number) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey && lastSelectedThumbIndexRef.current !== null) {
      const start = Math.min(lastSelectedThumbIndexRef.current, visibleIndex);
      const end = Math.max(lastSelectedThumbIndexRef.current, visibleIndex);
      const rangeIds = visibleNavigationImages.slice(start, end + 1).map((candidate) => candidate.id);
      useImageStore.setState((state) => {
        const next = new Set(state.selectedImages);
        rangeIds.forEach((id) => next.add(id));
        return { selectedImages: next };
      });
    } else {
      toggleImageSelection(contextImage.id);
    }

    lastSelectedThumbIndexRef.current = visibleIndex;
  }, [toggleImageSelection, visibleNavigationImages]);

  const handleThumbnailClick = useCallback((event: React.MouseEvent<HTMLButtonElement>, contextImage: IndexedImage, visibleIndex: number) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      updateThumbSelection(event, contextImage, visibleIndex);
      return;
    }

    openWorkspacePreview(visibleIndex);
  }, [openWorkspacePreview, updateThumbSelection]);

  const getContextTargetImages = useCallback((contextImage?: IndexedImage | null) => {
    if (contextImage && selectedImages.has(contextImage.id) && selectedWorkspaceImages.length > 0) {
      return selectedWorkspaceImages;
    }
    return contextImage ? [contextImage] : selectedWorkspaceImages;
  }, [selectedImages, selectedWorkspaceImages]);

  const getCompareTargetImages = useCallback((contextImage?: IndexedImage | null) => {
    if (!contextImage) {
      return selectedWorkspaceImages;
    }
    if (selectedImages.has(contextImage.id)) {
      return selectedWorkspaceImages;
    }
    return [...selectedWorkspaceImages, contextImage];
  }, [selectedImages, selectedWorkspaceImages]);

  const openCompareMode = useCallback((targetImages: IndexedImage[]) => {
    if (targetImages.length < 2 || targetImages.length > 4) {
      setAssetActionMessage('Select 2 to 4 images to compare.');
      return;
    }
    onOpenCompare?.(targetImages);
    setAssetContextMenu(null);
  }, [onOpenCompare]);

  const exportImages = useCallback((targetImages: IndexedImage[]) => {
    const imageIds = targetImages.map((candidate) => candidate.id);
    if (imageIds.length === 0) {
      return;
    }
    window.dispatchEvent(new CustomEvent(OPEN_BATCH_EXPORT_EVENT, {
      detail: {
        imageIds,
        preferredSource: imageIds.length > 1 ? 'selected' : 'selected',
      },
    }));
    setAssetContextMenu(null);
  }, []);

  const deleteImages = useCallback(async (targetImages: IndexedImage[]) => {
    if (targetImages.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      targetImages.length === 1
        ? `Delete "${targetImages[0].name}"? This sends the file to the recycle bin.`
        : `Delete ${targetImages.length} selected images? This sends the files to the recycle bin.`,
    );
    if (!confirmed) {
      return;
    }

    const results = await Promise.all(targetImages.map((candidate) => FileOperations.deleteFile(candidate)));
    const deletedIds = targetImages
      .filter((_, index) => results[index]?.success)
      .map((candidate) => candidate.id);

    if (deletedIds.length > 0) {
      removeImages(deletedIds);
      useImageStore.setState((state) => ({
        selectedImages: new Set(Array.from(state.selectedImages).filter((id) => !deletedIds.includes(id))),
      }));
    }

    const failedCount = results.length - deletedIds.length;
    setAssetActionMessage(failedCount > 0 ? `Deleted ${deletedIds.length}; ${failedCount} failed.` : `Deleted ${deletedIds.length} image${deletedIds.length === 1 ? '' : 's'}.`);
    setAssetContextMenu(null);
  }, [removeImages]);

  const setSelectedRating = useCallback((rating: ImageRating | null) => {
    if (selectedWorkspaceIds.length === 0) {
      return;
    }
    void bulkSetImageRating(selectedWorkspaceIds, rating);
    setIsRatingMenuOpen(false);
  }, [bulkSetImageRating, selectedWorkspaceIds]);

  const showAssetContextMenu = useCallback((event: React.MouseEvent, contextImage: IndexedImage) => {
    event.preventDefault();
    event.stopPropagation();
    const thumbBounds = event.currentTarget.getBoundingClientRect();
    const browserBounds = browserHostRef.current?.getBoundingClientRect();
    const maxXBeforeBrowser = (browserBounds?.left ?? window.innerWidth) - ASSET_CONTEXT_MENU_WIDTH - 1;
    const preferredRightX = event.clientX;
    const flippedLeftX = thumbBounds.left - ASSET_CONTEXT_MENU_WIDTH - 8;
    const x = preferredRightX <= maxXBeforeBrowser
      ? preferredRightX
      : Math.max(0, Math.min(flippedLeftX, maxXBeforeBrowser));

    setAssetContextMenu({
      image: contextImage,
      x,
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - ASSET_CONTEXT_MENU_HEIGHT - 8)),
    });
  }, []);

  const inspectAsset = useCallback((contextImage: IndexedImage) => {
    inspectWorkspaceImage(contextImage);
    setAssetContextMenu(null);
  }, [inspectWorkspaceImage]);

  const openWorkflowInComfyUI = useCallback(async (contextImage: IndexedImage) => {
    setAssetContextMenu(null);
    inspectWorkspaceImage(contextImage);
    setActiveInspectorTab('workflow');
    setConnectionMessage('Loading workflow in ComfyUI...');
    setLoadFailure(null);

    if (!isElectron || !window.electronAPI?.comfyUIViewLoadWorkflow) {
      setConnectionMessage('Embedded ComfyUI workflow loading is only available in the desktop app.');
      return;
    }

    try {
      const bounds = browserHostRef.current ? getBounds(browserHostRef.current) : undefined;
      const workflowJson = formatImageForComfyUI(contextImage);
      const result = await window.electronAPI.comfyUIViewLoadWorkflow({
        url: targetUrl,
        bounds,
        workflow: workflowJson,
        title: contextImage.name,
        preferNewTab: true,
      });

      if (result?.state) {
        setViewState(result.state);
      }

      if (result?.success) {
        setComfyUIConnectionStatus('connected');
        setConnectionMessage(
          result.message ||
          (result.loadedInNewTab
            ? 'Workflow opened in a new ComfyUI tab.'
            : 'Workflow loaded into the current ComfyUI canvas.')
        );
        return;
      }

      setConnectionMessage(result?.error || 'Failed to load workflow in ComfyUI.');
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : 'Failed to load workflow in ComfyUI.');
    }
  }, [inspectWorkspaceImage, isElectron, setComfyUIConnectionStatus, targetUrl]);

  const handleOpenPreviewWorkflow = useCallback((contextImage: IndexedImage) => {
    setWorkspacePreviewIndex(null);
    window.setTimeout(() => {
      void openWorkflowInComfyUI(contextImage);
    }, 0);
  }, [openWorkflowInComfyUI]);

  const exportAssetImage = useCallback((contextImage: IndexedImage) => {
    exportImages(getContextTargetImages(contextImage));
  }, [exportImages, getContextTargetImages]);

  const exportAssetWorkflow = useCallback(async (contextImage: IndexedImage) => {
    setAssetContextMenu(null);
    if (!window.electronAPI?.showSaveDialog || !window.electronAPI?.writeFile) {
      setAssetActionMessage('Workflow export is only available in the desktop app.');
      return;
    }

    try {
      const defaultName = `${contextImage.name.replace(/\.[^.]+$/, '') || 'workflow'}.json`;
      const saveResult = await window.electronAPI.showSaveDialog({
        title: 'Export ComfyUI workflow',
        defaultPath: defaultName,
        filters: [{ name: 'ComfyUI workflow', extensions: ['json'] }],
      });
      if (!saveResult.success || saveResult.canceled || !saveResult.path) {
        return;
      }

      const workflowJson = formatImageForComfyUI(contextImage);
      const writeResult = await window.electronAPI.writeFile(saveResult.path, workflowJson);
      setAssetActionMessage(writeResult.success ? 'Workflow exported.' : writeResult.error || 'Failed to export workflow.');
    } catch (error) {
      setAssetActionMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const deleteAsset = useCallback(async (contextImage: IndexedImage) => {
    await deleteImages(getContextTargetImages(contextImage));
  }, [deleteImages, getContextTargetImages]);

  const handleBulkFavorite = useCallback(() => {
    if (selectedWorkspaceIds.length === 0) {
      return;
    }
    void bulkToggleFavorite(selectedWorkspaceIds, !allSelectedWorkspaceFavorites);
  }, [allSelectedWorkspaceFavorites, bulkToggleFavorite, selectedWorkspaceIds]);

  const handleBulkTag = useCallback(() => {
    if (selectedWorkspaceIds.length > 0) {
      setIsTagManagerOpen(true);
    }
  }, [selectedWorkspaceIds.length]);

  const handleBulkExport = useCallback(() => {
    exportImages(selectedWorkspaceImages);
  }, [exportImages, selectedWorkspaceImages]);

  const handleBulkDelete = useCallback(() => {
    void deleteImages(selectedWorkspaceImages);
  }, [deleteImages, selectedWorkspaceImages]);

  const handleBulkCompare = useCallback(() => {
    openCompareMode(selectedWorkspaceImages);
  }, [openCompareMode, selectedWorkspaceImages]);

  if (!isElectron) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-lg border border-gray-800 bg-gray-950 p-8 text-center">
        <div className="max-w-md">
          <Rocket className="mx-auto h-10 w-10 text-purple-300" />
          <h2 className="mt-4 text-lg font-semibold text-gray-100">ComfyUI workspace is desktop-only</h2>
          <p className="mt-2 text-sm text-gray-400">
            The embedded ComfyUI browser uses Electron. In the browser build, use the external ComfyUI window.
          </p>
          <button
            onClick={() => window.open(targetUrl, '_blank', 'noopener,noreferrer')}
            className="mt-5 rounded-md border border-purple-500/40 bg-purple-500/15 px-4 py-2 text-sm font-semibold text-purple-100 hover:bg-purple-500/25"
          >
            Open ComfyUI externally
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-950">
      <div className="flex min-h-0 flex-1">
        <aside
          className="flex min-h-0 shrink-0 flex-col border-r border-gray-800 bg-gray-900/95"
          style={{ width: isThumbRailCollapsed ? 44 : thumbRailWidth }}
        >
          <div className="border-b border-gray-800 p-2">
            {isThumbRailCollapsed ? (
              <button
                onClick={toggleThumbRailCollapsed}
                className="flex h-8 w-full items-center justify-center rounded-md text-gray-400 hover:bg-gray-800 hover:text-gray-100"
                title="Show thumbnails"
                aria-label="Show thumbnails"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <div className="flex items-center gap-1 rounded-md border border-gray-800 bg-gray-950 px-2 py-1.5">
                <Folder className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                <select
                  value={selectedDirectoryId || ''}
                  onChange={(event) => onSelectDirectory?.(event.target.value || null)}
                  className="min-w-0 flex-1 bg-transparent text-xs text-gray-200 outline-none"
                  title="Change workspace folder"
                  aria-label="Change workspace folder"
                >
                  <option value="">All folders</option>
                  {directories.map((directory) => (
                    <option key={directory.id} value={directory.id}>
                      {directory.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={toggleThumbRailCollapsed}
                  className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-100"
                  title="Hide thumbnails"
                  aria-label="Hide thumbnails"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {!isThumbRailCollapsed && (
            <>
            <label
              className="mt-2 flex cursor-pointer items-center justify-between gap-2 rounded-md border border-gray-800 bg-gray-950/70 px-2 py-1.5 text-[11px] text-gray-400"
              title="Use the current Library filters for this thumbnail rail"
            >
              <span className="truncate">Apply Library Filters</span>
              <input
                type="checkbox"
                checked={applyLibraryFilters}
                onChange={(event) => onApplyLibraryFiltersChange?.(event.target.checked)}
                className="h-3.5 w-3.5 accent-purple-500"
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="mr-auto rounded border border-gray-800 px-1.5 py-1 text-[10px] font-medium text-gray-400">
                {selectedWorkspaceCount}
              </span>
              <button
                onClick={handleBulkExport}
                disabled={selectedWorkspaceCount === 0}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:text-gray-700"
                title={selectedWorkspaceCount === 0 ? 'Select images to export' : 'Export selected'}
                aria-label="Export selected"
              >
                <Package className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleBulkFavorite}
                disabled={selectedWorkspaceCount === 0}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-pink-300 disabled:cursor-not-allowed disabled:text-gray-700"
                title={selectedWorkspaceCount === 0 ? 'Select images to favorite' : allSelectedWorkspaceFavorites ? 'Remove selected from favorites' : 'Favorite selected'}
                aria-label={allSelectedWorkspaceFavorites ? 'Remove selected from favorites' : 'Favorite selected'}
              >
                <Heart className={`h-3.5 w-3.5 ${allSelectedWorkspaceFavorites ? 'fill-current text-pink-300' : ''}`} />
              </button>
              <button
                onClick={handleBulkTag}
                disabled={selectedWorkspaceCount === 0}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-blue-300 disabled:cursor-not-allowed disabled:text-gray-700"
                title={selectedWorkspaceCount === 0 ? 'Select images to tag' : 'Tag selected'}
                aria-label="Tag selected"
              >
                <Tag className="h-3.5 w-3.5" />
              </button>
              <div className="relative">
                <button
                  onClick={() => setIsRatingMenuOpen((open) => !open)}
                  disabled={selectedWorkspaceCount === 0}
                  className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-yellow-300 disabled:cursor-not-allowed disabled:text-gray-700"
                  title={selectedWorkspaceCount === 0 ? 'Select images to rate' : 'Rate selected'}
                  aria-label="Rate selected"
                >
                  <Star className="h-3.5 w-3.5" />
                </button>
                {isRatingMenuOpen && selectedWorkspaceCount > 0 && (
                  <div className="absolute left-0 top-full z-[100] mt-1 w-24 overflow-hidden rounded-md border border-gray-700 bg-gray-900 py-1 shadow-xl">
                    {[0, 1, 2, 3, 4, 5].map((rating) => (
                      <button
                        key={rating}
                        onClick={() => setSelectedRating(rating === 0 ? null : (rating as ImageRating))}
                        className="block w-full px-2 py-1 text-left text-xs text-gray-200 hover:bg-gray-800"
                      >
                        {rating === 0 ? 'Clear' : `${rating} star${rating === 1 ? '' : 's'}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={handleBulkCompare}
                disabled={selectedWorkspaceCount < 2 || selectedWorkspaceCount > 4}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-purple-300 disabled:cursor-not-allowed disabled:text-gray-700"
                title={selectedWorkspaceCount < 2 ? 'Select at least 2 images to compare' : selectedWorkspaceCount > 4 ? 'Select at most 4 images to compare' : 'Compare selected'}
                aria-label="Compare selected"
              >
                <GitCompare className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedWorkspaceCount === 0}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-red-300 disabled:cursor-not-allowed disabled:text-gray-700"
                title={selectedWorkspaceCount === 0 ? 'Select images to delete' : 'Delete selected'}
                aria-label="Delete selected"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={clearImageSelection}
                disabled={selectedWorkspaceCount === 0}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:text-gray-700"
                title={selectedWorkspaceCount === 0 ? 'No selection to clear' : 'Clear selection'}
                aria-label="Clear selection"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            </>
            )}
          </div>

          {!isThumbRailCollapsed && (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {visibleNavigationImages.map((candidate, visibleIndex) => (
              <WorkspaceThumbnailButton
                key={candidate.id}
                image={candidate}
                isActive={candidate.id === image?.id}
                isSelected={selectedImages.has(candidate.id)}
                directoryPath={directoryPathByImageId[candidate.id]}
                onClick={(event) => handleThumbnailClick(event, candidate, visibleIndex)}
                onToggleSelected={(event) => updateThumbSelection(event, candidate, visibleIndex)}
                onToggleFavorite={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void toggleFavorite(candidate.id);
                }}
                onContextMenu={(event) => showAssetContextMenu(event, candidate)}
                onDragStart={startImageFileDrag}
              />
            ))}
          </div>
          )}
        </aside>

        {!isThumbRailCollapsed && (
        <div
          className="w-1 cursor-ew-resize bg-gray-800 hover:bg-purple-500/50"
          onPointerDown={beginThumbRailResize}
          onPointerMove={handleThumbRailResize}
          onPointerUp={endThumbRailResize}
          onPointerCancel={endThumbRailResize}
          title="Resize thumbnail rail"
        />
        )}

        <div className="relative min-w-0 flex-1 bg-black">
          <div ref={browserHostRef} className="absolute inset-0" />
          {shouldShowBrowserFallback && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950 text-center">
              <div className="max-w-sm px-6">
                {suspendBrowser ? (
                  <Loader2 className="mx-auto h-9 w-9 animate-spin text-purple-300" />
                ) : (
                  <AlertTriangle className="mx-auto h-9 w-9 text-amber-300" />
                )}
                <h3 className="mt-3 text-base font-semibold text-gray-100">
                  {suspendBrowser ? 'ComfyUI browser paused during generation' : 'ComfyUI is not visible yet'}
                </h3>
                <p className="mt-2 text-sm text-gray-400">
                  {suspendBrowser
                    ? 'Image MetaHub is generating through the API and temporarily hides the embedded ComfyUI UI to reduce memory pressure.'
                    : `Start ComfyUI and make sure it is reachable at ${targetUrl || 'the configured server URL'}.`}
                </p>
                {!suspendBrowser && (
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <button
                      onClick={reloadEmbeddedView}
                      className="inline-flex items-center gap-2 rounded-md border border-purple-500/40 bg-purple-500/15 px-3 py-2 text-sm font-semibold text-purple-100 hover:bg-purple-500/25"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Refresh
                    </button>
                    <button
                      onClick={onOpenSettings}
                      className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      Settings
                    </button>
                    <button
                      onClick={openExternally}
                      className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open externally
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {!isPanelCollapsed && (
          <div
            className="w-1 cursor-ew-resize bg-gray-800 hover:bg-purple-500/50"
            onPointerDown={beginPanelResize}
            onPointerMove={handlePanelResize}
            onPointerUp={endPanelResize}
            onPointerCancel={endPanelResize}
            title="Resize ComfyUI context panel"
          />
        )}

        <aside
          className={`min-h-0 border-l border-gray-800 bg-gray-900/95 transition-[width] duration-200 ${
            isPanelCollapsed ? 'overflow-hidden p-0' : 'overflow-y-auto p-4'
          }`}
          style={{ width: isPanelCollapsed ? 44 : panelWidth }}
        >
          {isPanelCollapsed ? (
            <button
              onClick={togglePanelCollapsed}
              className="flex h-full w-full items-start justify-center pt-3 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
              title="Show IMH context panel"
              aria-label="Show IMH context panel"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : (
          <>
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${connectionClasses}`}
                    title={`${comfyUILastConnectionStatus === 'connected' ? 'Connected' : loadFailure ? 'Load failed' : 'ComfyUI'} - ${viewState.url || targetUrl}`}
                  >
                    {viewState.isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                  </div>
                  <h2 className="truncate text-sm font-semibold text-gray-100">Image Inspector</h2>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {connectionMessage || (currentPosition > 0 ? `${currentPosition} / ${normalizedNavigationImages.length}` : 'No image selected')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => window.electronAPI?.comfyUIViewGoBack?.()} disabled={!viewState.canGoBack} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100 disabled:opacity-40" title="Back" aria-label="Back">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button onClick={() => window.electronAPI?.comfyUIViewGoForward?.()} disabled={!viewState.canGoForward} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100 disabled:opacity-40" title="Forward" aria-label="Forward">
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button onClick={openExternally} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" title="Open externally" aria-label="Open externally">
                  <ExternalLink className="h-4 w-4" />
                </button>
                <button onClick={reloadEmbeddedView} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" title="Refresh ComfyUI" aria-label="Refresh ComfyUI">
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button onClick={togglePanelCollapsed} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" title="Hide image inspector" aria-label="Hide image inspector">
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button onClick={onOpenSettings} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" title="Open integration settings" aria-label="Open integration settings">
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {!image ? (
            <div className="mt-6 rounded-lg border border-gray-800 bg-gray-950/80 p-4 text-sm text-gray-400">
              Select an image to send workflow data from Image MetaHub into ComfyUI.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={onNavigatePrevious}
                  disabled={!canNavigatePrevious}
                  className="rounded border border-gray-700 px-2 py-1 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-40"
                >
                  Previous
                </button>
                <div className="min-w-0 flex-1 truncate text-center text-xs text-gray-500">
                  {currentPosition} / {normalizedNavigationImages.length}
                </div>
                <button
                  onClick={onNavigateNext}
                  disabled={!canNavigateNext}
                  className="rounded border border-gray-700 px-2 py-1 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-40"
                >
                  Next
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1 rounded-lg border border-gray-800 bg-gray-950/80 p-1">
                {inspectorTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isSelected = activeInspectorTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveInspectorTab(tab.id)}
                      className={`inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                        isSelected
                          ? 'bg-purple-500/20 text-purple-100'
                          : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {activeInspectorTab === 'image' && (
                <>
              <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
                {thumbnail?.thumbnailUrl ? (
                  <img
                    src={thumbnail.thumbnailUrl}
                    alt={image.name}
                    className="h-44 w-full cursor-grab object-contain bg-black active:cursor-grabbing"
                    draggable={Boolean(directoryPath && window.electronAPI?.startFileDrag)}
                    onDragStart={(event) => startImageFileDrag(event, image, directoryPath)}
                    title="Drag into ComfyUI"
                  />
                ) : (
                  <div className="flex h-44 items-center justify-center bg-black text-xs text-gray-600">No thumbnail</div>
                )}
                <div className="border-t border-gray-800 p-3">
                  <div className="truncate text-sm font-medium text-gray-100" title={image.name}>{image.name}</div>
                  {hasVerifiedTelemetry(image) && (
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-300">
                      <CheckCircle className="h-3.5 w-3.5" />
                      Verified telemetry
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={generateFromMetadata}
                  disabled={isGenerating || !metadata?.prompt}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-purple-500/40 bg-purple-500/15 px-3 py-2 text-xs font-semibold text-purple-100 hover:bg-purple-500/25 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  Generate
                </button>
                <button
                  onClick={() => copyToComfyUI(image)}
                  disabled={isCopying || !metadata?.prompt}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                  Copy JSON
                </button>
                <button
                  onClick={onOpenQueue}
                  className="col-span-2 rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800"
                >
                  Open generation queue
                </button>
              </div>
                </>
              )}

              {(copyStatus || generateStatus) && (
                <div className={`rounded-md border px-3 py-2 text-xs ${
                  (copyStatus?.success || generateStatus?.success)
                    ? 'border-green-700/40 bg-green-500/10 text-green-200'
                    : 'border-red-700/40 bg-red-500/10 text-red-200'
                }`}>
                  {copyStatus?.message || generateStatus?.message}
                </div>
              )}

              {assetActionMessage && (
                <div className="rounded-md border border-blue-700/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
                  {assetActionMessage}
                </div>
              )}

              {activeInspectorTab === 'metadata' && (
                metadata ? (
                  <div className="space-y-3" onContextMenu={showInspectorSelectionContextMenu}>
                  <div className="grid grid-cols-2 gap-2">
                    <MetadataLine label="Model" value={metadata.model} onCopy={copyInspectorValue} onContextMenu={showInspectorFieldContextMenu} />
                    <MetadataLine label="Seed" value={metadata.seed} onCopy={copyInspectorValue} onContextMenu={showInspectorFieldContextMenu} />
                    <MetadataLine label="Steps" value={metadata.steps} onCopy={copyInspectorValue} onContextMenu={showInspectorFieldContextMenu} />
                    <MetadataLine label="CFG" value={(metadata as any).cfgScale ?? metadata.cfg_scale} onCopy={copyInspectorValue} onContextMenu={showInspectorFieldContextMenu} />
                    <MetadataLine label="Sampler" value={metadata.sampler} onCopy={copyInspectorValue} onContextMenu={showInspectorFieldContextMenu} />
                    <MetadataLine label="Scheduler" value={metadata.scheduler} onCopy={copyInspectorValue} onContextMenu={showInspectorFieldContextMenu} />
                    <MetadataLine
                      label="Dimensions"
                      value={metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : undefined}
                      onCopy={copyInspectorValue}
                      onContextMenu={showInspectorFieldContextMenu}
                    />
                    <MetadataLine
                      label="LoRAs"
                      value={Array.isArray(metadata.loras) && metadata.loras.length > 0
                        ? metadata.loras.map((lora) => typeof lora === 'string' ? lora : lora.name || lora.model_name || '').filter(Boolean).join(', ')
                        : undefined}
                      onCopy={copyInspectorValue}
                      onContextMenu={showInspectorFieldContextMenu}
                    />
                  </div>

                  <MetadataTextBlock
                    label="Prompt"
                    value={metadata.prompt}
                    maxHeightClass="max-h-40"
                    onCopy={copyInspectorValue}
                    onContextMenu={showInspectorFieldContextMenu}
                  />

                  <MetadataTextBlock
                    label="Negative prompt"
                    value={metadata.negativePrompt}
                    maxHeightClass="max-h-32"
                    onCopy={copyInspectorValue}
                    onContextMenu={showInspectorFieldContextMenu}
                  />
                </div>
                ) : (
                  <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-4 text-sm text-gray-400">
                    No normalized metadata is available for this image.
                  </div>
                )
              )}

              {activeInspectorTab === 'workflow' && (
                metadata ? (
                <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-3">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Workflow controls
                  </div>
                  <ComfyUIWorkflowWorkspace
                    image={image}
                    directoryPath={directoryPath}
                    onGenerate={handleGenerateFromWorkspace}
                    isGenerating={isGenerating}
                    status={generateStatus}
                    defaultTab="parameters"
                    viewportHeight={360}
                    showCancelButton={false}
                  />
                </div>
                ) : (
                  <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-4 text-sm text-gray-400">
                    Workflow controls need normalized generation metadata.
                  </div>
                )
              )}
            </div>
          )}
          </>
          )}
        </aside>
      </div>
      {workspacePreviewIndex !== null && (
        <WorkspaceImagePreviewModal
          images={visibleNavigationImages}
          initialIndex={workspacePreviewIndex}
          onInspectImage={inspectWorkspaceImage}
          onOpenWorkflow={handleOpenPreviewWorkflow}
          onViewFullMetadata={onViewFullMetadata}
          onClose={() => setWorkspacePreviewIndex(null)}
        />
      )}
      {inspectorContextMenu && (
        <div
          className="fixed z-[96] min-w-[160px] overflow-hidden rounded-lg border border-gray-700 bg-gray-900 py-1 text-sm text-gray-100 shadow-2xl"
          style={{ left: inspectorContextMenu.x, top: inspectorContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-800"
            onClick={copyInspectorContextValue}
          >
            <Copy className="h-4 w-4" />
            Copy {inspectorContextMenu.label}
          </button>
        </div>
      )}
      {assetContextMenu && (
        <div
          className="fixed z-[95] w-56 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 py-1 text-sm text-gray-100 shadow-2xl"
          style={{ left: assetContextMenu.x, top: assetContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-800"
            onClick={() => inspectAsset(assetContextMenu.image)}
          >
            <Info className="h-4 w-4" />
            Inspect Asset
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-800"
            onClick={() => {
              void openWorkflowInComfyUI(assetContextMenu.image);
            }}
          >
            <Workflow className="h-4 w-4" />
            Open Workflow in ComfyUI
          </button>
          <button
            className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
              getCompareTargetImages(assetContextMenu.image).length >= 2 && getCompareTargetImages(assetContextMenu.image).length <= 4
                ? 'hover:bg-gray-800'
                : 'cursor-not-allowed text-gray-500'
            }`}
            disabled={getCompareTargetImages(assetContextMenu.image).length < 2 || getCompareTargetImages(assetContextMenu.image).length > 4}
            onClick={() => openCompareMode(getCompareTargetImages(assetContextMenu.image))}
          >
            <GitCompare className="h-4 w-4" />
            Compare Mode
          </button>
          <button
            className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
              getImagePrompt(assetContextMenu.image) ? 'hover:bg-gray-800' : 'cursor-not-allowed text-gray-500'
            }`}
            disabled={!getImagePrompt(assetContextMenu.image)}
            onClick={() => copyAssetPrompt(assetContextMenu.image)}
          >
            <Copy className="h-4 w-4" />
            Copy Prompt
          </button>
          <div className="my-1 border-t border-gray-700" />
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-800"
            onClick={() => exportAssetImage(assetContextMenu.image)}
          >
            <Download className="h-4 w-4" />
            Export Image
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-800"
            onClick={() => exportAssetWorkflow(assetContextMenu.image)}
          >
            <Workflow className="h-4 w-4" />
            Export Workflow
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-300 hover:bg-red-950/40"
            onClick={() => deleteAsset(assetContextMenu.image)}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      )}
      <TagManagerModal
        isOpen={isTagManagerOpen}
        onClose={() => setIsTagManagerOpen(false)}
        selectedImageIds={selectedWorkspaceIds}
      />
    </div>
  );
};

export default ComfyUIWorkspace;
