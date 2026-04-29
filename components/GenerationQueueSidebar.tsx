import React, { useMemo } from 'react';
import { X, RefreshCw, CircleX, CircleStop, ArchiveX } from 'lucide-react';
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
}

const statusStyles: Record<string, string> = {
  waiting: 'text-yellow-300',
  processing: 'text-blue-300',
  done: 'text-green-300',
  failed: 'text-red-300',
  canceled: 'text-gray-400',
};

const statusLabel: Record<string, string> = {
  waiting: 'Waiting',
  processing: 'Processing',
  done: 'Done',
  failed: 'Failed',
  canceled: 'Canceled',
};

const formatPromptPreview = (prompt?: string) => {
  if (!prompt) return 'No prompt';
  const trimmed = prompt.trim();
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 120)}...`;
};

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const GenerationQueueSidebar: React.FC<GenerationQueueSidebarProps> = ({
  onClose,
  width,
  isResizing,
  onResizeStart,
  onOpenGeneratedOutputs,
}) => {
  const items = useGenerationQueueStore((state) => state.items);
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
  const { stopPolling } = useA1111ProgressContext();
  const { stopTracking } = useComfyUIProgressContext();

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
    const image = findImage(item.imageId);
    if (!image) {
      alert('Image no longer available for retry.');
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

    if (item.status === 'waiting') {
      setJobStatus(item.id, 'canceled', { error: undefined });
      return;
    }

    if (activeJobs[item.provider] !== item.id) {
      setJobStatus(item.id, 'canceled', { error: undefined });
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
      setJobStatus(item.id, 'canceled', { error: undefined });
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
    setJobStatus(item.id, 'canceled', { error: undefined });
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
      className={`fixed right-0 top-0 h-full bg-gray-800 border-l border-gray-700 z-40 flex flex-col ${isResizing ? 'transition-none' : 'transition-[width] duration-300 ease-in-out'}`}
    >
      <div
        role="separator"
        aria-label="Resize queue sidebar"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
        className="absolute left-0 top-0 z-50 flex h-full w-3 -translate-x-1/2 cursor-col-resize items-center justify-center touch-none"
        title="Drag to resize queue sidebar"
      >
        <div className={`h-16 w-1 rounded-full transition-colors duration-150 ${isResizing ? 'bg-blue-400/90 shadow-[0_0_16px_rgba(96,165,250,0.55)]' : 'bg-gray-500/70 hover:bg-blue-400/80'}`} />
      </div>
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div>
          <h2 className="text-lg font-semibold text-gray-200">Queue</h2>
          <p className="text-xs text-gray-500">
            {items.length} items · {statusCounts.processing || 0} processing · {statusCounts.waiting || 0} waiting
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-50 transition-colors"
          title="Close queue"
          aria-label="Close queue"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 border-b border-gray-700 space-y-3">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>Overall progress</span>
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
            className="px-2 py-1 rounded bg-gray-700/60 hover:bg-gray-700 text-gray-200 transition-colors"
          >
            Clear finished
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {items.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-8">
            No generations queued yet.
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
                      {statusLabel[item.status]}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-500">
                      {item.provider === 'a1111' ? 'A1111' : 'ComfyUI'}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-gray-200 break-all">{item.imageName}</p>
                  <p className="text-xs text-gray-500">{formatTime(item.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {(item.status === 'processing' || item.status === 'waiting') && (
                    <button
                      onClick={(event) => handleCancel(item, event)}
                      className="text-gray-400 hover:text-red-300 transition-colors"
                      title={item.status === 'waiting' ? 'Cancel queued job' : 'Stop generation'}
                      aria-label={item.status === 'waiting' ? 'Cancel queued job' : 'Stop generation'}
                    >
                      {item.status === 'waiting' ? <CircleX size={16} /> : <CircleStop size={16} />}
                    </button>
                  )}
                  {(item.status === 'failed' || item.status === 'canceled') && (
                    <button
                      onClick={(event) => handleRetryClick(item, event)}
                      className="text-gray-400 hover:text-blue-300 transition-colors"
                      title="Retry"
                      aria-label="Retry generation"
                    >
                      <RefreshCw size={16} />
                    </button>
                  )}
                  <button
                    onClick={(event) => handleRemove(item, event)}
                    className="text-gray-400 hover:text-gray-200 transition-colors"
                    title="Remove from queue"
                    aria-label="Remove from queue"
                  >
                    <ArchiveX size={16} />
                  </button>
                </div>
              </div>

              {firstOutput?.url && (
                <div className="relative overflow-hidden rounded border border-gray-700/60 bg-black">
                  <img
                    src={firstOutput.url}
                    alt={firstOutput.name || 'Generated output'}
                    className="h-24 w-full object-cover"
                    loading="lazy"
                  />
                  {(item.generatedOutputs?.length || 0) > 1 && (
                    <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-semibold text-gray-100">
                      +{(item.generatedOutputs?.length || 1) - 1}
                    </span>
                  )}
                </div>
              )}

              <p className="text-xs text-gray-400 break-words">
                {formatPromptPreview(item.prompt)}
              </p>

              {item.status === 'processing' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{Math.round(item.progress * 100)}%</span>
                    {displayCurrentImage && (
                      <span>
                        Image {displayCurrentImage}/{item.totalImages}
                      </span>
                    )}
                    {item.totalSteps ? (
                      <span>
                        Step {item.currentStep || 0}/{item.totalSteps}
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
                      {item.currentNode}
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
