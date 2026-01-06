import { useState, useCallback } from 'react';
import { IndexedImage, BaseMetadata } from '../types';
import { A1111ApiClient } from '../services/a1111ApiClient';
import { useSettingsStore } from '../store/useSettingsStore';
import { useA1111ProgressContext } from '../contexts/A1111ProgressContext';
import { useGenerationQueueStore } from '../store/useGenerationQueueStore';

interface GenerateStatus {
  success: boolean;
  message: string;
}

export function useGenerateWithA1111() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus | null>(null);

  const a1111ServerUrl = useSettingsStore((state) => state.a1111ServerUrl);
  const { startPolling, stopPolling } = useA1111ProgressContext();
  const createJob = useGenerationQueueStore((state) => state.createJob);
  const setJobStatus = useGenerationQueueStore((state) => state.setJobStatus);
  const setActiveJob = useGenerationQueueStore((state) => state.setActiveJob);

  const generateWithA1111 = useCallback(
    async (image: IndexedImage, customParams?: Partial<BaseMetadata>, numberOfImages?: number) => {
      // Merge custom params with original metadata if provided
      const metadata = customParams
        ? { ...image.metadata?.normalizedMetadata, ...customParams }
        : image.metadata?.normalizedMetadata;

      if (!metadata || !metadata.prompt) {
        setGenerateStatus({
          success: false,
          message: 'No metadata available for this image',
        });
        setTimeout(() => setGenerateStatus(null), 5000);
        return;
      }

      if (!a1111ServerUrl) {
        setGenerateStatus({
          success: false,
          message: 'A1111 server URL not configured. Please check Settings.',
        });
        setTimeout(() => setGenerateStatus(null), 5000);
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
        setJobStatus(activeJobs.a1111, 'done', { progress: 1 });
      }
      setActiveJob('a1111', jobId);
      setJobStatus(jobId, 'processing');

      setIsGenerating(true);
      setGenerateStatus(null);

      try {
        const client = new A1111ApiClient({ serverUrl: a1111ServerUrl });

        // Start progress polling
        startPolling(a1111ServerUrl, numberOfImages || 1);

        // ALWAYS start generation (autoStart: true)
        const result = await client.sendToTxt2Img(metadata, {
          autoStart: true,
          numberOfImages: numberOfImages || 1,
        });

        setGenerateStatus({
          success: result.success,
          message: result.success
            ? 'Generated successfully!'
            : (result.error || 'Generation failed'),
        });

        if (!result.success) {
          setJobStatus(jobId, 'failed', { error: result.error || 'Generation failed' });
          const { activeJobs } = useGenerationQueueStore.getState();
          if (activeJobs.a1111 === jobId) {
            setActiveJob('a1111', null);
          }
        }

        // Stop progress polling
        stopPolling();

        // Clear status after 5 seconds
        setTimeout(() => setGenerateStatus(null), 5000);
      } catch (error: any) {
        setGenerateStatus({
          success: false,
          message: `Error: ${error.message}`,
        });

        setJobStatus(jobId, 'failed', { error: error.message });
        const { activeJobs } = useGenerationQueueStore.getState();
        if (activeJobs.a1111 === jobId) {
          setActiveJob('a1111', null);
        }

        // Stop progress polling on error
        stopPolling();

        setTimeout(() => setGenerateStatus(null), 5000);
      } finally {
        setIsGenerating(false);
      }
    },
    [a1111ServerUrl, createJob, setActiveJob, setJobStatus, startPolling, stopPolling]
  );

  return {
    generateWithA1111,
    isGenerating,
    generateStatus,
  };
}
