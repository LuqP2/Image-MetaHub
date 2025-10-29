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

type EnsureThumbnailOptions = {
  signal?: AbortSignal;
  epoch?: number;
};

type InflightEntry = {
  promise: Promise<void>;
  epoch: number;
};

class ThumbnailManager {
  private inflight = new Map<string, InflightEntry>();
  private activeUrls = new Map<string, string>();
  private activeEpoch = 0;

  setActiveEpoch(epoch: number): void {
    this.activeEpoch = epoch;
  }

  async ensureThumbnail(image: IndexedImage, options: EnsureThumbnailOptions = {}): Promise<void> {
    if (!image || !image.id) {
      return;
    }

    if (image.thumbnailStatus === 'ready' && image.thumbnailUrl) {
      return;
    }

    const epoch = options.epoch ?? this.activeEpoch;
    const signal = options.signal;

    if (signal?.aborted) {
      return;
    }

    const existing = this.inflight.get(image.id);
    if (existing && existing.epoch === epoch) {
      return existing.promise;
    }

    const loadPromise = this.loadThumbnail(image, epoch, signal).finally(() => {
      const current = this.inflight.get(image.id);
      if (current?.promise === loadPromise) {
        this.inflight.delete(image.id);
      }
    });

    this.inflight.set(image.id, { promise: loadPromise, epoch });
    await loadPromise;
  }

  private isEpochValid(epoch?: number): boolean {
    return typeof epoch !== 'number' || epoch === this.activeEpoch;
  }

  private createAbortError(): Error {
    const error = new Error('Aborted');
    (error as any).name = 'AbortError';
    return error;
  }

  private isAbortError(error: unknown): boolean {
    return Boolean(error) && typeof error === 'object' && (error as { name?: string }).name === 'AbortError';
  }

  private resetPending(imageId: string): void {
    const state = useImageStore.getState();
    const findImage = (list: IndexedImage[]) => list.find((img) => img.id === imageId);
    const currentImage = findImage(state.images) ?? findImage(state.filteredImages);

    if (!currentImage || currentImage.thumbnailStatus !== 'loading') {
      return;
    }

    state.setImageThumbnail(imageId, {
      status: 'pending',
      thumbnailUrl: currentImage.thumbnailUrl ?? null,
      error: null,
    });
  }

  private async loadThumbnail(image: IndexedImage, epoch: number, signal?: AbortSignal): Promise<void> {
    const setImageThumbnail = useImageStore.getState().setImageThumbnail;
    const assertValid = () => {
      if (signal?.aborted || !this.isEpochValid(epoch)) {
        throw this.createAbortError();
      }
    };

    try {
      assertValid();
      setImageThumbnail(image.id, { status: 'loading' });

      if (image.thumbnailUrl) {
        assertValid();
        setImageThumbnail(image.id, { status: 'ready', thumbnailUrl: image.thumbnailUrl });
        return;
      }

      const cachedBlob = await cacheManager.getCachedThumbnail(image.id);
      assertValid();
      if (cachedBlob) {
        const url = this.updateObjectUrl(image.id, cachedBlob);
        assertValid();
        setImageThumbnail(image.id, { status: 'ready', thumbnailUrl: url });
        return;
      }

      const file = await (image.thumbnailHandle ?? image.handle).getFile();
      assertValid();
      const blob = await generateThumbnailBlob(file);
      assertValid();
      if (!blob) {
        throw new Error('Thumbnail generation failed');
      }

      await cacheManager.cacheThumbnail(image.id, blob);
      assertValid();
      const url = this.updateObjectUrl(image.id, blob);
      assertValid();
      setImageThumbnail(image.id, { status: 'ready', thumbnailUrl: url });
    } catch (error) {
      if (this.isAbortError(error)) {
        this.resetPending(image.id);
        return;
      }

      if (signal?.aborted || !this.isEpochValid(epoch)) {
        this.resetPending(image.id);
        return;
      }

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

