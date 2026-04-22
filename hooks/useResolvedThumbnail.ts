import { useSyncExternalStore } from 'react';
import { IndexedImage, ThumbnailStatus } from '../types';
import { thumbnailManager } from '../services/thumbnailManager';

export type ResolvedThumbnailState = {
  thumbnailUrl: string | null;
  thumbnailHandle: FileSystemFileHandle | null;
  thumbnailStatus: ThumbnailStatus;
  thumbnailError: string | null;
};

export function useResolvedThumbnail(image: IndexedImage | null): ResolvedThumbnailState | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!image?.id) {
        return () => undefined;
      }

      return thumbnailManager.subscribe(image.id, onStoreChange);
    },
    () => thumbnailManager.getResolvedState(image),
    () => thumbnailManager.getResolvedState(image)
  );
}
