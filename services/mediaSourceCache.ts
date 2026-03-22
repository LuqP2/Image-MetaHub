import { IndexedImage } from '../types';
import { thumbnailManager } from './thumbnailManager';

type CacheEntry = {
  url: string;
  loading?: Promise<string>;
  lastAccess: number;
  revokeOnEvict: boolean;
};

type MediaSourceLoadOptions = {
  prioritize?: boolean;
};

const MAX_CACHE_ENTRIES = 12;

const resolveImageMimeType = (fileName: string): string => {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.mp4')) return 'video/mp4';
  if (lowerName.endsWith('.webm')) return 'video/webm';
  if (lowerName.endsWith('.mkv')) return 'video/x-matroska';
  if (lowerName.endsWith('.mov')) return 'video/quicktime';
  if (lowerName.endsWith('.avi')) return 'video/x-msvideo';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.gif')) return 'image/gif';
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
    const safeView = new Uint8Array(view);
    const blob = new Blob([safeView], { type: mimeType });
    return { url: URL.createObjectURL(blob), revoke: true };
  }

  if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as { data: unknown }).data)) {
    const view = new Uint8Array((data as { data: number[] }).data);
    const blob = new Blob([view], { type: mimeType });
    return { url: URL.createObjectURL(blob), revoke: true };
  }

  throw new Error('Unknown file data format.');
};

export const getRelativeImagePath = (image: IndexedImage): string => {
  const [, relativePath = ''] = image.id.split('::');
  return relativePath || image.name;
};

class MediaSourceCache {
  private entries = new Map<string, CacheEntry>();

  async getOrLoad(
    image: IndexedImage,
    directoryPath?: string,
    options: MediaSourceLoadOptions = {}
  ): Promise<string> {
    const cacheKey = this.getCacheKey(image, directoryPath);
    const existing = this.entries.get(cacheKey);

    if (existing?.url) {
      existing.lastAccess = Date.now();
      return existing.url;
    }

    if (existing?.loading) {
      return existing.loading;
    }

    const releaseBackgroundPause = options.prioritize
      ? thumbnailManager.pauseBackgroundWork()
      : null;

    const loading = this.loadSource(image, directoryPath)
      .then(({ url, revoke }) => {
        this.entries.set(cacheKey, {
          url,
          lastAccess: Date.now(),
          revokeOnEvict: revoke,
        });
        this.prune();
        return url;
      })
      .catch((error) => {
        this.entries.delete(cacheKey);
        throw error;
      })
      .finally(() => {
        releaseBackgroundPause?.();
      });

    this.entries.set(cacheKey, {
      url: '',
      loading,
      lastAccess: Date.now(),
      revokeOnEvict: false,
    });

    return loading;
  }

  prefetch(image: IndexedImage, directoryPath?: string): void {
    void this.getOrLoad(image, directoryPath).catch(() => {});
  }

  private getCacheKey(image: IndexedImage, directoryPath?: string): string {
    return `${directoryPath || ''}::${image.id}::${image.lastModified}`;
  }

  private async loadSource(
    image: IndexedImage,
    directoryPath?: string
  ): Promise<{ url: string; revoke: boolean }> {
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
      return { url: URL.createObjectURL(file), revoke: true };
    }

    if (window.electronAPI && directoryPath) {
      const relativeImagePath = getRelativeImagePath(image);
      const pathResult = await window.electronAPI.joinPaths(directoryPath, relativeImagePath);
      if (!pathResult.success || !pathResult.path) {
        throw new Error(pathResult.error || 'Failed to construct image path.');
      }

      const fileResult = await window.electronAPI.readFile(pathResult.path);
      if (!fileResult.success || !fileResult.data) {
        throw new Error(fileResult.error || 'Failed to read file via Electron API.');
      }

      return createImageUrlFromFileData(fileResult.data, image.name);
    }

    throw new Error('No valid image source available.');
  }

  private prune(): void {
    if (this.entries.size <= MAX_CACHE_ENTRIES) {
      return;
    }

    const sortedEntries = [...this.entries.entries()]
      .filter(([, entry]) => Boolean(entry.url))
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    while (this.entries.size > MAX_CACHE_ENTRIES && sortedEntries.length > 0) {
      const [cacheKey, entry] = sortedEntries.shift()!;
      this.entries.delete(cacheKey);
      if (entry.revokeOnEvict && entry.url) {
        URL.revokeObjectURL(entry.url);
      }
    }
  }
}

export const mediaSourceCache = new MediaSourceCache();
