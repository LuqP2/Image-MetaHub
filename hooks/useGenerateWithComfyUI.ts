/**
 * Generate with ComfyUI Hook
 * Sends workflow to ComfyUI and tracks generation progress
 */

import { useState, useCallback } from 'react';
import { IndexedImage, BaseMetadata } from '../types';
import { ComfyUIApiClient, WorkflowOverrides } from '../services/comfyUIApiClient';
import { useSettingsStore } from '../store/useSettingsStore';
import { useComfyUIProgressContext } from '../contexts/ComfyUIProgressContext';

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

      setIsGenerating(true);
      setGenerateStatus(null);

      try {
        const client = new ComfyUIApiClient({ serverUrl: comfyUIServerUrl });

        // Build workflow from metadata with overrides (model, loras)
        const workflow = client.buildWorkflowFromMetadata(metadata, params?.overrides);

        // Queue prompt
        const result = await client.queuePrompt(workflow);

        if (result.success && result.prompt_id) {
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
        }

        // Clear status after 5 seconds
        setTimeout(() => setGenerateStatus(null), 5000);
      } catch (error: any) {
        setGenerateStatus({
          success: false,
          message: `Error: ${error.message}`,
        });

        // Stop progress tracking on error
        stopTracking();

        setTimeout(() => setGenerateStatus(null), 5000);
      } finally {
        setIsGenerating(false);
      }
    },
    [comfyUIServerUrl, startTracking, stopTracking]
  );

  return {
    generateWithComfyUI,
    isGenerating,
    generateStatus,
  };
}
