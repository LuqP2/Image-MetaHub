import { useEffect, useState } from 'react';
import { IndexedImage } from '../types';

const useComparisonImageSource = (image: IndexedImage, directoryPath: string) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let currentUrl: string | null = null;
    setImageUrl(null);
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
        const fileHandle = image.handle;

        if (fileHandle && typeof fileHandle.getFile === 'function') {
          const file = await fileHandle.getFile();
          if (isMounted) {
            currentUrl = URL.createObjectURL(file);
            setImageUrl(currentUrl);
            setIsLoading(false);
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
              let dataUrl: string;
              if (typeof fileResult.data === 'string') {
                const ext = image.name.toLowerCase().endsWith('.jpg') || image.name.toLowerCase().endsWith('.jpeg')
                  ? 'jpeg'
                  : 'png';
                dataUrl = `data:image/${ext};base64,${fileResult.data}`;
              } else if (fileResult.data instanceof Uint8Array) {
                const binary = String.fromCharCode.apply(null, Array.from(fileResult.data));
                const base64 = btoa(binary);
                const ext = image.name.toLowerCase().endsWith('.jpg') || image.name.toLowerCase().endsWith('.jpeg')
                  ? 'jpeg'
                  : 'png';
                dataUrl = `data:image/${ext};base64,${base64}`;
              } else {
                throw new Error('Unknown file data format.');
              }
              currentUrl = dataUrl;
              setImageUrl(dataUrl);
              setIsLoading(false);
            } else {
              throw new Error(fileResult.error || 'Failed to read file via Electron API.');
            }
          } catch (electronError) {
            const fallbackMessage = electronError instanceof Error ? electronError.message : String(electronError);
            console.error('Electron fallback failed:', fallbackMessage);
            if (isMounted) {
              setLoadError(fallbackMessage);
              setIsLoading(false);
            }
          }
        } else if (isMounted) {
          setLoadError('No valid file handle and not in a compatible Electron environment.');
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
      if (currentUrl && currentUrl.startsWith('blob:')) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [image, directoryPath]);

  return { imageUrl, loadError, isLoading };
};

export default useComparisonImageSource;
