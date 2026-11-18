import { useTranslation, type MessageKey } from '../i18n/useTranslation';
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
  getRequestedImageCount,
  TEMPORARY_STATUS_TIMEOUT_MS,
} from '../utils/imageMetadata';

interface GenerateStatus {
  success: boolean;
  key: MessageKey;
  values?: Record<string, string>;
}

export interface GenerateParams {
  customMetadata?: Partial<BaseMetadata>;
  overrides?: WorkflowOverrides;
  directoryPath?: string;
  workflowMode?: ComfyUIWorkflowMode;
  sourceImagePolicy?: ComfyUISourceImagePolicy;
  advancedPromptJson?: string;
  advancedWorkflowJson?: string;
  maskFile?: File | null;
}

export function useGenerateWithComfyUI() {
  const { t } = useTranslation();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus | null>(null);

  const comfyUIServerUrl = useSettingsStore((state) => state.comfyUIServerUrl);
  const createJob = useGenerationQueueStore((state) => state.createJob);

  const generateWithComfyUI = useCallback(
    async (image: IndexedImage, params?: GenerateParams) => {
      setIsGenerating(true);
      const metadata = mergeNormalizedMetadata(image, params?.customMetadata);

      if (params?.workflowMode !== 'upscale' && !hasPromptMetadata(metadata)) {
        setIsGenerating(false);
        setGenerateStatus({
          success: false,
          key: 'imageViewer.status.noMetadata',
        });
        setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
        return;
      }

      if (!comfyUIServerUrl) {
        setIsGenerating(false);
        setGenerateStatus({
          success: false,
          key: 'imageViewer.status.serverMissing',
          values: { provider: 'ComfyUI' },
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
          directoryPath: params?.directoryPath,
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
          key: 'imageViewer.status.queuedWaiting',
          values: { provider: 'ComfyUI' },
        });
        setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
        return;
      }

      setIsGenerating(false);
      setGenerateStatus({
        success: true,
        key: 'imageViewer.details.queued',
      });
      setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
    },
    [comfyUIServerUrl, createJob]
  );

  return {
    generateWithComfyUI,
    isGenerating,
    generateStatus: generateStatus ? {
      success: generateStatus.success,
      message: t(generateStatus.key, generateStatus.values),
    } : null,
  };
}
