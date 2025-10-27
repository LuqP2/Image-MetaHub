/// <reference lib="dom" />

import { type IndexedImage } from '../types';

export interface CacheImageMetadata {
  id: string;
  name: string;
  metadataString: string;
  metadata: any; // Store complete metadata including normalizedMetadata
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

interface CacheRecord {
  id: string;
  directoryPath: string;
  directoryName: string;
  lastScan: number;
  imageCount: number;
  chunkSize?: number;
  chunkCount?: number;
}

interface CacheChunkRecord {
  id: string;
  cacheId: string;
  chunkIndex: number;
  items: CacheImageMetadata[];
}

export interface CacheEntry {
  id: string;
  directoryPath: string;
  directoryName: string;
  lastScan: number;
  imageCount: number;
  chunkSize?: number;
  chunkCount?: number;
  metadata: CacheImageMetadata[];
}

export interface CacheDiff {
  newAndModifiedFiles: { name: string; lastModified: number }[];
  deletedFileIds: string[];
  cachedImages: IndexedImage[];
  needsFullRefresh: boolean;
}

class CacheManager {
  private dbName = 'invokeai-browser-cache'; // Default name
  private dbVersion = 4;
  private readonly chunkSize = 10000;
  private readonly chunkStoreName = 'cacheChunks';
  private db: IDBDatabase | null = null;
  private isInitialized = false;

  async init(basePath?: string): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Create a unique DB name from the base path to avoid collisions
    if (basePath) {
      // Sanitize the path to be a valid DB name
      this.dbName = `image-metahub-cache-${basePath.replace(/[^a-zA-Z0-9]/g, '_')}`;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('❌ IndexedDB open error:', request.error);
        this.handleIndexedDBError(request.error).then(resolve).catch(reject);
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (db.objectStoreNames.contains('cache')) {
          db.deleteObjectStore('cache');
        }
        if (db.objectStoreNames.contains(this.chunkStoreName)) {
          db.deleteObjectStore(this.chunkStoreName);
        }
        if (db.objectStoreNames.contains('thumbnails')) {
          db.deleteObjectStore('thumbnails');
        }

        const cacheStore = db.createObjectStore('cache', { keyPath: 'id' });
        cacheStore.createIndex('directoryName', 'directoryName', { unique: false });

        const chunkStore = db.createObjectStore(this.chunkStoreName, { keyPath: 'id' });
        chunkStore.createIndex('cacheId', 'cacheId', { unique: false });
        chunkStore.createIndex('cacheId_chunkIndex', ['cacheId', 'chunkIndex'], { unique: true });

        db.createObjectStore('thumbnails', { keyPath: 'id' });
      };
    });
  }

  private async handleIndexedDBError(error: any): Promise<void> {
    try {
      const deleteRequest = indexedDB.deleteDatabase(this.dbName);
      await new Promise<void>((resolve, reject) => {
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => {
          console.error('❌ Failed to delete IndexedDB:', deleteRequest.error);
          reject(deleteRequest.error);
        };
      });
      return this.init();
    } catch (deleteError) {
      console.error('❌ Failed to reset IndexedDB:', deleteError);
      return Promise.resolve();
    }
  }

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

  private async clearCacheChunks(cacheId: string): Promise<void> {
    if (!this.db || !this.db.objectStoreNames.contains(this.chunkStoreName)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkStoreName], 'readwrite');
      const store = transaction.objectStore(this.chunkStoreName);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      const indexName = store.indexNames.contains('cacheId_chunkIndex') ? 'cacheId_chunkIndex' : 'cacheId';
      const index = store.index(indexName);
      const range = indexName === 'cacheId_chunkIndex'
        ? IDBKeyRange.bound([cacheId, 0], [cacheId, Number.MAX_SAFE_INTEGER])
        : IDBKeyRange.only(cacheId);

      const cursorRequest = index.openCursor(range);
      cursorRequest.onerror = () => reject(cursorRequest.error!);
      cursorRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    });
  }

  private async writeCache(
    cacheId: string,
    directoryPath: string,
    directoryName: string,
    metadataRecords: CacheImageMetadata[]
  ): Promise<void> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return;
    }

    await this.clearCacheChunks(cacheId);

    const chunkCount = metadataRecords.length === 0
      ? 0
      : Math.ceil(metadataRecords.length / this.chunkSize);

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(['cache', this.chunkStoreName], 'readwrite');
      const cacheStore = transaction.objectStore('cache');
      const chunkStore = transaction.objectStore(this.chunkStoreName);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        console.error('❌ Transaction failed for cache:', transaction.error);
        reject(transaction.error);
      };

      const cacheRecord: CacheRecord = {
        id: cacheId,
        directoryPath,
        directoryName,
        lastScan: Date.now(),
        imageCount: metadataRecords.length,
        chunkSize: this.chunkSize,
        chunkCount,
      };

      cacheStore.put(cacheRecord);

      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
        const start = chunkIndex * this.chunkSize;
        const end = start + this.chunkSize;
        const items = metadataRecords.slice(start, end);

        const chunkRecord: CacheChunkRecord = {
          id: `${cacheId}-chunk-${chunkIndex}`,
          cacheId,
          chunkIndex,
          items,
        };

        chunkStore.put(chunkRecord);
      }
    });
  }

  private async getCacheMetadata(cacheId: string): Promise<CacheImageMetadata[]> {
    if (!this.db || !this.db.objectStoreNames.contains(this.chunkStoreName)) {
      return [];
    }

    return new Promise<CacheImageMetadata[]>((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkStoreName], 'readonly');
      const store = transaction.objectStore(this.chunkStoreName);
      const hasSortedIndex = store.indexNames.contains('cacheId_chunkIndex');
      const index = store.index(hasSortedIndex ? 'cacheId_chunkIndex' : 'cacheId');
      const range = hasSortedIndex
        ? IDBKeyRange.bound([cacheId, 0], [cacheId, Number.MAX_SAFE_INTEGER])
        : IDBKeyRange.only(cacheId);

      const request = index.getAll(range);
      request.onerror = () => reject(request.error!);
      request.onsuccess = () => {
        const records = (request.result as CacheChunkRecord[]) || [];
        const sorted = hasSortedIndex
          ? records
          : records.sort((a, b) => a.chunkIndex - b.chunkIndex);
        const metadata = sorted.flatMap(record => record.items);
        resolve(metadata);
      };
    });
  }

  async iterateCachedMetadata(
    directoryPath: string,
    scanSubfolders: boolean,
    onChunk: (chunk: CacheImageMetadata[]) => void | Promise<void>
  ): Promise<void> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return;
    }
    if (!this.db.objectStoreNames.contains(this.chunkStoreName)) {
      const cached = await this.getCachedData(directoryPath, scanSubfolders);
      if (cached?.metadata?.length) {
        await onChunk(cached.metadata);
      }
      return;
    }

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkStoreName], 'readonly');
      const store = transaction.objectStore(this.chunkStoreName);
      const hasSortedIndex = store.indexNames.contains('cacheId_chunkIndex');

      if (!hasSortedIndex) {
        const fallbackIndex = store.index('cacheId');
        const range = IDBKeyRange.only(cacheId);
        const request = fallbackIndex.getAll(range);
        request.onerror = () => reject(request.error!);
        request.onsuccess = () => {
          const records = (request.result as CacheChunkRecord[]) || [];
          records.sort((a, b) => a.chunkIndex - b.chunkIndex);
          (async () => {
            for (const record of records) {
              await onChunk(record.items);
            }
          })()
            .then(() => resolve())
            .catch(reject);
        };
        return;
      }

      const index = store.index('cacheId_chunkIndex');
      const range = IDBKeyRange.bound([cacheId, 0], [cacheId, Number.MAX_SAFE_INTEGER]);
      const cursorRequest = index.openCursor(range);
      cursorRequest.onerror = () => reject(cursorRequest.error!);
      cursorRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) {
          resolve();
          return;
        }
        const chunk = cursor.value as CacheChunkRecord;
        Promise.resolve(onChunk(chunk.items))
          .then(() => cursor.continue())
          .catch(reject);
      };
    });
  }

  private async getAllCacheRecords(): Promise<CacheRecord[]> {
    if (!this.db) {
      return [];
    }

    return new Promise<CacheRecord[]>((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readonly');
      const store = transaction.objectStore('cache');
      const request = store.getAll();
      request.onerror = () => reject(request.error!);
      request.onsuccess = () => resolve((request.result as CacheRecord[]) || []);
    });
  }

  async getCachedData(directoryPath: string, scanSubfolders: boolean): Promise<CacheEntry | null>;
  async getCachedData(
    directoryPath: string,
    scanSubfolders: boolean,
    options: { includeMetadata: true }
  ): Promise<CacheEntry | null>;
  async getCachedData(
    directoryPath: string,
    scanSubfolders: boolean,
    options: { includeMetadata: false }
  ): Promise<Omit<CacheEntry, 'metadata'> | null>;
  async getCachedData(
    directoryPath: string,
    scanSubfolders: boolean,
    options: { includeMetadata?: boolean } = { includeMetadata: true }
  ): Promise<CacheEntry | CacheRecord | null> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return null;
    }
    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    console.log(`🔍 Looking for cache with ID: ${cacheId} in DB: ${this.dbName}`);

    const record = await new Promise<(CacheRecord & Partial<Pick<CacheEntry, 'metadata'>>) | null>((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readonly');
      const store = transaction.objectStore('cache');
      const request = store.get(cacheId);
      request.onerror = () => reject(request.error!);
      request.onsuccess = () => {
        const result = request.result as CacheRecord | null;
        resolve(result || null);
      };
    });

    if (!record) {
      return null;
    }

    const cachedMetadata = (record as CacheEntry).metadata;

    if (options.includeMetadata === false) {
      if (cachedMetadata) {
        const { metadata: _metadata, ...rest } = record as CacheEntry;
        return rest;
      }
      return record as Omit<CacheEntry, 'metadata'>;
    }

    if (cachedMetadata) {
      return record as CacheEntry;
    }

    const metadata = await this.getCacheMetadata(cacheId);
    return { ...record, metadata } as CacheEntry;
  }

  async cacheData(
    directoryPath: string,
    directoryName: string,
    images: IndexedImage[],
    scanSubfolders: boolean
  ): Promise<void> {
    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const metadata = this.buildCacheMetadata(images);
    await this.writeCache(cacheId, directoryPath, directoryName, metadata);
  }

  async cacheThumbnail(imageId: string, blob: Blob): Promise<void> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return;
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['thumbnails'], 'readwrite');
      const store = transaction.objectStore('thumbnails');
      const request = store.put({ id: imageId, blob });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getCachedThumbnail(imageId: string): Promise<Blob | null> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return null;
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['thumbnails'], 'readonly');
      const store = transaction.objectStore('thumbnails');
      const request = store.get(imageId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.blob : null);
      };
    });
  }

  async validateAndCleanCache(): Promise<number> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return 0;
    }

    const cacheEntries = await this.getAllCacheRecords();
    let cleanedCount = 0;

    for (const entry of cacheEntries) {
      const isRecursive = entry.id.endsWith('-recursive');
      const cached = await this.getCachedData(entry.directoryPath, isRecursive);
      const metadataList = cached?.metadata ?? [];

      if (metadataList.length === 0) {
        continue;
      }

      const invalidImages = metadataList.filter(meta => {
        if (!meta.metadataString || meta.metadataString.trim() === '') {
          return false;
        }
        try {
          const parsed = JSON.parse(meta.metadataString);
          return !parsed.normalizedMetadata;
        } catch (error) {
          console.warn(`❌ Invalid metadata JSON for ${meta.name}, removing from cache`);
          return true;
        }
      });

      if (invalidImages.length > 0) {
        const validMetadata = metadataList.filter(meta => !!(meta.metadata && meta.metadata.normalizedMetadata));
        await this.writeCache(entry.id, entry.directoryPath, entry.directoryName, validMetadata);
        cleanedCount += invalidImages.length;
      }
    }

    return cleanedCount;
  }

  async clearCache(): Promise<void> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return;
    }

    const storeNames = ['cache', 'thumbnails'];
    if (this.db.objectStoreNames.contains(this.chunkStoreName)) {
      storeNames.push(this.chunkStoreName);
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(storeNames, 'readwrite');
      const cacheStore = transaction.objectStore('cache');
      const thumbStore = transaction.objectStore('thumbnails');
      const chunkStore = this.db!.objectStoreNames.contains(this.chunkStoreName)
        ? transaction.objectStore(this.chunkStoreName)
        : null;

      const requests = [cacheStore.clear(), thumbStore.clear()];
      if (chunkStore) {
        requests.push(chunkStore.clear());
      }

      let completed = 0;
      const expected = requests.length;
      const checkComplete = () => {
        completed++;
        if (completed === expected) {
          resolve();
        }
      };

      transaction.onerror = () => {
        reject(transaction.error!);
      };

      for (const request of requests) {
        request.onerror = () => reject(request.error!);
        request.onsuccess = checkComplete;
      }
    });
  }

  async clearDirectoryCache(directoryPath: string, scanSubfolders: boolean): Promise<void> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return;
    }
    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;

    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      const request = store.delete(cacheId);
      request.onerror = () => {
        console.error(`❌ Failed to clear cache for directory: ${cacheId}`, request.error);
        reject(request.error!);
      };
      request.onsuccess = () => resolve();
    });

    await this.clearCacheChunks(cacheId);
  }

  async validateCacheAndGetDiff(
    directoryPath: string,
    directoryName: string,
    currentFiles: { name: string; lastModified: number }[],
    scanSubfolders: boolean
  ): Promise<CacheDiff> {
    const cached = await this.getCachedData(directoryPath, scanSubfolders);

    if (!cached) {
      const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
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

      if (!cachedFile) {
        newAndModifiedFiles.push(file);
      } else if (cachedFile.lastModified < file.lastModified) {
        newAndModifiedFiles.push(file);
      } else {
        cachedImages.push({
          ...cachedFile,
          metadata: cachedFile.metadata,
          handle: { name: cachedFile.name, kind: 'file' } as any,
        });
      }
    }

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