import { IndexedImage, ThumbnailStatus } from '../types';
import cacheManager from './cacheManager';
import { isAudioFileName, isVideoFileName } from '../utils/mediaTypes.js';
import {
  getLegacyThumbnailId,
  getThumbnailCacheCandidate,
  getVersionedThumbnailId,
} from './thumbnailCache';
import {
  recordPerformanceCounter,
  recordPerformanceDuration,
} from '../utils/performanceDiagnostics';

const MAX_THUMBNAIL_EDGE = 320;
const MAX_CONCURRENT_THUMBNAILS = 5;
const MAX_CONCURRENT_HIGH_PRIORITY_THUMBNAILS = 3;
const MAX_CONCURRENT_BACKGROUND_THUMBNAILS = 1;
const MAX_ACTIVE_THUMBNAIL_URLS = 200;
const MAX_RENDERER_VIDEO_THUMBNAIL_BYTES = 80 * 1024 * 1024;

type ElectronFileHandle = FileSystemFileHandle & { _filePath?: string };

type RuntimeThumbnailState = {
  lastModified: number;
  thumbnailUrl: string | null;
  thumbnailStatus: ThumbnailStatus;
  thumbnailError: string | null;
};

type ThumbnailJob = {
  image: IndexedImage;
  token: number;
  priority: 'high' | 'low';
  markLoading: boolean;
  skipCacheLookup: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type ViewportSchedule = {
  visibleImages: IndexedImage[];
  aheadImages?: IndexedImage[];
  keepImageIds?: Set<string>;
  cancelQueue?: 'low' | 'all';
};

const isVideoAsset = (image: IndexedImage, file?: File): boolean => {
  return isVideoFileName(image.name, image.fileType) || (file ? isVideoFileName(file.name, file.type) : false);
};

const isAudioAsset = (image: IndexedImage, file?: File): boolean => {
  return isAudioFileName(image.name, image.fileType) || (file ? isAudioFileName(file.name, file.type) : false);
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
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
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

    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
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

  return new Blob([new Uint8Array(result.data)], { type: result.mimeType || 'image/jpeg' });
}

class ThumbnailManager {
  private inflight = new Map<string, Promise<void>>();
  private activeUrls = new Map<string, string>();
  private runtimeState = new Map<string, RuntimeThumbnailState>();
  private resolvedStateCache = new Map<string, {
    lastModified: number;
    thumbnailUrl: string | null;
    thumbnailHandle: FileSystemFileHandle | null;
    thumbnailStatus: ThumbnailStatus;
    thumbnailError: string | null;
    snapshot: {
      thumbnailUrl: string | null;
      thumbnailHandle: FileSystemFileHandle | null;
      thumbnailStatus: ThumbnailStatus;
      thumbnailError: string | null;
    };
  }>();
  private listeners = new Map<string, Set<() => void>>();
  private highPriorityQueue: ThumbnailJob[] = [];
  private backgroundQueue: ThumbnailJob[] = [];
  private activeHighPriorityWorkers = 0;
  private activeBackgroundWorkers = 0;
  private requestTokens = new Map<string, number>();
  private requestCounter = 0;
  private warmupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private warmupTokens = new Map<string, number>();
  private backgroundPauseCount = 0;
  private viewportScheduleToken = 0;
  private pendingEmitIds = new Set<string>();
  private emitFrame: number | null = null;

  subscribe(imageId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(imageId);
    if (listeners) {
      listeners.add(listener);
    } else {
      this.listeners.set(imageId, new Set([listener]));
    }

    return () => {
      const currentListeners = this.listeners.get(imageId);
      if (!currentListeners) {
        return;
      }

      currentListeners.delete(listener);
      if (currentListeners.size === 0) {
        this.listeners.delete(imageId);
      }
    };
  }

  getResolvedState(
    image: IndexedImage | null
  ): {
    thumbnailUrl: string | null;
    thumbnailHandle: FileSystemFileHandle | null;
    thumbnailStatus: ThumbnailStatus;
    thumbnailError: string | null;
  } | null {
    if (!image) {
      return null;
    }

    const runtimeState = this.getActiveRuntimeState(image);
    const nextThumbnailUrl = runtimeState?.thumbnailUrl ?? image.thumbnailUrl ?? null;
    const nextThumbnailHandle = image.thumbnailHandle ?? null;
    const nextThumbnailStatus = runtimeState?.thumbnailStatus ?? image.thumbnailStatus ?? 'pending';
    const nextThumbnailError = runtimeState?.thumbnailError ?? image.thumbnailError ?? null;
    const cachedState = this.resolvedStateCache.get(image.id);

    if (
      cachedState &&
      cachedState.lastModified === image.lastModified &&
      cachedState.thumbnailUrl === nextThumbnailUrl &&
      cachedState.thumbnailHandle === nextThumbnailHandle &&
      cachedState.thumbnailStatus === nextThumbnailStatus &&
      cachedState.thumbnailError === nextThumbnailError
    ) {
      return cachedState.snapshot;
    }

    const snapshot = {
      thumbnailUrl: nextThumbnailUrl,
      thumbnailHandle: nextThumbnailHandle,
      thumbnailStatus: nextThumbnailStatus,
      thumbnailError: nextThumbnailError,
    };

    this.resolvedStateCache.set(image.id, {
      lastModified: image.lastModified,
      thumbnailUrl: nextThumbnailUrl,
      thumbnailHandle: nextThumbnailHandle,
      thumbnailStatus: nextThumbnailStatus,
      thumbnailError: nextThumbnailError,
      snapshot,
    });

    return snapshot;
  }

  scheduleViewport({
    visibleImages,
    aheadImages = [],
    keepImageIds,
    cancelQueue = 'all',
  }: ViewportSchedule): void {
    const nextVisible = this.dedupeImages(visibleImages);
    const nextAhead = this.dedupeImages(aheadImages, new Set(nextVisible.map((image) => image.id)));
    const retainedIds = keepImageIds ?? new Set([...nextVisible, ...nextAhead].map((image) => image.id));
    const scheduleToken = ++this.viewportScheduleToken;

    this.cancelQueuedJobs({ queue: cancelQueue, keepImageIds: retainedIds });
    const supportsUrlCacheLookup = typeof window !== 'undefined' && Boolean(window.electronAPI?.resolveThumbnailCacheBatch);
    if (!supportsUrlCacheLookup) {
      this.prefetchImages(nextVisible, 'high', { markLoading: false });
      this.prefetchImages(nextAhead, 'low', { markLoading: false });
      return;
    }

    void this.resolveAndQueueViewport(nextVisible, nextAhead, scheduleToken).catch((error) => {
      console.error('Failed to schedule thumbnail viewport:', error);
      if (this.viewportScheduleToken !== scheduleToken) {
        return;
      }
      this.prefetchImages(nextVisible, 'high', { markLoading: false });
      this.prefetchImages(nextAhead, 'low', { markLoading: false });
    });
  }

  private async resolveAndQueueViewport(
    visibleImages: IndexedImage[],
    aheadImages: IndexedImage[],
    scheduleToken: number
  ): Promise<void> {
    const visibleStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const visibleMisses = await this.resolveCachedThumbnailBatch(visibleImages, {
      priority: 'visible',
    });

    recordPerformanceDuration(
      'thumbnail.viewport.visible-cache-lookup',
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - visibleStartedAt,
      {
        requested: visibleImages.length,
        misses: visibleMisses.length,
      }
    );

    if (this.viewportScheduleToken !== scheduleToken) {
      return;
    }

    this.prefetchImages(visibleMisses, 'high', { markLoading: false, skipCacheLookup: true });

    if (visibleMisses.some((image) => !this.hasReadyThumbnail(image))) {
      recordPerformanceCounter('thumbnail.viewport.defer-overscan', {
        visibleMisses: visibleMisses.length,
        overscanCount: aheadImages.length,
      });
      return;
    }

    const aheadMisses = await this.resolveCachedThumbnailBatch(aheadImages, {
      priority: 'overscan',
    });

    if (this.viewportScheduleToken !== scheduleToken) {
      return;
    }

    this.prefetchImages(aheadMisses, 'low', { markLoading: false, skipCacheLookup: true });
  }

  pauseBackgroundWork(): () => void {
    this.backgroundPauseCount++;

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.backgroundPauseCount = Math.max(0, this.backgroundPauseCount - 1);
      this.processQueues();
    };
  }

  cancelQueuedJobs(options: { queue?: 'high' | 'low' | 'all'; keepImageIds?: Set<string> } = {}): void {
    const queue = options.queue ?? 'all';
    const keepImageIds = options.keepImageIds;

    const shouldKeep = (job: ThumbnailJob) => keepImageIds?.has(job.image.id) ?? false;
    const releaseJob = (job: ThumbnailJob) => {
      if (!shouldKeep(job) && !this.isStale(job.image.id, job.token)) {
        this.inflight.delete(job.image.id);
      }
      job.resolve();
    };

    if (queue === 'all' || queue === 'high') {
      const nextHigh: ThumbnailJob[] = [];
      for (const job of this.highPriorityQueue) {
        if (shouldKeep(job)) {
          nextHigh.push(job);
        } else {
          releaseJob(job);
        }
      }
      this.highPriorityQueue = nextHigh;
    }

    if (queue === 'all' || queue === 'low') {
      const nextLow: ThumbnailJob[] = [];
      for (const job of this.backgroundQueue) {
        if (shouldKeep(job)) {
          nextLow.push(job);
        } else {
          releaseJob(job);
        }
      }
      this.backgroundQueue = nextLow;
    }
  }

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
    const deduped = this.dedupeImages(images);

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

      if (this.backgroundPauseCount > 0) {
        const timer = setTimeout(runChunk, Math.max(delayMs, 50));
        this.warmupTimers.set(scopeKey, timer);
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
    options: { markLoading?: boolean; skipCacheLookup?: boolean } = {}
  ): void {
    if (!images || images.length === 0) {
      return;
    }

    for (const image of this.dedupeImages(images)) {
      void this.ensureThumbnail(image, priority, {
        markLoading: options.markLoading ?? false,
        skipCacheLookup: options.skipCacheLookup ?? false,
      }).catch(() => {
        // Visible viewport work is retried when the item is scheduled again.
      });
    }
  }

  async ensureThumbnail(
    image: IndexedImage,
    priority: 'high' | 'low' = 'high',
    options: { markLoading?: boolean; skipCacheLookup?: boolean } = {}
  ): Promise<void> {
    if (!image?.id) {
      return;
    }

    const activeState = this.getActiveRuntimeState(image);
    if (activeState?.thumbnailStatus === 'ready' && activeState.thumbnailUrl) {
      this.touchObjectUrl(image.id);
      return;
    }

    if (!activeState && image.thumbnailStatus === 'ready' && image.thumbnailUrl) {
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

    const token = this.nextToken(image.id);
    this.dropQueuedJobs(image.id);

    const promise = new Promise<void>((resolve, reject) => {
      const job: ThumbnailJob = {
        image,
        token,
        priority,
        markLoading: options.markLoading ?? true,
        skipCacheLookup: options.skipCacheLookup ?? false,
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

  private hasReadyThumbnail(image: IndexedImage): boolean {
    const activeState = this.getActiveRuntimeState(image);
    return Boolean(
      (activeState?.thumbnailStatus === 'ready' && activeState.thumbnailUrl) ||
      (!activeState && image.thumbnailStatus === 'ready' && image.thumbnailUrl)
    );
  }

  private async resolveCachedThumbnailBatch(
    images: IndexedImage[],
    detail: { priority: 'visible' | 'overscan' | 'single' }
  ): Promise<IndexedImage[]> {
    const candidates = this.dedupeImages(images)
      .filter((image) => !this.hasReadyThumbnail(image) && !isAudioAsset(image))
      .map((image) => getThumbnailCacheCandidate(image));

    if (candidates.length === 0) {
      return [];
    }

    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const batch = await cacheManager.resolveCachedThumbnails(candidates);
    const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;

    if (!batch) {
      return images;
    }

    const misses: IndexedImage[] = [];
    const imagesById = new Map(images.map((image) => [image.id, image]));

    for (const candidate of candidates) {
      const image = imagesById.get(candidate.requestId);
      if (!image) {
        continue;
      }

      const result = batch.results[candidate.requestId];
      if (result?.hit && result.url) {
        this.setRuntimeState(image, {
          thumbnailStatus: 'ready',
          thumbnailUrl: result.url,
          thumbnailError: null,
        });
      } else {
        misses.push(image);
      }
    }

    recordPerformanceDuration('thumbnail.cache-batch.resolve', durationMs, {
      priority: detail.priority,
      requested: candidates.length,
      hits: candidates.length - misses.length,
      misses: misses.length,
      mainProcessMs: batch.stats?.durationMs,
    });

    return misses;
  }

  private dedupeImages(images: IndexedImage[], seedIds?: Set<string>): IndexedImage[] {
    const seenIds = seedIds ?? new Set<string>();
    const deduped: IndexedImage[] = [];

    for (const image of images) {
      if (!image?.id || seenIds.has(image.id)) {
        continue;
      }
      seenIds.add(image.id);
      deduped.push(image);
    }

    return deduped;
  }

  private emit(imageId: string): void {
    this.pendingEmitIds.add(imageId);
    if (this.emitFrame !== null) {
      return;
    }

    const flush = () => {
      this.emitFrame = null;
      const imageIds = Array.from(this.pendingEmitIds);
      this.pendingEmitIds.clear();

      for (const pendingImageId of imageIds) {
        this.emitNow(pendingImageId);
      }
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      this.emitFrame = window.requestAnimationFrame(flush);
    } else {
      this.emitFrame = window.setTimeout(flush, 0);
    }
  }

  private emitNow(imageId: string): void {
    const listeners = this.listeners.get(imageId);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener();
    }
  }

  private getActiveRuntimeState(image: IndexedImage): RuntimeThumbnailState | undefined {
    const runtimeState = this.runtimeState.get(image.id);
    if (!runtimeState) {
      return undefined;
    }

    if (runtimeState.lastModified !== image.lastModified) {
      this.runtimeState.delete(image.id);
      this.resolvedStateCache.delete(image.id);
      return undefined;
    }

    return runtimeState;
  }

  private setRuntimeState(
    image: IndexedImage,
    payload: {
      thumbnailUrl?: string | null;
      thumbnailStatus: ThumbnailStatus;
      thumbnailError?: string | null;
    }
  ): void {
    const currentState = this.getActiveRuntimeState(image);
    const nextState: RuntimeThumbnailState = {
      lastModified: image.lastModified,
      thumbnailUrl: payload.thumbnailUrl ?? currentState?.thumbnailUrl ?? image.thumbnailUrl ?? null,
      thumbnailStatus: payload.thumbnailStatus,
      thumbnailError: payload.thumbnailError ?? (payload.thumbnailStatus === 'error'
        ? 'Failed to load thumbnail'
        : currentState?.thumbnailError ?? image.thumbnailError ?? null),
    };

    if (
      currentState &&
      currentState.thumbnailUrl === nextState.thumbnailUrl &&
      currentState.thumbnailStatus === nextState.thumbnailStatus &&
      currentState.thumbnailError === nextState.thumbnailError
    ) {
      return;
    }

    this.runtimeState.set(image.id, nextState);
    this.emit(image.id);
  }

  private nextToken(imageId: string): number {
    const next = ++this.requestCounter;
    this.requestTokens.set(imageId, next);
    return next;
  }

  private dropQueuedJobs(imageId: string): void {
    if (this.highPriorityQueue.length > 0) {
      this.highPriorityQueue = this.highPriorityQueue.filter((job) => job.image.id !== imageId);
    }
    if (this.backgroundQueue.length > 0) {
      this.backgroundQueue = this.backgroundQueue.filter((job) => job.image.id !== imageId);
    }
  }

  private isStale(imageId: string, token: number): boolean {
    return this.requestTokens.get(imageId) !== token;
  }

  private findQueuedJob(imageId: string): { queueName: 'high' | 'low'; index: number } | null {
    const highIndex = this.highPriorityQueue.findIndex((job) => job.image.id === imageId);
    if (highIndex !== -1) {
      return { queueName: 'high', index: highIndex };
    }

    const lowIndex = this.backgroundQueue.findIndex((job) => job.image.id === imageId);
    if (lowIndex !== -1) {
      return { queueName: 'low', index: lowIndex };
    }

    return null;
  }

  private get activeWorkers(): number {
    return this.activeHighPriorityWorkers + this.activeBackgroundWorkers;
  }

  private processQueues(): void {
    while (
      this.activeWorkers < MAX_CONCURRENT_THUMBNAILS &&
      this.activeHighPriorityWorkers < MAX_CONCURRENT_HIGH_PRIORITY_THUMBNAILS &&
      this.highPriorityQueue.length > 0
    ) {
      const job = this.highPriorityQueue.shift();
      if (!job) {
        break;
      }
      this.startJob(job, 'high');
    }

    while (
      this.backgroundPauseCount === 0 &&
      this.activeWorkers < MAX_CONCURRENT_THUMBNAILS &&
      this.activeBackgroundWorkers < MAX_CONCURRENT_BACKGROUND_THUMBNAILS &&
      this.backgroundQueue.length > 0
    ) {
      const job = this.backgroundQueue.shift();
      if (!job) {
        break;
      }
      this.startJob(job, 'low');
    }

    while (
      this.activeWorkers < MAX_CONCURRENT_THUMBNAILS &&
      this.highPriorityQueue.length > 0
    ) {
      const job = this.highPriorityQueue.shift();
      if (!job) {
        break;
      }
      this.startJob(job, 'high');
    }
  }

  private startJob(job: ThumbnailJob, queueName: 'high' | 'low'): void {
    if (this.isStale(job.image.id, job.token)) {
      job.resolve();
      return;
    }

    if (queueName === 'high') {
      this.activeHighPriorityWorkers++;
    } else {
      this.activeBackgroundWorkers++;
    }

    this.loadThumbnail(job.image, job.token, job.markLoading, job.skipCacheLookup)
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

  private async loadThumbnail(
    image: IndexedImage,
    token: number,
    markLoading: boolean,
    skipCacheLookup: boolean
  ): Promise<void> {
    const setSafe = (payload: {
      thumbnailUrl?: string | null;
      thumbnailStatus: ThumbnailStatus;
      thumbnailError?: string | null;
    }) => {
      if (this.isStale(image.id, token)) {
        return;
      }
      this.setRuntimeState(image, payload);
    };

    if (markLoading) {
      setSafe({ thumbnailStatus: 'loading' });
    }

    try {
      if (image.thumbnailUrl) {
        setSafe({ thumbnailStatus: 'ready', thumbnailUrl: image.thumbnailUrl, thumbnailError: null });
        return;
      }

      if (isAudioAsset(image)) {
        setSafe({ thumbnailStatus: 'ready', thumbnailUrl: null, thumbnailError: null });
        return;
      }

      const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
      const isElectron = Boolean(electronAPI);
      const supportsUrlCacheLookup = Boolean(electronAPI?.resolveThumbnailCacheBatch);

      if (!skipCacheLookup && supportsUrlCacheLookup) {
        const misses = await this.resolveCachedThumbnailBatch([image], { priority: 'single' });
        if (misses.length === 0) {
          return;
        }
      } else if (!skipCacheLookup) {
        const thumbnailKey = getVersionedThumbnailId(image);
        const legacyThumbnailKey = getLegacyThumbnailId(image);
        let cachedBlob = await cacheManager.getCachedThumbnail(thumbnailKey);
        cachedBlob = cachedBlob || (await cacheManager.getCachedThumbnail(legacyThumbnailKey));
        if (cachedBlob) {
          const url = this.updateObjectUrl(image.id, cachedBlob);
          setSafe({ thumbnailStatus: 'ready', thumbnailUrl: url, thumbnailError: null });
          return;
        }
      }

      let blob: Blob | null = null;
      const isVideo = isVideoAsset(image);
      const fileSize = image.fileSize;

      if (isElectron && isVideo && (!fileSize || fileSize > MAX_RENDERER_VIDEO_THUMBNAIL_BYTES)) {
        setSafe({ thumbnailStatus: 'ready', thumbnailUrl: null, thumbnailError: null });
        return;
      }

      if (isElectron && !isVideo) {
        const fileHandle = (image.thumbnailHandle ?? image.handle) as ElectronFileHandle | undefined;
        const filePath = fileHandle?._filePath;
        if (filePath) {
          const generated = await cacheManager.generateThumbnailToCache({
            ...getThumbnailCacheCandidate(image),
            filePath,
            maxEdge: MAX_THUMBNAIL_EDGE,
            quality: 82,
          });

          if (generated?.url) {
            setSafe({ thumbnailStatus: 'ready', thumbnailUrl: generated.url, thumbnailError: null });
            recordPerformanceCounter('thumbnail.generated-to-cache', {
              imageId: image.id,
              imageName: image.name,
              source: 'electron-main',
            });
            return;
          }
        }

        if (!electronAPI?.generateThumbnailToCache) {
          blob = await generateElectronThumbnailBlob(image);
        }
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

      await cacheManager.cacheThumbnail(getVersionedThumbnailId(image), blob);
      const url = this.updateObjectUrl(image.id, blob);
      setSafe({ thumbnailStatus: 'ready', thumbnailUrl: url, thumbnailError: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown thumbnail error';
      setSafe({ thumbnailStatus: 'error', thumbnailError: message });
    }
  }

  private updateObjectUrl(imageId: string, blob: Blob): string {
    const existing = this.activeUrls.get(imageId);
    if (existing) {
      URL.revokeObjectURL(existing);
      this.clearRuntimeObjectUrl(imageId, existing);
    }

    const url = URL.createObjectURL(blob);
    this.activeUrls.delete(imageId);
    this.activeUrls.set(imageId, url);
    this.evictOverflowUrls();
    return url;
  }

  private touchObjectUrl(imageId: string): void {
    const existing = this.activeUrls.get(imageId);
    if (!existing) {
      return;
    }

    this.activeUrls.delete(imageId);
    this.activeUrls.set(imageId, existing);
  }

  private evictOverflowUrls(): void {
    while (this.activeUrls.size > MAX_ACTIVE_THUMBNAIL_URLS) {
      const oldest = this.activeUrls.entries().next().value as [string, string] | undefined;
      if (!oldest) {
        return;
      }

      const [imageId, url] = oldest;
      this.activeUrls.delete(imageId);
      URL.revokeObjectURL(url);
      this.clearRuntimeObjectUrl(imageId, url);
    }
  }

  private clearRuntimeObjectUrl(imageId: string, revokedUrl: string): void {
    const currentState = this.runtimeState.get(imageId);
    if (!currentState || currentState.thumbnailUrl !== revokedUrl) {
      return;
    }

    this.runtimeState.set(imageId, {
      ...currentState,
      thumbnailUrl: null,
      thumbnailStatus: 'pending',
      thumbnailError: null,
    });
    this.emit(imageId);
  }
}

export const thumbnailManager = new ThumbnailManager();
