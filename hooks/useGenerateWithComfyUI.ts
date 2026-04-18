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
import { ComfyUISourceImagePolicy, ComfyUIWorkflowMode } from '../services/comfyUIWorkflowBuilder';
import {
  hasPromptMetadata,
  mergeNormalizedMetadata,
  NO_METADATA_MESSAGE,
  getRequestedImageCount,
  TEMPORARY_STATUS_TIMEOUT_MS,
} from '../utils/imageMetadata';

interface GenerateStatus {
  success: boolean;
  message: string;
}

export interface GenerateParams {
  customMetadata?: Partial<BaseMetadata>;
  overrides?: WorkflowOverrides;
  workflowMode?: ComfyUIWorkflowMode;
  sourceImagePolicy?: ComfyUISourceImagePolicy;
  advancedPromptJson?: string;
  advancedWorkflowJson?: string;
  maskFile?: File | null;
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
      const metadata = mergeNormalizedMetadata(image, params?.customMetadata);

      if (!hasPromptMetadata(metadata)) {
        setGenerateStatus({
          success: false,
          message: NO_METADATA_MESSAGE,
        });
        setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
        return;
      }

      if (!comfyUIServerUrl) {
        setGenerateStatus({
          success: false,
          message: 'ComfyUI server URL not configured. Please check Settings.',
        });
        setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
        return;
      }

      const numberOfImages = getRequestedImageCount(params?.customMetadata);

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
          workflowMode: params?.workflowMode,
          sourceImagePolicy: params?.sourceImagePolicy,
          advancedPromptJson: params?.advancedPromptJson,
          advancedWorkflowJson: params?.advancedWorkflowJson,
          maskFile: params?.maskFile || null,
        },
      });
      const { activeJobs } = useGenerationQueueStore.getState();
      if (activeJobs.comfyui && activeJobs.comfyui !== jobId) {
        setGenerateStatus({
          success: true,
          message: 'Generation queued. Waiting for current ComfyUI job to finish.',
        });
        setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
        return;
      }
      setActiveJob('comfyui', jobId);
      setJobStatus(jobId, 'processing');

      setIsGenerating(true);
      setGenerateStatus(null);

      try {
        const client = new ComfyUIApiClient({ serverUrl: comfyUIServerUrl });

        const prepared = await client.prepareWorkflow({
          image,
          metadata,
          overrides: params?.overrides,
          workflowMode: params?.workflowMode,
          sourceImagePolicy: params?.sourceImagePolicy,
          advancedPromptJson: params?.advancedPromptJson,
          advancedWorkflowJson: params?.advancedWorkflowJson,
          maskFile: params?.maskFile || null,
        });
        const workflow = prepared.workflow;

        // Queue prompt
        const result = await client.queuePrompt(workflow);

        if (result.success && result.prompt_id) {
          updateQueueJob(jobId, result.prompt_id);
          // Start WebSocket progress tracking with matching client id
          startTracking(comfyUIServerUrl, result.prompt_id, workflow.client_id);

          setGenerateStatus({
            success: true,
            message: prepared.warnings.length > 0
              ? `Workflow queued in ${prepared.modeUsed} mode. ${prepared.warnings[0]}`
              : `Workflow queued in ${prepared.modeUsed} mode.`,
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
        setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setGenerateStatus({
          success: false,
          message: `Error: ${errorMessage}`,
        });

        setJobStatus(jobId, 'failed', { error: errorMessage });
        const { activeJobs } = useGenerationQueueStore.getState();
        if (activeJobs.comfyui === jobId) {
          setActiveJob('comfyui', null);
        }

        // Stop progress tracking on error
        stopTracking();

        setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
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
