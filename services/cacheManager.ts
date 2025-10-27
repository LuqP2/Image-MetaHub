import { type IndexedImage } from '../types';

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
}

export interface CacheDiff {
  newAndModifiedFiles: { name: string; lastModified: number }[];
  deletedFileIds: string[];
  cachedImages: IndexedImage[];
  needsFullRefresh: boolean;
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

  // Helper to build the metadata array for caching
  private buildCacheMetadata(images: IndexedImage[]): CacheImageMetadata[] {
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
    }));
  }
  
  // Reads the entire cache from the JSON file via IPC
  async getCachedData(
    directoryPath: string,
    scanSubfolders: boolean,
  ): Promise<CacheEntry | null> {
    if (!this.isElectron) return null;

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const result = await window.electronAPI.getCachedData(cacheId);

    if (result.success) {
      const cacheRecord = result.data;
      if (!cacheRecord) return null;

      // If chunkCount is present, load metadata from chunks
      if (cacheRecord.chunkCount > 0) {
        let metadata: CacheImageMetadata[] = [];
        for (let i = 0; i < cacheRecord.chunkCount; i++) {
          const chunkResult = await window.electronAPI.getCacheChunk({ cacheId, chunkIndex: i });
          if (chunkResult.success) {
            metadata = metadata.concat(chunkResult.data);
          } else {
            console.error(`Failed to load cache chunk ${i} for ${cacheId}:`, chunkResult.error);
          }
        }
        cacheRecord.metadata = metadata;
      }

      return cacheRecord;

    } else {
      console.error("Failed to get cached data:", result.error);
      return null;
    }
  }
  
  // (No-op) - This functionality is now implicit in getCachedData
  async iterateCachedMetadata(
    directoryPath: string,
    scanSubfolders: boolean,
    onChunk: (chunk: CacheImageMetadata[]) => void | Promise<void>
  ): Promise<void> {
    const cachedData = await this.getCachedData(directoryPath, scanSubfolders);
    if (cachedData && cachedData.metadata.length > 0) {
      await onChunk(cachedData.metadata);
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
    const metadata = this.buildCacheMetadata(images);
    
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
    currentFiles: { name: string; lastModified: number }[],
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
    const newAndModifiedFiles: { name: string; lastModified: number }[] = [];
    const cachedImages: IndexedImage[] = [];
    const currentFileNames = new Set<string>();

    for (const file of currentFiles) {
      currentFileNames.add(file.name);
      const cachedFile = cachedMetadataMap.get(file.name);

      // File is new
      if (!cachedFile) {
        newAndModifiedFiles.push(file);
      // File has been modified since last scan
      } else if (cachedFile.lastModified < file.lastModified) {
        newAndModifiedFiles.push(file);
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
export { cacheManager };
export default cacheManager;