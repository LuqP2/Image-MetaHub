import { isExrFileName } from '../utils/mediaTypes.js';
import { subscribeExrChanged } from '../services/exr/client';
import { useEffect, useState } from 'react';
import { IndexedImage } from '../types';
import { mediaSourceCache } from '../services/mediaSourceCache';
import { useResolvedThumbnail } from './useResolvedThumbnail';

const useComparisonImageSource = (image: IndexedImage, directoryPath: string, skip = false) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const thumbnail = useResolvedThumbnail(image);
  const [exrRevision, setExrRevision] = useState(0);
  useEffect(() => isExrFileName(image.name) ? subscribeExrChanged(() => setExrRevision(n => n + 1)) : undefined, [image.name]);

  useEffect(() => {
    if (skip) { setImageUrl(null); setLoadError(null); setIsLoading(false); return; }
    let isMounted = true;
    const previewUrl = thumbnail?.thumbnailUrl ?? null;
    const hasPreview = Boolean(previewUrl);
    setImageUrl(previewUrl);
    setLoadError(null);
    setIsLoading(true);

    const loadImage = async () => {
      if (!isMounted) return;

      if (!directoryPath && window.electronAPI) {
        console.error('Cannot load image: directoryPath is undefined');
        setLoadError('Directory path is not available');
        setIsLoading(false);
        return;
      }

      try {
        const url = await mediaSourceCache.getOrLoad(image, directoryPath);
        if (isMounted) {
          setImageUrl(url);
          setIsLoading(false);
        }
      } catch (loadError) {
        const fallbackMessage = loadError instanceof Error ? loadError.message : String(loadError);
        console.error('Failed to load comparison source:', fallbackMessage);
        if (isMounted) {
          if (!hasPreview) {
            setLoadError(fallbackMessage);
          }
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
    };
  }, [image.id, image.handle, image.thumbnailHandle, image.name, thumbnail?.thumbnailUrl, directoryPath, exrRevision, skip]);

  return { imageUrl, loadError, isLoading };
};

export default useComparisonImageSource;
