/**
 * Copy to ComfyUI Hook
 * Copies workflow JSON to clipboard for manual import into ComfyUI
 */

import { useState, useCallback } from 'react';
import { IndexedImage } from '../types';
import { formatMetadataForComfyUI } from '../utils/comfyUIFormatter';

interface CopyStatus {
  success: boolean;
  message: string;
}

export function useCopyToComfyUI() {
  const [isCopying, setIsCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);

  const copyToComfyUI = useCallback(async (image: IndexedImage) => {
    const metadata = image.metadata?.normalizedMetadata;

    if (!metadata || !metadata.prompt) {
      setCopyStatus({
        success: false,
        message: 'No metadata available for this image',
      });
      setTimeout(() => setCopyStatus(null), 5000);
      return;
    }

    setIsCopying(true);
    setCopyStatus(null);

    try {
      // Format metadata to ComfyUI workflow JSON
      const workflowJSON = formatMetadataForComfyUI(metadata);

      // Copy to clipboard
      await navigator.clipboard.writeText(workflowJSON);

      setCopyStatus({
        success: true,
        message: 'Workflow JSON copied! Use "Load" in ComfyUI to import.',
      });

      // Clear status after 5 seconds
      setTimeout(() => setCopyStatus(null), 5000);
    } catch (error: any) {
      // Handle clipboard API errors (e.g., HTTP context, permissions)
      const errorMessage = error.message?.includes('clipboard')
        ? 'Clipboard access denied. Please use HTTPS or localhost.'
        : `Error: ${error.message}`;

      setCopyStatus({
        success: false,
        message: errorMessage,
      });

      setTimeout(() => setCopyStatus(null), 5000);
    } finally {
      setIsCopying(false);
    }
  }, []);

  return {
    copyToComfyUI,
    isCopying,
    copyStatus,
  };
}
