import { useEffect, useMemo, useRef } from 'react';
import { IndexedImage } from '../types';
import { thumbnailManager } from '../services/thumbnailManager';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageStore } from '../store/useImageStore';

const DEFAULT_WARMUP_DELAY_MS = 120;

export function useThumbnailWarmup(images: IndexedImage[], limit: number): void {
  const disableThumbnails = useSettingsStore((state) => state.disableThumbnails);
  const scheduledIdsRef = useRef<Set<string>>(new Set());
  const candidateImagesRef = useRef<IndexedImage[]>([]);

  const candidateImages = useMemo(() => {
    if (!Array.isArray(images) || images.length === 0 || limit <= 0) {
      return [];
    }
    return images.slice(0, limit);
  }, [images, limit]);

  const signature = useMemo(
    () => candidateImages.map((image) => `${image.id}:${image.lastModified ?? 0}`).join('|'),
    [candidateImages]
  );
  candidateImagesRef.current = candidateImages;

  useEffect(() => {
    const imagesToWarm = candidateImagesRef.current;
    if (disableThumbnails || imagesToWarm.length === 0) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      const run = async () => {
        for (const image of imagesToWarm) {
          const warmKey = `${image.id}:${image.lastModified ?? 0}`;

          if (cancelled || scheduledIdsRef.current.has(warmKey)) {
            continue;
          }

          const state = useImageStore.getState();
          const currentImage =
            state.images.find((item) => item.id === image.id) ??
            state.filteredImages.find((item) => item.id === image.id);
          const currentStatus = currentImage?.thumbnailStatus ?? image.thumbnailStatus;

          if (currentStatus === 'ready' || currentStatus === 'loading') {
            scheduledIdsRef.current.add(warmKey);
            continue;
          }

          scheduledIdsRef.current.add(warmKey);

          try {
            await thumbnailManager.ensureThumbnail(image, 'low');
          } catch {
            scheduledIdsRef.current.delete(warmKey);
          }

          if (cancelled) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      };

      void run();
    }, DEFAULT_WARMUP_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [disableThumbnails, signature]);
}
