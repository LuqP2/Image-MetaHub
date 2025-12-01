import { useState, useCallback } from 'react';
import { IndexedImage } from '../types';
import { A1111ApiClient } from '../services/a1111ApiClient';
import { useSettingsStore } from '../store/useSettingsStore';

interface GenerateStatus {
  success: boolean;
  message: string;
}

export function useGenerateWithA1111() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus | null>(null);

  const a1111ServerUrl = useSettingsStore((state) => state.a1111ServerUrl);

  const generateWithA1111 = useCallback(
    async (image: IndexedImage) => {
      const metadata = image.metadata?.normalizedMetadata;

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

        // ALWAYS start generation (autoStart: true)
        const result = await client.sendToTxt2Img(metadata, {
          autoStart: true,
        });

        setGenerateStatus({
          success: result.success,
          message: result.success
            ? 'Generated successfully!'
            : (result.error || 'Generation failed'),
        });

        // Clear status after 5 seconds
        setTimeout(() => setGenerateStatus(null), 5000);
      } catch (error: any) {
        setGenerateStatus({
          success: false,
          message: `Error: ${error.message}`,
        });

        setTimeout(() => setGenerateStatus(null), 5000);
      } finally {
        setIsGenerating(false);
      }
    },
    [a1111ServerUrl]
  );

  return {
    generateWithA1111,
    isGenerating,
    generateStatus,
  };
}
