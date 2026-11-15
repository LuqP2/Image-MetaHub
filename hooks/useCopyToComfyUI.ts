/**
 * Copy to ComfyUI Hook
 * Copies workflow JSON to clipboard for manual import into ComfyUI
 */

import { useState, useCallback } from 'react';
import type { IndexedImage } from '../types';
import { getOriginalComfyUIWorkflowJson } from '../services/comfyUIWorkflowHydration';
import { copyTextToClipboard } from '../utils/imageUtils';
import {
  getClipboardErrorMessage,
  TEMPORARY_STATUS_TIMEOUT_MS,
} from '../utils/imageMetadata';

interface CopyStatus {
  success: boolean;
  message: string;
}

export function useCopyToComfyUI() {
  const [isCopying, setIsCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);

  const copyToComfyUI = useCallback(async (image: IndexedImage, directoryPath?: string) => {
    setIsCopying(true);
    setCopyStatus(null);

    try {
      const workflowJSON = await getOriginalComfyUIWorkflowJson(image, directoryPath);

      // Copy to clipboard
      const result = await copyTextToClipboard(workflowJSON);
      if (!result.success) {
        throw new Error(result.error || 'Unknown error occurred');
      }

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
