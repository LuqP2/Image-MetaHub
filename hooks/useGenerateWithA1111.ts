import { useState, useCallback } from 'react';
import { IndexedImage, BaseMetadata } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGenerationQueueStore } from '../store/useGenerationQueueStore';
import {
  hasPromptMetadata,
  mergeNormalizedMetadata,
  NO_METADATA_MESSAGE,
  TEMPORARY_STATUS_TIMEOUT_MS,
} from '../utils/imageMetadata';

interface GenerateStatus {
  success: boolean;
  message: string;
}

export function useGenerateWithA1111() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus | null>(null);

  const a1111ServerUrl = useSettingsStore((state) => state.a1111ServerUrl);
  const createJob = useGenerationQueueStore((state) => state.createJob);

  const generateWithA1111 = useCallback(
    async (image: IndexedImage, customParams?: Partial<BaseMetadata>, numberOfImages?: number) => {
      setIsGenerating(true);
      const metadata = mergeNormalizedMetadata(image, customParams);

      if (!hasPromptMetadata(metadata)) {
        setIsGenerating(false);
        setGenerateStatus({
          success: false,
          message: NO_METADATA_MESSAGE,
        });
        setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
        return;
      }

      if (!a1111ServerUrl) {
        setIsGenerating(false);
        setGenerateStatus({
          success: false,
          message: 'A1111 server URL not configured. Please check Settings.',
        });
        setTimeout(() => setGenerateStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
        return;
      }

      const jobId = createJob({
        provider: 'a1111',
        imageId: image.id,
        imageName: image.name,
        prompt: metadata.prompt,
        totalImages: numberOfImages || 1,
        payload: {
          provider: 'a1111',
          customMetadata: customParams,
          numberOfImages: numberOfImages || 1,
        },
      });
      const { activeJobs } = useGenerationQueueStore.getState();
      if (activeJobs.a1111 && activeJobs.a1111 !== jobId) {
        setIsGenerating(false);
        setGenerateStatus({
          success: true,
          message: 'Generation queued. Waiting for current A1111 job to finish.',
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
    [a1111ServerUrl, createJob]
  );

  return {
    generateWithA1111,
    isGenerating,
    generateStatus,
  };
}
