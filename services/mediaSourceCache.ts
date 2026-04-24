import { IndexedImage } from '../types';
import { thumbnailManager } from './thumbnailManager';
import { inferMimeTypeFromName, isAudioFileName, isVideoFileName } from '../utils/mediaTypes.js';
import {
  recordPerformanceCounter,
  recordPerformanceDuration,
} from '../utils/performanceDiagnostics';

type CacheEntry = {
  url: string;
  loading?: Promise<string>;
  lastAccess: number;
  revokeOnEvict: boolean;
  kind: 'stream-url' | 'object-url';
};

type MediaSourceLoadOptions = {
  prioritize?: boolean;
};

const MAX_STREAM_URL_CACHE_ENTRIES = 64;
const MAX_OBJECT_URL_CACHE_ENTRIES = 16;
const MAX_RENDERER_READ_BYTES = 200 * 1024 * 1024;
type ElectronFileHandle = FileSystemFileHandle & { _filePath?: string };

const getFileDataByteLength = (data: unknown): number | undefined => {
  if (typeof data === 'string') {
    return Math.ceil((data.length * 3) / 4);
  }

  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }

  if (ArrayBuffer.isView(data)) {
    return data.byteLength;
  }

  if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as { data: unknown }).data)) {
    return (data as { data: number[] }).data.length;
  }

  return undefined;
};

const createImageUrlFromFileData = (data: unknown, fileName: string): { url: string; revoke: boolean } => {
  const mimeType = inferMimeTypeFromName(fileName, 'image/png');

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

export const getElectronAbsoluteMediaPath = (image: IndexedImage): string | null => {
  const primaryHandle = image.handle as ElectronFileHandle | undefined;
  const fallbackHandle = image.thumbnailHandle as ElectronFileHandle | undefined;
  const absolutePath = primaryHandle?._filePath || fallbackHandle?._filePath || null;
  return typeof absolutePath === 'string' && absolutePath.trim().length > 0 ? absolutePath : null;
};

class MediaSourceCache {
  private entries = new Map<string, CacheEntry>();

  async getOrLoad(
    image: IndexedImage,
    directoryPath?: string,
    options: MediaSourceLoadOptions = {}
  ): Promise<string> {
    const requestStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const cacheKey = this.getCacheKey(image, directoryPath);
    const existing = this.entries.get(cacheKey);

    if (existing?.url) {
      existing.lastAccess = Date.now();
      recordPerformanceDuration('media-source-cache.get-or-load', (typeof performance !== 'undefined' ? performance.now() : Date.now()) - requestStartedAt, {
        imageId: image.id,
        cacheKey,
        source: 'memory-hit',
        cacheSize: this.entries.size,
      });
      return existing.url;
    }

    if (existing?.loading) {
      existing.lastAccess = Date.now();
      if (!options.prioritize) {
        recordPerformanceCounter('media-source-cache.pending-hit', {
          imageId: image.id,
          cacheKey,
          prioritized: false,
        });
        return existing.loading;
      }

      const releaseBackgroundPause = thumbnailManager.pauseBackgroundWork();
      try {
        recordPerformanceCounter('media-source-cache.pending-hit', {
          imageId: image.id,
          cacheKey,
          prioritized: true,
        });
        return await existing.loading;
      } finally {
        releaseBackgroundPause();
      }
    }

    const releaseBackgroundPause = options.prioritize
      ? thumbnailManager.pauseBackgroundWork()
      : null;

    const loading = this.loadSource(image, directoryPath)
      .then(({ url, revoke, detail }) => {
        this.entries.set(cacheKey, {
          url,
          lastAccess: Date.now(),
          revokeOnEvict: revoke,
          kind: detail.urlKind,
        });
        this.prune();
        recordPerformanceDuration('media-source-cache.get-or-load', (typeof performance !== 'undefined' ? performance.now() : Date.now()) - requestStartedAt, {
          imageId: image.id,
          cacheKey,
          source: 'miss',
          prioritized: options.prioritize ?? false,
          cacheSize: this.entries.size,
          ...detail,
        });
        return url;
      })
      .catch((error) => {
        this.entries.delete(cacheKey);
        recordPerformanceCounter('media-source-cache.load-error', {
          imageId: image.id,
          cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
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
      kind: 'object-url',
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
  ): Promise<{ url: string; revoke: boolean; detail: Record<string, unknown> & { urlKind: 'stream-url' | 'object-url' } }> {
    const loadStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const electronAbsoluteMediaPath = window.electronAPI ? getElectronAbsoluteMediaPath(image) : null;
    const primaryHandle = image.handle;
    const fallbackHandle = image.thumbnailHandle;
    const fileHandle =
      primaryHandle && typeof primaryHandle.getFile === 'function'
        ? primaryHandle
        : fallbackHandle && typeof fallbackHandle.getFile === 'function'
          ? fallbackHandle
          : null;
    const isLargeStreamingMedia =
      isVideoFileName(image.name, image.fileType) || isAudioFileName(image.name, image.fileType);

    if (window.electronAPI) {
      let absolutePath = electronAbsoluteMediaPath;
      let joinPathMs: number | undefined;

      if (!absolutePath && directoryPath) {
        const relativeImagePath = getRelativeImagePath(image);
        const joinStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const pathResult = await window.electronAPI.joinPaths(directoryPath, relativeImagePath);
        joinPathMs = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - joinStartedAt) * 100) / 100;
        if (!pathResult.success || !pathResult.path) {
          throw new Error(pathResult.error || 'Failed to construct image path.');
        }
        absolutePath = pathResult.path;
      }

      if (absolutePath && window.electronAPI.resolveMediaUrl) {
        const resolveStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const resolvedUrl = await window.electronAPI.resolveMediaUrl(absolutePath);
        if (resolvedUrl.success && resolvedUrl.url) {
          return {
            url: resolvedUrl.url,
            revoke: false,
            detail: {
              urlKind: 'stream-url',
              sourceMode: 'electron-resolved-url',
              usedHandlePath: Boolean(electronAbsoluteMediaPath),
              joinPathMs,
              resolveUrlMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - resolveStartedAt) * 100) / 100,
              totalLoadMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - loadStartedAt) * 100) / 100,
            },
          };
        }

        recordPerformanceCounter('media-source-cache.resolve-url-fallback', {
          imageId: image.id,
          error: resolvedUrl.error || 'unknown',
          errorType: resolvedUrl.errorType,
        });
      }

      if (absolutePath) {
        if (isLargeStreamingMedia) {
          if (fileHandle) {
            const getFileStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const file = await fileHandle.getFile();
            const objectUrlStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const url = URL.createObjectURL(file);
            return {
              url,
              revoke: true,
              detail: {
                urlKind: 'object-url',
                sourceMode: 'file-handle-large-media-fallback',
                fileSize: file.size,
                usedHandlePath: Boolean(electronAbsoluteMediaPath),
                joinPathMs,
                getFileMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - getFileStartedAt) * 100) / 100,
                objectUrlMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - objectUrlStartedAt) * 100) / 100,
                totalLoadMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - loadStartedAt) * 100) / 100,
              },
            };
          }

          throw new Error('Could not create streaming media URL; refusing to read full media file into renderer memory.');
        }

        const readStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const fileResult = await window.electronAPI.readFile(absolutePath);
        if (!fileResult.success || !fileResult.data) {
          throw new Error(fileResult.error || 'Failed to read file via Electron API.');
        }

        const byteLength = getFileDataByteLength(fileResult.data);
        if (byteLength !== undefined && byteLength > MAX_RENDERER_READ_BYTES) {
          throw new Error(`Refusing to load ${Math.round(byteLength / 1024 / 1024)}MB file into renderer memory.`);
        }

        const createUrlStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const created = createImageUrlFromFileData(fileResult.data, image.name);
        return {
          ...created,
          detail: {
            urlKind: 'object-url',
            sourceMode: 'electron-read-file',
            fileSize: byteLength,
            usedHandlePath: Boolean(electronAbsoluteMediaPath),
            joinPathMs,
            readFileMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - readStartedAt) * 100) / 100,
            createUrlMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - createUrlStartedAt) * 100) / 100,
            totalLoadMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - loadStartedAt) * 100) / 100,
          },
        };
      }
    }

    if (fileHandle) {
      const getFileStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const file = await fileHandle.getFile();
      const objectUrlStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const url = URL.createObjectURL(file);
      return {
        url,
        revoke: true,
        detail: {
          urlKind: 'object-url',
          sourceMode: 'file-handle',
          fileSize: file.size,
          getFileMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - getFileStartedAt) * 100) / 100,
          objectUrlMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - objectUrlStartedAt) * 100) / 100,
          totalLoadMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - loadStartedAt) * 100) / 100,
        },
      };
    }

    throw new Error('No valid image source available.');
  }

  private prune(): void {
    this.pruneKind('stream-url', MAX_STREAM_URL_CACHE_ENTRIES);
    this.pruneKind('object-url', MAX_OBJECT_URL_CACHE_ENTRIES);
  }

  private pruneKind(kind: 'stream-url' | 'object-url', maxEntries: number): void {
    const sortedEntries = [...this.entries.entries()]
      .filter(([, entry]) => Boolean(entry.url) && entry.kind === kind)
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    while (sortedEntries.length > maxEntries) {
      const [cacheKey, entry] = sortedEntries.shift()!;
      this.entries.delete(cacheKey);
      if (entry.revokeOnEvict && entry.url) {
        URL.revokeObjectURL(entry.url);
      }
      recordPerformanceCounter('media-source-cache.evicted', {
        cacheKey,
        cacheSize: this.entries.size,
        kind,
        maxCacheEntries: maxEntries,
      });
    }
  }
}

export const mediaSourceCache = new MediaSourceCache();
