import { IndexedImage } from '../types';
import cacheManager from './cacheManager';
import { useImageStore } from '../store/useImageStore';

const MAX_THUMBNAIL_EDGE = 320;
const MAX_CONCURRENT_THUMBNAILS = 12;
const MAX_CONCURRENT_HIGH_PRIORITY_THUMBNAILS = 10;
const MAX_CONCURRENT_BACKGROUND_THUMBNAILS = 2;

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi']);
type ElectronFileHandle = FileSystemFileHandle & { _filePath?: string };

const isVideoAsset = (image: IndexedImage, file?: File): boolean => {
  if (image.fileType && image.fileType.startsWith('video/')) {
    return true;
  }
  const imageName = image.name?.toLowerCase() || '';
  for (const ext of VIDEO_EXTENSIONS) {
    if (imageName.endsWith(ext)) {
      return true;
    }
  }
  if (file?.type?.startsWith('video/')) {
    return true;
  }
  const fileName = file?.name?.toLowerCase() || '';
  for (const ext of VIDEO_EXTENSIONS) {
    if (fileName.endsWith(ext)) {
      return true;
    }
  }
  return false;
};

const waitForVideoEvent = (video: HTMLVideoElement, eventName: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const onError = () => {
      cleanup();
      reject(new Error('Video load error'));
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener('error', onError);
    };
    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener('error', onError, { once: true });
  });

async function generateVideoThumbnailBlob(file: File): Promise<Blob | null> {
  let objectUrl: string | null = null;
  try {
    objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = objectUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    await waitForVideoEvent(video, 'loadeddata');

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration > 0) {
      const targetTime = Math.min(0.1, Math.max(0, duration - 0.05));
      if (targetTime > 0) {
        video.currentTime = targetTime;
        await waitForVideoEvent(video, 'seeked');
      }
    }

    const width = video.videoWidth || 1;
    const height = video.videoHeight || 1;
    const maxEdge = Math.max(width, height);
    const scale = Math.min(1, MAX_THUMBNAIL_EDGE / maxEdge);
    const thumbWidth = Math.max(1, Math.round(width * scale));
    const thumbHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = thumbWidth;
    canvas.height = thumbHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.82)
    );
    return blob;
  } catch (error) {
    console.error('Failed to generate video thumbnail blob:', error);
    return null;
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

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

async function generateElectronThumbnailBlob(image: IndexedImage): Promise<Blob | null> {
  const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!electronAPI?.generateThumbnailFromPath) {
    return null;
  }

  const fileHandle = (image.thumbnailHandle ?? image.handle) as ElectronFileHandle | undefined;
  const filePath = fileHandle?._filePath;
  if (!filePath) {
    return null;
  }

  const result = await electronAPI.generateThumbnailFromPath({
    filePath,
    maxEdge: MAX_THUMBNAIL_EDGE,
    quality: 82,
  });

  if (!result.success || !result.data) {
    if (!result.success && result.error) {
      console.error('Failed to generate Electron thumbnail:', result.error);
    }
    return null;
  }

  return new Blob([new Uint8Array(result.data)], { type: 'image/jpeg' });
}

type ThumbnailJob = {
  image: IndexedImage;
  token: number;
  priority: 'high' | 'low';
  markLoading: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
};

class ThumbnailManager {
  private inflight = new Map<string, Promise<void>>();
  private activeUrls = new Map<string, string>();
  private highPriorityQueue: ThumbnailJob[] = [];
  private backgroundQueue: ThumbnailJob[] = [];
  private activeHighPriorityWorkers = 0;
  private activeBackgroundWorkers = 0;
  private requestTokens = new Map<string, number>();
  private requestCounter = 0;
  private warmupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private warmupTokens = new Map<string, number>();

  scheduleWarmup(
    scopeKey: string,
    images: IndexedImage[],
    options: { batchSize?: number; delayMs?: number } = {}
  ): void {
    if (!scopeKey || !images || images.length === 0) {
      return;
    }

    const batchSize = Math.max(8, options.batchSize ?? 80);
    const delayMs = Math.max(0, options.delayMs ?? 16);
    const deduped = Array.from(
      new Map(
        images
          .filter((image) => Boolean(image?.id))
          .map((image) => [image.id, image])
      ).values()
    );

    if (deduped.length === 0) {
      return;
    }

    const nextToken = (this.warmupTokens.get(scopeKey) ?? 0) + 1;
    this.warmupTokens.set(scopeKey, nextToken);

    const existingTimer = this.warmupTimers.get(scopeKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.warmupTimers.delete(scopeKey);
    }

    let cursor = 0;

    const runChunk = () => {
      if (this.warmupTokens.get(scopeKey) !== nextToken) {
        return;
      }

      const chunk = deduped.slice(cursor, cursor + batchSize);
      if (chunk.length === 0) {
        this.warmupTimers.delete(scopeKey);
        return;
      }

      this.prefetchImages(chunk, 'low', { markLoading: false });
      cursor += chunk.length;

      if (cursor < deduped.length) {
        const timer = setTimeout(runChunk, delayMs);
        this.warmupTimers.set(scopeKey, timer);
      } else {
        this.warmupTimers.delete(scopeKey);
      }
    };

    runChunk();
  }

  prefetchImages(
    images: IndexedImage[],
    priority: 'high' | 'low' = 'low',
    options: { markLoading?: boolean } = {}
  ): void {
    if (!images || images.length === 0) {
      return;
    }

    const deduped = new Map<string, IndexedImage>();
    for (const image of images) {
      if (!image?.id || deduped.has(image.id)) {
        continue;
      }
      deduped.set(image.id, image);
    }

    for (const image of deduped.values()) {
      void this.ensureThumbnail(image, priority, {
        markLoading: options.markLoading ?? false,
      }).catch(() => {
        // Background warmup should stay silent; visible requests will retry with UI feedback.
      });
    }
  }

  async ensureThumbnail(
    image: IndexedImage,
    priority: 'high' | 'low' = 'high',
    options: { markLoading?: boolean } = {}
  ): Promise<void> {
    if (!image || !image.id) {
      return;
    }

    // Check current status from store (not from prop, which may be stale)
    const storeState = useImageStore.getState();
    const currentEntry = storeState.thumbnailEntries[image.id];
    const activeEntry = currentEntry && currentEntry.lastModified === image.lastModified ? currentEntry : undefined;

    if (activeEntry?.thumbnailStatus === 'ready' && activeEntry.thumbnailUrl) {
      return;
    }

    const existing = this.inflight.get(image.id);
    if (existing) {
      const queuedJobRef = this.findQueuedJob(image.id);
      if (queuedJobRef && priority === 'high' && queuedJobRef.queueName === 'low') {
        const [queuedJob] = this.backgroundQueue.splice(queuedJobRef.index, 1);
        if (queuedJob) {
          queuedJob.priority = 'high';
          queuedJob.markLoading = queuedJob.markLoading || (options.markLoading ?? true);
          this.highPriorityQueue.unshift(queuedJob);
        }
      } else if (queuedJobRef && priority === 'high' && queuedJobRef.queueName === 'high') {
        const queuedJob = this.highPriorityQueue[queuedJobRef.index];
        if (queuedJob) {
          queuedJob.markLoading = queuedJob.markLoading || (options.markLoading ?? true);
        }
      }
      this.processQueues();
      return existing;
    }

    // Bump token to invalidate older queued/processing jobs for the same image
    const token = this.nextToken(image.id);
    this.dropQueuedJobs(image.id);

    const promise = new Promise<void>((resolve, reject) => {
      const job: ThumbnailJob = {
        image,
        token,
        priority,
        markLoading: options.markLoading ?? true,
        resolve,
        reject,
      };
      if (priority === 'high') {
        this.highPriorityQueue.unshift(job);
      } else {
        this.backgroundQueue.push(job);
      }
      this.processQueues();
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
    if (this.highPriorityQueue.length > 0) {
      this.highPriorityQueue = this.highPriorityQueue.filter(job => job.image.id !== imageId);
    }
    if (this.backgroundQueue.length > 0) {
      this.backgroundQueue = this.backgroundQueue.filter(job => job.image.id !== imageId);
    }
  }

  private isStale(imageId: string, token: number): boolean {
    return this.requestTokens.get(imageId) !== token;
  }

  private findQueuedJob(imageId: string): { queueName: 'high' | 'low'; index: number } | null {
    const highIndex = this.highPriorityQueue.findIndex(job => job.image.id === imageId);
    if (highIndex !== -1) {
      return { queueName: 'high', index: highIndex };
    }

    const lowIndex = this.backgroundQueue.findIndex(job => job.image.id === imageId);
    if (lowIndex !== -1) {
      return { queueName: 'low', index: lowIndex };
    }

    return null;
  }

  private get activeWorkers(): number {
    return this.activeHighPriorityWorkers + this.activeBackgroundWorkers;
  }

  private processQueues() {
    while (
      this.activeWorkers < MAX_CONCURRENT_THUMBNAILS &&
      this.activeHighPriorityWorkers < MAX_CONCURRENT_HIGH_PRIORITY_THUMBNAILS &&
      this.highPriorityQueue.length > 0
    ) {
      const job = this.highPriorityQueue.shift();
      if (!job) break;
      this.startJob(job, 'high');
    }

    while (
      this.activeWorkers < MAX_CONCURRENT_THUMBNAILS &&
      this.activeBackgroundWorkers < MAX_CONCURRENT_BACKGROUND_THUMBNAILS &&
      this.backgroundQueue.length > 0
    ) {
      const job = this.backgroundQueue.shift();
      if (!job) break;
      this.startJob(job, 'low');
    }

    while (
      this.activeWorkers < MAX_CONCURRENT_THUMBNAILS &&
      this.highPriorityQueue.length > 0
    ) {
      const job = this.highPriorityQueue.shift();
      if (!job) break;
      this.startJob(job, 'high');
    }
  }

  private startJob(job: ThumbnailJob, queueName: 'high' | 'low') {
    if (this.isStale(job.image.id, job.token)) {
      job.resolve();
      return;
    }

    if (queueName === 'high') {
      this.activeHighPriorityWorkers++;
    } else {
      this.activeBackgroundWorkers++;
    }

    this.loadThumbnail(job.image, job.token, job.markLoading)
      .then(() => job.resolve())
      .catch((err) => job.reject(err))
      .finally(() => {
        if (!this.isStale(job.image.id, job.token)) {
          this.inflight.delete(job.image.id);
        }

        if (queueName === 'high') {
          this.activeHighPriorityWorkers--;
        } else {
          this.activeBackgroundWorkers--;
        }

        this.processQueues();
      });
  }

  private async loadThumbnail(image: IndexedImage, token: number, markLoading: boolean): Promise<void> {
    const setImageThumbnail = useImageStore.getState().setImageThumbnail;
    const setSafe = (payload: { status: 'loading' | 'ready' | 'error'; thumbnailUrl?: string | null; error?: string | null }) => {
      if (this.isStale(image.id, token)) return;
      setImageThumbnail(image.id, payload);
    };

    if (markLoading) {
      setSafe({ status: 'loading' });
    }

    try {
      if (image.thumbnailUrl) {
        setSafe({ status: 'ready', thumbnailUrl: image.thumbnailUrl });
        return;
      }

      // Create a cache key that includes validation data (timestamp)
      // This ensures we don't serve stale thumbnails if the file changes but path remains same
      const thumbnailKey = `${image.id}-${image.lastModified}`;

      const cachedBlob = await cacheManager.getCachedThumbnail(thumbnailKey);
      if (cachedBlob) {
        const url = this.updateObjectUrl(image.id, cachedBlob);
        setSafe({ status: 'ready', thumbnailUrl: url });
        return;
      }

      let blob: Blob | null = null;

      if (typeof window !== 'undefined' && window.electronAPI && !isVideoAsset(image)) {
        blob = await generateElectronThumbnailBlob(image);
      }

      if (!blob) {
        const file = await (image.thumbnailHandle ?? image.handle).getFile();
        blob = isVideoAsset(image, file)
          ? await generateVideoThumbnailBlob(file)
          : await generateThumbnailBlob(file);
      }

      if (!blob) {
        throw new Error('Thumbnail generation failed');
      }

      await cacheManager.cacheThumbnail(thumbnailKey, blob);
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
