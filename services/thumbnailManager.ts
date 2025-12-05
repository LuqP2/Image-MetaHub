import { IndexedImage } from '../types';
import cacheManager from './cacheManager';
import { useImageStore } from '../store/useImageStore';

const MAX_THUMBNAIL_EDGE = 320;

async function generateThumbnailBlob(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = Math.max(bitmap.width, bitmap.height) || 1;
    const scale = Math.min(1, MAX_THUMBNAIL_EDGE / maxEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.82)
    );

    return blob;
  } catch (error) {
    console.error('Failed to generate thumbnail blob:', error);
    return null;
  }
}

class ThumbnailManager {
  private inflight = new Map<string, Promise<void>>();
  private activeUrls = new Map<string, string>();

  async ensureThumbnail(image: IndexedImage): Promise<void> {
    if (!image || !image.id) {
      return;
    }

    // Check current status from store (not from prop, which may be stale)
    const storeState = useImageStore.getState();
    const currentImage = storeState.images.find(img => img.id === image.id);

    if (currentImage?.thumbnailStatus === 'ready' && currentImage.thumbnailUrl) {
      return;
    }

    if (currentImage?.thumbnailStatus === 'loading') {
      return; // Already being loaded
    }

    const existing = this.inflight.get(image.id);
    if (existing) {
      return existing;
    }

    const loadPromise = this.loadThumbnail(image).finally(() => {
      this.inflight.delete(image.id);
    });

    this.inflight.set(image.id, loadPromise);
    await loadPromise;
  }

  private async loadThumbnail(image: IndexedImage): Promise<void> {
    const setImageThumbnail = useImageStore.getState().setImageThumbnail;
    setImageThumbnail(image.id, { status: 'loading' });

    try {
      if (image.thumbnailUrl) {
        setImageThumbnail(image.id, { status: 'ready', thumbnailUrl: image.thumbnailUrl });
        return;
      }

      const cachedBlob = await cacheManager.getCachedThumbnail(image.id);
      if (cachedBlob) {
        const url = this.updateObjectUrl(image.id, cachedBlob);
        setImageThumbnail(image.id, { status: 'ready', thumbnailUrl: url });
        return;
      }

      const file = await (image.thumbnailHandle ?? image.handle).getFile();
      const blob = await generateThumbnailBlob(file);
      if (!blob) {
        throw new Error('Thumbnail generation failed');
      }

      await cacheManager.cacheThumbnail(image.id, blob);
      const url = this.updateObjectUrl(image.id, blob);
      setImageThumbnail(image.id, { status: 'ready', thumbnailUrl: url });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown thumbnail error';
      setImageThumbnail(image.id, { status: 'error', error: message });
    }
  }

  private updateObjectUrl(imageId: string, blob: Blob): string {
    const existing = this.activeUrls.get(imageId);
    if (existing) {
      URL.revokeObjectURL(existing);
    }

    const url = URL.createObjectURL(blob);
    this.activeUrls.set(imageId, url);
    return url;
  }
}

export const thumbnailManager = new ThumbnailManager();

