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

    const resolved = thumbnailManager.getResolvedState(image);
    if (resolved.thumbnailStatus === 'ready' || resolved.thumbnailStatus === 'loading') {
      return;
    }

    void thumbnailManager.ensureThumbnail(image, 'high', { markLoading: true }).catch((error) => {
      console.error('Failed to ensure thumbnail:', error);
    });
  }, [disableThumbnails, image?.id, image?.lastModified]);
}
