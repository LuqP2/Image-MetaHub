import { useTranslation, type MessageKey } from '../i18n/useTranslation';
import { useState, useCallback } from 'react';
import { BaseMetadata, IndexedImage } from '../types';
import { formatMetadataForA1111 } from '../utils/a1111Formatter';
import { copyTextToClipboard } from '../utils/imageUtils';
import {
  getClipboardErrorMessage,
  getNormalizedMetadata,
  hasPromptMetadata,
  TEMPORARY_STATUS_TIMEOUT_MS,
} from '../utils/imageMetadata';

interface CopyStatus {
  success: boolean;
  key?: MessageKey;
  error?: unknown;
}

export function useCopyToA1111() {
  const { t } = useTranslation();
  const [isCopying, setIsCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);

  const copyToA1111 = useCallback(async (image: IndexedImage, metadataOverride?: BaseMetadata) => {
    const metadata = metadataOverride ?? getNormalizedMetadata(image);

    if (!hasPromptMetadata(metadata)) {
      setCopyStatus({
        success: false,
        key: 'imageViewer.status.noMetadata',
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
        key: 'imageViewer.status.a1111Copied',
      });

      // Clear status after 5 seconds
      setTimeout(() => setCopyStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
    } catch (error: unknown) {

      setCopyStatus({
        success: false,
        error,
      });

      setTimeout(() => setCopyStatus(null), TEMPORARY_STATUS_TIMEOUT_MS);
    } finally {
      setIsCopying(false);
    }
  }, []);

  return {
    copyToA1111,
    isCopying,
    copyStatus: copyStatus ? {
      success: copyStatus.success,
      message: copyStatus.key ? t(copyStatus.key) : getClipboardErrorMessage(copyStatus.error, t),
    } : null,
  };
}
