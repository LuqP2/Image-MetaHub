import { useState, useCallback } from 'react';
import { IndexedImage } from '../types';
import { formatMetadataForA1111 } from '../utils/a1111Formatter';

interface CopyStatus {
  success: boolean;
  message: string;
}

export function useCopyToA1111() {
  const [isCopying, setIsCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);

  const copyToA1111 = useCallback(async (image: IndexedImage) => {
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
      // Format metadata to A1111 string
      const formattedText = formatMetadataForA1111(metadata);

      // Copy to clipboard
      await navigator.clipboard.writeText(formattedText);

      setCopyStatus({
        success: true,
        message: 'Copied! Paste into A1111 prompt box and click the Blue Arrow.',
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
    copyToA1111,
    isCopying,
    copyStatus,
  };
}
