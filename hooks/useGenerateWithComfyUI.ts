/**
 * Generate with ComfyUI Hook
 * Sends workflow to ComfyUI and tracks generation progress
 */

import { useState, useCallback } from 'react';
import { IndexedImage, BaseMetadata } from '../types';
import { ComfyUIApiClient, WorkflowOverrides } from '../services/comfyUIApiClient';
import { useSettingsStore } from '../store/useSettingsStore';
import { useComfyUIProgressContext } from '../contexts/ComfyUIProgressContext';
import { useGenerationQueueStore } from '../store/useGenerationQueueStore';

interface GenerateStatus {
  success: boolean;
  message: string;
}

export interface GenerateParams {
  customMetadata?: Partial<BaseMetadata>;
  overrides?: WorkflowOverrides;
}

export function useGenerateWithComfyUI() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus | null>(null);

  const comfyUIServerUrl = useSettingsStore((state) => state.comfyUIServerUrl);
  const { startTracking, stopTracking } = useComfyUIProgressContext();
  const createJob = useGenerationQueueStore((state) => state.createJob);
  const setJobStatus = useGenerationQueueStore((state) => state.setJobStatus);
  const setActiveJob = useGenerationQueueStore((state) => state.setActiveJob);

  const updateQueueJob = useCallback((jobId: string, promptId: string) => {
    useGenerationQueueStore.getState().updateJob(jobId, { providerJobId: promptId });
  }, []);

  const generateWithComfyUI = useCallback(
    async (image: IndexedImage, params?: GenerateParams) => {
      // Merge custom params with original metadata if provided
      const metadata = params?.customMetadata
        ? { ...image.metadata?.normalizedMetadata, ...params.customMetadata }
        : image.metadata?.normalizedMetadata;

      if (!metadata || !metadata.prompt) {
        setGenerateStatus({
          success: false,
          message: 'No metadata available for this image',
        });
        setTimeout(() => setGenerateStatus(null), 5000);
        return;
      }

      if (!comfyUIServerUrl) {
        setGenerateStatus({
          success: false,
          message: 'ComfyUI server URL not configured. Please check Settings.',
        });
        setTimeout(() => setGenerateStatus(null), 5000);
        return;
      }

      const numberOfImages =
        (params?.customMetadata as any)?.batch_size ||
        (params?.customMetadata as any)?.numberOfImages ||
        1;

      const jobId = createJob({
        provider: 'comfyui',
        imageId: image.id,
        imageName: image.name,
        prompt: metadata.prompt,
        totalImages: numberOfImages,
        payload: {
          provider: 'comfyui',
          customMetadata: params?.customMetadata,
          overrides: params?.overrides,
        },
      });
      const { activeJobs } = useGenerationQueueStore.getState();
      if (activeJobs.comfyui && activeJobs.comfyui !== jobId) {
        setJobStatus(activeJobs.comfyui, 'done', { progress: 1 });
      }
      setActiveJob('comfyui', jobId);
      setJobStatus(jobId, 'processing');

      setIsGenerating(true);
      setGenerateStatus(null);

      try {
        const client = new ComfyUIApiClient({ serverUrl: comfyUIServerUrl });

        // Build workflow from metadata with overrides (model, loras)
        const workflow = client.buildWorkflowFromMetadata(metadata, params?.overrides);

        // Queue prompt
        const result = await client.queuePrompt(workflow);

        if (result.success && result.prompt_id) {
          updateQueueJob(jobId, result.prompt_id);
          // Start WebSocket progress tracking
          startTracking(comfyUIServerUrl, result.prompt_id);

          setGenerateStatus({
            success: true,
            message: 'Workflow queued! Check ComfyUI for results.',
          });
        } else {
          setGenerateStatus({
            success: false,
            message: result.error || 'Failed to queue workflow',
          });
          setJobStatus(jobId, 'failed', { error: result.error || 'Failed to queue workflow' });
          const { activeJobs } = useGenerationQueueStore.getState();
          if (activeJobs.comfyui === jobId) {
            setActiveJob('comfyui', null);
          }
        }

        // Clear status after 5 seconds
        setTimeout(() => setGenerateStatus(null), 5000);
      } catch (error: any) {
        setGenerateStatus({
          success: false,
          message: `Error: ${error.message}`,
        });

        setJobStatus(jobId, 'failed', { error: error.message });
        const { activeJobs } = useGenerationQueueStore.getState();
        if (activeJobs.comfyui === jobId) {
          setActiveJob('comfyui', null);
        }

        // Stop progress tracking on error
        stopTracking();

        setTimeout(() => setGenerateStatus(null), 5000);
      } finally {
        setIsGenerating(false);
      }
    },
    [comfyUIServerUrl, createJob, setActiveJob, setJobStatus, startTracking, stopTracking, updateQueueJob]
  );

  return {
    generateWithComfyUI,
    isGenerating,
    generateStatus,
  };
}
