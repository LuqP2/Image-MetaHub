import { IndexedImage, ThumbnailStatus } from '../types';
import { useImageStore } from '../store/useImageStore';

type ResolvedThumbnailState = {
  thumbnailUrl: string | null;
  thumbnailHandle: FileSystemFileHandle | null;
  thumbnailStatus: ThumbnailStatus;
  thumbnailError: string | null;
};

export function useResolvedThumbnail(image: IndexedImage | null): ResolvedThumbnailState | null {
  const thumbnailEntry = useImageStore((state) => (image ? state.thumbnailEntries[image.id] : undefined));

  if (!image) {
    return null;
  }

  const activeEntry = thumbnailEntry && thumbnailEntry.lastModified === image.lastModified
    ? thumbnailEntry
    : undefined;

  return {
    thumbnailUrl: activeEntry?.thumbnailUrl ?? image.thumbnailUrl ?? null,
    thumbnailHandle: activeEntry?.thumbnailHandle ?? image.thumbnailHandle ?? null,
    thumbnailStatus: activeEntry?.thumbnailStatus ?? image.thumbnailStatus ?? 'pending',
    thumbnailError: activeEntry?.thumbnailError ?? image.thumbnailError ?? null,
  };
}
