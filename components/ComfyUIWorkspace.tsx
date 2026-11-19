import { translatePresentationMessage } from '../i18n/presentationMessages';
import { useTranslation } from '../i18n/useTranslation';
import { createPortal } from 'react-dom';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  CheckSquare,
  Bookmark,
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
  ListChecks,
  Package,
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



import { copyTextToClipboard } from '../utils/imageUtils';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import { useThumbnail } from '../hooks/useThumbnail';
import { getOriginalComfyUIWorkflowJson } from '../services/comfyUIWorkflowHydration';
import { formatImageForComfyUI } from '../utils/comfyUIFormatter';
import { FileOperations } from '../services/fileOperations';
import { useImageStore } from '../store/useImageStore';
import TagManagerModal from './TagManagerModal';
import WorkspaceContextPanel from './comfyui/WorkspaceContextPanel';
import WorkspaceSearch, { workspaceCardClass, workspaceFieldClass } from './comfyui/WorkspaceSearch';


import { useFeatureAccess } from '../hooks/useFeatureAccess';


import { useSavePrompt } from '../hooks/useSavePrompt';
import { buildCatalogSearchText, buildCompactSearchText } from '../utils/imageSearchText';
import { useSavedPromptStore } from '../store/useSavedPromptStore';

interface ComfyUIWorkspaceProps {
  toolbarHost?: HTMLDivElement | null;
  queueCount?: number;
  onOpenPromptLibrary?: () => void;
  onViewPromptSource?: (path: string) => void | Promise<void>;
  image: IndexedImage | null;
  directoryPath?: string;
  navigationImages?: IndexedImage[];
  directoryPathByImageId?: Record<string, string>;

  isActive: boolean;
  suspendBrowser?: boolean;



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


const SIDEBAR_COLLAPSED_STORAGE_KEY = 'image-metahub-comfyui-workspace-thumb-rail-collapsed';
const SIDEBAR_WIDTH_STORAGE_KEY = 'image-metahub-comfyui-workspace-sidebar-width';
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 560;
const ASSET_CONTEXT_MENU_WIDTH = 224;
const ASSET_CONTEXT_MENU_HEIGHT = 328;
const clampSidebarWidth = (width: number) => Math.min(Math.max(Math.round(width) || 320, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH);
const OPEN_BATCH_EXPORT_EVENT = 'imagemetahub:open-batch-export';

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

const WorkspaceThumbnailButton: React.FC<{
  image: IndexedImage;
  isActive: boolean;
  isSelected: boolean;
  directoryPath?: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onToggleSelected: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleFavorite: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDragStart: (event: React.DragEvent<HTMLElement>, image: IndexedImage, directoryPath?: string) => void;
}> = ({ image, isActive, isSelected, directoryPath, onClick, onDoubleClick, onKeyDown, onToggleSelected, onToggleFavorite, onContextMenu, onDragStart }) => {
  const { t: tr } = useTranslation();

  useThumbnail(image);
  const thumbnail = useResolvedThumbnail(image);
  const dimensionsLabel = getImageDimensionsLabel(image);
  const prompt = getImagePrompt(image);

  return (
    <div className={`group flex h-full min-w-0 items-center gap-1 rounded border px-1 ${isSelected ? 'border-accent/60 bg-accent/10' : isActive ? 'border-accent/40 bg-gray-800' : 'border-gray-800 hover:bg-gray-800/60'}`}>
      <button
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline focus-visible:outline-accent"
        title={prompt ? image.name + '\n\n' + prompt : image.name}
        aria-label={tr('integrations.workspace.inspectImageAria', { name: image.name })}
        aria-current={isActive || undefined}
        draggable={Boolean(directoryPath && window.electronAPI?.startFileDrag)}
        onDragStart={event => onDragStart(event, image, directoryPath)}
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-950 text-gray-500">
          {thumbnail?.thumbnailUrl ? (
            <img src={thumbnail.thumbnailUrl} alt="" draggable={false} className="h-full w-full object-cover image-alpha-grid" />
          ) : <ImageIcon size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-gray-100">{image.name}</div>
          {dimensionsLabel && <div className="mt-0.5 text-[11px] tabular-nums text-gray-400">{dimensionsLabel}</div>}
        </div>
      </button>
      <button type="button" onClick={onToggleSelected}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-gray-800 focus-visible:outline focus-visible:outline-accent ${isSelected ? 'text-accent' : 'text-gray-400'}`}
        aria-pressed={isSelected} title={isSelected ? tr('libraryGallery.deselectImage') : tr('libraryGallery.selectImage')}
        aria-label={tr(isSelected ? 'integrations.workspace.deselectNamed' : 'integrations.workspace.selectNamed', { name: image.name })}>
        {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
      </button>
      <button type="button" onClick={onToggleFavorite}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-gray-800 focus-visible:outline focus-visible:outline-accent ${image.isFavorite ? 'text-pink-400 light:text-pink-700' : 'text-gray-400'}`}
        aria-pressed={Boolean(image.isFavorite)} title={image.isFavorite ? tr('libraryGallery.removeFromFavorites') : tr('libraryGallery.addToFavorites')}
        aria-label={tr(image.isFavorite ? 'integrations.workspace.unfavoriteNamed' : 'integrations.workspace.favoriteNamed', { name: image.name })}>
        <Heart size={14} fill={image.isFavorite ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
};

type LibraryRowData = {
  images: IndexedImage[];
  activeId?: string;
  directories: Record<string, string>;
  selected: Set<string>;
  onClick: (event: React.MouseEvent<HTMLButtonElement>, image: IndexedImage, index: number) => void;
  onDoubleClick: (event: React.MouseEvent<HTMLButtonElement>, image: IndexedImage) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, image: IndexedImage) => void;
  onToggleSelected: (event: React.MouseEvent<HTMLButtonElement>, image: IndexedImage, index: number) => void;
  onToggleFavorite: (id: string) => void;
  onContextMenu: (event: React.MouseEvent, image: IndexedImage) => void;
  onDragStart: (event: React.DragEvent<HTMLElement>, image: IndexedImage, directoryPath?: string) => void;
};

function LibraryRow({ index, style, data }: ListChildComponentProps<LibraryRowData>) {
  const image = data.images[index];
  return <div style={style} className="px-2 py-1">
    <WorkspaceThumbnailButton
      image={image}
      isActive={image.id === data.activeId}
      isSelected={data.selected.has(image.id)}
      directoryPath={data.directories[image.id]}
      onClick={event => data.onClick(event, image, index)}
      onDoubleClick={event => data.onDoubleClick(event, image)}
      onKeyDown={event => data.onKeyDown(event, image)}
      onToggleSelected={event => data.onToggleSelected(event, image, index)}
      onToggleFavorite={event => {
        event.stopPropagation();
        data.onToggleFavorite(image.id);
      }}
      onContextMenu={event => data.onContextMenu(event, image)}
      onDragStart={data.onDragStart}
    />
  </div>;
}

const getBounds = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
};

type WorkspaceAssetContextMenu = {
  image: IndexedImage;
  x: number;
  y: number;
  above: boolean;
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
  toolbarHost,
  queueCount = 0,
  image,
  directoryPath,
  navigationImages = [],
  directoryPathByImageId = {},

  isActive,
  suspendBrowser = false,



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
  onOpenPromptLibrary = () => {},
  onViewPromptSource = () => {},
}) => {
  const { t: tr } = useTranslation();


  const [hasOverlay, setHasOverlay] = useState(false);
  const { canUseAdvancedPromptLibrary, showProModal } = useFeatureAccess();

  useEffect(() => {
    const check = () => setHasOverlay(Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')));
    const observer = new MutationObserver(check); check();
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    return () => observer.disconnect();
  }, []);
  const browserHostRef = useRef<HTMLDivElement>(null);

  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const selectionAnchorRef = useRef<string | null>(null);
  const libraryListRef = useRef<FixedSizeList<LibraryRowData>>(null);
  const libraryScrollOffsetRef = useRef(0);
  const [librarySearch, setLibrarySearch] = useState('');
  const savePrompt = useSavePrompt();
  const handledWorkflowLoadRequestIdRef = useRef<number | null>(null);
  const [viewState, setViewState] = useState<ComfyUIViewState>(DEFAULT_VIEW_STATE);
  const [loadFailure, setLoadFailure] = useState<ComfyUIViewLoadFailure | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string>('');
  const [assetContextMenu, setAssetContextMenu] = useState<WorkspaceAssetContextMenu>(null);

  const [assetActionMessage, setAssetActionMessage] = useState<string>('');
  const [saveSelectionStatus, setSaveSelectionStatus] = useState('');
  useEffect(() => window.electronAPI?.onComfyUISaveSelection?.(({ kind, text }) => {
    if (!['prompt', 'block'].includes(kind) || typeof text !== 'string' || !text.trim()) return;
    if (kind === 'block' && !canUseAdvancedPromptLibrary) { showProModal('prompt_library_advanced'); return; }
    void useSavedPromptStore.getState().mutate({ action: 'create', kind, item: kind === 'block' ? { text } : { positivePrompt: text } })
      .then(() => setSaveSelectionStatus(kind === 'block' ? tr('promptLibrary.blockSaved') : tr('integrations.inspector.promptSaved')))
      .catch(error => setSaveSelectionStatus(error instanceof Error ? error.message : tr('integrations.workspace.saveSelectionFailed')));
  }), [canUseAdvancedPromptLibrary, showProModal, tr]);
  useEffect(() => { if (saveSelectionStatus) { const timer = setTimeout(() => setSaveSelectionStatus(''), 4000); return () => clearTimeout(timer); } }, [saveSelectionStatus]);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [isRatingMenuOpen, setIsRatingMenuOpen] = useState(false);
  const [sidebarWidth, setSidebarWidthState] = useState(() => {
    if (typeof window === 'undefined') return 320;
    return clampSidebarWidth(Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)));
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  });
  const comfyUIServerUrl = useSettingsStore((state) => state.comfyUIServerUrl);
  const comfyUILastConnectionStatus = useSettingsStore((state) => state.comfyUILastConnectionStatus);
  const setComfyUIConnectionStatus = useSettingsStore((state) => state.setComfyUIConnectionStatus);
  const comfyUIWorkspaceLastUrl = useSettingsStore((state) => state.comfyUIWorkspaceLastUrl);
  const setComfyUIWorkspaceLastUrl = useSettingsStore((state) => state.setComfyUIWorkspaceLastUrl);
  const removeImages = useImageStore((state) => state.removeImages);
  const selectedImages = useImageStore((state) => state.selectedImages);
  const toggleImageSelection = useImageStore((state) => state.toggleImageSelection);
  const bulkToggleFavorite = useImageStore((state) => state.bulkToggleFavorite);
  const toggleFavorite = useImageStore((state) => state.toggleFavorite);
  const bulkSetImageRating = useImageStore((state) => state.bulkSetImageRating);

  const normalizedNavigationImages = useMemo(
    () => (navigationImages.length > 0 ? navigationImages : image ? [image] : []),
    [image, navigationImages],
  );
  const scopedLibraryImages = useMemo(
    () => selectedDirectoryId ? normalizedNavigationImages.filter(candidate => candidate.directoryId === selectedDirectoryId) : normalizedNavigationImages,
    [normalizedNavigationImages, selectedDirectoryId],
  );
  const visibleNavigationImages = useMemo(() => {
    const terms = librarySearch.toLowerCase().replace(/\\/g, '/').split(/\s+/).filter(Boolean);
    if (terms.length === 0) return scopedLibraryImages;

    return scopedLibraryImages.filter(candidate => {
      const catalog = buildCatalogSearchText(candidate);
      const metadata = buildCompactSearchText(candidate);
      return terms.every(term => catalog.includes(term) || metadata.includes(term));
    });
  }, [librarySearch, scopedLibraryImages]);

  useEffect(() => {
    selectionAnchorRef.current = null;
    libraryScrollOffsetRef.current = 0;
    libraryListRef.current?.scrollTo(0);
  }, [librarySearch, selectedDirectoryId, applyLibraryFilters]);

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
  const shouldShowBrowser = isActive && !suspendBrowser && !hasBrowserLoadFailure && !hasOverlay;
  const shouldShowBrowserFallback = suspendBrowser || hasBrowserLoadFailure || !viewState.visible;

  useEffect(() => {
    if (!assetContextMenu) {
      return;
    }

    const close = () => setAssetContextMenu(null);
    window.addEventListener('click', close);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('blur', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [assetContextMenu]);

  const connectionClasses = useMemo(() => {
    if (comfyUILastConnectionStatus === 'connected') {
      return 'border-green-500/30 bg-green-500/10 text-green-200 light:text-green-800';
    }
    if (comfyUILastConnectionStatus === 'error' || loadFailure) {
      return 'border-red-500/30 bg-red-500/10 text-red-200 light:text-red-800';
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
      setConnectionMessage(result?.error || tr('integrations.workspace.openExternalFailed'));
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
      setConnectionMessage(result?.error || tr('integrations.workspace.reloadFailed'));
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
    setConnectionMessage(tr('integrations.workspace.loadingWorkflow'));
    setLoadFailure(null);

    const loadWorkflow = async () => {
      if (!isElectron || !window.electronAPI?.comfyUIViewLoadWorkflow) {
        setConnectionMessage(tr('integrations.workspace.loadWorkflowDesktopOnly'));
        return;
      }

      try {
        const bounds = browserHostRef.current ? getBounds(browserHostRef.current) : undefined;
        const workflowJson = await getOriginalComfyUIWorkflowJson(
          workflowImage,
          directoryPathByImageId[workflowImage.id] ?? (workflowImage.id === image?.id ? directoryPath : undefined),
        );
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
              ? tr('integrations.workspace.workflowOpenedNewTab')
              : tr('integrations.workspace.workflowLoadedCanvas'))
          );
          return;
        }

        setConnectionMessage(result?.error || tr('integrations.workspace.loadWorkflowFailed'));
      } catch (error) {
        const message = error instanceof Error ? error.message : tr('integrations.workspace.loadWorkflowFailed');
        setConnectionMessage(message);
        useImageStore.getState().setError(message);
      }
    };

    void loadWorkflow();
  }, [
    directoryPath,
    directoryPathByImageId,
    image,
    isElectron,
    normalizedNavigationImages,
    setComfyUIConnectionStatus,
    onWorkflowLoadRequestHandled,
    targetUrl,
    workflowLoadRequest,
    tr,
  ]);

  const setSidebarWidth = (width: number) => {
    const nextWidth = clampSidebarWidth(width);
    setSidebarWidthState(nextWidth);
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
  };

  const beginSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarResizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
  };

  const handleSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const resizeState = sidebarResizeStateRef.current;
    if (!resizeState) {
      return;
    }
    setSidebarWidth(resizeState.startWidth + event.clientX - resizeState.startX);
  };

  const endSidebarResize = () => {
    sidebarResizeStateRef.current = null;
    void syncBounds();
  };

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
    window.electronAPI.startFileDrag({ directoryPath: dragDirectoryPath, relativePath, imageId: dragImage.id });
  }, []);

  const copyAssetValue = useCallback((label: string, value: string) => {
    const text = value.trim();
    if (!text) {
      return;
    }

    copyTextToClipboard(text)
      .then((result) => {
        if (result.success) {
          setAssetActionMessage(tr('integrations.workspace.fieldCopied', { label: label }));
        } else {
          console.error(`Failed to copy ${label}:`, result.error);
          setAssetActionMessage(tr('imageViewer.actions.copyFailed', { label: label }));
        }
      });
  }, [tr]);

  const copyAssetPrompt = useCallback((contextImage: IndexedImage) => {
    const prompt = getImagePrompt(contextImage);
    setAssetContextMenu(null);
    copyAssetValue(tr('libraryGallery.prompt'), prompt);
  }, [copyAssetValue, tr]);

  const toggleSidebarCollapsed = useCallback(() => {
    setIsSidebarCollapsed((current) => {
      const next = !current;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      }
      window.requestAnimationFrame(() => {
        void syncBounds();
      });
      return next;
    });
  }, [syncBounds]);

  const inspectWorkspaceImage = useCallback((nextImage: IndexedImage) => {
    onInspectImage?.(nextImage);
  }, [onInspectImage]);

  const updateThumbSelection = useCallback((event: React.MouseEvent, contextImage: IndexedImage, visibleIndex: number) => {
    event.preventDefault();
    event.stopPropagation();

    const anchor = event.shiftKey
      ? visibleNavigationImages.findIndex(candidate => candidate.id === selectionAnchorRef.current)
      : -1;
    if (anchor >= 0) {
      const start = Math.min(anchor, visibleIndex);
      const end = Math.max(anchor, visibleIndex);
      const rangeIds = visibleNavigationImages.slice(start, end + 1).map((candidate) => candidate.id);
      useImageStore.setState((state) => {
        const next = new Set(state.selectedImages);
        rangeIds.forEach((id) => next.add(id));
        return { selectedImages: next };
      });
    } else {
      toggleImageSelection(contextImage.id);
    }

    selectionAnchorRef.current = contextImage.id;
  }, [toggleImageSelection, visibleNavigationImages]);

  const handleThumbnailClick = useCallback((event: React.MouseEvent<HTMLButtonElement>, contextImage: IndexedImage, visibleIndex: number) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      updateThumbSelection(event, contextImage, visibleIndex);
      return;
    }

    inspectWorkspaceImage(contextImage);
  }, [inspectWorkspaceImage, updateThumbSelection]);

  const handleThumbnailDoubleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>, contextImage: IndexedImage) => {
    event.preventDefault();
    event.stopPropagation();
    onViewFullMetadata?.(contextImage);
  }, [onViewFullMetadata]);

  const handleThumbnailKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>, contextImage: IndexedImage) => {
    if (event.key !== 'Enter' || event.repeat) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onViewFullMetadata?.(contextImage);
  }, [onViewFullMetadata]);

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
      setAssetActionMessage(tr('integrations.workspace.compareRangeError'));
      return;
    }
    onOpenCompare?.(targetImages);
    setAssetContextMenu(null);
  }, [onOpenCompare, tr]);

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

    const { skipDeleteConfirmation } = useSettingsStore.getState();
    if (!skipDeleteConfirmation) {
      const confirmed = window.confirm(
        targetImages.length === 1
          ? tr('integrations.workspace.deleteSingleConfirm', { name: targetImages[0].name })
          : tr('integrations.workspace.deleteMultipleConfirm', { count: targetImages.length }),
      );
      if (!confirmed) {
        return;
      }
    }

    const results = await FileOperations.deleteFiles(targetImages);
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
    setAssetActionMessage(failedCount > 0 ? tr('integrations.workspace.deletedWithFailures', { deleted: deletedIds.length, failed: failedCount }) : tr('integrations.workspace.deletedImages', { count: deletedIds.length }));
    setAssetContextMenu(null);
  }, [removeImages, tr]);

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
    const x = Math.max(0, Math.min(preferredRightX || thumbBounds.left, maxXBeforeBrowser > 0 ? maxXBeforeBrowser : window.innerWidth - ASSET_CONTEXT_MENU_WIDTH));

    const cursorY = event.clientY || thumbBounds.bottom;
    const spaceBelow = window.innerHeight - cursorY;
    const above = cursorY >= ASSET_CONTEXT_MENU_HEIGHT + 8 ||
      (spaceBelow < ASSET_CONTEXT_MENU_HEIGHT + 8 && cursorY > spaceBelow);
    setAssetContextMenu({ image: contextImage, x, y: cursorY, above });
  }, []);

  const inspectAsset = useCallback((contextImage: IndexedImage) => {
    setAssetContextMenu(null);
    onViewFullMetadata?.(contextImage);
  }, [onViewFullMetadata]);

  const openWorkflowInComfyUI = useCallback(async (contextImage: IndexedImage) => {
    setAssetContextMenu(null);
    inspectWorkspaceImage(contextImage);
    setConnectionMessage(tr('integrations.workspace.loadingWorkflow'));
    setLoadFailure(null);

    if (!isElectron || !window.electronAPI?.comfyUIViewLoadWorkflow) {
      setConnectionMessage(tr('integrations.workspace.loadWorkflowDesktopOnly'));
      return;
    }

    try {
      const bounds = browserHostRef.current ? getBounds(browserHostRef.current) : undefined;
      const workflowJson = await getOriginalComfyUIWorkflowJson(
        contextImage,
        directoryPathByImageId[contextImage.id] ?? (contextImage.id === image?.id ? directoryPath : undefined),
      );
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
            ? tr('integrations.workspace.workflowOpenedNewTab')
            : tr('integrations.workspace.workflowLoadedCanvas'))
        );
        return;
      }

      setConnectionMessage(result?.error || tr('integrations.workspace.loadWorkflowFailed'));
    } catch (error) {
      const message = error instanceof Error ? error.message : tr('integrations.workspace.loadWorkflowFailed');
      setConnectionMessage(message);
      useImageStore.getState().setError(message);
    }
  }, [directoryPath, directoryPathByImageId, image?.id, inspectWorkspaceImage, isElectron, setComfyUIConnectionStatus, targetUrl, tr]);

  const exportAssetImage = useCallback((contextImage: IndexedImage) => {
    exportImages(getContextTargetImages(contextImage));
  }, [exportImages, getContextTargetImages]);

  const exportAssetWorkflow = useCallback(async (contextImage: IndexedImage) => {
    setAssetContextMenu(null);
    if (!window.electronAPI?.showSaveDialog || !window.electronAPI?.writeFile) {
      setAssetActionMessage(tr('integrations.workspace.exportWorkflowDesktopOnly'));
      return;
    }

    try {
      const defaultName = `${contextImage.name.replace(/\.[^.]+$/, '') || 'workflow'}.json`;
      const saveResult = await window.electronAPI.showSaveDialog({
        title: tr('integrations.workspace.exportWorkflowDialogTitle'),
        defaultPath: defaultName,
        filters: [{ name: tr('integrations.workspace.workflowFilterName'), extensions: ['json'] }],
      });
      if (!saveResult.success || saveResult.canceled || !saveResult.path) {
        return;
      }

      const workflowJson = formatImageForComfyUI(contextImage);
      const writeResult = await window.electronAPI.writeFile(saveResult.path, workflowJson);
      setAssetActionMessage(writeResult.success ? tr('integrations.workspace.workflowExported') : writeResult.error || tr('integrations.workspace.exportWorkflowFailed'));
    } catch (error) {
      setAssetActionMessage(error instanceof Error ? error.message : String(error));
    }
  }, [tr]);

  const deleteAsset = useCallback(async (contextImage: IndexedImage) => {
    await deleteImages(getContextTargetImages(contextImage));
  }, [deleteImages, getContextTargetImages]);

  const clearWorkspaceSelection = () => {
    useImageStore.setState(state => {
      const next = new Set(state.selectedImages);
      selectedWorkspaceIds.forEach(id => next.delete(id));
      return { selectedImages: next };
    });
    selectionAnchorRef.current = null;
  };

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
          <Rocket className="mx-auto h-10 w-10 text-purple-300 light:text-purple-800" />
          <h2 className="mt-4 text-lg font-semibold text-gray-100">{tr('integrations.workspace.desktopOnlyTitle')}</h2>
          <p className="mt-2 text-sm text-gray-400">
            {tr('integrations.workspace.desktopOnlyDescription')}</p>
          <button
            onClick={() => window.open(targetUrl, '_blank', 'noopener,noreferrer')}
            className="mt-5 rounded-md border border-purple-500/40 bg-purple-500/15 px-4 py-2 text-sm font-semibold text-purple-100 light:text-purple-900 hover:bg-purple-500/25"
          >
            {tr('integrations.workspace.openComfyExternally')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-950">
      {saveSelectionStatus && <p role="status" className="shrink-0 border-b border-gray-800 px-3 py-2 text-xs text-accent">{saveSelectionStatus}</p>}
      {toolbarHost && createPortal(
        <div className="flex items-center gap-1" role="toolbar" aria-label={tr('integrations.workspace.navigationLabel')}>
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded border ${connectionClasses}`} title={connectionMessage ? translatePresentationMessage(connectionMessage, tr) : tr('shell.connection', { status: tr(comfyUILastConnectionStatus === 'connected' ? 'settings.integrations.connected' : comfyUILastConnectionStatus === 'error' ? 'shell.errorStatus' : 'libraryGallery.unknown') })}>
            {viewState.isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : loadFailure || comfyUILastConnectionStatus === 'error' ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
          </span>
          <button onClick={() => window.electronAPI?.comfyUIViewGoBack?.()} disabled={!viewState.canGoBack} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100 disabled:opacity-40" title={tr('libraryGallery.back')} aria-label={tr('libraryGallery.back')}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button onClick={() => window.electronAPI?.comfyUIViewGoForward?.()} disabled={!viewState.canGoForward} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100 disabled:opacity-40" title={tr('integrations.workspace.forward')} aria-label={tr('integrations.workspace.forward')}>
            <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={openExternally} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" title={tr('integrations.workspace.openExternally')} aria-label={tr('integrations.workspace.openExternally')}>
            <ExternalLink className="h-4 w-4" />
          </button>
          <button onClick={reloadEmbeddedView} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" title={tr('integrations.workspace.refreshComfy')} aria-label={tr('integrations.workspace.refreshComfy')}>
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={onOpenSettings} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" title={tr('integrations.workspace.openIntegrationSettings')} aria-label={tr('integrations.workspace.openIntegrationSettings')}>
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <button onClick={onOpenQueue} className="relative rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" title={tr('integrations.inspector.openGenerationQueue')} aria-label={tr('integrations.inspector.openGenerationQueue')}>
            <ListChecks className="h-4 w-4" />
            {queueCount > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-blue-500 px-1 text-[10px] font-bold text-gray-950">{queueCount}</span>}
          </button>
        </div>, toolbarHost
      )}
      <div className="flex min-h-0 flex-1">
        <aside
          className="flex min-h-0 shrink-0 flex-col border-r border-gray-800 bg-gray-900/95"
          style={{ width: isSidebarCollapsed ? 44 : sidebarWidth }}
        >
          <WorkspaceContextPanel
            collapsed={isSidebarCollapsed}
            onToggle={toggleSidebarCollapsed}
            active={shouldShowBrowser && viewState.visible}
            onOpenLibrary={onOpenPromptLibrary}
            onViewSource={onViewPromptSource}
            libraryPanel={visible => (
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 space-y-2 border-b border-gray-800 p-2">
                  <WorkspaceSearch label={tr('integrations.workspace.searchLibrary')} query={librarySearch} onChange={setLibrarySearch} />
                  <div className={workspaceFieldClass + ' flex items-center gap-1.5 focus-within:border-accent'}>
                    <Folder size={14} className="shrink-0 text-gray-400" />
                    <select
                      value={selectedDirectoryId || ''}
                      onChange={event => onSelectDirectory?.(event.target.value || null)}
                      className="min-w-0 flex-1 bg-transparent text-xs text-gray-200 outline-none"
                      aria-label={tr('integrations.workspace.changeFolder')}
                    >
                      <option value="" className="bg-gray-900">{tr('canvas.allFolders')}</option>
                      {directories.map(directory => (
                        <option key={directory.id} value={directory.id} className="bg-gray-900">{directory.name}</option>
                      ))}
                    </select>
                  </div>
                  <label
                    className={workspaceFieldClass + ' flex cursor-pointer items-center justify-between gap-2 text-gray-400 focus-within:border-accent'}
                    title={tr('integrations.workspace.applyLibraryFiltersTooltip')}
                  >
                    <span className="truncate">{tr('integrations.workspace.applyLibraryFilters')}</span>
                    <input
                      type="checkbox"
                      checked={applyLibraryFilters}
                      onChange={(event) => onApplyLibraryFiltersChange?.(event.target.checked)}
                      className="h-3.5 w-3.5 accent-accent"
                    />
                  </label>
                  <div className="flex min-h-7 items-center justify-between gap-1 text-xs tabular-nums text-gray-400">
                    <span role="status">{tr('libraryGallery.imageCount', { count: visibleNavigationImages.length })}</span>
                    {selectedWorkspaceCount > 0 && <span>{tr('libraryGallery.selectedCount', { count: selectedWorkspaceCount })}</span>}
                  </div>
                  {selectedWorkspaceCount > 0 && <div className="flex flex-wrap items-center gap-1" role="group" aria-label={tr('integrations.workspace.selectedImageActions')}>
                    <button
                      onClick={handleBulkExport}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:text-gray-700"
                      title={tr('promptLibrary.exportSelected')}
                      aria-label={tr('promptLibrary.exportSelected')}
                    >
                      <Package className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={handleBulkFavorite}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-pink-300 light:hover:text-pink-800 disabled:cursor-not-allowed disabled:text-gray-700"
                      title={allSelectedWorkspaceFavorites ? tr('integrations.workspace.removeSelectedFavorites') : tr('integrations.workspace.favoriteSelected')}
                      aria-label={allSelectedWorkspaceFavorites ? tr('integrations.workspace.removeSelectedFavorites') : tr('integrations.workspace.favoriteSelected')}
                    >
                      <Heart className={`h-3.5 w-3.5 ${allSelectedWorkspaceFavorites ? 'fill-current text-pink-300 light:text-pink-800' : ''}`} />
                    </button>
                    <button
                      onClick={handleBulkTag}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-blue-300 light:hover:text-blue-800 disabled:cursor-not-allowed disabled:text-gray-700"
                      title={tr('integrations.workspace.tagSelected')}
                      aria-label={tr('integrations.workspace.tagSelected')}
                    >
                      <Tag className="h-3.5 w-3.5" />
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setIsRatingMenuOpen((open) => !open)}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-yellow-300 light:hover:text-yellow-800 disabled:cursor-not-allowed disabled:text-gray-700"
                        title={tr('integrations.workspace.rateSelected')}
                        aria-label={tr('integrations.workspace.rateSelected')}
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                      {isRatingMenuOpen && (
                        <div className="absolute left-0 top-full z-[100] mt-1 w-24 overflow-hidden rounded-md border border-gray-700 bg-gray-900 py-1 shadow-xl">
                          {[0, 1, 2, 3, 4, 5].map((rating) => (
                            <button
                              key={rating}
                              onClick={() => setSelectedRating(rating === 0 ? null : (rating as ImageRating))}
                              className="block w-full px-2 py-1 text-left text-xs text-gray-200 hover:bg-gray-800"
                            >
                              {rating === 0 ? tr('libraryGallery.clear') : tr('librarySearch.starCount', { count: rating })}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleBulkCompare}
                      disabled={selectedWorkspaceCount < 2 || selectedWorkspaceCount > 4}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-purple-300 light:hover:text-purple-800 disabled:cursor-not-allowed disabled:text-gray-700"
                      title={selectedWorkspaceCount < 2 ? tr('integrations.workspace.compareMinError') : selectedWorkspaceCount > 4 ? tr('integrations.workspace.compareMaxError') : tr('integrations.workspace.compareSelected')}
                      aria-label={tr('integrations.workspace.compareSelected')}
                    >
                      <GitCompare className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={handleBulkDelete}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-red-300 light:hover:text-red-800 disabled:cursor-not-allowed disabled:text-gray-700"
                      title={tr('integrations.workspace.deleteSelected')}
                      aria-label={tr('integrations.workspace.deleteSelected')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={clearWorkspaceSelection}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:text-gray-700"
                      title={tr('libraryGallery.clearSelection')}
                      aria-label={tr('libraryGallery.clearSelection')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>}
                  {assetActionMessage && <p role="status" className="text-xs text-gray-400">{translatePresentationMessage(assetActionMessage, tr)}</p>}
                </div>
                {visible && (visibleNavigationImages.length === 0 ? (
                  <p className="p-3 text-xs text-gray-400">{librarySearch.trim() ? tr('promptLibrary.noMatchingImages') : tr('integrations.workspace.noImagesInView')}</p>
                ) : (
                  <div className="min-h-0 flex-1">
                    <AutoSizer disableWidth>{({ height }) => (
                      <FixedSizeList<LibraryRowData>
                        ref={libraryListRef}
                        className="scrollbar-thin"
                        height={height || 320}
                        width="100%"
                        itemCount={visibleNavigationImages.length}
                        itemSize={64}
                        itemKey={(index, data) => data.images[index].id}
                        itemData={{
                          images: visibleNavigationImages,
                          activeId: image?.id,
                          selected: selectedImages,
                          directories: directoryPathByImageId,
                          onClick: handleThumbnailClick,
                          onDoubleClick: handleThumbnailDoubleClick,
                          onKeyDown: handleThumbnailKeyDown,
                          onToggleSelected: updateThumbSelection,
                          onToggleFavorite: toggleFavorite,
                          onContextMenu: showAssetContextMenu,
                          onDragStart: startImageFileDrag,
                        }}
                        initialScrollOffset={libraryScrollOffsetRef.current}
                        onScroll={({ scrollOffset }) => { libraryScrollOffsetRef.current = scrollOffset; }}
                      >
                        {LibraryRow}
                      </FixedSizeList>
                    )}</AutoSizer>
                  </div>
                ))}
              </div>
            )}
          />
        </aside>

        {!isSidebarCollapsed && (
        <div
          className="w-1 shrink-0 touch-none cursor-ew-resize bg-gray-800 hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none"
          onPointerDown={beginSidebarResize}
          onPointerMove={handleSidebarResize}
          onPointerUp={endSidebarResize}
          onPointerCancel={endSidebarResize}
          role="separator"
          aria-label={tr('integrations.workspace.resizeSidebar')}
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            setSidebarWidth(sidebarWidth + (event.key === 'ArrowLeft' ? -16 : 16));
          }}
        />
        )}

        <div className="relative min-w-0 flex-1 bg-black">
          <div ref={browserHostRef} className="absolute inset-0" />
          {shouldShowBrowserFallback && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950 text-center">
              <div className="max-w-sm px-6">
                {suspendBrowser ? (
                  <Loader2 className="mx-auto h-9 w-9 animate-spin text-purple-300 light:text-purple-800" />
                ) : (
                  <AlertTriangle className="mx-auto h-9 w-9 text-amber-300 light:text-amber-800" />
                )}
                <h3 className="mt-3 text-base font-semibold text-gray-100">
                  {suspendBrowser ? tr('integrations.workspace.pausedDuringGeneration') : tr('integrations.workspace.notVisibleYet')}
                </h3>
                <p className="mt-2 text-sm text-gray-400">
                  {suspendBrowser
                    ? tr('integrations.workspace.pausedDuringGenerationHelp')
                    : targetUrl ? tr('integrations.workspace.startComfyAtUrl', { url: targetUrl }) : tr('integrations.workspace.startComfyConfiguredUrl')}
                </p>
                {!suspendBrowser && (
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <button
                      onClick={reloadEmbeddedView}
                      className="inline-flex items-center gap-2 rounded-md border border-purple-500/40 bg-purple-500/15 px-3 py-2 text-sm font-semibold text-purple-100 light:text-purple-900 hover:bg-purple-500/25"
                    >
                      <RefreshCw className="h-4 w-4" />
                      {tr('integrations.workspace.refresh')}</button>
                    <button
                      onClick={onOpenSettings}
                      className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      {tr('settings.navigation.settings')}</button>
                    <button
                      onClick={openExternally}
                      className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
                    >
                      <ExternalLink className="h-4 w-4" />
                      {tr('integrations.workspace.openExternally')}</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
      {assetContextMenu && (
        <div
          className={workspaceCardClass + ' fixed z-[95] w-56 overflow-y-auto bg-gray-900 py-1 text-xs text-gray-100 shadow-xl'}
          style={{
            left: assetContextMenu.x,
            top: assetContextMenu.above ? undefined : assetContextMenu.y,
            bottom: assetContextMenu.above ? window.innerHeight - assetContextMenu.y : undefined,
            maxHeight: Math.max(0, (assetContextMenu.above ? assetContextMenu.y : window.innerHeight - assetContextMenu.y) - 8),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-gray-800"
            onClick={() => inspectAsset(assetContextMenu.image)}
          >
            <Info className="h-3.5 w-3.5" />
            {tr('integrations.workspace.inspectAsset')}</button>
          <button
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-gray-800"
            onClick={() => {
              void openWorkflowInComfyUI(assetContextMenu.image);
            }}
          >
            <Workflow className="h-3.5 w-3.5" />
            {tr('imageViewer.details.openComfy')}</button>
          <button
            className={`flex w-full items-center gap-2 px-2.5 py-2 text-left ${
              getCompareTargetImages(assetContextMenu.image).length >= 2 && getCompareTargetImages(assetContextMenu.image).length <= 4
                ? 'hover:bg-gray-800'
                : 'cursor-not-allowed text-gray-500'
            }`}
            disabled={getCompareTargetImages(assetContextMenu.image).length < 2 || getCompareTargetImages(assetContextMenu.image).length > 4}
            onClick={() => openCompareMode(getCompareTargetImages(assetContextMenu.image))}
          >
            <GitCompare className="h-3.5 w-3.5" />
            {tr('integrations.workspace.compareMode')}</button>
          <button
            className={`flex w-full items-center gap-2 px-2.5 py-2 text-left ${
              getImagePrompt(assetContextMenu.image) ? 'hover:bg-gray-800' : 'cursor-not-allowed text-gray-500'
            }`}
            disabled={!getImagePrompt(assetContextMenu.image)}
            onClick={() => copyAssetPrompt(assetContextMenu.image)}
          >
            <Copy className="h-3.5 w-3.5" />
            {tr('libraryGallery.copyPrompt')}</button>
          <div className="my-1 border-t border-gray-700" />
          <button
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-gray-800"
            onClick={() => {
              const target = assetContextMenu.image;
              setAssetContextMenu(null);
              void savePrompt(target, {
                directoryPath: directoryPathByImageId[target.id] ?? (image?.id === target.id ? directoryPath : undefined),
                readAuthoritativeShadow: true,
              }).then(result => {
                setAssetActionMessage(result.status === 'already-saved' ? tr('integrations.workspace.promptAlreadySaved') : tr('integrations.inspector.promptSaved'));
              }).catch(error => {
                setAssetActionMessage(error instanceof Error ? error.message : tr('libraryGallery.couldNotSavePrompt'));
              });
            }}
          >
            <Bookmark size={14} />
            {tr('promptLibrary.savePrompt')}</button>
          <button
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-gray-800"
            onClick={() => exportAssetImage(assetContextMenu.image)}
          >
            <Download className="h-3.5 w-3.5" />
            {tr('libraryGallery.exportImage')}</button>
          <button
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-gray-800"
            onClick={() => exportAssetWorkflow(assetContextMenu.image)}
          >
            <Workflow className="h-3.5 w-3.5" />
            {tr('integrations.workspace.exportWorkflow')}</button>
          <button
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-red-300 hover:bg-red-950/40 light:text-red-800 light:hover:bg-red-500/10"
            onClick={() => deleteAsset(assetContextMenu.image)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {tr('libraryGallery.delete')}</button>
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
