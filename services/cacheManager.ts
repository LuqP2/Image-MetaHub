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
  loras: string[];
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
  }));
}

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
    const chunkNumber = this.chunkIndex++;
    this.totalImages += images.length;

    this.writeQueue = this.writeQueue.then(async () => {
      const result = await window.electronAPI?.writeCacheChunk?.({
        cacheId: this.cacheId,
        chunkIndex: chunkNumber,
        data: metadata,
      });
      if (result && !result.success) {
        throw new Error(result.error || 'Failed to write cache chunk');
      }
    });

    await this.writeQueue;
    return metadata;
  }

  async overwrite(chunkIndex: number, metadata: CacheImageMetadata[]): Promise<void> {
    if (!metadata) {
      return;
    }

    this.writeQueue = this.writeQueue.then(async () => {
      const result = await window.electronAPI?.writeCacheChunk?.({
        cacheId: this.cacheId,
        chunkIndex,
        data: metadata,
      });
      if (result && !result.success) {
        throw new Error(result.error || 'Failed to rewrite cache chunk');
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
    const metadata = toCacheMetadata(images);
    
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
      console.error("Failed to cache thumbnail:", result.error);
    }
  }

  async getCachedThumbnail(imageId: string): Promise<Blob | null> {
    if (!this.isElectron) return null;
    const result = await window.electronAPI.getThumbnail(imageId);
    if (result.success && result.data) {
      return new Blob([new Uint8Array(result.data)], { type: 'image/webp' });
    }
    if (!result.success) {
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