import { useState, useCallback } from 'react';
import { IndexedImage, BaseMetadata } from '../types';
import { A1111ApiClient } from '../services/a1111ApiClient';
import { useSettingsStore } from '../store/useSettingsStore';
import { useA1111ProgressContext } from '../contexts/A1111ProgressContext';

interface GenerateStatus {
  success: boolean;
  message: string;
}

export function useGenerateWithA1111() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus | null>(null);

  const a1111ServerUrl = useSettingsStore((state) => state.a1111ServerUrl);
  const { startPolling, stopPolling } = useA1111ProgressContext();

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

        // Stop progress polling
        stopPolling();

        // Clear status after 5 seconds
        setTimeout(() => setGenerateStatus(null), 5000);
      } catch (error: any) {
        setGenerateStatus({
          success: false,
          message: `Error: ${error.message}`,
        });

        // Stop progress polling on error
        stopPolling();

        setTimeout(() => setGenerateStatus(null), 5000);
      } finally {
        setIsGenerating(false);
      }
    },
    [a1111ServerUrl, startPolling, stopPolling]
  );

  return {
    generateWithA1111,
    isGenerating,
    generateStatus,
  };
}
