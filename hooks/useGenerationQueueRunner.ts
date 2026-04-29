import { useEffect, useRef } from 'react';
import { IndexedImage } from '../types';
import { useA1111ProgressContext } from '../contexts/A1111ProgressContext';
import { useComfyUIProgressContext } from '../contexts/ComfyUIProgressContext';
import { useGenerationQueueStore, GenerationProvider, GenerationQueueItem } from '../store/useGenerationQueueStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  executeA1111QueueJob,
  executeComfyUIQueueJob,
} from '../services/generationQueueExecutors';

type ImageLookup = {
  images: IndexedImage[];
  filteredImages: IndexedImage[];
};

const terminalStatuses = new Set(['done', 'failed', 'canceled']);

const findImage = ({ images, filteredImages }: ImageLookup, imageId: string) =>
  images.find((img) => img.id === imageId) ||
  filteredImages.find((img) => img.id === imageId) ||
  null;

export function useGenerationQueueRunner({ images, filteredImages }: ImageLookup) {
  const items = useGenerationQueueStore((state) => state.items);
  const activeJobs = useGenerationQueueStore((state) => state.activeJobs);
  const a1111ServerUrl = useSettingsStore((state) => state.a1111ServerUrl);
  const comfyUIServerUrl = useSettingsStore((state) => state.comfyUIServerUrl);
  const { startPolling, stopPolling } = useA1111ProgressContext();
  const { startTracking, stopTracking } = useComfyUIProgressContext();
  const runningJobsRef = useRef<Set<string>>(new Set());
  const runningProvidersRef = useRef<Set<GenerationProvider>>(new Set());

  useEffect(() => {
    const startProvider = (provider: GenerationProvider) => {
      const state = useGenerationQueueStore.getState();
      const activeJobId = state.activeJobs[provider];

      if (runningProvidersRef.current.has(provider)) {
        return;
      }

      if (!activeJobId) {
        const nextJobId = state.getNextWaitingJobId(provider);
        if (nextJobId) {
          state.setActiveJob(provider, nextJobId);
          state.setJobStatus(nextJobId, 'processing', { error: undefined });
        }
        return;
      }

      const activeItem = state.items.find((item) => item.id === activeJobId);
      if (!activeItem) {
        state.setActiveJob(provider, null);
        return;
      }

      if (terminalStatuses.has(activeItem.status)) {
        state.setActiveJob(provider, null);
        return;
      }

      if (activeItem.status !== 'processing' || runningJobsRef.current.has(activeItem.id)) {
        return;
      }

      void executeProviderJob(activeItem);
    };

    const executeProviderJob = async (job: GenerationQueueItem) => {
      runningJobsRef.current.add(job.id);
      runningProvidersRef.current.add(job.provider);
      const state = useGenerationQueueStore.getState();
      const image = findImage({ images, filteredImages }, job.imageId);

      if (!image) {
        state.setJobStatus(job.id, 'failed', { error: 'Source image no longer available.' });
        if (state.activeJobs[job.provider] === job.id) {
          state.setActiveJob(job.provider, null);
        }
        runningJobsRef.current.delete(job.id);
        runningProvidersRef.current.delete(job.provider);
        return;
      }

      try {
        const result = job.provider === 'a1111'
          ? await executeA1111QueueJob(job, {
              image,
              serverUrl: a1111ServerUrl,
              startPolling,
              stopPolling,
            })
          : await executeComfyUIQueueJob(job, {
              image,
              serverUrl: comfyUIServerUrl,
              startTracking,
              stopTracking,
              isCanceled: () => {
                const latest = useGenerationQueueStore.getState().items.find((item) => item.id === job.id);
                return latest?.status === 'canceled';
              },
            });

        const latest = useGenerationQueueStore.getState().items.find((item) => item.id === job.id);
        if (latest && latest.status !== 'canceled') {
          useGenerationQueueStore.getState().setJobStatus(job.id, 'done', {
            progress: 1,
            currentImage: job.totalImages,
            completedAt: Date.now(),
            generatedOutputs: result.generatedOutputs,
            providerJobId: result.providerJobId || latest.providerJobId,
            error: undefined,
          });
        }
      } catch (error) {
        const latest = useGenerationQueueStore.getState().items.find((item) => item.id === job.id);
        if (latest && latest.status !== 'canceled') {
          useGenerationQueueStore.getState().setJobStatus(job.id, 'failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        runningJobsRef.current.delete(job.id);
        runningProvidersRef.current.delete(job.provider);
        const latestState = useGenerationQueueStore.getState();
        const activeJobId = latestState.activeJobs[job.provider];
        if (activeJobId === job.id) {
          latestState.setActiveJob(job.provider, null);
        } else if (activeJobId) {
          latestState.updateJob(activeJobId, {});
        } else {
          latestState.setActiveJob(job.provider, null);
        }
      }
    };

    startProvider('a1111');
    startProvider('comfyui');
  }, [
    activeJobs,
    a1111ServerUrl,
    comfyUIServerUrl,
    filteredImages,
    images,
    items,
    startPolling,
    startTracking,
    stopPolling,
    stopTracking,
  ]);
}
