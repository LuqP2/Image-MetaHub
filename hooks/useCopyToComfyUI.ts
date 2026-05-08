/**
 * Copy to ComfyUI Hook
 * Copies workflow JSON to clipboard for manual import into ComfyUI
 */

import { useState, useCallback } from 'react';
import { BaseMetadata, IndexedImage } from '../types';
import { formatImageForComfyUI, formatMetadataForComfyUI } from '../utils/comfyUIFormatter';
import { hydrateImageForEmbeddedComfyWorkflow } from '../services/comfyUIWorkflowHydration';
import {
  getClipboardErrorMessage,
  getNormalizedMetadata,
  hasPromptMetadata,
  NO_METADATA_MESSAGE,
  TEMPORARY_STATUS_TIMEOUT_MS,
} from '../utils/imageMetadata';
import { useImageStore } from '../store/useImageStore';

interface CopyStatus {
  success: boolean;
  message: string;
}

export function useCopyToComfyUI() {
  const [isCopying, setIsCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);
  const directories = useImageStore((state) => state.directories);

  const copyToComfyUI = useCallback(async (image: IndexedImage, metadataOverride?: BaseMetadata) => {
    const metadata = metadataOverride ?? getNormalizedMetadata(image);
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
      const directoryPath = directories.find((directory) => directory.id === image.directoryId)?.path;
      const sourceImage = metadataOverride
        ? image
        : await hydrateImageForEmbeddedComfyWorkflow(image, directoryPath);
      const workflowJSON = metadataOverride
        ? formatMetadataForComfyUI(metadataOverride)
        : formatImageForComfyUI(sourceImage);

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
  }, [directories]);

  return {
    copyToComfyUI,
    isCopying,
    copyStatus,
  };
}
