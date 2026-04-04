import { useCallback, useState } from 'react';
import { type IndexedImage } from '../types';
import { useImageStore } from '../store/useImageStore';
import cacheManager from '../services/cacheManager';
import { reparseIndexedImage } from '../services/fileIndexer';

export function useReparseMetadata() {
  const [isReparsing, setIsReparsing] = useState(false);
  const directories = useImageStore((state) => state.directories);
  const scanSubfolders = useImageStore((state) => state.scanSubfolders);
  const mergeImages = useImageStore((state) => state.mergeImages);
  const setError = useImageStore((state) => state.setError);
  const setSuccess = useImageStore((state) => state.setSuccess);

  const reparseImages = useCallback(async (images: IndexedImage[]) => {
    if (images.length === 0 || isReparsing) {
      return;
    }

    setIsReparsing(true);
    try {
      const updatedImages: IndexedImage[] = [];
      const failures: Array<{ image: IndexedImage; error: string }> = [];

      for (const image of images) {
        const directoryPath = directories.find((directory) => directory.id === image.directoryId)?.path;
        if (!directoryPath) {
          failures.push({ image, error: 'Directory path is unavailable.' });
          continue;
        }

        try {
          const reparsed = await reparseIndexedImage(image, directoryPath);
          if (!reparsed) {
            failures.push({ image, error: 'The parser returned no metadata.' });
            continue;
          }

          updatedImages.push({
            ...image,
            ...reparsed,
            handle: image.handle,
            thumbnailHandle: image.thumbnailHandle,
            thumbnailUrl: image.thumbnailUrl,
            thumbnailStatus: image.thumbnailStatus,
            thumbnailError: image.thumbnailError,
            directoryId: image.directoryId,
            directoryName: image.directoryName,
            isFavorite: image.isFavorite,
            tags: image.tags,
            rating: image.rating,
            clusterId: image.clusterId,
            clusterPosition: image.clusterPosition,
            autoTags: image.autoTags,
            autoTagsGeneratedAt: image.autoTagsGeneratedAt,
            enrichmentState: 'enriched',
          });
        } catch (error) {
          failures.push({
            image,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (updatedImages.length > 0) {
        mergeImages(updatedImages);

        const updatesByDirectory = new Map<string, { directoryName: string; images: IndexedImage[] }>();
        for (const image of updatedImages) {
          const directoryPath = directories.find((directory) => directory.id === image.directoryId)?.path;
          const directoryName = directories.find((directory) => directory.id === image.directoryId)?.name;
          if (!directoryPath || !directoryName) {
            continue;
          }
          const current = updatesByDirectory.get(directoryPath);
          if (current) {
            current.images.push(image);
          } else {
            updatesByDirectory.set(directoryPath, { directoryName, images: [image] });
          }
        }

        for (const [directoryPath, payload] of updatesByDirectory.entries()) {
          await cacheManager.updateCachedImages(
            directoryPath,
            payload.directoryName,
            payload.images,
            scanSubfolders
          );
        }
      }

      if (failures.length > 0) {
        const prefix = updatedImages.length > 0
          ? `Reparsed ${updatedImages.length} image${updatedImages.length !== 1 ? 's' : ''}, but ${failures.length} failed.`
          : `Failed to reparse ${failures.length} image${failures.length !== 1 ? 's' : ''}.`;
        setError(`${prefix} ${failures[0].image.name}: ${failures[0].error}`);
      } else if (updatedImages.length > 0) {
        setSuccess(
          `Reparsed metadata for ${updatedImages.length} image${updatedImages.length !== 1 ? 's' : ''}.`
        );
      }
    } finally {
      setIsReparsing(false);
    }
  }, [directories, isReparsing, mergeImages, scanSubfolders, setError, setSuccess]);

  return {
    isReparsing,
    reparseImages,
  };
}

export default useReparseMetadata;
