import { type IndexedImage } from '../types';

/**
 * Parser version - increment when parser logic changes significantly
 * This ensures cache is invalidated when parsing rules change
 */
export const PARSER_VERSION = 3; // v3: Improved CLIPTextEncode to trace String Literal links, added model to SamplerCustomAdvanced

// Simplified metadata structure for the JSON cache
export interface CacheImageMetadata {
  id: string;
  name:string;
  metadataString: string;
  metadata: any;
  lastModified: number;
  models: string[];
  loras: string[] | (string | { name: string; model_name?: string; weight?: number; model_weight?: number; clip_weight?: number })[]; // Support both formats for backward compatibility
  scheduler: string;
  board?: string;
  prompt?: string;
  negativePrompt?: string;
  cfgScale?: number;
  steps?: number;
  seed?: number;
  dimensions?: string;
  enrichmentState?: 'catalog' | 'enriched';
  fileSize?: number;
  fileType?: string;

  // Smart Clustering & Auto-Tagging (Phase 1)
  clusterId?: string;
  clusterPosition?: number;
  autoTags?: string[];
  autoTagsGeneratedAt?: number;
}

// Main structure for the JSON cache file
export interface CacheEntry {
  id: string; // e.g., 'C:/Users/Jules/Pictures-recursive'
  directoryPath: string;
  directoryName: string;
  lastScan: number;
  imageCount: number;
  metadata: CacheImageMetadata[];
  chunkCount?: number;
  parserVersion?: number; // Track which parser version created this cache
}

export interface CacheDiff {
  newAndModifiedFiles: { name: string; lastModified: number; size?: number; type?: string; birthtimeMs?: number }[];
  deletedFileIds: string[];
  cachedImages: IndexedImage[];
  needsFullRefresh: boolean;
}

const DEFAULT_INCREMENTAL_CHUNK_SIZE = 1024;

function toCacheMetadata(images: IndexedImage[]): CacheImageMetadata[] {
  return images.map(img => ({
    id: img.id,
    name: img.name,
    metadataString: img.metadataString,
    metadata: img.metadata,
    lastModified: img.lastModified,
    models: img.models,
    loras: img.loras,
    scheduler: img.scheduler,
    board: img.board,
    prompt: img.prompt,
    negativePrompt: img.negativePrompt,
    cfgScale: img.cfgScale,
    steps: img.steps,
    seed: img.seed,
    dimensions: img.dimensions,
    enrichmentState: img.enrichmentState,
    fileSize: img.fileSize,
    fileType: img.fileType,

    // Smart Clustering & Auto-Tagging (Phase 1)
    clusterId: img.clusterId,
    clusterPosition: img.clusterPosition,
    autoTags: img.autoTags,
    autoTagsGeneratedAt: img.autoTagsGeneratedAt,
  }));
}

const isCloneError = (error: unknown): boolean => {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /clone|deserialize|DataCloneError|serialize|serializer/i.test(message);
};

const safeJsonClone = (value: unknown): any => {
  try {
    return JSON.parse(JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') {
        return val.toString();
      }
      if (val instanceof Map) {
        return Object.fromEntries(val);
      }
      if (val instanceof Set) {
        return Array.from(val);
      }
      if (val instanceof Date) {
        return val.toISOString();
      }
      if (ArrayBuffer.isView(val)) {
        const view = val as ArrayBufferView;
        return Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      }
      if (val instanceof ArrayBuffer) {
        return Array.from(new Uint8Array(val));
      }
      return val;
    }));
  } catch {
    return null;
  }
};

const sanitizeCacheMetadata = (
  metadata: CacheImageMetadata[],
  options: { forceClone?: boolean } = {}
): CacheImageMetadata[] => {
  const forceClone = options.forceClone ?? false;
  let didChange = false;

  const sanitized = metadata.map(entry => {
    if (!forceClone) {
      return entry;
    }

    didChange = true;
    return {
      ...entry,
      metadata: safeJsonClone(entry.metadata),
    };
  });

  return didChange ? sanitized : metadata;
};

class IncrementalCacheWriter {
  private chunkIndex = 0;
  private totalImages = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly cacheId: string;

  constructor(
    private readonly directoryPath: string,
    private readonly directoryName: string,
    private readonly scanSubfolders: boolean,
    private readonly chunkSize: number = DEFAULT_INCREMENTAL_CHUNK_SIZE
  ) {
    this.cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
  }

  get targetChunkSize(): number {
    return this.chunkSize;
  }

  async initialize(): Promise<void> {
    const result = await window.electronAPI?.prepareCacheWrite?.({ cacheId: this.cacheId });
    if (result && !result.success) {
      throw new Error(result.error || 'Failed to prepare cache write');
    }
  }

  async append(images: IndexedImage[], precomputed?: CacheImageMetadata[]): Promise<CacheImageMetadata[]> {
    if (!images || images.length === 0) {
      return [];
    }

    const metadata = precomputed ?? toCacheMetadata(images);
    let preparedMetadata = sanitizeCacheMetadata(metadata);
    const chunkNumber = this.chunkIndex++;
    this.totalImages += images.length;

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const result = await window.electronAPI?.writeCacheChunk?.({
          cacheId: this.cacheId,
          chunkIndex: chunkNumber,
          data: preparedMetadata,
        });
        if (result && !result.success) {
          throw new Error(result.error || 'Failed to write cache chunk');
        }
      } catch (err) {
        if (isCloneError(err)) {
          console.warn('[Cache] Cache chunk serialization failed, retrying with sanitized payload.', err);
          preparedMetadata = sanitizeCacheMetadata(metadata, { forceClone: true });
          const retry = await window.electronAPI?.writeCacheChunk?.({
            cacheId: this.cacheId,
            chunkIndex: chunkNumber,
            data: preparedMetadata,
          });
          if (retry && !retry.success) {
            console.error('[Cache] Failed to write cache chunk after sanitization:', retry.error);
            throw new Error(retry.error || 'Failed to write cache chunk');
          }
          return;
        }
        throw err;
      }
    });

    await this.writeQueue;
    return preparedMetadata;
  }

  async overwrite(chunkIndex: number, metadata: CacheImageMetadata[]): Promise<void> {
    if (!metadata) {
      return;
    }

    const preparedMetadata = sanitizeCacheMetadata(metadata);
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const result = await window.electronAPI?.writeCacheChunk?.({
          cacheId: this.cacheId,
          chunkIndex,
          data: preparedMetadata,
        });
        if (result && !result.success) {
          throw new Error(result.error || 'Failed to rewrite cache chunk');
        }
      } catch (err) {
        if (isCloneError(err)) {
          console.warn('[Cache] Cache chunk rewrite serialization failed, retrying with sanitized payload.', err);
          const sanitized = sanitizeCacheMetadata(metadata, { forceClone: true });
          metadata.splice(0, metadata.length, ...sanitized);
          const retry = await window.electronAPI?.writeCacheChunk?.({
            cacheId: this.cacheId,
            chunkIndex,
            data: sanitized,
          });
          if (retry && !retry.success) {
            console.error('[Cache] Failed to rewrite cache chunk after sanitization:', retry.error);
            throw new Error(retry.error || 'Failed to rewrite cache chunk');
          }
          return;
        }
        throw err;
      }
    });

    await this.writeQueue;
  }

  async finalize(): Promise<void> {
    await this.writeQueue;

    const record = {
      id: this.cacheId,
      directoryPath: this.directoryPath,
      directoryName: this.directoryName,
      lastScan: Date.now(),
      imageCount: this.totalImages,
      chunkCount: this.chunkIndex,
    } satisfies Omit<CacheEntry, 'metadata'>;

    const result = await window.electronAPI?.finalizeCacheWrite?.({ cacheId: this.cacheId, record });
    if (result && !result.success) {
      throw new Error(result.error || 'Failed to finalize cache write');
    }
  }
}

class CacheManager {
  private isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

  // No longer need init() for IndexedDB
  async init(): Promise<void> {
    if (!this.isElectron) {
      console.warn("JSON cache is only supported in Electron. Caching will be disabled.");
    }
    return Promise.resolve();
  }

  // Reads the entire cache from the JSON file via IPC
  async getCachedData(
    directoryPath: string,
    scanSubfolders: boolean,
  ): Promise<CacheEntry | null> {
    if (!this.isElectron) return null;

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const summaryFn = window.electronAPI.getCacheSummary ?? window.electronAPI.getCachedData;
    const result = await summaryFn(cacheId);

    if (!result.success) {
      console.error('Failed to get cached data:', result.error);
      return null;
    }

    const summary = result.data;
    if (!summary) {
      return null;
    }

    let metadata: CacheImageMetadata[] = Array.isArray(summary.metadata) ? summary.metadata : [];
    const chunkCount = summary.chunkCount ?? 0;

    if (metadata.length === 0 && chunkCount > 0) {
      const chunks: CacheImageMetadata[] = [];
      for (let i = 0; i < chunkCount; i++) {
        const chunkResult = await window.electronAPI.getCacheChunk({ cacheId, chunkIndex: i });
        if (chunkResult.success && Array.isArray(chunkResult.data)) {
          chunks.push(...chunkResult.data);
        } else if (!chunkResult.success) {
          console.error(`Failed to load cache chunk ${i} for ${cacheId}:`, chunkResult.error);
        }
      }
      metadata = chunks;
    }

    const cacheEntry: CacheEntry = {
      id: summary.id,
      directoryPath: summary.directoryPath,
      directoryName: summary.directoryName,
      lastScan: summary.lastScan,
      imageCount: summary.imageCount,
      metadata,
      chunkCount: summary.chunkCount,
    };

    return cacheEntry;
  }

  // (No-op) - This functionality is now implicit in getCachedData
  async iterateCachedMetadata(
    directoryPath: string,
    scanSubfolders: boolean,
    onChunk: (chunk: CacheImageMetadata[]) => void | Promise<void>
  ): Promise<void> {
    if (!this.isElectron) return;

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const summaryFn = window.electronAPI.getCacheSummary ?? window.electronAPI.getCachedData;
    const result = await summaryFn(cacheId);

    if (!result.success || !result.data) {
      if (!result.success) {
        console.error('Failed to iterate cached metadata:', result.error);
      }
      return;
    }

    const summary = result.data;
    if (Array.isArray(summary.metadata) && summary.metadata.length > 0) {
      await onChunk(summary.metadata);
      return;
    }

    const chunkCount = summary.chunkCount ?? 0;
    for (let i = 0; i < chunkCount; i++) {
      const chunkResult = await window.electronAPI.getCacheChunk({ cacheId, chunkIndex: i });
      if (chunkResult.success && Array.isArray(chunkResult.data) && chunkResult.data.length > 0) {
        await onChunk(chunkResult.data);
      } else if (!chunkResult.success) {
        console.error(`Failed to load cache chunk ${i} for ${cacheId}:`, chunkResult.error);
      }
    }
  }


  // Writes the entire cache to the JSON file via IPC
  async cacheData(
    directoryPath: string,
    directoryName: string,
    images: IndexedImage[],
    scanSubfolders: boolean
  ): Promise<void> {
    if (!this.isElectron) return;

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const metadata = sanitizeCacheMetadata(toCacheMetadata(images), { forceClone: true });
    
    const cacheEntry: CacheEntry = {
      id: cacheId,
      directoryPath,
      directoryName,
      lastScan: Date.now(),
      imageCount: images.length,
      metadata: metadata,
    };
    
    const result = await window.electronAPI.cacheData({ cacheId, data: cacheEntry });
    if (!result.success) {
      console.error("Failed to cache data:", result.error);
    }
  }

  async appendToCache(
    directoryPath: string,
    directoryName: string,
    images: IndexedImage[],
    scanSubfolders: boolean,
    options?: { chunkSize?: number }
  ): Promise<void> {
    if (!this.isElectron) return;
    if (!images || images.length === 0) return;

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const summaryFn = window.electronAPI.getCacheSummary ?? window.electronAPI.getCachedData;
    const summaryResult = await summaryFn(cacheId);

    if (!summaryResult.success || !summaryResult.data) {
      await this.cacheData(directoryPath, directoryName, images, scanSubfolders);
      return;
    }

    const summary = summaryResult.data as CacheEntry;
    const chunkSize = options?.chunkSize ?? DEFAULT_INCREMENTAL_CHUNK_SIZE;
    const metadata = sanitizeCacheMetadata(toCacheMetadata(images), { forceClone: true });

    let chunkIndex = summary.chunkCount ?? 0;
    for (let i = 0; i < metadata.length; i += chunkSize) {
      const chunk = metadata.slice(i, i + chunkSize);
      const result = await window.electronAPI.writeCacheChunk({
        cacheId,
        chunkIndex,
        data: chunk,
      });
      if (!result.success) {
        console.error('Failed to append cache chunk:', result.error);
        return;
      }
      chunkIndex += 1;
    }

    const record = {
      id: cacheId,
      directoryPath,
      directoryName: summary.directoryName ?? directoryName,
      lastScan: Date.now(),
      imageCount: (summary.imageCount ?? 0) + images.length,
      chunkCount: chunkIndex,
    } satisfies Omit<CacheEntry, 'metadata'>;

    const finalizeResult = await window.electronAPI.finalizeCacheWrite({ cacheId, record });
    if (!finalizeResult.success) {
      console.error('Failed to finalize appended cache write:', finalizeResult.error);
    }
  }

  async createIncrementalWriter(
    directoryPath: string,
    directoryName: string,
    scanSubfolders: boolean,
    options?: { chunkSize?: number }
  ): Promise<IncrementalCacheWriter | null> {
    if (!this.isElectron) return null;

    const writer = new IncrementalCacheWriter(
      directoryPath,
      directoryName,
      scanSubfolders,
      options?.chunkSize ?? DEFAULT_INCREMENTAL_CHUNK_SIZE
    );

    await writer.initialize();
    return writer;
  }

  async cacheThumbnail(imageId: string, blob: Blob): Promise<void> {
    if (!this.isElectron) return;
    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const result = await window.electronAPI.cacheThumbnail({ thumbnailId: imageId, data });
    if (!result.success) {
      // Only log non-path-related errors (path errors should be handled by the hash fix in Electron)
      const isPathError = result.errorCode === 'ENAMETOOLONG' || result.error?.includes('path too long') || result.error?.includes('ENOENT');
      if (!isPathError) {
        console.error("Failed to cache thumbnail:", result.error);
      }
    }
  }

  async getCachedThumbnail(imageId: string): Promise<Blob | null> {
    if (!this.isElectron) return null;
    const result = await window.electronAPI.getThumbnail(imageId);
    if (result.success && result.data) {
      return new Blob([new Uint8Array(result.data)], { type: 'image/webp' });
    }
    // Don't log errors for thumbnails that don't exist yet (expected during first load)
    // Only log unexpected errors
    if (!result.success && result.error && !result.error.includes('ENOENT')) {
      console.error("Failed to get cached thumbnail:", result.error);
    }
    return null;
  }

  
  // Deletes the JSON cache file via IPC
  async clearDirectoryCache(directoryPath: string, scanSubfolders: boolean): Promise<void> {
    if (!this.isElectron) return;
    
    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const result = await window.electronAPI.clearCacheData(cacheId);
    
    if (!result.success) {
      console.error("Failed to clear directory cache:", result.error);
    }
  }

  // Compares current file system state with the cache to find differences
  async validateCacheAndGetDiff(
    directoryPath: string,
    directoryName: string,
    currentFiles: { name: string; lastModified: number; size?: number; type?: string; birthtimeMs?: number }[],
    scanSubfolders: boolean
  ): Promise<CacheDiff> {
    const cached = await this.getCachedData(directoryPath, scanSubfolders);
    
    // If no cache exists, all files are new
    if (!cached) {
      return {
        newAndModifiedFiles: currentFiles,
        deletedFileIds: [],
        cachedImages: [],
        needsFullRefresh: true,
      };
    }
    
    const cachedMetadataMap = new Map(cached.metadata.map(m => [m.name, m]));
    const newAndModifiedFiles: { name: string; lastModified: number; size?: number; type?: string; birthtimeMs?: number }[] = [];
    const cachedImages: IndexedImage[] = [];
    const currentFileNames = new Set<string>();

    for (const file of currentFiles) {
      currentFileNames.add(file.name);
      const cachedFile = cachedMetadataMap.get(file.name);

      // File is new
      if (!cachedFile) {
        newAndModifiedFiles.push({
          name: file.name,
          lastModified: file.lastModified,
          size: file.size,
          type: file.type,
          birthtimeMs: file.birthtimeMs,
        });
      // File has been modified since last scan
      } else if (cachedFile.lastModified < file.lastModified) {
        newAndModifiedFiles.push({
          name: file.name,
          lastModified: file.lastModified,
          size: file.size,
          type: file.type,
          birthtimeMs: file.birthtimeMs,
        });
      // File is unchanged, add it to the list of images to be loaded from cache
      } else {
        cachedImages.push({
          ...cachedFile,
          handle: { name: cachedFile.name, kind: 'file' } as any, // Mock handle
        });
      }
    }

    // Find files that were in the cache but are no longer on disk
    const deletedFileIds = cached.metadata
      .filter(m => !currentFileNames.has(m.name))
      .map(m => m.id);

    return {
      newAndModifiedFiles,
      deletedFileIds,
      cachedImages,
      needsFullRefresh: false,
    };
  }
}

const cacheManager = new CacheManager();
export { cacheManager, IncrementalCacheWriter };
export default cacheManager;
