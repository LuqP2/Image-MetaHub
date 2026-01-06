import React, { useMemo } from 'react';
import { X, RefreshCw, Ban, Trash2 } from 'lucide-react';
import { useGenerationQueueStore, GenerationQueueItem } from '../store/useGenerationQueueStore';
import { useGenerateWithA1111 } from '../hooks/useGenerateWithA1111';
import { useGenerateWithComfyUI } from '../hooks/useGenerateWithComfyUI';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { A1111ApiClient } from '../services/a1111ApiClient';
import { ComfyUIApiClient } from '../services/comfyUIApiClient';
import { useA1111ProgressContext } from '../contexts/A1111ProgressContext';
import { useComfyUIProgressContext } from '../contexts/ComfyUIProgressContext';

interface GenerationQueueSidebarProps {
  onClose: () => void;
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

const GenerationQueueSidebar: React.FC<GenerationQueueSidebarProps> = ({ onClose }) => {
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
    });
  };

  const handleCancel = async (item: GenerationQueueItem) => {
    if (item.status !== 'processing' && item.status !== 'waiting') {
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
      setJobStatus(item.id, 'canceled');
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
    setJobStatus(item.id, 'canceled');
  };

  return (
    <div data-area="queue" tabIndex={-1} className="fixed right-0 top-0 h-full w-96 bg-gray-800 border-l border-gray-700 z-40 flex flex-col">
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
          <button
            onClick={() => clearByStatus(['waiting', 'processing', 'done', 'failed', 'canceled'])}
            className="px-2 py-1 rounded bg-gray-700/60 hover:bg-gray-700 text-gray-200 transition-colors"
          >
            Clear all
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {items.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-8">
            No generations queued yet.
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="bg-gray-900/60 border border-gray-700/60 rounded-lg p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
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
                      onClick={() => handleCancel(item)}
                      className="text-gray-400 hover:text-red-300 transition-colors"
                      title="Cancel"
                    >
                      <Ban size={16} />
                    </button>
                  )}
                  {(item.status === 'failed' || item.status === 'canceled') && (
                    <button
                      onClick={() => handleRetry(item)}
                      className="text-gray-400 hover:text-blue-300 transition-colors"
                      title="Retry"
                    >
                      <RefreshCw size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => removeJob(item.id)}
                    className="text-gray-400 hover:text-gray-200 transition-colors"
                    title="Remove"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <p className="text-xs text-gray-400 break-words">
                {formatPromptPreview(item.prompt)}
              </p>

              {item.status === 'processing' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{Math.round(item.progress * 100)}%</span>
                    {item.totalImages && item.totalImages > 1 && (
                      <span>
                        Image {item.currentImage || 1}/{item.totalImages}
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
          ))
        )}
      </div>
    </div>
  );
};

export default GenerationQueueSidebar;
