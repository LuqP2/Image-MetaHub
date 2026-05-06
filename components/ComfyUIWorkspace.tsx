import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Clipboard,
  ExternalLink,
  ImageIcon,
  Info,
  Loader2,
  Play,
  Rocket,
  SlidersHorizontal,
  Workflow,
} from 'lucide-react';
import { BaseMetadata, ComfyUIViewLoadFailure, ComfyUIViewState, IndexedImage } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGenerateWithComfyUI } from '../hooks/useGenerateWithComfyUI';
import { useCopyToComfyUI } from '../hooks/useCopyToComfyUI';
import { type GenerationParams as ComfyUIGenerationParams } from './ComfyUIGenerateModal';
import ComfyUIWorkflowWorkspace from './ComfyUIWorkflowWorkspace';
import { hasVerifiedTelemetry } from '../utils/telemetryDetection';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';

interface ComfyUIWorkspaceProps {
  image: IndexedImage | null;
  directoryPath?: string;
  navigationImages?: IndexedImage[];
  directoryPathByImageId?: Record<string, string>;
  currentIndex?: number;
  isActive: boolean;
  suspendBrowser?: boolean;
  onSelectImage?: (image: IndexedImage) => void;
  onNavigatePrevious?: () => void;
  onNavigateNext?: () => void;
  onOpenQueue: () => void;
  onOpenSettings: () => void;
}

const DEFAULT_VIEW_STATE: ComfyUIViewState = {
  url: '',
  title: '',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  visible: false,
};

const PANEL_COLLAPSED_STORAGE_KEY = 'image-metahub-comfyui-workspace-panel-collapsed';

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return 'Not found';
  }
  return String(value);
};

const MetadataLine: React.FC<{ label: string; value: unknown }> = ({ label, value }) => (
  <div className="rounded-md border border-gray-800 bg-gray-950/60 px-3 py-2">
    <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
    <div className="mt-1 truncate font-mono text-xs text-gray-200" title={formatValue(value)}>
      {formatValue(value)}
    </div>
  </div>
);

const WorkspaceThumbnailButton: React.FC<{
  image: IndexedImage;
  isActive: boolean;
  directoryPath?: string;
  onClick: () => void;
  onDragStart: (event: React.DragEvent<HTMLElement>, image: IndexedImage, directoryPath?: string) => void;
}> = ({ image, isActive, directoryPath, onClick, onDragStart }) => {
  const thumbnail = useResolvedThumbnail(image);

  return (
    <button
      onClick={onClick}
      className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-black transition-colors ${
        isActive ? 'border-purple-400 ring-1 ring-purple-400/60' : 'border-gray-700 hover:border-gray-500'
      }`}
      title={image.name}
      aria-label={`Show ${image.name}`}
      draggable={Boolean(directoryPath && window.electronAPI?.startFileDrag)}
      onDragStart={(event) => onDragStart(event, image, directoryPath)}
    >
      {thumbnail?.thumbnailUrl ? (
        <img src={thumbnail.thumbnailUrl} alt="" className="h-full w-full object-cover image-alpha-grid" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-600">
          <ImageIcon className="h-4 w-4" />
        </div>
      )}
    </button>
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

const ComfyUIWorkspace: React.FC<ComfyUIWorkspaceProps> = ({
  image,
  directoryPath,
  navigationImages = [],
  directoryPathByImageId = {},
  currentIndex = -1,
  isActive,
  suspendBrowser = false,
  onSelectImage,
  onNavigatePrevious,
  onNavigateNext,
  onOpenQueue,
  onOpenSettings,
}) => {
  const browserHostRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [viewState, setViewState] = useState<ComfyUIViewState>(DEFAULT_VIEW_STATE);
  const [loadFailure, setLoadFailure] = useState<ComfyUIViewLoadFailure | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string>('');
  const [activeInspectorTab, setActiveInspectorTab] = useState<'image' | 'metadata' | 'workflow'>('image');
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
    if (normalizedNavigationImages.length <= 24 || currentIndex < 0) {
      return normalizedNavigationImages;
    }

    const startIndex = Math.max(0, currentIndex - 11);
    const endIndex = Math.min(normalizedNavigationImages.length, startIndex + 24);
    const adjustedStartIndex = Math.max(0, endIndex - 24);

    return normalizedNavigationImages.slice(adjustedStartIndex, endIndex);
  }, [currentIndex, normalizedNavigationImages]);
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.comfyUIViewOpen);
  const targetUrl = comfyUIWorkspaceLastUrl || comfyUIServerUrl;
  const shouldShowBrowser = isActive && !suspendBrowser;

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
    } else if (result?.error) {
      setConnectionMessage(result.error);
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
      setLoadFailure(failure);
      setComfyUIConnectionStatus('error');
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

  const openExternally = async () => {
    const result = await window.electronAPI?.openExternalUrl?.(targetUrl);
    if (!result?.success) {
      setConnectionMessage(result?.error || 'Failed to open ComfyUI externally.');
    }
  };

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
        <div className="relative min-w-0 flex-1 bg-black">
          <div ref={browserHostRef} className="absolute inset-0" />
          {(suspendBrowser || loadFailure || !viewState.visible) && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gray-950 text-center">
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
                    : 'Start ComfyUI or open it externally. The browser stays attached to this workspace once the endpoint responds.'}
                </p>
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
                <button onClick={() => window.electronAPI?.comfyUIViewGoBack?.()} disabled={!viewState.canGoBack} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100 disabled:opacity-40" title="Back">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button onClick={() => window.electronAPI?.comfyUIViewGoForward?.()} disabled={!viewState.canGoForward} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100 disabled:opacity-40" title="Forward">
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button onClick={openExternally} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" title="Open externally">
                  <ExternalLink className="h-4 w-4" />
                </button>
                <button onClick={togglePanelCollapsed} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" title="Hide image inspector">
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button onClick={onOpenSettings} className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" title="Open integration settings">
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

              {normalizedNavigationImages.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {visibleNavigationImages.map((candidate) => (
                    <WorkspaceThumbnailButton
                      key={candidate.id}
                      image={candidate}
                      isActive={candidate.id === image.id}
                      directoryPath={directoryPathByImageId[candidate.id]}
                      onClick={() => onSelectImage?.(candidate)}
                      onDragStart={startImageFileDrag}
                    />
                  ))}
                </div>
              )}

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

              {activeInspectorTab === 'metadata' && (
                metadata ? (
                  <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <MetadataLine label="Model" value={metadata.model} />
                    <MetadataLine label="Seed" value={metadata.seed} />
                    <MetadataLine label="Steps" value={metadata.steps} />
                    <MetadataLine label="CFG" value={(metadata as any).cfgScale ?? metadata.cfg_scale} />
                    <MetadataLine label="Sampler" value={metadata.sampler} />
                    <MetadataLine label="Scheduler" value={metadata.scheduler} />
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Prompt</div>
                    <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-gray-200">{metadata.prompt || 'Not found'}</p>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Negative prompt</div>
                    <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-gray-200">{metadata.negativePrompt || 'Not found'}</p>
                  </div>
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
    </div>
  );
};

export default ComfyUIWorkspace;
