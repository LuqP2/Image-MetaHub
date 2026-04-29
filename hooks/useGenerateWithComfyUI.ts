/**
 * Generate with ComfyUI Hook
 * Sends workflow to ComfyUI and tracks generation progress
 */

import { useState, useCallback } from 'react';
import { IndexedImage, BaseMetadata } from '../types';
import { WorkflowOverrides } from '../services/comfyUIApiClient';
import { useSettingsStore } from '../store/useSettingsStore';
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
  const createJob = useGenerationQueueStore((state) => state.createJob);

  const generateWithComfyUI = useCallback(
    async (image: IndexedImage, params?: GenerateParams) => {
      setIsGenerating(true);
      const metadata = mergeNormalizedMetadata(image, params?.customMetadata);

      if (!hasPromptMetadata(metadata)) {
        setIsGenerating(false);
        setGenerateStatus({
          success: false,
          message: NO_METADATA_MESSAGE,
        });
        setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
        return;
      }

      if (!comfyUIServerUrl) {
        setIsGenerating(false);
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
        setIsGenerating(false);
        setGenerateStatus({
          success: true,
          message: 'Generation queued. Waiting for current ComfyUI job to finish.',
        });
        setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
        return;
      }

      setIsGenerating(false);
      setGenerateStatus({
        success: true,
        message: 'Generation queued.',
      });
      setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
    },
    [comfyUIServerUrl, createJob]
  );

  return {
    generateWithComfyUI,
    isGenerating,
    generateStatus,
  };
}
