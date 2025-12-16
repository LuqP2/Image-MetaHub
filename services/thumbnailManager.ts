import { IndexedImage } from '../types';
import cacheManager from './cacheManager';
import { useImageStore } from '../store/useImageStore';

const MAX_THUMBNAIL_EDGE = 320;
const MAX_CONCURRENT_THUMBNAILS = 3;

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

type ThumbnailJob = {
  image: IndexedImage;
  token: number;
  resolve: () => void;
  reject: (error: unknown) => void;
};

class ThumbnailManager {
  private inflight = new Map<string, Promise<void>>();
  private activeUrls = new Map<string, string>();
  private queue: ThumbnailJob[] = [];
  private activeWorkers = 0;
  private requestTokens = new Map<string, number>();
  private requestCounter = 0;

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

    const existing = this.inflight.get(image.id);
    if (currentImage?.thumbnailStatus === 'loading' && existing) {
      return existing;
    }

    // Bump token to invalidate older queued/processing jobs for the same image
    const token = this.nextToken(image.id);
    this.dropQueuedJobs(image.id);

    const promise = new Promise<void>((resolve, reject) => {
      this.queue.push({ image, token, resolve, reject });
      this.processQueue();
    });

    this.inflight.set(image.id, promise);
    return promise;
  }

  private nextToken(imageId: string): number {
    const next = ++this.requestCounter;
    this.requestTokens.set(imageId, next);
    return next;
  }

  private dropQueuedJobs(imageId: string) {
    if (this.queue.length === 0) return;
    this.queue = this.queue.filter(job => job.image.id !== imageId);
  }

  private isStale(imageId: string, token: number): boolean {
    return this.requestTokens.get(imageId) !== token;
  }

  private processQueue() {
    while (this.activeWorkers < MAX_CONCURRENT_THUMBNAILS && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;

      // If a newer request exists, skip this job
      if (this.isStale(job.image.id, job.token)) {
        job.resolve();
        continue;
      }

      this.activeWorkers++;

      this.loadThumbnail(job.image, job.token)
        .then(() => job.resolve())
        .catch((err) => job.reject(err))
        .finally(() => {
          // Clean inflight only if this job is still the latest for the image
          if (!this.isStale(job.image.id, job.token)) {
            this.inflight.delete(job.image.id);
          }
          this.activeWorkers--;
          this.processQueue();
        });
    }
  }

  private async loadThumbnail(image: IndexedImage, token: number): Promise<void> {
    const setImageThumbnail = useImageStore.getState().setImageThumbnail;
    const setSafe = (payload: { status: 'loading' | 'ready' | 'error'; thumbnailUrl?: string | null; error?: string | null }) => {
      if (this.isStale(image.id, token)) return;
      setImageThumbnail(image.id, payload);
    };

    setSafe({ status: 'loading' });

    try {
      if (image.thumbnailUrl) {
        setSafe({ status: 'ready', thumbnailUrl: image.thumbnailUrl });
        return;
      }

      const cachedBlob = await cacheManager.getCachedThumbnail(image.id);
      if (cachedBlob) {
        const url = this.updateObjectUrl(image.id, cachedBlob);
        setSafe({ status: 'ready', thumbnailUrl: url });
        return;
      }

      const file = await (image.thumbnailHandle ?? image.handle).getFile();
      const blob = await generateThumbnailBlob(file);
      if (!blob) {
        throw new Error('Thumbnail generation failed');
      }

      await cacheManager.cacheThumbnail(image.id, blob);
      const url = this.updateObjectUrl(image.id, blob);
      setSafe({ status: 'ready', thumbnailUrl: url });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown thumbnail error';
      setSafe({ status: 'error', error: message });
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
