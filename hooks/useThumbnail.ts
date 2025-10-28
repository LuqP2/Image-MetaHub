import { useEffect } from 'react';
import { IndexedImage } from '../types';
import { thumbnailManager } from '../services/thumbnailManager';

export function useThumbnail(image: IndexedImage | null): void {
  useEffect(() => {
    if (!image) {
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
  }, [image?.id, image?.thumbnailStatus]);
}

