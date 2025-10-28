import { useEffect } from 'react';
import { IndexedImage } from '../types';
import { thumbnailManager } from '../services/thumbnailManager';
import { useSettingsStore } from '../store/useSettingsStore';

export function useThumbnail(image: IndexedImage | null): void {
  const disableThumbnails = useSettingsStore((state) => state.disableThumbnails);

  useEffect(() => {
    if (disableThumbnails || !image) {
      return;
    }

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
  }, [image?.id, image?.thumbnailStatus, disableThumbnails]);
}

