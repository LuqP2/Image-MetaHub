import React, { useCallback, useEffect, useRef, useState } from 'react';
import ImageModal from './ImageModal';
import { useImageStore } from '../store/useImageStore';
import type { IndexedImage } from '../types';
import type { ImageViewerCommand, ImageViewerSnapshot } from '../services/imageViewerContracts';
import { useSettingsStore } from '../store/useSettingsStore';
import { useLicenseStore } from '../store/useLicenseStore';

const getSessionId = () => new URLSearchParams(window.location.search).get('sessionId') || '';

const asIndexedImage = (image: ImageViewerSnapshot['image']): IndexedImage => image as IndexedImage;

const DetachedImageModalApp: React.FC = () => {
  const sessionIdRef = useRef(getSessionId());
  const latestRevisionRef = useRef(-1);
  const [snapshot, setSnapshot] = useState<ImageViewerSnapshot | null>(null);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    const applyTheme = (systemShouldUseDark: boolean) => {
      const isDark = ['dark', 'dracula', 'nord', 'ocean'].includes(theme)
        || (theme === 'system' && systemShouldUseDark);
      document.documentElement.classList.toggle('dark', isDark);
      document.documentElement.setAttribute('data-theme', theme === 'system' ? (systemShouldUseDark ? 'dark' : 'light') : theme);
    };
    const api = window.electronAPI;
    if (!api) return;
    void api.getTheme().then(({ shouldUseDarkColors }) => applyTheme(shouldUseDarkColors));
    return api.onThemeUpdated(({ shouldUseDarkColors }) => applyTheme(shouldUseDarkColors));
  }, [theme]);

  useEffect(() => {
    void Promise.resolve(useLicenseStore.persist.rehydrate())
      .then(() => useLicenseStore.getState().checkLicenseStatus());
  }, []);

  const sendCommand = useCallback(async (command: ImageViewerCommand) => {
    const api = window.electronAPI;
    if (!api?.imageViewerCommand) return { success: false, error: 'Desktop viewer bridge is unavailable.' };
    return api.imageViewerCommand({ sessionId: sessionIdRef.current, command });
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    const sessionId = sessionIdRef.current;
    if (!api?.imageViewerReady || !api.onImageViewerSnapshot || !sessionId) return;

    const applySnapshot = (next: ImageViewerSnapshot) => {
      if (next.sessionId !== sessionId || next.revision <= latestRevisionRef.current) return;
      latestRevisionRef.current = next.revision;
      const images = [next.previousImage, next.image, next.nextImage]
        .filter((candidate): candidate is ImageViewerSnapshot['image'] => Boolean(candidate))
        .map(asIndexedImage);
      const current = asIndexedImage(next.image);
      useImageStore.setState({
        images,
        filteredImages: images,
        selectedImage: current,
        recentTags: next.recentTags,
        comparisonImages: next.comparisonImages.map(asIndexedImage),
        collections: next.collections,
        directories: [{
          id: current.directoryId || next.directoryPath,
          name: next.directoryPath.split(/[\\/]/).filter(Boolean).pop() || next.directoryPath,
          path: next.directoryPath,
        }] as never,
      });
      setSnapshot(next);
      void useSettingsStore.persist.rehydrate();
      void useLicenseStore.persist.rehydrate();
    };

    const unsubscribe = api.onImageViewerSnapshot(applySnapshot);
    void api.imageViewerReady(sessionId);

    useImageStore.setState({
      toggleFavorite: async (imageId: string) => {
        useImageStore.setState((state) => ({ images: state.images.map((entry) =>
          entry.id === imageId ? { ...entry, isFavorite: !entry.isFavorite } : entry) }));
        await sendCommand({ type: 'toggle-favorite', imageId });
      },
      setImageRating: async (imageId: string, rating) => {
        useImageStore.setState((state) => ({ images: state.images.map((entry) =>
          entry.id === imageId ? { ...entry, rating } : entry) }));
        await sendCommand({ type: 'set-rating', imageId, rating });
      },
      addTagToImage: async (imageId: string, tag: string) => {
        const normalized = tag.trim().toLowerCase();
        useImageStore.setState((state) => ({ images: state.images.map((entry) =>
          entry.id === imageId && normalized && !entry.tags?.includes(normalized)
            ? { ...entry, tags: [...(entry.tags || []), normalized] }
            : entry) }));
        await sendCommand({ type: 'add-tag', imageId, tag });
      },
      removeTagFromImage: async (imageId: string, tag: string) => {
        useImageStore.setState((state) => ({ images: state.images.map((entry) =>
          entry.id === imageId ? { ...entry, tags: (entry.tags || []).filter((value) => value !== tag) } : entry) }));
        await sendCommand({ type: 'remove-tag', imageId, tag });
      },
      removeAutoTagFromImage: (imageId: string, tag: string) => {
        useImageStore.setState((state) => ({ images: state.images.map((entry) =>
          entry.id === imageId ? { ...entry, autoTags: (entry.autoTags || []).filter((value) => value !== tag) } : entry) }));
        void sendCommand({ type: 'remove-auto-tag', imageId, tag });
      },
      setSearchQuery: (query: string) => {
        void sendCommand({ type: 'set-search', query });
      },
      addImageToComparison: (image: IndexedImage) => {
        useImageStore.setState((state) => ({ comparisonImages: [...state.comparisonImages, image] }));
        void sendCommand({ type: 'add-comparison', imageId: image.id });
      },
      openComparisonModal: () => undefined,
      addImagesToCollection: async (collectionId: string, imageIds: string[]) => {
        const result = await sendCommand({ type: 'add-to-collection', collectionId, imageIds });
        return (result.collection || null) as never;
      },
      createCollection: async (collection: Record<string, unknown>) => {
        const result = await sendCommand({ type: 'create-collection', collection });
        return result.collection as never;
      },
    } as never);

    return unsubscribe;
  }, [sendCommand]);

  if (!snapshot) {
    return <div className="flex h-screen items-center justify-center bg-gray-950 text-sm text-gray-400">Opening image…</div>;
  }

  const image = asIndexedImage(snapshot.image);
  const navigate = (direction: 'next' | 'previous' | 'random', wrap = false) => {
    void sendCommand({ type: 'navigate', direction, wrap });
  };
  const acknowledgeSlideshowStart = () => {
    void sendCommand({ type: 'slideshow-started' });
  };
  const toggleAlwaysOnTop = async () => {
    const result = await window.electronAPI?.imageViewerWindowAction({
      sessionId: snapshot.sessionId,
      action: 'toggle-always-on-top',
    });
    if (result?.success) setIsAlwaysOnTop(Boolean(result.isAlwaysOnTop));
  };

  return (
    <ImageModal
      hostMode="native-window"
      isAlwaysOnTop={isAlwaysOnTop}
      onToggleAlwaysOnTop={() => void toggleAlwaysOnTop()}
      modalId={snapshot.sessionId}
      image={image}
      onClose={() => void window.electronAPI?.imageViewerWindowAction({ sessionId: snapshot.sessionId, action: 'close' })}
      onImageDeleted={(imageId) => void sendCommand({ type: 'image-deleted', imageId })}
      onImageRenamed={(oldImageId, newImageId, newRelativePath) => void sendCommand({ type: 'image-renamed', oldImageId, newImageId, newRelativePath })}
      onRequestDelete={(imageId) => sendCommand({ type: 'delete-image', imageId })}
      onRequestRename={async (imageId, newName) => {
        const result = await sendCommand({ type: 'rename-image', imageId, newName });
        return {
          success: result.success,
          error: result.error,
          newImageId: typeof result.newImageId === 'string' ? result.newImageId : undefined,
          newRelativePath: typeof result.newRelativePath === 'string' ? result.newRelativePath : undefined,
        };
      }}
      onRequestReparse={(imageId) => sendCommand({ type: 'reparse-image', imageId })}
      onRequestGenerate={(request) => sendCommand({ type: 'generate', request })}
      onImageSaved={async (request) => {
        const result = await sendCommand({ type: 'image-saved', request });
        return {
          success: result.success,
          error: result.error,
          savedImageName: typeof result.savedImageName === 'string' ? result.savedImageName : undefined,
        };
      }}
      onRequestTagSuggestions={async (query) => {
        const result = await sendCommand({ type: 'get-tag-suggestions', query });
        return Array.isArray(result.suggestions) ? result.suggestions as never : [];
      }}
      currentIndex={snapshot.currentIndex}
      totalImages={snapshot.totalImages}
      onNavigateNext={() => navigate('next')}
      onNavigatePrevious={() => navigate('previous')}
      onNavigateNextWrapping={() => navigate('next', true)}
      onNavigateRandom={() => navigate('random')}
      directoryPath={snapshot.directoryPath}
      isIndexing={snapshot.isIndexing}
      isActive
      startSlideshow={snapshot.startSlideshow}
      closeOnSlideshowExit={snapshot.closeOnSlideshowExit}
      onSlideshowStartAcknowledged={acknowledgeSlideshowStart}
      onFindSimilar={(target) => void sendCommand({ type: 'find-similar', imageId: target.id })}
      onOpenComfyUIWorkflow={(target) => void sendCommand({ type: 'open-comfyui', imageId: target.id })}
      onOpenImageEditor={(target) => void sendCommand({ type: 'open-editor', imageId: target.id })}
    />
  );
};

export default DetachedImageModalApp;
