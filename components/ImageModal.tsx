import React, { useEffect, useLayoutEffect, useState, FC, useCallback, useMemo, useRef } from 'react';
import { type IndexedImage, type BaseMetadata, type LoRAInfo, type SmartCollection } from '../types';
import { FileOperations } from '../services/fileOperations';
import { copyImageToClipboard, showInExplorer } from '../utils/imageUtils';
import { Copy, Pencil, Trash2, ChevronDown, ChevronRight, Folder, Download, Clipboard, Sparkles, GitCompare, Heart, X, Zap, CheckCircle, ArrowUp, Play, Pause, Volume2, VolumeX, Repeat, Eye, EyeOff, Search, Minus, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { useCopyToA1111 } from '../hooks/useCopyToA1111';
import { useGenerateWithA1111 } from '../hooks/useGenerateWithA1111';
import { useCopyToComfyUI } from '../hooks/useCopyToComfyUI';
import { useGenerateWithComfyUI } from '../hooks/useGenerateWithComfyUI';
import { comparisonWillAutoOpen, useImageComparison } from '../hooks/useImageComparison';
import { useReparseMetadata } from '../hooks/useReparseMetadata';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useGenerationProviderAvailability } from '../hooks/useGenerationProviderAvailability';
import { A1111GenerateModal, type GenerationParams as A1111GenerationParams } from './A1111GenerateModal';
import { type GenerationParams as ComfyUIGenerationParams } from './ComfyUIGenerateModal';
import ComfyUIWorkflowWorkspace from './ComfyUIWorkflowWorkspace';
import ProBadge from './ProBadge';
import hotkeyManager from '../services/hotkeyManager';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { mediaSourceCache } from '../services/mediaSourceCache';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';

import { hasVerifiedTelemetry } from '../utils/telemetryDetection';
import { eventMatchesKeybinding, isTypingElement } from '../utils/hotkeyUtils';
import { useShadowMetadata } from '../hooks/useShadowMetadata';
import { MetadataEditorModal } from './MetadataEditorModal';
import ImageLineageSection from './ImageLineageSection';
import { getGenerationTypeLabel } from '../utils/imageLineage';
import RatingStars from './RatingStars';
import TagInputCombobox from './TagInputCombobox';
import { getRecentTagChips } from '../utils/tagSuggestions';
import CollectionFormModal, { CollectionFormValues } from './CollectionFormModal';


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
  modalId?: string;
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
  zIndex?: number;
  isActive?: boolean;
  onActivate?: () => void;
  initialWindowOffset?: number;
  isMinimized?: boolean;
  onMinimize?: () => void;
}

interface ModalWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ModalInteractionState =
  | { mode: 'idle' }
  | {
      mode: 'drag';
      startX: number;
      startY: number;
      initialX: number;
      initialY: number;
    }
  | {
      mode: 'resize';
      startX: number;
      startY: number;
      initialWidth: number;
      initialHeight: number;
      initialX: number;
      initialY: number;
      direction:
        | 'top'
        | 'right'
        | 'bottom'
        | 'left'
        | 'top-left'
        | 'top-right'
        | 'bottom-left'
        | 'bottom-right';
    };

const MODAL_MARGIN = 20;
const MIN_MODAL_WIDTH = 760;
const MIN_MODAL_HEIGHT = 520;
const DEFAULT_MODAL_MAX_WIDTH = 1600;
const DEFAULT_MODAL_MAX_HEIGHT = 1080;
const MODAL_MIN_VISIBLE_WIDTH = 120;
const MODAL_RECOVERABLE_TOP_HEIGHT = 80;
const WINDOW_PROXY_ANIMATION_DURATION_MS = 140;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getFooterWindowElement = (modalId?: string): HTMLElement | null => {
  if (!modalId || typeof document === 'undefined') {
    return null;
  }

  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-image-modal-window-id]')
  ).find((element) => element.dataset.imageModalWindowId === modalId) ?? null;
};

const shouldSkipWindowAnimation = (animationsEnabled: boolean) =>
  !animationsEnabled ||
  typeof window === 'undefined' ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const animateWindowProxy = async (fromRect: DOMRect, toRect: DOMRect, zIndex: number) => {
  if (typeof document === 'undefined') {
    return;
  }

  const proxy = document.createElement('div');
  const scaleX = Math.max(toRect.width / Math.max(fromRect.width, 1), 0.04);
  const scaleY = Math.max(toRect.height / Math.max(fromRect.height, 1), 0.04);

  proxy.style.position = 'fixed';
  proxy.style.left = `${fromRect.left}px`;
  proxy.style.top = `${fromRect.top}px`;
  proxy.style.width = `${fromRect.width}px`;
  proxy.style.height = `${fromRect.height}px`;
  proxy.style.border = '1px solid rgba(148, 163, 184, 0.45)';
  proxy.style.borderRadius = '12px';
  proxy.style.background = 'rgba(31, 41, 55, 0.72)';
  proxy.style.boxShadow = '0 18px 45px rgba(0, 0, 0, 0.35)';
  proxy.style.pointerEvents = 'none';
  proxy.style.transformOrigin = 'top left';
  proxy.style.willChange = 'transform, opacity';
  proxy.style.zIndex = `${Math.max(zIndex + 1, 100)}`;

  document.body.appendChild(proxy);

  try {
    if (typeof proxy.animate !== 'function') {
      return;
    }

    const animation = proxy.animate(
      [
        { opacity: 0.72, transform: 'translate3d(0, 0, 0) scale(1, 1)' },
        {
          opacity: 0.18,
          transform: `translate3d(${toRect.left - fromRect.left}px, ${toRect.top - fromRect.top}px, 0) scale(${scaleX}, ${scaleY})`,
        },
      ],
      {
        duration: WINDOW_PROXY_ANIMATION_DURATION_MS,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      }
    );

    await animation.finished;
  } catch {
    // Animation cancellation should not block the window action.
  } finally {
    proxy.remove();
  }
};

const getModalViewportMetrics = () => {
  if (typeof window === 'undefined') {
    return {
      viewportWidth: DEFAULT_MODAL_MAX_WIDTH,
      viewportHeight: DEFAULT_MODAL_MAX_HEIGHT,
      margin: MODAL_MARGIN,
      minWidth: MIN_MODAL_WIDTH,
      minHeight: MIN_MODAL_HEIGHT,
    };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = viewportWidth < 900 ? 12 : MODAL_MARGIN;

  return {
    viewportWidth,
    viewportHeight,
    margin,
    minWidth: Math.min(MIN_MODAL_WIDTH, Math.max(420, viewportWidth - margin * 2)),
    minHeight: Math.min(MIN_MODAL_HEIGHT, Math.max(360, viewportHeight - margin * 2)),
  };
};

const createDefaultModalWindow = (): ModalWindowState => {
  const metrics = getModalViewportMetrics();
  const width = clamp(
    Math.min(DEFAULT_MODAL_MAX_WIDTH, metrics.viewportWidth - metrics.margin * 2),
    metrics.minWidth,
    metrics.viewportWidth - metrics.margin * 2
  );
  const height = clamp(
    Math.min(Math.round(metrics.viewportHeight * 0.9), DEFAULT_MODAL_MAX_HEIGHT),
    metrics.minHeight,
    metrics.viewportHeight - metrics.margin * 2
  );

  return {
    width,
    height,
    x: Math.round((metrics.viewportWidth - width) / 2),
    y: Math.round((metrics.viewportHeight - height) / 2),
  };
};

const createMaximizedModalWindow = (): ModalWindowState => {
  const metrics = getModalViewportMetrics();
  const margin = Math.max(8, metrics.margin - 8);
  const width = Math.max(metrics.minWidth, metrics.viewportWidth - margin * 2);
  const height = Math.max(metrics.minHeight, metrics.viewportHeight - margin * 2);

  return {
    x: margin,
    y: margin,
    width,
    height,
  };
};

const getRecoverableModalPositionBounds = (width: number, height: number) => {
  const metrics = getModalViewportMetrics();
  const visibleWidth = Math.min(MODAL_MIN_VISIBLE_WIDTH, Math.max(1, width));
  const recoverableTopHeight = Math.min(MODAL_RECOVERABLE_TOP_HEIGHT, Math.max(1, height));
  const minX = -width + visibleWidth;
  const maxX = metrics.viewportWidth - visibleWidth;
  const minY = 0;
  const maxY = Math.max(0, metrics.viewportHeight - recoverableTopHeight);

  return {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minY: Math.min(minY, maxY),
    maxY: Math.max(minY, maxY),
  };
};

const clampModalWindowToViewport = (windowState: ModalWindowState): ModalWindowState => {
  const metrics = getModalViewportMetrics();
  const maxWidth = Math.max(metrics.minWidth, metrics.viewportWidth - metrics.margin * 2);
  const maxHeight = Math.max(metrics.minHeight, metrics.viewportHeight - metrics.margin * 2);
  const width = clamp(windowState.width, metrics.minWidth, maxWidth);
  const height = clamp(windowState.height, metrics.minHeight, maxHeight);
  const bounds = getRecoverableModalPositionBounds(width, height);

  return {
    width,
    height,
    x: clamp(windowState.x, bounds.minX, bounds.maxX),
    y: clamp(windowState.y, bounds.minY, bounds.maxY),
  };
};

type ContextMenuState =
  | {
      visible: false;
      x: number;
      y: number;
      kind: 'media' | 'selection';
      selectionText: string;
    }
  | {
      visible: true;
      x: number;
      y: number;
      kind: 'media' | 'selection';
      selectionText: string;
    };

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

const formatGenerationTime = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

const formatDurationSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

const formatVRAM = (vramMb: number, gpuDevice?: string | null): string => {
  const vramGb = vramMb / 1024;

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

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov', '.avi'];

const isVideoFileName = (fileName: string, fileType?: string | null): boolean => {
  if (fileType && fileType.startsWith('video/')) {
    return true;
  }
  const lower = fileName.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

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

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const VideoPlayer: React.FC<{
  src: string;
  poster?: string;
  onContextMenu?: React.MouseEventHandler;
}> = ({ src, poster, onContextMenu }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('video_player_volume');
    return saved ? parseFloat(saved) : 1;
  });
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('video_player_muted') === 'true';
  });
  const [isLooping, setIsLooping] = useState(() => {
    return localStorage.getItem('video_player_loop') === 'true';
  });

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
      videoRef.current.loop = isLooping;
    }
  }, [volume, isMuted, isLooping]);

  useEffect(() => {
     localStorage.setItem('video_player_volume', volume.toString());
     localStorage.setItem('video_player_muted', isMuted.toString());
     localStorage.setItem('video_player_loop', isLooping.toString());
  }, [volume, isMuted, isLooping]);

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(console.error);
      } else {
        videoRef.current.pause();
      }
    }
  }, []);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMuted(prev => !prev);
  }, []);

  const toggleLoop = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLooping(prev => !prev);
  }, []);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    if (newVol > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center bg-black group/video"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={togglePlay}
      onContextMenu={onContextMenu}
    >
      <video
        ref={videoRef}
        src={src}
        className="max-w-full max-h-full object-contain"
        poster={poster}
        autoPlay
        playsInline
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Center Play Button Overlay (only when paused and not hovering controls) */}
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 backdrop-blur-sm rounded-full p-4 text-white hover:bg-black/70 transition-all pointer-events-auto cursor-pointer transform hover:scale-110" onClick={togglePlay}>
            <Play size={48} fill="currentColor" />
          </div>
        </div>
      )}

      {/* Controls Overlay */}
      <div 
        className={`absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity duration-300 ${isHovering || !isPlaying ? 'opacity-100' : 'opacity-0'}`}
        onClick={(e) => e.stopPropagation()} // Prevent clicking controls from toggling play
      >
        {/* Progress Bar */}
        <div className="w-full mb-2 flex items-center gap-2 group/progress">
            <span className="text-xs font-mono text-gray-300">{formatTime(currentTime)}</span>
            <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={handleSeek}
                className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer hover:h-2 transition-all accent-blue-500"
            />
            <span className="text-xs font-mono text-gray-300">{formatTime(duration)}</span>
        </div>

        {/* Buttons Row */}
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                <button onClick={togglePlay} className="text-white hover:text-blue-400 transition-colors">
                    {isPlaying ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor"/>}
                </button>
                
                <div className="flex items-center gap-2 group/volume">
                    <button onClick={toggleMute} className="text-white hover:text-blue-400 transition-colors">
                        {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                    </button>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                        className="w-0 overflow-hidden group-hover/volume:w-20 transition-all duration-300 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                </div>
            </div>

            <div className="flex items-center gap-4">
                <button 
                  onClick={toggleLoop} 
                  className={`transition-colors ${isLooping ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
                  title={isLooping ? "Loop On" : "Loop Off"}
                >
                    <Repeat size={18} />
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};



const ImageModal: React.FC<ImageModalProps> = ({
  modalId,
  image,
  onClose,
  onImageDeleted,
  onImageRenamed,
  currentIndex = 0,
  totalImages = 0,
  onNavigateNext,
  onNavigatePrevious,
  directoryPath,
  isIndexing = false,
  zIndex = 50,
  isActive = true,
  onActivate,
  initialWindowOffset = 0,
  isMinimized = false,
  onMinimize,
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(image.name.replace(/\.(png|jpg|jpeg|webp|mp4|webm|mkv|mov|avi)$/i, ''));
  const [showRawMetadata, setShowRawMetadata] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    x: 0,
    y: 0,
    visible: false,
    kind: 'media',
    selectionText: '',
  });
  const [isCollectionSubmenuOpen, setIsCollectionSubmenuOpen] = useState(false);
  const [isAddToCollectionSubmenuOpen, setIsAddToCollectionSubmenuOpen] = useState(false);
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [showPerformance, setShowPerformance] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'details' | 'workflow'>('details');
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [detailsPlacement, setDetailsPlacement] = useState<'right' | 'bottom'>('right');
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [modalWindow, setModalWindow] = useState<ModalWindowState>(() => {
    const defaultWindow = createDefaultModalWindow();
    return clampModalWindowToViewport({
      ...defaultWindow,
      x: defaultWindow.x + initialWindowOffset,
      y: defaultWindow.y + initialWindowOffset,
    });
  });
  const [modalInteraction, setModalInteraction] = useState<ModalInteractionState>({ mode: 'idle' });
  const modalShellRef = useRef<HTMLDivElement>(null);
  const modalWindowRef = useRef<ModalWindowState>(modalWindow);
  const liveModalWindowRef = useRef<ModalWindowState>(modalWindow);
  const modalPaintFrameRef = useRef<number | null>(null);
  const restoredModalWindowRef = useRef<ModalWindowState | null>(null);
  const isMinimizeAnimatingRef = useRef(false);
  const wasMinimizedRef = useRef(isMinimized);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const canDragExternally = typeof window !== 'undefined' && !!window.electronAPI?.startFileDrag;
  const enableAnimations = useSettingsStore((state) => state.enableAnimations);

  useEffect(() => {
    if (!isMinimized) {
      isMinimizeAnimatingRef.current = false;
    }
  }, [isMinimized]);

  useLayoutEffect(() => {
    const wasMinimized = wasMinimizedRef.current;
    wasMinimizedRef.current = isMinimized;

    if (isMinimized || !wasMinimized || shouldSkipWindowAnimation(enableAnimations)) {
      return;
    }

    const modalElement = modalShellRef.current;
    const targetElement = getFooterWindowElement(modalId);

    if (!modalElement || !targetElement) {
      return;
    }

    const modalRect = modalElement.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();

    modalElement.style.pointerEvents = 'none';
    modalElement.style.opacity = '0';

    const restoreModalInteractivity = () => {
      modalElement.style.pointerEvents = '';
      modalElement.style.opacity = '';
    };

    void animateWindowProxy(targetRect, modalRect, zIndex).then(restoreModalInteractivity, restoreModalInteractivity);
  }, [enableAnimations, isMinimized, modalId, zIndex]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const { copyToA1111, isCopying, copyStatus } = useCopyToA1111();
  const { generateWithA1111, isGenerating, generateStatus } = useGenerateWithA1111();

  const { copyToComfyUI, isCopying: isCopyingComfyUI, copyStatus: copyStatusComfyUI } = useCopyToComfyUI();
  const { generateWithComfyUI, isGenerating: isGeneratingComfyUI, generateStatus: generateStatusComfyUI } = useGenerateWithComfyUI();

  const { addImage, comparisonCount } = useImageComparison();
  const { isReparsing, reparseImages } = useReparseMetadata();

  const { canUseA1111, canUseComfyUI, canUseComparison, showProModal, initialized } = useFeatureAccess();
  const { a1111Enabled, comfyUIEnabled, visibleProviders, singleVisibleProvider } = useGenerationProviderAvailability();

  const toggleFavorite = useImageStore((state) => state.toggleFavorite);
  const setImageRating = useImageStore((state) => state.setImageRating);
  const addTagToImage = useImageStore((state) => state.addTagToImage);
  const removeTagFromImage = useImageStore((state) => state.removeTagFromImage);
  const removeAutoTagFromImage = useImageStore((state) => state.removeAutoTagFromImage);
  const availableTags = useImageStore((state) => state.availableTags);
  const setSearchQuery = useImageStore((state) => state.setSearchQuery);
  const recentTags = useImageStore((state) => state.recentTags);
  const setSelectedImage = useImageStore((state) => state.setSelectedImage);
  const setPreviewImage = useImageStore((state) => state.setPreviewImage);
  const collections = useImageStore((state) => state.collections);
  const createCollection = useImageStore((state) => state.createCollection);
  const addImagesToCollection = useImageStore((state) => state.addImagesToCollection);

  const { metadata: shadowMetadata, saveMetadata: saveShadowMetadata, deleteMetadata: deleteShadowMetadata } = useShadowMetadata(image.id);
  const [isMetadataEditorOpen, setIsMetadataEditorOpen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const imageFromStore = useImageStore(
    useCallback(
      (state) => state.images.find((candidate) => candidate.id === image.id),
      [image.id]
    )
  );
  const liveImage = imageFromStore ?? image;
  const thumbnail = useResolvedThumbnail(liveImage);
  const isVideo = isVideoFileName(image.name, image.fileType);
  const showA1111Actions = !isVideo && a1111Enabled;
  const showComfyUIActions = !isVideo && comfyUIEnabled;
  const showComfyUIHeading = showA1111Actions && visibleProviders.length > 1;
  const a1111GenerateLabel = singleVisibleProvider?.id === 'a1111' ? 'Generate' : 'Generate with A1111';
  const currentTags = liveImage.tags || [];
  const currentAutoTags = liveImage.autoTags || [];
  const currentIsFavorite = liveImage.isFavorite ?? false;
  const currentRating = liveImage.rating ?? null;
  const tagSuggestionLimit = useSettingsStore((state) => state.tagSuggestionLimit);
  const recentTagChipLimit = useSettingsStore((state) => state.recentTagChipLimit);
  const preferredThumbnailUrl = thumbnail?.thumbnailUrl ?? null;
  const recentTagSuggestions = useMemo(() => getRecentTagChips({
    recentTags,
    excludedTags: currentTags,
    limit: recentTagChipLimit,
  }), [currentTags, recentTagChipLimit, recentTags]);
  const createdAtLabel = useMemo(() => new Date(image.lastModified).toLocaleString(), [image.lastModified]);

  const [tagInput, setTagInput] = useState('');
  const [isMediaOverlayVisible, setIsMediaOverlayVisible] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const mediaOverlayHideTimeoutRef = useRef<number | null>(null);
  const previewKeymap = useSettingsStore((state) => state.keymap.preview as Record<string, string> | undefined);
  const toggleFullscreenKeybinding = previewKeymap?.toggleFullscreenInViewer || 'alt+enter';
  const isWindowInteractionActive = modalInteraction.mode !== 'idle';
  const showSidebar = !isFullscreen && !isSidebarCollapsed;
  const showSidebarOnBottom = showSidebar && detailsPlacement === 'bottom';
  const showSidebarOnRight = showSidebar && detailsPlacement === 'right';
  const imageFullPath = directoryPath
    ? `${directoryPath}${/[\\/]$/.test(directoryPath) ? '' : '\\'}${image.name}`
    : image.name;
  const mediaOverlayVisibilityClass = isMediaOverlayVisible ? 'opacity-100' : 'opacity-0 pointer-events-none';

  useEffect(() => {
    if (contextMenu.visible) {
      return;
    }

    setIsCollectionSubmenuOpen(false);
    setIsAddToCollectionSubmenuOpen(false);
  }, [contextMenu.visible]);

  const applyModalWindowStyles = useCallback((windowState: ModalWindowState) => {
    if (isFullscreen || !modalShellRef.current) {
      return;
    }

    modalShellRef.current.style.left = `${windowState.x}px`;
    modalShellRef.current.style.top = `${windowState.y}px`;
    modalShellRef.current.style.width = `${windowState.width}px`;
    modalShellRef.current.style.height = `${windowState.height}px`;
  }, [isFullscreen]);

  const scheduleModalWindowPaint = useCallback((windowState: ModalWindowState) => {
    liveModalWindowRef.current = windowState;

    if (typeof window === 'undefined' || modalPaintFrameRef.current !== null) {
      return;
    }

    modalPaintFrameRef.current = window.requestAnimationFrame(() => {
      modalPaintFrameRef.current = null;
      applyModalWindowStyles(liveModalWindowRef.current);
    });
  }, [applyModalWindowStyles]);

  const toggleFullscreen = useCallback(async () => {
    if (window.electronAPI?.toggleFullscreen) {
      const result = await window.electronAPI.toggleFullscreen();
      if (result.success) {
        setIsFullscreen(result.isFullscreen ?? false);
      }
    }
  }, []);

  const clearMediaOverlayHideTimer = useCallback(() => {
    if (typeof window === 'undefined' || mediaOverlayHideTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(mediaOverlayHideTimeoutRef.current);
    mediaOverlayHideTimeoutRef.current = null;
  }, []);

  const revealMediaOverlay = useCallback(() => {
    setIsMediaOverlayVisible(true);
    clearMediaOverlayHideTimer();

    if (typeof window === 'undefined') {
      return;
    }

    mediaOverlayHideTimeoutRef.current = window.setTimeout(() => {
      setIsMediaOverlayVisible(false);
      mediaOverlayHideTimeoutRef.current = null;
    }, 1500);
  }, [clearMediaOverlayHideTimer]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const unsubscribeFullscreenChanged = window.electronAPI?.onFullscreenChanged?.((data) => {
      setIsFullscreen(data.isFullscreen ?? false);
    });

    const unsubscribeFullscreenStateCheck = window.electronAPI?.onFullscreenStateCheck?.((data) => {
      setIsFullscreen(data.isFullscreen ?? false);
    });

    return () => {
      unsubscribeFullscreenChanged?.();
      unsubscribeFullscreenStateCheck?.();
    };
  }, [isActive]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const shouldStartFullscreen = sessionStorage.getItem('openImageFullscreen') === 'true';
    if (shouldStartFullscreen) {
      sessionStorage.removeItem('openImageFullscreen');
      setTimeout(() => {
        if (window.electronAPI?.toggleFullscreen) {
          window.electronAPI.toggleFullscreen().then((result) => {
            if (result?.success) {
              setIsFullscreen(result.isFullscreen ?? false);
            }
          });
        }
      }, 100);
    }
  }, [isActive]);

  useEffect(() => {
    modalWindowRef.current = modalWindow;
    liveModalWindowRef.current = modalWindow;
    applyModalWindowStyles(modalWindow);
  }, [applyModalWindowStyles, modalWindow]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && modalPaintFrameRef.current !== null) {
        window.cancelAnimationFrame(modalPaintFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isFullscreen) {
      return;
    }

    const handleResize = () => {
      if (isWindowMaximized) {
        setModalWindow(createMaximizedModalWindow());
        return;
      }

      setModalWindow((current) => clampModalWindowToViewport(current));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isFullscreen, isWindowMaximized]);

  useEffect(() => {
    if (isFullscreen || modalInteraction.mode === 'idle') {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const metrics = getModalViewportMetrics();
      const currentWindow = liveModalWindowRef.current;

      if (modalInteraction.mode === 'drag') {
        const bounds = getRecoverableModalPositionBounds(currentWindow.width, currentWindow.height);

        scheduleModalWindowPaint({
          ...currentWindow,
          x: clamp(
            modalInteraction.initialX + (event.clientX - modalInteraction.startX),
            bounds.minX,
            bounds.maxX
          ),
          y: clamp(
            modalInteraction.initialY + (event.clientY - modalInteraction.startY),
            bounds.minY,
            bounds.maxY
          ),
        });
        return;
      }

      const deltaX = event.clientX - modalInteraction.startX;
      const deltaY = event.clientY - modalInteraction.startY;
      const resizeFromLeft =
        modalInteraction.direction === 'left' ||
        modalInteraction.direction === 'top-left' ||
        modalInteraction.direction === 'bottom-left';
      const resizeFromRight =
        modalInteraction.direction === 'right' ||
        modalInteraction.direction === 'top-right' ||
        modalInteraction.direction === 'bottom-right';
      const resizeFromTop =
        modalInteraction.direction === 'top' ||
        modalInteraction.direction === 'top-left' ||
        modalInteraction.direction === 'top-right';
      const resizeFromBottom =
        modalInteraction.direction === 'bottom' ||
        modalInteraction.direction === 'bottom-left' ||
        modalInteraction.direction === 'bottom-right';

      let nextX = modalInteraction.initialX;
      let nextY = modalInteraction.initialY;
      let nextWidth = modalInteraction.initialWidth;
      let nextHeight = modalInteraction.initialHeight;

      if (resizeFromLeft) {
        nextX = clamp(
          modalInteraction.initialX + deltaX,
          -modalInteraction.initialWidth + MODAL_MIN_VISIBLE_WIDTH,
          modalInteraction.initialX + modalInteraction.initialWidth - metrics.minWidth
        );
        nextWidth = modalInteraction.initialWidth - (nextX - modalInteraction.initialX);
      }

      if (resizeFromRight) {
        nextWidth = clamp(
          modalInteraction.initialWidth + deltaX,
          metrics.minWidth,
          metrics.viewportWidth - metrics.margin - modalInteraction.initialX
        );
      }

      if (resizeFromTop) {
        nextY = clamp(
          modalInteraction.initialY + deltaY,
          0,
          modalInteraction.initialY + modalInteraction.initialHeight - metrics.minHeight
        );
        nextHeight = modalInteraction.initialHeight - (nextY - modalInteraction.initialY);
      }

      if (resizeFromBottom) {
        nextHeight = clamp(
          modalInteraction.initialHeight + deltaY,
          metrics.minHeight,
          metrics.viewportHeight - metrics.margin - modalInteraction.initialY
        );
      }

      scheduleModalWindowPaint({
        x: nextX,
        y: nextY,
        width: nextWidth,
        height: nextHeight,
      });
    };

    const handlePointerUp = () => {
      if (typeof window !== 'undefined' && modalPaintFrameRef.current !== null) {
        window.cancelAnimationFrame(modalPaintFrameRef.current);
        modalPaintFrameRef.current = null;
        applyModalWindowStyles(liveModalWindowRef.current);
      }

      setModalWindow(clampModalWindowToViewport(liveModalWindowRef.current));
      setModalInteraction({ mode: 'idle' });
    };

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [applyModalWindowStyles, isFullscreen, modalInteraction, scheduleModalWindowPaint]);

  const nMeta: BaseMetadata | undefined = image.metadata?.normalizedMetadata;
  const effectiveMetadata: BaseMetadata | undefined = (nMeta && !showOriginal) ? {
    ...nMeta,
    prompt: shadowMetadata?.prompt ?? nMeta.prompt,
    negativePrompt: shadowMetadata?.negativePrompt ?? nMeta.negativePrompt,
    seed: shadowMetadata?.seed ?? nMeta.seed,
    width: shadowMetadata?.width ?? nMeta.width,
    height: shadowMetadata?.height ?? nMeta.height,
    model: (shadowMetadata?.resources?.find(r => r.type === 'model')?.name) ?? nMeta.model,
  } : (shadowMetadata && !showOriginal) ? {
     prompt: shadowMetadata.prompt || '',
     negativePrompt: shadowMetadata.negativePrompt,
     seed: shadowMetadata.seed,
     width: shadowMetadata.width || 0,
     height: shadowMetadata.height || 0,
     model: shadowMetadata.resources?.find(r => r.type === 'model')?.name || 'Unknown',
     steps: 0,
     scheduler: 'Unknown',
     topics: [],
  } as BaseMetadata : nMeta;

  const effectiveDuration = shadowMetadata?.duration ?? (nMeta as any)?.video?.duration_seconds;


  const videoInfo = (nMeta as any)?.video;
  const motionModel = (nMeta as any)?.motion_model;

  useEffect(() => {
    if (!showComfyUIActions || !nMeta) {
      setSidebarTab('details');
    }
  }, [nMeta, showComfyUIActions]);

  const beginWindowDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isFullscreen || isWindowMaximized || event.button !== 0) {
      return;
    }

    const currentWindow = modalWindowRef.current;
    event.preventDefault();
    setModalInteraction({
      mode: 'drag',
      startX: event.clientX,
      startY: event.clientY,
      initialX: currentWindow.x,
      initialY: currentWindow.y,
    });
  }, [isFullscreen, isWindowMaximized]);

  const shouldStartWindowDrag = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) {
      return false;
    }

    return !target.closest([
      '[data-no-window-drag="true"]',
      '[data-window-drag-region="details"]',
      '[data-resize-handle="true"]',
      'button',
      'input',
      'textarea',
      'select',
      'option',
      'a',
      'label',
      'summary',
      '[role="button"]',
      '[role="link"]',
      'img',
      'video',
      'canvas',
    ].join(', '));
  }, []);

  const handleWindowSurfacePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!shouldStartWindowDrag(event.target)) {
      return;
    }

    beginWindowDrag(event);
  }, [beginWindowDrag, shouldStartWindowDrag]);

  const handleImageContainerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    revealMediaOverlay();

    if (!isFullscreen) {
      handleWindowSurfacePointerDown(event);
    }
  }, [handleWindowSurfacePointerDown, isFullscreen, revealMediaOverlay]);

  const beginWindowResize = useCallback((direction: 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => (event: React.PointerEvent<HTMLDivElement>) => {
    if (isFullscreen || isWindowMaximized || event.button !== 0) {
      return;
    }

    const currentWindow = modalWindowRef.current;
    event.preventDefault();
    event.stopPropagation();
    setModalInteraction({
      mode: 'resize',
      direction,
      startX: event.clientX,
      startY: event.clientY,
      initialWidth: currentWindow.width,
      initialHeight: currentWindow.height,
      initialX: currentWindow.x,
      initialY: currentWindow.y,
    });
  }, [isFullscreen, isWindowMaximized]);

  const resetModalWindow = useCallback(() => {
    setIsWindowMaximized(false);
    setModalWindow(createDefaultModalWindow());
  }, []);

  const toggleWindowMaximize = useCallback(() => {
    if (isWindowMaximized) {
      setIsWindowMaximized(false);
      setModalWindow(restoredModalWindowRef.current ?? createDefaultModalWindow());
      return;
    }

    restoredModalWindowRef.current = modalWindowRef.current;
    setIsWindowMaximized(true);
    setModalWindow(createMaximizedModalWindow());
  }, [isWindowMaximized]);

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
      visible: true,
      kind: 'media',
      selectionText: '',
    });
  };

  const handleSelectionContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) {
      return;
    }

    const selection = window.getSelection()?.toString() ?? '';
    if (!selection.trim()) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      visible: true,
      kind: 'selection',
      selectionText: selection,
    });
  };

  const hideContextMenu = () => {
    setContextMenu({ x: 0, y: 0, visible: false, kind: 'media', selectionText: '' });
  };

  const handleAddToExistingCollection = useCallback(async (collection: SmartCollection) => {
    await addImagesToCollection(collection.id, [image.id]);
    hideContextMenu();
  }, [addImagesToCollection, image.id]);

  const handleCreateCollectionFromContext = useCallback(async (values: CollectionFormValues) => {
    const targetImageIds = values.includeTargetImages ? [image.id] : [];
    const coverImageId = targetImageIds.length > 0 ? targetImageIds[0] : null;

    await createCollection({
      kind: 'manual',
      name: values.name,
      description: values.description || undefined,
      sortIndex: collections.length,
      imageIds: targetImageIds,
      snapshotImageIds: [],
      coverImageId,
      autoUpdate: false,
      sourceTag: null,
      thumbnailId: coverImageId ?? undefined,
      type: 'custom',
      query: undefined,
    });

    setIsCollectionModalOpen(false);
    hideContextMenu();
  }, [collections.length, createCollection, image.id]);

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
    if (isVideo) {
      return;
    }
    const result = await copyImageToClipboard(image, directoryPath);
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

  const copySelection = () => {
    copyToClipboardElectron(contextMenu.selectionText, 'Selection');
    hideContextMenu();
  };

  const searchSelection = () => {
    const query = contextMenu.selectionText.replace(/\s+/g, ' ').trim();
    if (!query) {
      return;
    }
    setSearchQuery(query);
    hideContextMenu();
    onClose();
  };

  const showInFolder = () => {
    hideContextMenu();
    if (!directoryPath) {
      alert('Cannot determine file location: directory path is missing.');
      return;
    }
    showInExplorer(`${directoryPath}/${image.name}`);
  };

  const handleReparseMetadata = async () => {
    hideContextMenu();
    await reparseImages([liveImage]);
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
      const destResult = await window.electronAPI.showDirectoryDialog();
      if (destResult.canceled || !destResult.path) {
        return;
      }
      const destDir = destResult.path;
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

      const readResult = await window.electronAPI.readFile(sourcePath);
      if (!readResult.success || !readResult.data) {
        alert(`Failed to read original file: ${readResult.error}`);
        return;
      }

      const writeResult = await window.electronAPI.writeFile(destPath, readResult.data);
      if (!writeResult.success) {
        alert(`Failed to export image: ${writeResult.error}`);
        return;
      }

      alert(`Image exported successfully to: ${destPath}`);

    } catch (error) {
      console.error('Export error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`An unexpected error occurred during export: ${errorMessage}`);
    }
  };

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    revealMediaOverlay();
  }, [image.id, revealMediaOverlay]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsMediaOverlayVisible(false);
    clearMediaOverlayHideTimer();
  }, [clearMediaOverlayHideTimer, isFullscreen]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    const delta = e.deltaY * -0.01;
    const newZoom = Math.min(Math.max(1, zoom + delta), 5);

    setZoom(newZoom);

    if (newZoom === 1) {
      setPan({ x: 0, y: 0 });
    }
  }, [zoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!(e.target instanceof Element) || !e.target.closest('img, video, canvas, [data-media-element="true"]')) {
      return;
    }

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

  const handleDragStart = useCallback((e: React.DragEvent<HTMLImageElement>) => {
    if (!canDragExternally) {
      return;
    }

    if (!directoryPath) {
      return;
    }

    const [, relativeFromId] = image.id.split('::');
    const relativePath = relativeFromId || image.name;

    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copy';
    }
    window.electronAPI?.startFileDrag({ directoryPath, relativePath });
  }, [canDragExternally, directoryPath, image.id, image.name]);

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
    const hasPreview = Boolean(preferredThumbnailUrl);

    setImageUrl(isVideo ? null : (preferredThumbnailUrl ?? null));

    const loadImage = async () => {
      if (!isMounted) return;

      if (!directoryPath && window.electronAPI) {
        console.error('Cannot load image: directoryPath is undefined');
        if (isMounted && !hasPreview) {
          setImageUrl(null);
          alert('Failed to load image: Directory path is not available.');
        }
        return;
      }

      try {
        const url = await mediaSourceCache.getOrLoad(image, directoryPath, { prioritize: true });
        if (isMounted) {
          setImageUrl(url);
        }
      } catch (loadError) {
        console.error('Failed to load full image source:', loadError);
        if (isMounted && !hasPreview) {
          setImageUrl(null);
        }
      }
    };

    loadImage();

    const prefetchNeighbors = () => {
      const state = useImageStore.getState();
      const navigationImages = state.clusterNavigationContext || state.filteredImages;
      const currentIndex = navigationImages.findIndex((candidate) => candidate.id === image.id);
      if (currentIndex === -1) {
        return;
      }

      const directoryMap = new Map(state.directories.map((dir) => [dir.id, dir.path]));
      const neighborCandidates = [navigationImages[currentIndex - 1], navigationImages[currentIndex + 1]].filter(Boolean) as IndexedImage[];
      for (const neighbor of neighborCandidates) {
        const neighborDirectoryPath = directoryMap.get(neighbor.directoryId || '');
        if (neighborDirectoryPath) {
          mediaSourceCache.prefetch(neighbor, neighborDirectoryPath);
        }
      }
    };

    if (!isVideo) {
      prefetchNeighbors();
    }

    return () => {
      isMounted = false;
    };
  }, [image.id, image.handle, image.thumbnailHandle, image.name, directoryPath, preferredThumbnailUrl, isVideo]);

  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(image.id);
  }, [image.id, toggleFavorite]);

  const handleSetRating = useCallback((rating: 1 | 2 | 3 | 4 | 5 | null) => {
    setImageRating(image.id, rating);
  }, [image.id, setImageRating]);

  const focusTagInput = useCallback(async () => {
    const focusInput = () => {
      tagInputRef.current?.focus();
      tagInputRef.current?.select();
    };

    if (isFullscreen) {
      await toggleFullscreen();
      window.setTimeout(focusInput, 50);
      return;
    }

    focusInput();
  }, [isFullscreen, toggleFullscreen]);

  useEffect(() => {
    const imageContainer = imageContainerRef.current;
    if (imageContainer) {
      imageContainer.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      if (imageContainer) {
        imageContainer.removeEventListener('wheel', handleWheel);
      }
    };
  }, [handleWheel]);

  const handleDelete = useCallback(async () => {
    if (isIndexing) {
      return;
    }

    if (window.confirm('Are you sure you want to delete this image? This action cannot be undone.')) {
      const idToDelete = image.id;
      const imageToDelete = image;

      const hasMoreImages = totalImages > 1;
      
      if (hasMoreImages) {
        if (currentIndex < totalImages - 1) {
          onNavigateNext?.();
        } else {
          onNavigatePrevious?.();
        }
      }

      const result = await FileOperations.deleteFile(imageToDelete);
      if (result.success) {
        onImageDeleted?.(idToDelete);
        
        if (!hasMoreImages) {
          onClose();
        }
      } else {
        alert(`Failed to delete file: ${result.error}`);
      }
    }
  }, [currentIndex, image, isIndexing, onClose, onImageDeleted, onNavigateNext, onNavigatePrevious, totalImages]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (hotkeyManager.areHotkeysPaused()) {
        return;
      }

      if (isRenaming) return;
      const isTypingContext = isTypingElement(event.target);

      if (event.key === 'Escape') {
        if (isTypingContext) {
          return;
        }

      event.stopPropagation();
        if (isFullscreen) {
          toggleFullscreen();
        } else {
          onClose();
        }
        return;
      }

      if (isTypingContext) {
        return;
      }

      if (eventMatchesKeybinding(event, toggleFullscreenKeybinding)) {
        event.preventDefault();
        event.stopPropagation();
        toggleFullscreen();
        return;
      }

      if (eventMatchesKeybinding(event, previewKeymap?.toggleFavoriteInViewer)) {
        event.preventDefault();
        handleToggleFavorite();
        return;
      }

      if (eventMatchesKeybinding(event, previewKeymap?.focusAddTagInViewer)) {
        event.preventDefault();
        focusTagInput().catch((error) => {
          console.error('Failed to focus tag input:', error);
        });
        return;
      }

      if (eventMatchesKeybinding(event, previewKeymap?.deleteImageInViewer)) {
        event.preventDefault();
        handleDelete().catch((error) => {
          console.error('Failed to delete image from shortcut:', error);
        });
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onNavigatePrevious?.();
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        onNavigateNext?.();
      }
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
  }, [
    focusTagInput,
    handleDelete,
    handleToggleFavorite,
    hideContextMenu,
    isActive,
    isFullscreen,
    isRenaming,
    onClose,
    onNavigateNext,
    onNavigatePrevious,
    previewKeymap,
    toggleFullscreen,
    toggleFullscreenKeybinding,
  ]);

  useEffect(() => {
    return () => {
      clearMediaOverlayHideTimer();
    };
  }, [clearMediaOverlayHideTimer]);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (modalShellRef.current) {
        const modalRect = modalShellRef.current.getBoundingClientRect();
        const newWidth = modalRect.right - e.clientX;
        setSidebarWidth(Math.max(300, Math.min(newWidth, Math.floor(modalRect.width * 0.7))));
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    if (!isRenaming) {
      setNewName(image.name.replace(/\.(png|jpg|jpeg|webp|mp4|webm|mkv|mov|avi)$/i, ''));
    }
  }, [image.name, isRenaming]);

  useEffect(() => {
    if (!isRenaming) {
      return;
    }

    const timeout = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [isRenaming]);

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

  const handleAddTag = (value = tagInput) => {
    if (!value.trim()) return;
    addTagToImage(image.id, value);
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    removeTagFromImage(image.id, tag);
  };

  const handleRemoveAutoTag = (tag: string) => {
    removeAutoTagFromImage(image.id, tag);
  };

  const handleMinimizeWithAnimation = useCallback(async () => {
    if (!onMinimize || isMinimizeAnimatingRef.current) {
      return;
    }

    const modalElement = modalShellRef.current;
    const targetElement = getFooterWindowElement(modalId);

    if (!modalElement || !targetElement || shouldSkipWindowAnimation(enableAnimations)) {
      onMinimize();
      return;
    }

    const modalRect = modalElement.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();

    isMinimizeAnimatingRef.current = true;
    modalElement.style.pointerEvents = 'none';
    modalElement.style.opacity = '0';

    try {
      await animateWindowProxy(modalRect, targetRect, zIndex);
    } finally {
      onMinimize();
    }
  }, [enableAnimations, modalId, onMinimize, zIndex]);

  const handlePromoteAutoTag = async (tag: string) => {
    await addTagToImage(image.id, tag);
    removeAutoTagFromImage(image.id, tag);
  };

  if (isMinimized) {
    return null;
  }

  const modalShellStateClass = isActive
    ? 'border-gray-800 shadow-2xl ring-1 ring-white/10'
    : 'border-gray-800/70 shadow-lg ring-1 ring-white/5';
  const titleBarStateClass = isActive
    ? 'border-gray-800 bg-gray-950/95'
    : 'border-gray-700 bg-gray-800/95';
  const titleTextClass = isActive ? 'text-gray-100' : 'text-gray-400';
  const titleMetaClass = isActive ? 'text-gray-500' : 'text-gray-600';
  const modalEntryAnimationClass = !enableAnimations || (wasMinimizedRef.current && !isMinimized)
    ? ''
    : 'animate-in fade-in zoom-in-95';

  return (
    <div
      className={`fixed inset-0 transition-all duration-300 ${
        isFullscreen ? 'pointer-events-auto bg-black' : 'pointer-events-none'
      }`}
      style={{ zIndex }}
      onClick={isFullscreen ? onClose : undefined}
    >
      <div
        ref={modalShellRef}
        className={`${
          isFullscreen 
            ? 'fixed inset-0 h-full w-full rounded-none'
            : `fixed bg-gray-900 border rounded-2xl overflow-hidden ${modalShellStateClass}`
        } pointer-events-auto flex flex-col ${modalEntryAnimationClass} ${isWindowInteractionActive ? 'select-none' : ''}`}
        onPointerDown={() => onActivate?.()}
        onClick={(e) => {
          e.stopPropagation();
          hideContextMenu();
        }}
        style={
          isFullscreen
            ? undefined
            : {
                left: `${modalWindow.x}px`,
                top: `${modalWindow.y}px`,
                width: `${modalWindow.width}px`,
                height: `${modalWindow.height}px`,
                transition: isWindowInteractionActive ? 'none' : 'box-shadow 160ms ease, border-color 160ms ease',
              }
        }
      >
        {!isFullscreen && (
          <div
            className={`flex items-center justify-between gap-3 border-b px-4 py-1.5 backdrop-blur-sm cursor-move transition-colors duration-150 ${titleBarStateClass}`}
            onPointerDown={handleWindowSurfacePointerDown}
            onDoubleClick={toggleWindowMaximize}
          >
            <div className="min-w-0 flex-1">
              {isRenaming ? (
                <div
                  className="flex items-center gap-2"
                  onPointerDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void confirmRename();
                      } else if (event.key === 'Escape') {
                        setIsRenaming(false);
                        setNewName(image.name.replace(/\.(png|jpg|jpeg|webp|mp4|webm|mkv|mov|avi)$/i, ''));
                      }
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-gray-600 bg-gray-900 px-2 py-1 text-sm font-semibold text-white outline-none transition-colors focus:border-blue-500"
                    aria-label="Rename image"
                  />
                  <button
                    onClick={() => void confirmRename()}
                    className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-green-500"
                    title="Save rename"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setIsRenaming(false);
                      setNewName(image.name.replace(/\.(png|jpg|jpeg|webp|mp4|webm|mkv|mov|avi)$/i, ''));
                    }}
                    className="rounded-lg bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-100 transition-colors hover:bg-gray-600"
                    title="Cancel rename"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className={`truncate text-sm font-semibold ${titleTextClass}`} title={image.name}>
                  {image.name}
                </div>
              )}
              <div className={`flex items-center gap-2 text-[11px] ${titleMetaClass}`}>
                <span className="min-w-0 truncate" title={imageFullPath}>
                  {imageFullPath}
                </span>
                {hasVerifiedTelemetry(liveImage) && (
                  <span
                    className="shrink-0 rounded-full border border-green-500/20 bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-green-400"
                    title="MetaHub Save Node"
                  >
                    MetaHub Save Node
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-gray-500" title={createdAtLabel}>
                  {createdAtLabel}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                onPointerDown={(event) => event.stopPropagation()}
                disabled={isIndexing}
                className="rounded-lg border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 transition-colors hover:border-red-500/50 hover:bg-red-500/15 hover:text-red-300 disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-gray-900 disabled:text-gray-600"
                title={isIndexing ? 'Cannot delete during indexing' : 'Delete image'}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsRenaming(true)}
                onPointerDown={(event) => event.stopPropagation()}
                disabled={isIndexing}
                className="rounded-lg border border-gray-700 bg-gray-800 p-1.5 text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-700 hover:text-orange-300 disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-gray-900 disabled:text-gray-600"
                title={isIndexing ? 'Cannot rename during indexing' : 'Rename image'}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => void handleMinimizeWithAnimation()}
                onPointerDown={(event) => event.stopPropagation()}
                className="rounded-lg border border-gray-700 bg-gray-800 p-1.5 text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-700 hover:text-white"
                title="Minimize window"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={toggleWindowMaximize}
                onPointerDown={(event) => event.stopPropagation()}
                className="rounded-lg border border-gray-700 bg-gray-800 p-1.5 text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-700 hover:text-white"
                title={isWindowMaximized ? 'Restore window' : 'Maximize window'}
              >
                {isWindowMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={onClose}
                onPointerDown={(event) => event.stopPropagation()}
                className="rounded-lg border border-gray-700 bg-gray-800 p-1.5 text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-700 hover:text-white"
                aria-label="Close image"
                title="Close (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <div className={`flex min-h-0 flex-1 ${showSidebarOnBottom ? 'flex-col' : 'flex-row'}`}>
        {/* Image Display Section */}
        <div
          ref={imageContainerRef}
          className={`w-full ${
            isFullscreen
              ? 'h-full'
              : !showSidebar
                ? 'h-full'
              : showSidebarOnBottom
                ? 'min-h-[280px] flex-1'
                : 'h-full flex-1 min-w-0'
          } bg-black flex items-center justify-center ${isFullscreen ? 'p-0' : 'p-2'} relative group overflow-hidden`}
          onPointerDown={handleImageContainerPointerDown}
          onPointerMove={revealMediaOverlay}
          onMouseDown={isVideo ? undefined : handleMouseDown}
          onMouseMove={isVideo ? undefined : handleMouseMove}
          onMouseUp={isVideo ? undefined : handleMouseUp}
          onMouseLeave={isVideo ? undefined : handleMouseUp}
          style={{ cursor: !isVideo && zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        >
          {imageUrl ? (
            isVideo ? (
              <div data-no-window-drag="true" className="max-h-full max-w-full">
                <VideoPlayer
                  key={image.id}
                  src={imageUrl}
                  poster={preferredThumbnailUrl ?? undefined}
                  onContextMenu={handleContextMenu}
                />
              </div>
            ) : (
              <img
                src={imageUrl}
                alt={image.name}
                className="max-w-full max-h-full object-contain select-none"
                onContextMenu={handleContextMenu}
                onDragStart={handleDragStart}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                }}
                draggable={canDragExternally && zoom === 1}
              />
            )
          ) : (
            <div className="w-full h-full animate-pulse bg-gray-700 rounded-md"></div>
          )}

          {onNavigatePrevious && (
            <button
              onClick={onNavigatePrevious}
              className={`absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/35 p-2 text-white/90 transition-[opacity,background-color] duration-300 ease-out hover:bg-black/55 ${mediaOverlayVisibilityClass}`}
              title="Previous image"
            >
              ←
            </button>
          )}
          {onNavigateNext && (
            <button
              onClick={onNavigateNext}
              className={`absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/35 p-2 text-white/90 transition-[opacity,background-color] duration-300 ease-out hover:bg-black/55 ${mediaOverlayVisibilityClass}`}
              title="Next image"
            >
              →
            </button>
          )}

          <div data-no-window-drag="true" className="absolute top-4 left-4 bg-black/60 text-white px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm border border-white/20">
            {currentIndex + 1} / {totalImages}
          </div>

          {!isVideo && (
            <div data-no-window-drag="true" className={`absolute bottom-4 left-4 flex flex-col gap-2 rounded-lg border border-white/10 bg-black/35 p-2 backdrop-blur-sm transition-opacity duration-300 ease-out ${mediaOverlayVisibilityClass}`}>
              <button
                onClick={handleZoomIn}
                disabled={zoom >= 5}
                className="rounded p-2 text-white/90 transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                title="Zoom In"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <div className="text-center font-mono text-xs text-white/80">{Math.round(zoom * 100)}%</div>
              <button
                onClick={handleZoomOut}
                disabled={zoom <= 1}
                className="rounded p-2 text-white/90 transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                title="Zoom Out"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </button>
              <button
                onClick={handleResetZoom}
                disabled={zoom <= 1}
                className="rounded p-2 text-white/90 transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30 text-xs"
                title="Reset Zoom"
              >
                Reset
              </button>
            </div>
          )}

          <div data-no-window-drag="true" className={`absolute top-4 right-4 flex flex-col items-end gap-2 transition-opacity duration-300 ease-out ${mediaOverlayVisibilityClass}`}>
            {isFullscreen ? (
              <div className="flex flex-col items-end gap-2">
                <button
                  onClick={toggleFullscreen}
                  className="rounded-full border border-white/10 bg-black/35 p-2 text-white/90 transition-colors hover:bg-black/55"
                  title={`Exit fullscreen (${toggleFullscreenKeybinding})`}
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
                <button
                  onClick={onClose}
                  className="rounded-full border border-white/10 bg-black/35 p-2 text-white/90 transition-colors hover:bg-black/55"
                  aria-label="Close image"
                  title="Close (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-2">
                <button
                  onClick={() => setDetailsPlacement((current) => current === 'right' ? 'bottom' : 'right')}
                  className="rounded-full border border-white/10 bg-black/35 p-2 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/55"
                  title={showSidebarOnRight ? 'Show details on bottom' : 'Show details on right'}
                >
                  {showSidebarOnRight ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => setIsSidebarCollapsed((current) => !current)}
                  className="rounded-full border border-white/10 bg-black/35 p-2 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/55"
                  title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
                >
                  {showSidebar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  onClick={resetModalWindow}
                  className="rounded-full border border-white/10 bg-black/35 p-2 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/55"
                  title="Reset window"
                >
                  <Repeat className="h-4 w-4" />
                </button>
                <button
                  onClick={toggleFullscreen}
                  className="rounded-full border border-white/10 bg-black/35 p-2 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/55"
                  title={`Fullscreen (${toggleFullscreenKeybinding})`}
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Metadata Panel */}
        {showSidebar && (
        <>
          {!showSidebarOnBottom && (
             <div
               onMouseDown={(e) => { e.preventDefault(); setIsResizingSidebar(true); }}
               className={`w-1 cursor-col-resize hover:bg-gray-500/50 bg-gray-800/80 shrink-0 transition-colors ${isResizingSidebar ? 'bg-gray-500/80 z-50' : 'z-40'}`}
               title="Resize sidebar"
             />
          )}
        <div
          data-window-drag-region="details"
          className={`w-full ${
            showSidebarOnBottom
              ? 'h-[42%] min-h-[240px] border-t border-gray-800/80'
              : 'h-full border-l border-transparent'
          } relative flex flex-col`}
          style={
            showSidebarOnBottom
              ? {}
              : { width: sidebarWidth, minWidth: 300, maxWidth: "70%" }
          }
          onContextMenu={handleSelectionContextMenu}
        >
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Annotations Section */}
          <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700/50 space-y-2">
            {/* Favorite, Rating, and Tags */}
            <div className="space-y-3">
              <div className="flex w-fit items-center gap-2 rounded-lg border border-gray-700/60 bg-gray-950/30 px-2 py-1.5">
                <button
                  onClick={handleToggleFavorite}
                  className={`p-1 rounded transition-all ${
                    currentIsFavorite
                      ? 'text-rose-400 hover:text-rose-300'
                      : 'text-gray-500 hover:text-rose-400'
                  }`}
                  title={currentIsFavorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Heart className={`w-5 h-5 ${currentIsFavorite ? 'fill-current' : ''}`} />
                </button>
                <div className="h-5 w-px bg-gray-700/70" />
                <RatingStars rating={currentRating} onChange={handleSetRating} size={16} />
              </div>

              {/* Tags Pills */}
              <div className="space-y-2">
                {/* Add Tag Input */}
                <TagInputCombobox
                  ref={tagInputRef}
                  value={tagInput}
                  onValueChange={setTagInput}
                  onSubmit={handleAddTag}
                  recentTags={recentTags}
                  availableTags={availableTags}
                  excludedTags={currentTags}
                  suggestionLimit={tagSuggestionLimit}
                  placeholder="Add tag..."
                  inputClassName="w-full bg-gray-700/50 text-gray-200 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
                  dropdownClassName="absolute z-10 mt-1 max-h-32 w-full overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 shadow-lg"
                  optionClassName="w-full text-left px-2 py-1.5 text-xs text-gray-200 hover:bg-gray-700 flex justify-between items-center"
                  activeOptionClassName="bg-gray-700 text-white"
                  metaClassName="text-xs text-gray-500"
                  onEscape={() => {
                    setTagInput('');
                    tagInputRef.current?.focus();
                  }}
                />

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

                {/* Tag Suggestions */}
                {tagInput.trim().length === 0 && recentTagSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {recentTagSuggestions.map(tag => (
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

          {nMeta && showComfyUIActions && (
            <div className="rounded-lg border border-gray-700/50 bg-gray-900/50 p-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setSidebarTab('details')}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    sidebarTab === 'details'
                      ? 'bg-gray-800 text-gray-100 ring-1 ring-gray-600'
                      : 'text-gray-400 hover:bg-gray-800/70 hover:text-gray-200'
                  }`}
                >
                  Details
                </button>
                <button
                  onClick={() => {
                    if (!canUseComfyUI) {
                      showProModal('comfyui');
                      return;
                    }
                    setSidebarTab('workflow');
                  }}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    sidebarTab === 'workflow'
                      ? 'bg-purple-500/15 text-purple-100 ring-1 ring-purple-400/40'
                      : 'text-gray-300 hover:bg-gray-800/70 hover:text-white'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <span>View Workflow</span>
                    {!canUseComfyUI && initialized && <ProBadge size="sm" />}
                  </span>
                </button>
              </div>
            </div>
          )}

          {sidebarTab === 'details' ? (
            <div className="space-y-4">
          {/* MetaHub Save Node Notes - Only if present */}
          {nMeta?.notes && (
            <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-lg border border-gray-200 dark:border-gray-700/50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-purple-600 dark:text-purple-300 uppercase tracking-wider">Notes (MetaHub Save Node)</span>
              </div>
              <pre className="text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words font-mono text-sm bg-white dark:bg-gray-800/50 p-2 rounded border border-gray-200 dark:border-gray-700/50">{nMeta.notes}</pre>
            </div>
          )}

          {nMeta ? (
            <div className="space-y-4">
              {/* Prompt Section - Always Visible */}
              <div className="space-y-3">
                <ImageLineageSection
                  image={liveImage}
                  metadata={nMeta}
                  onOpenImage={(targetImage) => {
                    setPreviewImage(targetImage);
                    setSelectedImage(targetImage);
                  }}
                />
                <MetadataItem label="Prompt" value={effectiveMetadata?.prompt} isPrompt onCopy={() => copyToClipboard(effectiveMetadata?.prompt || '', 'Prompt')} />
                <MetadataItem label="Negative Prompt" value={effectiveMetadata?.negativePrompt} isPrompt onCopy={() => copyToClipboard(effectiveMetadata?.negativePrompt || '', 'Negative Prompt')} />
                
                {/* Shadow Resources List */}
                {shadowMetadata?.resources && shadowMetadata.resources.length > 0 && (
                  <div className="bg-gray-900/50 p-3 rounded-md border border-gray-700/50">
                     <p className="font-semibold text-gray-400 text-xs uppercase tracking-wider mb-2">Resources (Overrides)</p>
                     <ul className="space-y-1">
                       {shadowMetadata.resources.map(r => (
                         <li key={r.id} className="text-sm text-gray-200 flex justify-between">
                           <span>{r.name} <span className="text-gray-500 text-xs">({r.type})</span></span>
                           {r.weight !== undefined && <span className="text-gray-400 text-xs">{r.weight}</span>}
                         </li>
                       ))}
                     </ul>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <MetadataItem label="Seed" value={effectiveMetadata?.seed} onCopy={() => copyToClipboard(String(effectiveMetadata?.seed || ''), 'Seed')} />
                  <MetadataItem label="Model" value={effectiveMetadata?.model} onCopy={() => copyToClipboard(effectiveMetadata?.model || '', 'Model')} />
                </div>
              </div>

              {/* Details Section - Collapsible */}
              <div>
                <button 
                  onClick={() => setShowDetails(!showDetails)} 
                  className="text-gray-600 dark:text-gray-300 text-sm w-full text-left py-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  <span className="font-semibold">Generation Details</span>
                  {showDetails ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                {showDetails && (
                  <div className="space-y-3 mt-3">
                    {nMeta.generationType && (
                      <MetadataItem label="Generation Type" value={getGenerationTypeLabel(nMeta.generationType)} />
                    )}
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
                      <MetadataItem label="Steps" value={effectiveMetadata?.steps} />
                      <MetadataItem label="CFG Scale" value={effectiveMetadata?.cfg_scale} />
                      {nMeta.clip_skip && nMeta.clip_skip > 1 && (
                        <MetadataItem label="Clip Skip" value={nMeta.clip_skip} />
                      )}
                      <MetadataItem label="Seed" value={nMeta.seed} onCopy={(v) => copyToClipboard(v, "Seed")} />
                      <MetadataItem label="Sampler" value={nMeta.sampler} />
                      <MetadataItem label="Scheduler" value={effectiveMetadata?.scheduler} />
                      <MetadataItem label="Dimensions" value={effectiveMetadata?.width && effectiveMetadata?.height ? `${effectiveMetadata.width}x${effectiveMetadata.height}` : undefined} />
                      {(nMeta as any).denoise != null && (nMeta as any).denoise < 1 && (
                        <MetadataItem label="Denoise" value={(nMeta as any).denoise} />
                      )}
                    </div>
                    {videoInfo && (
                      <div className="grid grid-cols-2 gap-2">
                        <MetadataItem label="Frames" value={videoInfo.frame_count} />
                        <MetadataItem label="FPS" value={videoInfo.frame_rate != null ? Number(videoInfo.frame_rate).toFixed(2) : undefined} />
                        {effectiveDuration != null && (
                          <MetadataItem label="Duration" value={formatDurationSeconds(Number(effectiveDuration))} />
                        )}
                        <MetadataItem label="Video Codec" value={videoInfo.codec} />
                        <MetadataItem 
                          label="Video Format" 
                          value={(() => {
                            if (!videoInfo.format) return undefined;
                            const formats = videoInfo.format.split(',');
                            const ext = image.name.split('.').pop()?.toLowerCase();
                            if (ext && formats.includes(ext)) return ext;
                            return formats[0];
                          })()} 
                        />
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
                    {shadowMetadata?.notes && (
                      <div className="col-span-2 pt-2 border-t border-gray-700/50 mt-2">
                         <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-1">Workflow Notes</h4>
                         <div className="text-sm text-gray-300 whitespace-pre-wrap font-mono bg-gray-900/50 p-2 rounded border border-gray-800">
                           {shadowMetadata.notes}
                         </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Performance Section - Collapsible */}
              {nMeta && nMeta._analytics && (
                <div>
                  <button
                    onClick={() => setShowPerformance(!showPerformance)}
                    className="text-gray-600 dark:text-gray-300 text-sm w-full text-left py-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    <span className="font-semibold flex items-center gap-2">
                      <Zap size={16} className="text-yellow-600 dark:text-yellow-400" />
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
                        <div className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700/50 pt-2 space-y-1">
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

          <div className="grid grid-cols-2 gap-2 pt-2">
            <button onClick={() => copyToClipboard(nMeta?.prompt || '', 'Prompt')} className="w-full justify-center bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-2">Copy Prompt</button>
            <button onClick={() => copyToClipboard(JSON.stringify(image.metadata, null, 2), 'Raw Metadata')} className="w-full justify-center bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-2">Copy Raw Metadata</button>
            <button onClick={async () => {
              if (!directoryPath) {
                alert('Cannot determine file location: directory path is missing.');
                return;
              }
              await showInExplorer(`${directoryPath}/${image.name}`);
            }} className="w-full justify-center bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-white/10 px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2">Show in Folder</button>
            <button
              onClick={() => {
                if (!canUseComparison) {
                  showProModal('comparison');
                  return;
                }
                const added = addImage(image);
                if (added && comparisonWillAutoOpen(comparisonCount)) {
                  onClose(); // Close ImageModal, ComparisonModal will auto-open
                }
              }}
              disabled={canUseComparison && comparisonCount >= 4}
              className="w-full justify-center bg-purple-50 hover:bg-purple-100 dark:bg-purple-500/10 dark:hover:bg-purple-500/20 disabled:bg-gray-100 dark:disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30 px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
              title={!canUseComparison ? "Comparison (Pro Feature)" : comparisonCount >= 4 ? "Comparison queue full" : "Add to comparison"}
            >
              <GitCompare className="w-3 h-3" />
              Add to Compare {canUseComparison && comparisonCount > 0 && `(${comparisonCount}/4)`}
              {!canUseComparison && initialized && <ProBadge size="sm" />}
            </button>
          </div>

          {/* A1111 Integration - Separate Buttons with Visual Hierarchy */}
          {nMeta && showA1111Actions && (
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
                className="w-full bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 disabled:bg-gray-100 dark:disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed border border-blue-200 dark:border-blue-500/50 hover:border-blue-300 dark:hover:border-blue-400 text-blue-700 dark:text-blue-100 px-4 py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200"
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
                    <span>{a1111GenerateLabel}</span>
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
                className="w-full bg-gray-50 hover:bg-gray-100 dark:bg-white/5 dark:hover:bg-white/10 disabled:bg-gray-100 dark:disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-all duration-200"
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
              {showA1111Actions && isGenerateModalOpen && nMeta && (
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
          {nMeta && showComfyUIActions && (
            <div className={`mt-3 ${showComfyUIHeading ? 'pt-3 border-t border-gray-700' : ''}`}>
              {showComfyUIHeading && (
                <h4 className="text-xs text-gray-400 uppercase tracking-wider mb-2">ComfyUI</h4>
              )}

              {/* Generate Button */}
              <button
                onClick={() => {
                  if (!canUseComfyUI) {
                    showProModal('comfyui');
                    return;
                  }
                  setSidebarTab('workflow');
                }}
                className="w-full bg-purple-50 hover:bg-purple-100 dark:bg-purple-500/10 dark:hover:bg-purple-500/20 disabled:bg-gray-100 dark:disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed border border-purple-200 dark:border-purple-500/50 hover:border-purple-300 dark:hover:border-purple-400 text-purple-700 dark:text-purple-100 px-4 py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 mb-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>View Workflow / Generate</span>
                {!canUseComfyUI && initialized && <ProBadge size="sm" />}
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
                className="w-full bg-gray-50 hover:bg-gray-100 dark:bg-white/5 dark:hover:bg-white/10 disabled:bg-gray-100 dark:disabled:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-all duration-200"
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

            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-400" />
                Generation Data
                {shadowMetadata && (
                  <span className="text-[10px] bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded border border-blue-800">
                    EDITED
                  </span>
                )}
              </h3>
              <div className="flex gap-2">
                {shadowMetadata && (
                  <>
                    <button
                      onClick={() => setShowOriginal(!showOriginal)}
                      className={`p-1.5 rounded-md transition-colors ${showOriginal ? 'bg-blue-900/50 text-blue-300' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                      title={showOriginal ? "Back to Edited" : "See Original"}
                    >
                      {showOriginal ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                     <button
                      onClick={() => {
                        if (confirm('Are you sure you want to delete all edited metadata and revert to the original?')) {
                          deleteShadowMetadata();
                        }
                      }}
                      className="p-1.5 bg-gray-800 hover:bg-red-900/50 rounded-md transition-colors text-gray-400 hover:text-red-400"
                      title="Revert to Original (Delete Edits)"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setIsMetadataEditorOpen(true)}
                  className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded-md transition-colors text-gray-400 hover:text-white"
                  title="Edit Metadata (Shadow)"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setShowRawMetadata(!showRawMetadata)}
                  className="text-xs text-gray-400 hover:text-white underline"
                >
                  {showRawMetadata ? 'Show Parsed' : 'Show JSON'}
                </button>
              </div>
            </div>
            {showRawMetadata && (
              <pre className="bg-black/50 p-2 rounded-lg text-xs text-gray-300 whitespace-pre-wrap break-all max-h-64 overflow-y-auto mt-2">
                {JSON.stringify(image.metadata, null, 2)}
              </pre>
            )}
          </div>
            </div>
          ) : sidebarTab === 'workflow' && nMeta && showComfyUIActions ? (
            <div className="space-y-4">
              <ComfyUIWorkflowWorkspace
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
                      model: params.model?.name || nMeta?.model,
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
                  }}
                  isGenerating={isGeneratingComfyUI}
                  status={generateStatusComfyUI}
                  defaultTab="visual"
                  viewportHeight={showSidebarOnBottom ? 420 : 520}
                  showCancelButton={false}
                />
            </div>
          ) : null}
          </div>
        </div>
        </>
        )}
        </div>

        {!isFullscreen && (
          <>
            <div
              className="absolute inset-x-5 top-0 h-1.5 cursor-ns-resize bg-transparent"
              onPointerDown={beginWindowResize('top')}
              data-resize-handle="true"
              title="Resize height"
            />
            <div
              className="absolute inset-y-5 right-0 w-1.5 cursor-ew-resize bg-transparent"
              onPointerDown={beginWindowResize('right')}
              data-resize-handle="true"
              title="Resize width"
            />
            <div
              className="absolute inset-x-5 bottom-0 h-1.5 cursor-ns-resize bg-transparent"
              onPointerDown={beginWindowResize('bottom')}
              data-resize-handle="true"
              title="Resize height"
            />
            <div
              className="absolute inset-y-5 left-0 w-1.5 cursor-ew-resize bg-transparent"
              onPointerDown={beginWindowResize('left')}
              data-resize-handle="true"
              title="Resize width"
            >
            </div>
            <div
              className="absolute left-0 top-0 h-5 w-5 cursor-nwse-resize"
              onPointerDown={beginWindowResize('top-left')}
              data-resize-handle="true"
              title="Resize window"
            />
            <div
              className="absolute right-0 top-0 h-5 w-5 cursor-nesw-resize"
              onPointerDown={beginWindowResize('top-right')}
              data-resize-handle="true"
              title="Resize window"
            />
            <div
              className="absolute bottom-0 left-0 h-5 w-5 cursor-nesw-resize"
              onPointerDown={beginWindowResize('bottom-left')}
              data-resize-handle="true"
              title="Resize window"
            />
            <div
              className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
              onPointerDown={beginWindowResize('bottom-right')}
              data-resize-handle="true"
              title="Resize window"
            />
          </>
        )}
      </div>

      {/* Metadata Editor Modal */}
      <div className="pointer-events-auto">
        <MetadataEditorModal
          isOpen={isMetadataEditorOpen}
          onClose={() => setIsMetadataEditorOpen(false)}
          initialMetadata={shadowMetadata}
          onSave={async (m) => { await saveShadowMetadata(m); }}
          imageId={image.id}
        />
      </div>

      <div className="pointer-events-auto">
        <CollectionFormModal
          isOpen={isCollectionModalOpen}
          title="Create Collection"
          submitLabel="Create Collection"
          initialValues={{
            name: '',
            description: '',
            sourceTag: '',
            autoUpdate: false,
            includeTargetImages: true,
          }}
          onClose={() => setIsCollectionModalOpen(false)}
          onSubmit={handleCreateCollectionFromContext}
          showIncludeTargetImages
        />
      </div>

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className="pointer-events-auto fixed z-[60] bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.kind === 'selection' ? (
            <>
              <button
                onClick={copySelection}
                className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                Copy
              </button>
              <button
                onClick={searchSelection}
                className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
              >
                <Search className="w-4 h-4" />
                Search Selection
              </button>
            </>
          ) : (
            <>
              <button
                onClick={copyImage}
                className={`w-full text-left px-4 py-2 text-sm text-gray-200 transition-colors flex items-center gap-2 ${isVideo ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-700 hover:text-white'}`}
                disabled={isVideo}
              >
                <Copy className="w-4 h-4" />
                Copy to Clipboard
              </button>

              <div
                className="relative"
                onMouseEnter={() => setIsCollectionSubmenuOpen(true)}
                onMouseLeave={() => {
                  setIsCollectionSubmenuOpen(false);
                  setIsAddToCollectionSubmenuOpen(false);
                }}
              >
                <button
                  onClick={() => setIsCollectionSubmenuOpen((open) => !open)}
                  className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
                >
                  <Folder className="w-4 h-4" />
                  <span className="flex-1">Collection</span>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>

                {isCollectionSubmenuOpen && (
                  <div className="absolute left-full top-0 min-w-[220px] rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl">
                    <div
                      className="relative"
                      onMouseEnter={() => setIsAddToCollectionSubmenuOpen(true)}
                      onMouseLeave={() => setIsAddToCollectionSubmenuOpen(false)}
                    >
                      <button
                        onClick={() => setIsAddToCollectionSubmenuOpen((open) => !open)}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                      >
                        <span className="flex-1">Add to Collection</span>
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      </button>

                      {isAddToCollectionSubmenuOpen && (
                        <div className="absolute left-full top-0 min-w-[220px] rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl">
                          {collections.length === 0 ? (
                            <div className="px-4 py-2 text-sm text-gray-500">No collections yet</div>
                          ) : (
                            collections.map((collection) => (
                              <button
                                key={collection.id}
                                onClick={() => void handleAddToExistingCollection(collection)}
                                className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                              >
                                <span className="truncate">{collection.name}</span>
                                {collection.sourceTag && (
                                  <span className="text-[10px] uppercase tracking-wide text-gray-500">
                                    {collection.autoUpdate !== false ? 'Auto' : 'Linked'}
                                  </span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        setIsCollectionModalOpen(true);
                        hideContextMenu();
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                    >
                      Create New Collection
                    </button>
                  </div>
                )}
              </div>

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
                onClick={handleReparseMetadata}
                className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isReparsing}
              >
                <RefreshCw className={`w-4 h-4 ${isReparsing ? 'animate-spin' : ''}`} />
                Reparse Metadata
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
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(ImageModal, (prevProps, nextProps) => {
  const tagsEqual = (tags1?: string[], tags2?: string[]) => {
    if (!tags1 && !tags2) return true;
    if (!tags1 || !tags2) return false;
    if (tags1.length !== tags2.length) return false;
    return tags1.every((tag, index) => tag === tags2[index]);
  };

  const propsEqual =
    prevProps.image.id === nextProps.image.id &&
    prevProps.image.name === nextProps.image.name &&
    prevProps.image.isFavorite === nextProps.image.isFavorite &&
    prevProps.image.rating === nextProps.image.rating &&
    tagsEqual(prevProps.image.tags, nextProps.image.tags) &&
    prevProps.currentIndex === nextProps.currentIndex &&
    prevProps.totalImages === nextProps.totalImages &&
    prevProps.directoryPath === nextProps.directoryPath &&
    prevProps.isIndexing === nextProps.isIndexing &&
    prevProps.zIndex === nextProps.zIndex &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.modalId === nextProps.modalId &&
    prevProps.initialWindowOffset === nextProps.initialWindowOffset &&
    prevProps.isMinimized === nextProps.isMinimized;

  return propsEqual;
});
