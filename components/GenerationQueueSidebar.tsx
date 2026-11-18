import { useTranslation, type MessageKey, type Translate } from '../i18n/useTranslation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, RefreshCw, CircleX, CircleStop, ArchiveX, Play } from 'lucide-react';
import { useGenerationQueueStore, GenerationQueueItem } from '../store/useGenerationQueueStore';
import { useGenerateWithA1111 } from '../hooks/useGenerateWithA1111';
import { useGenerateWithComfyUI } from '../hooks/useGenerateWithComfyUI';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { A1111ApiClient } from '../services/a1111ApiClient';
import { ComfyUIApiClient } from '../services/comfyUIApiClient';
import { useA1111ProgressContext } from '../contexts/A1111ProgressContext';
import { useComfyUIProgressContext } from '../contexts/ComfyUIProgressContext';
import { getDisplayCurrentImage } from '../utils/generationQueueProgress';

interface GenerationQueueSidebarProps {
  onClose: () => void;
  width: number;
  isResizing: boolean;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onOpenGeneratedOutputs?: (item: GenerationQueueItem) => void;
  onOpenGeneratedOutputImage?: (item: GenerationQueueItem) => void;
}

const statusStyles: Record<string, string> = {
  waiting: 'text-yellow-300',
  processing: 'text-blue-300',
  done: 'text-green-300',
  failed: 'text-red-300',
  canceled: 'text-gray-400',
};

const statusLabel: Record<GenerationQueueItem['status'], MessageKey> = {
  waiting: 'generationQueue.waiting',
  processing: 'generationQueue.processing',
  done: 'generationQueue.done',
  failed: 'generationQueue.failed',
  canceled: 'generationQueue.canceled',
};

const formatPromptPreview = (prompt: string | undefined, t: Translate) => {
  if (!prompt) return t('generationQueue.noPrompt');
  const trimmed = prompt.trim();
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 120)}...`;
};

const formatTime = (timestamp: number, language: string) =>
  new Date(timestamp).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });

const PREVIEW_HEIGHT_STORAGE_KEY = 'imh:queuePreviewHeight';
const PREVIEW_HEIGHT_DEFAULT = 96; // matches the previous fixed h-24
const PREVIEW_HEIGHT_MIN = 64;
const PREVIEW_HEIGHT_MAX = 640;

const readStoredPreviewHeight = (): number => {
  if (typeof window === 'undefined') {
    return PREVIEW_HEIGHT_DEFAULT;
  }
  const stored = Number(window.localStorage.getItem(PREVIEW_HEIGHT_STORAGE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) {
    return PREVIEW_HEIGHT_DEFAULT;
  }
  return Math.min(PREVIEW_HEIGHT_MAX, Math.max(PREVIEW_HEIGHT_MIN, stored));
};

const GenerationQueueSidebar: React.FC<GenerationQueueSidebarProps> = ({
  onClose,
  width,
  isResizing,
  onResizeStart,
  onOpenGeneratedOutputs,
  onOpenGeneratedOutputImage,
}) => {
  const { t, language } = useTranslation();
  const items = useGenerationQueueStore((state) => state.items);
  const hasFinishedItems = items.some(item => ['done', 'failed', 'canceled'].includes(item.status));
  const removeJob = useGenerationQueueStore((state) => state.removeJob);
  const clearByStatus = useGenerationQueueStore((state) => state.clearByStatus);
  const setJobStatus = useGenerationQueueStore((state) => state.setJobStatus);
  const setActiveJob = useGenerationQueueStore((state) => state.setActiveJob);
  const activeJobs = useGenerationQueueStore((state) => state.activeJobs);

  const { generateWithA1111 } = useGenerateWithA1111();
  const { generateWithComfyUI } = useGenerateWithComfyUI();
  const images = useImageStore((state) => state.images);
  const filteredImages = useImageStore((state) => state.filteredImages);
  const a1111ServerUrl = useSettingsStore((state) => state.a1111ServerUrl);
  const comfyUIServerUrl = useSettingsStore((state) => state.comfyUIServerUrl);
  const comfyUIEnabled = useSettingsStore((state) => state.comfyUIEnabled);
  const { stopPolling } = useA1111ProgressContext();
  const { stopTracking } = useComfyUIProgressContext();

  // Shared, persisted height for the per-item preview / output image boxes so
  // portrait images can be dragged taller and stay that way across sessions.
  const [previewHeight, setPreviewHeight] = useState<number>(readStoredPreviewHeight);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PREVIEW_HEIGHT_STORAGE_KEY, String(previewHeight));
    }
  }, [previewHeight]);

  const handlePreviewResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = previewHeight;
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(
        PREVIEW_HEIGHT_MAX,
        Math.max(PREVIEW_HEIGHT_MIN, startHeight + (moveEvent.clientY - startY))
      );
      setPreviewHeight(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [previewHeight]);

  const [isRunningWorkflow, setIsRunningWorkflow] = useState(false);
  const [runFeedback, setRunFeedback] = useState<{ type: 'success' | 'error'; messageKey?: MessageKey; message?: string } | null>(null);

  useEffect(() => {
    if (!runFeedback) {
      return;
    }
    const timer = window.setTimeout(() => setRunFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [runFeedback]);

  const handleRunWorkflow = useCallback(async () => {
    if (isRunningWorkflow) {
      return;
    }
    setIsRunningWorkflow(true);
    setRunFeedback(null);
    try {
      const result = await window.electronAPI?.comfyUIViewRunWorkflow?.();
      if (result?.success) {
        setRunFeedback({ type: 'success', messageKey: 'generationQueue.queued' });
      } else {
        setRunFeedback({ type: 'error', message: result?.error, messageKey: 'generationQueue.runFailed' });
      }
    } catch (error) {
      setRunFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : undefined, messageKey: 'generationQueue.runFailed',
      });
    } finally {
      setIsRunningWorkflow(false);
    }
  }, [isRunningWorkflow]);

  const overallProgress = useMemo(() => {
    if (items.length === 0) return 0;
    const completed = items.reduce((acc, item) => {
      if (item.status === 'done' || item.status === 'failed' || item.status === 'canceled') {
        return acc + 1;
      }
      if (item.status === 'processing') {
        return acc + item.progress;
      }
      return acc;
    }, 0);
    return Math.min(1, completed / items.length);
  }, [items]);

  const statusCounts = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [items]);

  const findImage = (imageId: string) => {
    return images.find((img) => img.id === imageId) ||
      filteredImages.find((img) => img.id === imageId) ||
      null;
  };

  const handleRetry = async (item: GenerationQueueItem) => {
    if (!item.imageId) {
      alert(t('generationQueue.retryUnavailable'));
      return;
    }

    const image = findImage(item.imageId);
    if (!image) {
      alert(t('generationQueue.imageUnavailable'));
      return;
    }

    if (item.provider === 'a1111') {
      const payload = item.payload?.provider === 'a1111' ? item.payload : undefined;
      await generateWithA1111(image, payload?.customMetadata, payload?.numberOfImages);
      return;
    }

    const payload = item.payload?.provider === 'comfyui' ? item.payload : undefined;
    await generateWithComfyUI(image, {
      customMetadata: payload?.customMetadata,
      overrides: payload?.overrides,
      workflowMode: payload?.workflowMode,
      sourceImagePolicy: payload?.sourceImagePolicy,
      advancedPromptJson: payload?.advancedPromptJson,
      advancedWorkflowJson: payload?.advancedWorkflowJson,
      maskFile: payload?.maskFile,
    });
  };

  const handleCancel = async (item: GenerationQueueItem, event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();
    if (item.status !== 'processing' && item.status !== 'waiting') {
      return;
    }

    if (item.provider === 'comfyui' && item.origin === 'comfyui-external') {
      if (!comfyUIServerUrl || !item.providerJobId) {
        setJobStatus(item.id, 'failed', { error: t('generationQueue.cancelNoId'), previewImageUrl: null });
        return;
      }

      const client = new ComfyUIApiClient({ serverUrl: comfyUIServerUrl });
      try {
        const result = item.status === 'waiting'
          ? await client.deleteQueueItems([item.providerJobId])
          : await client.interrupt();

        if (!result.success) {
          setJobStatus(item.id, item.status, { error: result.error || t('generationQueue.cancelFailed') });
          return;
        }

        setJobStatus(item.id, 'canceled', { error: undefined, previewImageUrl: null });
      } catch (error) {
        setJobStatus(item.id, item.status, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (item.provider === 'comfyui' && item.status === 'waiting' && item.providerJobId && comfyUIServerUrl) {
      const client = new ComfyUIApiClient({ serverUrl: comfyUIServerUrl });
      try {
        const result = await client.deleteQueueItems([item.providerJobId]);
        if (!result.success) {
          setJobStatus(item.id, item.status, { error: result.error || t('generationQueue.cancelFailed') });
          return;
        }
      } catch (error) {
        setJobStatus(item.id, item.status, {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    if (item.status === 'waiting') {
      setJobStatus(item.id, 'canceled', { error: undefined, previewImageUrl: null });
      return;
    }

    if (activeJobs[item.provider] !== item.id) {
      setJobStatus(item.id, 'canceled', { error: undefined, previewImageUrl: null });
      return;
    }

    if (item.provider === 'a1111') {
      if (a1111ServerUrl) {
        try {
          const client = new A1111ApiClient({ serverUrl: a1111ServerUrl });
          await client.interrupt();
        } catch (error) {
          console.warn('[Queue] Failed to interrupt A1111 job:', error);
        }
      }
      if (activeJobs.a1111 === item.id) {
        stopPolling();
        setActiveJob('a1111', null);
      }
      setJobStatus(item.id, 'canceled', { error: undefined, previewImageUrl: null });
      return;
    }

    if (comfyUIServerUrl) {
      try {
        const client = new ComfyUIApiClient({ serverUrl: comfyUIServerUrl });
        await client.interrupt();
      } catch (error) {
        console.warn('[Queue] Failed to interrupt ComfyUI job:', error);
      }
    }

    if (activeJobs.comfyui === item.id) {
      stopTracking();
      setActiveJob('comfyui', null);
    }
    setJobStatus(item.id, 'canceled', { error: undefined, previewImageUrl: null });
  };

  const handleRemove = (item: GenerationQueueItem, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    removeJob(item.id);
  };

  const handleRetryClick = async (item: GenerationQueueItem, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    await handleRetry(item);
  };

  const handleCardKeyDown = (item: GenerationQueueItem, event: React.KeyboardEvent<HTMLDivElement>) => {
    const canOpenResult = item.status === 'done' && Boolean(item.generatedOutputs?.length);
    if (!canOpenResult || !onOpenGeneratedOutputs) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenGeneratedOutputs(item);
    }
  };

  return (
    <div
      data-area="queue"
      tabIndex={-1}
      style={{ width }}
      className={`fixed right-0 top-[var(--imh-header-height,61px)] bottom-0 bg-gray-800 border-l border-gray-700 z-40 flex flex-col ${isResizing ? 'transition-none' : 'transition-[width] duration-300 ease-in-out'}`}
    >
      <div
        role="separator"
        aria-label={t('generationQueue.resize')}
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
        className="absolute left-0 top-0 z-50 flex h-full w-3 -translate-x-1/2 cursor-col-resize items-center justify-center touch-none"
        title={t('generationQueue.resizeHelp')}
      >
        <div className={`h-16 w-1 rounded-full transition-colors duration-150 ${isResizing ? 'bg-blue-400/90 shadow-[0_0_16px_rgba(96,165,250,0.55)]' : 'bg-gray-500/70 hover:bg-blue-400/80'}`} />
      </div>
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div>
          <h2 className="text-lg font-semibold text-gray-200">{t('generationQueue.title')}</h2>
          <p className="text-xs text-gray-500">
            {t('generationQueue.counts', { count: items.length, processing: statusCounts.processing || 0, waiting: statusCounts.waiting || 0 })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {comfyUIEnabled && (
            <button
              onClick={handleRunWorkflow}
              disabled={isRunningWorkflow}
              title={t('generationQueue.runHelp')}
              aria-label={t('generationQueue.runHelp')}
              className="flex items-center gap-1.5 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 hover:text-gray-950 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="h-3.5 w-3.5" />
              {t('generationQueue.run')}
            </button>
          )}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-50 transition-colors"
            title={t('generationQueue.close')}
            aria-label={t('generationQueue.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      {runFeedback && (
        <div
          className={`px-4 py-2 text-xs border-b border-gray-700 ${
            runFeedback.type === 'success' ? 'text-green-300 bg-green-900/20' : 'text-red-300 bg-red-900/20'
          }`}
        >
          {runFeedback.message || (runFeedback.messageKey ? t(runFeedback.messageKey) : '')}
        </div>
      )}

      <div className="p-4 border-b border-gray-700 space-y-3">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{t('generationQueue.overall')}</span>
          <span>{Math.round(overallProgress * 100)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-gray-700/60 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${overallProgress * 100}%` }}
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <button
            onClick={() => clearByStatus(['done', 'failed', 'canceled'])}
            disabled={!hasFinishedItems}
            title={!hasFinishedItems ? t('generationQueue.noneFinished') : t('generationQueue.clearAllFinished')}
            className="px-2 py-1 rounded bg-gray-700/60 hover:bg-gray-700 text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('generationQueue.clearFinished')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {items.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-8">
            {t('generationQueue.empty')}
          </div>
        ) : (
          items.map((item) => {
            const canOpenResult = item.status === 'done' && Boolean(item.generatedOutputs?.length);
            const firstOutput = item.generatedOutputs?.[0];
            const displayCurrentImage = getDisplayCurrentImage(item);

            return (
            <div
              key={item.id}
              role={canOpenResult ? 'button' : undefined}
              tabIndex={canOpenResult ? 0 : undefined}
              onClick={canOpenResult && onOpenGeneratedOutputs ? () => onOpenGeneratedOutputs(item) : undefined}
              onKeyDown={(event) => handleCardKeyDown(item, event)}
              className={`bg-gray-900/60 border border-gray-700/60 rounded-lg p-3 space-y-2 transition-colors ${
                canOpenResult ? 'cursor-pointer hover:border-blue-400/60 hover:bg-gray-900/80' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${statusStyles[item.status]}`}>
                      {t(statusLabel[item.status])}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-500">
                      {item.provider === 'a1111' ? 'A1111' : item.origin === 'comfyui-external' ? t('generationQueue.external') : 'ComfyUI'}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-gray-200 break-all">{item.imageName}</p>
                  <p className="text-xs text-gray-500">{formatTime(item.createdAt, language)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {(item.status === 'processing' || item.status === 'waiting') && (
                    <button
                      onClick={(event) => handleCancel(item, event)}
                      className="text-gray-400 hover:text-red-300 transition-colors"
                      title={item.status === 'waiting' ? t('generationQueue.cancelQueued') : t('generationQueue.stop')}
                      aria-label={item.status === 'waiting' ? t('generationQueue.cancelQueued') : t('generationQueue.stop')}
                    >
                      {item.status === 'waiting' ? <CircleX size={16} /> : <CircleStop size={16} />}
                    </button>
                  )}
                  {(item.status === 'failed' || item.status === 'canceled') && item.origin !== 'comfyui-external' && (
                    <button
                      onClick={(event) => handleRetryClick(item, event)}
                      className="text-gray-400 hover:text-blue-300 transition-colors"
                      title={t('generationQueue.retry')}
                      aria-label={t('generationQueue.retryGeneration')}
                    >
                      <RefreshCw size={16} />
                    </button>
                  )}
                  <button
                    onClick={(event) => handleRemove(item, event)}
                    className="text-gray-400 hover:text-gray-200 transition-colors"
                    title={t('generationQueue.remove')}
                    aria-label={t('generationQueue.remove')}
                  >
                    <ArchiveX size={16} />
                  </button>
                </div>
              </div>

              {item.status === 'processing' && item.previewImageUrl ? (
                <div
                  className="group relative overflow-hidden rounded border border-gray-700/60 bg-black"
                  style={{ height: previewHeight }}
                >
                  <img
                    src={item.previewImageUrl}
                    alt={t('generationQueue.live')}
                    className="h-full w-full object-contain"
                  />
                  <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                    {t('generationQueue.live')}
                  </span>
                  <div
                    onPointerDown={handlePreviewResizeStart}
                    onClick={(event) => event.stopPropagation()}
                    className="absolute inset-x-0 bottom-0 flex h-3 cursor-ns-resize items-center justify-center bg-gradient-to-t from-black/70 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
                    title={t('generationQueue.resizePreview')}
                    role="separator"
                    aria-orientation="horizontal"
                  >
                    <span className="h-0.5 w-8 rounded-full bg-gray-300/80" />
                  </div>
                </div>
              ) : firstOutput?.url ? (
                <div
                  className="group relative overflow-hidden rounded border border-gray-700/60 bg-black"
                  style={{ height: previewHeight }}
                  onClick={canOpenResult ? (event) => event.stopPropagation() : undefined}
                  onDoubleClick={canOpenResult && onOpenGeneratedOutputImage
                    ? (event) => {
                        event.stopPropagation();
                        onOpenGeneratedOutputImage(item);
                      }
                    : undefined}
                  title={canOpenResult ? t('generationQueue.openImage') : undefined}
                >
                  <img
                    src={firstOutput.url}
                    alt={firstOutput.name || t('generationQueue.output')}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  {(item.generatedOutputs?.length || 0) > 1 && (
                    <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-semibold text-gray-100">
                      +{(item.generatedOutputs?.length || 1) - 1}
                    </span>
                  )}
                  <div
                    onPointerDown={handlePreviewResizeStart}
                    onClick={(event) => event.stopPropagation()}
                    className="absolute inset-x-0 bottom-0 flex h-3 cursor-ns-resize items-center justify-center bg-gradient-to-t from-black/70 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
                    title={t('generationQueue.resizePreview')}
                    role="separator"
                    aria-orientation="horizontal"
                  >
                    <span className="h-0.5 w-8 rounded-full bg-gray-300/80" />
                  </div>
                </div>
              ) : null}

              <p className="text-xs text-gray-400 break-words">
                {formatPromptPreview(item.prompt, t)}
              </p>

              {item.status === 'processing' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{Math.round(item.progress * 100)}%</span>
                    {displayCurrentImage && (
                      <span>
                        {t('generationQueue.imageProgress', { current: displayCurrentImage, total: item.totalImages })}
                      </span>
                    )}
                    {item.totalSteps ? (
                      <span>
                        {t('generationQueue.stepProgress', { current: item.currentStep || 0, total: item.totalSteps })}
                      </span>
                    ) : null}
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-700/60 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${item.progress * 100}%` }}
                    />
                  </div>
                  {item.currentNode && (
                    <div className="text-[11px] text-gray-500 truncate">
                      {t('generationQueue.currentNode', { node: item.currentNode })}
                    </div>
                  )}
                </div>
              )}

              {(item.status === 'done' || item.status === 'failed' || item.status === 'canceled') && (
                <div className="h-1 rounded-full bg-gray-700/40 overflow-hidden">
                  <div
                    className={`h-full ${
                      item.status === 'done' ? 'bg-green-500/80' : 'bg-red-500/70'
                    }`}
                    style={{ width: '100%' }}
                  />
                </div>
              )}

              {item.error && (
                <p className="text-xs text-red-300 break-words">{item.error}</p>
              )}
            </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default GenerationQueueSidebar;
