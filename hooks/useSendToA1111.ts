import { useState, useCallback } from 'react';
import { IndexedImage } from '../types';
import { A1111ApiClient } from '../services/a1111ApiClient';
import { useSettingsStore } from '../store/useSettingsStore';

interface SendStatus {
  success: boolean;
  message: string;
}

export function useSendToA1111() {
  const [isSending, setIsSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<SendStatus | null>(null);

  const a1111ServerUrl = useSettingsStore((state) => state.a1111ServerUrl);
  const a1111AutoStart = useSettingsStore((state) => state.a1111AutoStart);

  const sendToA1111 = useCallback(
    async (image: IndexedImage) => {
      const metadata = image.metadata?.normalizedMetadata;

      if (!metadata || !metadata.prompt) {
        setSendStatus({
          success: false,
          message: 'No metadata available for this image',
        });
        return;
      }

      if (!a1111ServerUrl) {
        setSendStatus({
          success: false,
          message: 'A1111 server URL not configured. Please check Settings.',
        });
        return;
      }

      setIsSending(true);
      setSendStatus(null);

      try {
        const client = new A1111ApiClient({ serverUrl: a1111ServerUrl });

        const result = await client.sendToTxt2Img(metadata, {
          autoStart: a1111AutoStart,
        });

        setSendStatus({
          success: result.success,
          message: result.message || result.error || 'Unknown error',
        });

        // Clear status after 5 seconds
        setTimeout(() => setSendStatus(null), 5000);
      } catch (error: any) {
        setSendStatus({
          success: false,
          message: `Error: ${error.message}`,
        });

        setTimeout(() => setSendStatus(null), 5000);
      } finally {
        setIsSending(false);
      }
    },
    [a1111ServerUrl, a1111AutoStart]
  );

  return {
    sendToA1111,
    isSending,
    sendStatus,
  };
}
