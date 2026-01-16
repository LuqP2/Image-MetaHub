import { useEffect, useState } from 'react';
import { IndexedImage } from '../types';

const resolveImageMimeType = (fileName: string): string => {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  return 'image/png';
};

const createImageUrlFromFileData = (data: unknown, fileName: string): { url: string; revoke: boolean } => {
  const mimeType = resolveImageMimeType(fileName);

  if (typeof data === 'string') {
    return { url: `data:${mimeType};base64,${data}`, revoke: false };
  }

  if (data instanceof ArrayBuffer) {
    const blob = new Blob([data], { type: mimeType });
    return { url: URL.createObjectURL(blob), revoke: true };
  }

  if (ArrayBuffer.isView(data)) {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const blob = new Blob([view], { type: mimeType });
    return { url: URL.createObjectURL(blob), revoke: true };
  }

  if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as { data: unknown }).data)) {
    const view = new Uint8Array((data as { data: number[] }).data);
    const blob = new Blob([view], { type: mimeType });
    return { url: URL.createObjectURL(blob), revoke: true };
  }

  throw new Error('Unknown file data format.');
};

const useComparisonImageSource = (image: IndexedImage, directoryPath: string) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let createdUrl: string | null = null;
    const previewUrl = image.thumbnailUrl ?? null;
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

      const setResolvedUrl = (url: string, revoke: boolean) => {
        if (!isMounted) return;
        if (createdUrl) {
          URL.revokeObjectURL(createdUrl);
          createdUrl = null;
        }
        if (revoke) {
          createdUrl = url;
        }
        setImageUrl(url);
        setIsLoading(false);
      };

      try {
        const primaryHandle = image.handle;
        const fallbackHandle = image.thumbnailHandle;
        const fileHandle =
          primaryHandle && typeof primaryHandle.getFile === 'function'
            ? primaryHandle
            : fallbackHandle && typeof fallbackHandle.getFile === 'function'
              ? fallbackHandle
              : null;

        if (fileHandle) {
          const file = await fileHandle.getFile();
          if (isMounted) {
            const url = URL.createObjectURL(file);
            setResolvedUrl(url, true);
          }
          return;
        }
        throw new Error('Image handle is not a valid FileSystemFileHandle.');
      } catch (handleError) {
        const message = handleError instanceof Error ? handleError.message : String(handleError);
        console.warn(`Could not load image with FileSystemFileHandle: ${message}. Attempting Electron fallback.`);
        if (isMounted && window.electronAPI && directoryPath) {
          try {
            const pathResult = await window.electronAPI.joinPaths(directoryPath, image.name);
            if (!pathResult.success || !pathResult.path) {
              throw new Error(pathResult.error || 'Failed to construct image path.');
            }
            const fileResult = await window.electronAPI.readFile(pathResult.path);
            if (fileResult.success && fileResult.data && isMounted) {
              const { url, revoke } = createImageUrlFromFileData(fileResult.data, image.name);
              setResolvedUrl(url, revoke);
            } else {
              throw new Error(fileResult.error || 'Failed to read file via Electron API.');
            }
        } catch (electronError) {
            const fallbackMessage = electronError instanceof Error ? electronError.message : String(electronError);
            console.error('Electron fallback failed:', fallbackMessage);
            if (isMounted) {
              if (!hasPreview) {
                setLoadError(fallbackMessage);
              }
              setIsLoading(false);
            }
          }
        } else if (isMounted) {
          if (!hasPreview) {
            setLoadError('No valid file handle and not in a compatible Electron environment.');
          }
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [image.id, image.handle, image.thumbnailHandle, image.name, image.thumbnailUrl, directoryPath]);

  return { imageUrl, loadError, isLoading };
};

export default useComparisonImageSource;
