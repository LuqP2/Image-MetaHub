import { useEffect, useRef } from 'react';
import { IndexedImage } from '../types';
import { thumbnailManager } from '../services/thumbnailManager';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';

export function useThumbnail(image: IndexedImage | null): void {
  const disableThumbnails = useSettingsStore((state) => state.disableThumbnails);
  const indexingState = useImageStore((state) => state.indexingState);
  const isIndexingRef = useRef(indexingState === 'indexing');
  const loadingRef = useRef<Set<string>>(new Set());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update ref without triggering effects
  isIndexingRef.current = indexingState === 'indexing';

  useEffect(() => {
    // Don't load thumbnails during indexing to avoid infinite loops
    if (disableThumbnails || !image || isIndexingRef.current) {
      return;
    }

    // Check CURRENT store state (not stale prop) before starting load
    const storeState = useImageStore.getState();
    const currentImage = storeState.images.find(img => img.id === image.id);

    if (currentImage?.thumbnailStatus === 'ready' || currentImage?.thumbnailStatus === 'loading') {
      return;
    }

    // Prevent duplicate loads from same hook instance
    if (loadingRef.current.has(image.id)) {
      return;
    }

    // Debounce: wait one React frame (16ms) before loading
    // This prevents rapid-fire updates from causing loops
    timeoutRef.current = setTimeout(() => {
      let cancelled = false;
      loadingRef.current.add(image.id);

      const run = async () => {
        try {
          await thumbnailManager.ensureThumbnail(image);
        } catch (error) {
          if (!cancelled) {
            console.error('Failed to ensure thumbnail:', error);
          }
        } finally {
          if (!cancelled) {
            loadingRef.current.delete(image.id);
          }
        }
      };

      void run();

      return () => {
        cancelled = true;
        loadingRef.current.delete(image.id);
      };
    }, 16); // One React frame

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      loadingRef.current.delete(image.id);
    };
  }, [image?.id, disableThumbnails]);
}

