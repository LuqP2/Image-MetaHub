import { useState, useCallback } from 'react';
import { BaseMetadata, IndexedImage } from '../types';
import { formatMetadataForA1111 } from '../utils/a1111Formatter';
import { copyTextToClipboard } from '../utils/imageUtils';
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

export function useCopyToA1111() {
  const [isCopying, setIsCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);

  const copyToA1111 = useCallback(async (image: IndexedImage, metadataOverride?: BaseMetadata) => {
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
      // Format metadata to A1111 string
      const formattedText = formatMetadataForA1111(metadata);

      // Copy to clipboard
      const result = await copyTextToClipboard(formattedText);
      if (!result.success) {
        throw new Error(result.error || 'Unknown error occurred');
      }

      setCopyStatus({
        success: true,
        message: 'Copied! Paste into A1111 prompt box and click the Blue Arrow.',
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
    copyToA1111,
    isCopying,
    copyStatus,
  };
}
