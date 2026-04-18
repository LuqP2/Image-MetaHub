/**
 * Copy to ComfyUI Hook
 * Copies workflow JSON to clipboard for manual import into ComfyUI
 */

import { useState, useCallback } from 'react';
import { IndexedImage } from '../types';
import { formatImageForComfyUI } from '../utils/comfyUIFormatter';
import {
  getClipboardErrorMessage,
  getNormalizedMetadata,
  hasPromptMetadata,
  NO_METADATA_MESSAGE,
  TEMPORARY_STATUS_TIMEOUT_MS,
} from '../utils/imageMetadata';

interface CopyStatus {
  success: boolean;
  message: string;
}

export function useCopyToComfyUI() {
  const [isCopying, setIsCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);

  const copyToComfyUI = useCallback(async (image: IndexedImage) => {
    const metadata = getNormalizedMetadata(image);
    if (!hasPromptMetadata(metadata)) {
      setCopyStatus({
        success: false,
        message: NO_METADATA_MESSAGE,
      });
      setTimeout(() => setCopyStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
      return;
    }

    setIsCopying(true);
    setCopyStatus(null);

    try {
      const workflowJSON = formatImageForComfyUI(image);

      // Copy to clipboard
      await navigator.clipboard.writeText(workflowJSON);

      setCopyStatus({
        success: true,
        message: 'Workflow JSON copied! Use "Load" in ComfyUI to import.',
      });

      // Clear status after 5 seconds
      setTimeout(() => setCopyStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
    } catch (error: unknown) {
      const errorMessage = getClipboardErrorMessage(error);

      setCopyStatus({
        success: false,
        message: errorMessage,
      });

      setTimeout(() => setCopyStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
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
