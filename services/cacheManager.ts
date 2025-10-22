/// <reference lib="dom" />

import { type IndexedImage } from '../types';

interface CacheEntry {
  id: string;
  directoryPath: string;
  directoryName: string;
  lastScan: number;
  imageCount: number;
  metadataChunkIds?: string[]; // Store IDs of metadata chunks
  metadata?: { // Kept for backwards compatibility during migration
    id: string;
    name: string;
    metadataString: string;
    metadata: any;
    lastModified: number;
    models: string[];
    loras: string[];
    scheduler: string;
  }[];
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
        const transaction = (event.target as IDBOpenDBRequest).transaction;

        // Clear old stores for a clean upgrade
        if (db.objectStoreNames.contains('cache')) {
          db.deleteObjectStore('cache');
        }
        if (db.objectStoreNames.contains('thumbnails')) {
          db.deleteObjectStore('thumbnails');
        }
        if (db.objectStoreNames.contains('cache_chunks')) {
          db.deleteObjectStore('cache_chunks');
        }

        const cacheStore = db.createObjectStore('cache', { keyPath: 'id' });
        cacheStore.createIndex('directoryName', 'directoryName', { unique: false });

        db.createObjectStore('thumbnails', { keyPath: 'id' });
        db.createObjectStore('cache_chunks', { keyPath: 'id' });
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

  async getCachedData(directoryPath: string, scanSubfolders: boolean): Promise<CacheEntry | null> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return null;
    }
    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache', 'cache_chunks'], 'readonly');
      const cacheStore = transaction.objectStore('cache');
      const chunkStore = transaction.objectStore('cache_chunks');

      const request = cacheStore.get(cacheId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entry = request.result;

        if (!entry) {
          resolve(null);
          return;
        }

        // Handle legacy data structure
        if (entry.metadata) {
          resolve(entry);
          return;
        }

        if (!entry.metadataChunkIds || entry.metadataChunkIds.length === 0) {
          entry.metadata = [];
          resolve(entry);
          return;
        }

        const allMetadata: any[] = [];
        let chunksRetrieved = 0;

        entry.metadataChunkIds.forEach((chunkId: string) => {
          const chunkRequest = chunkStore.get(chunkId);
          chunkRequest.onerror = () => reject(chunkRequest.error);
          chunkRequest.onsuccess = () => {
            if (chunkRequest.result && chunkRequest.result.data) {
              allMetadata.push(...chunkRequest.result.data);
            }
            chunksRetrieved++;
            if (chunksRetrieved === entry.metadataChunkIds.length) {
              entry.metadata = allMetadata;
              delete entry.metadataChunkIds;
              resolve(entry);
            }
          };
        });
      };
    });
  }

  async cacheData(
    directoryPath: string,
    directoryName: string,
    images: IndexedImage[],
    scanSubfolders: boolean,
  ): Promise<void> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return;
    }

    const CHUNK_SIZE = 10000; // Store 10,000 records per chunk
    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;

    const allMetadata = images.map((img) => ({
      id: img.id,
      name: img.name,
      metadataString: img.metadataString,
      metadata: img.metadata,
      lastModified: img.lastModified,
      models: img.models,
      loras: img.loras,
      scheduler: img.scheduler,
    }));

    const metadataChunks = [];
    for (let i = 0; i < allMetadata.length; i += CHUNK_SIZE) {
      metadataChunks.push(allMetadata.slice(i, i + CHUNK_SIZE));
    }

    const metadataChunkIds = metadataChunks.map((_, index) => `${cacheId}-chunk-${index}`);

    const cacheEntry: CacheEntry = {
      id: cacheId,
      directoryPath,
      directoryName,
      lastScan: Date.now(),
      imageCount: images.length,
      metadataChunkIds,
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache', 'cache_chunks'], 'readwrite');
      const cacheStore = transaction.objectStore('cache');
      const chunkStore = transaction.objectStore('cache_chunks');

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      // 1. Get the old entry to find and delete old chunk IDs
      const getRequest = cacheStore.get(cacheId);

      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => {
        const oldEntry = getRequest.result;

        // 2. If old entry exists, delete its chunks to prevent orphans
        if (oldEntry && oldEntry.metadataChunkIds) {
          oldEntry.metadataChunkIds.forEach((chunkId: string) => {
            chunkStore.delete(chunkId);
          });
        }

        // 3. Save the new metadata chunks
        metadataChunks.forEach((chunk, index) => {
          const chunkId = metadataChunkIds[index];
          chunkStore.put({ id: chunkId, data: chunk });
        });

        // 4. Save the main cache entry with references to the new chunks
        cacheStore.put(cacheEntry);
      };
    });
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
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cacheEntries: CacheEntry[] = request.result;
        let cleanedCount = 0;
        for (const entry of cacheEntries) {
          const invalidImages = entry.metadata.filter(meta => {
            // Skip validation for images without metadata (they're still valid)
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
            entry.metadata = entry.metadata.filter(meta => !!(meta.metadata && meta.metadata.normalizedMetadata));
            entry.imageCount = entry.metadata.length;
            entry.lastScan = Date.now();
            store.put(entry);
            cleanedCount += invalidImages.length;
          }
        }
        resolve(cleanedCount);
      };
    });
  }

  async clearCache(): Promise<void> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache', 'thumbnails', 'cache_chunks'], 'readwrite');
      const stores = ['cache', 'thumbnails', 'cache_chunks'];
      let completed = 0;

      stores.forEach((storeName) => {
        const request = transaction.objectStore(storeName).clear();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          completed++;
          if (completed === stores.length) {
            resolve();
          }
        };
      });
    });
  }

  async clearDirectoryCache(directoryPath: string, scanSubfolders: boolean): Promise<void> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return;
    }
    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache', 'cache_chunks'], 'readwrite');
      const cacheStore = transaction.objectStore('cache');
      const chunkStore = transaction.objectStore('cache_chunks');

      // First, get the entry to find its chunk IDs
      const getRequest = cacheStore.get(cacheId);

      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => {
        const entry = getRequest.result;

        // If the entry has chunk IDs, delete them
        if (entry && entry.metadataChunkIds) {
          entry.metadataChunkIds.forEach((chunkId: string) => {
            chunkStore.delete(chunkId);
          });
        }

        // Now, delete the main cache entry
        const deleteRequest = cacheStore.delete(cacheId);
        deleteRequest.onerror = () => reject(deleteRequest.error);
        deleteRequest.onsuccess = () => resolve();
      };
    });
  }

  async removeImages(imageIds: string[]): Promise<void> {
    if (!this.db || imageIds.length === 0) {
      return;
    }
    
    const idsToRemove = new Set(imageIds);

    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(['cache', 'cache_chunks', 'thumbnails'], 'readwrite');
      const cacheStore = transaction.objectStore('cache');
      const chunkStore = transaction.objectStore('cache_chunks');
      const thumbStore = transaction.objectStore('thumbnails');

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();

      // Delete thumbnails
      for (const id of imageIds) {
        thumbStore.delete(id);
      }

      // Get all cache entries and update them
      const cursorRequest = cacheStore.openCursor();

      cursorRequest.onerror = () => reject(cursorRequest.error);
      cursorRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;

        if (cursor) {
          const entry: CacheEntry = cursor.value;

          // Handle legacy metadata structure
          if (entry.metadata && Array.isArray(entry.metadata)) {
            const initialCount = entry.metadata.length;
            entry.metadata = entry.metadata.filter((meta) => !idsToRemove.has(meta.id));
            const removedCount = initialCount - entry.metadata.length;

            if (removedCount > 0) {
              entry.imageCount -= removedCount;
              cursor.update(entry);
            }
          }
          // Handle chunked metadata structure
          else if (entry.metadataChunkIds && Array.isArray(entry.metadataChunkIds)) {
            // Delete all chunks associated with this entry
            entry.metadataChunkIds.forEach((chunkId: string) => {
              chunkStore.delete(chunkId);
            });

            // For now, clear the chunks - they'll be regenerated on next cache operation
            entry.metadataChunkIds = [];
            entry.imageCount = 0;
            cursor.update(entry);
          }

          cursor.continue();
        }
      };
    });
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
    const deletedFileIds: string[] = [];

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
          handle: { name: cachedFile.name, kind: 'file' } as FileSystemFileHandle,
        });
      }
    }

    // Find deleted files
    for (const m of cached.metadata) {
      if (!currentFileNames.has(m.name)) {
        deletedFileIds.push(m.id);
      }
    }

    // If there are deleted files, clean them up from cache
    if (deletedFileIds.length > 0) {
      await this.removeImages(deletedFileIds);
    }

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