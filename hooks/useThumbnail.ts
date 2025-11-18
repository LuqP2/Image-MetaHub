import { useEffect, useRef } from 'react';
import { IndexedImage } from '../types';
import { thumbnailManager } from '../services/thumbnailManager';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';

export function useThumbnail(image: IndexedImage | null): void {
  const disableThumbnails = useSettingsStore((state) => state.disableThumbnails);
  const indexingState = useImageStore((state) => state.indexingState);
  const isIndexingRef = useRef(indexingState === 'indexing');

  // Update ref without triggering effects
  isIndexingRef.current = indexingState === 'indexing';

  useEffect(() => {
    // Don't load thumbnails during indexing to avoid infinite loops
    if (disableThumbnails || !image || isIndexingRef.current) {
      return;
    }

    // Check current thumbnail status before starting load
    if (image.thumbnailStatus === 'ready' || image.thumbnailStatus === 'loading') {
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        await thumbnailManager.ensureThumbnail(image);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to ensure thumbnail:', error);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [image?.id, disableThumbnails]);
}

