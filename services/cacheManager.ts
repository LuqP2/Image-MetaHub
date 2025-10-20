/// <reference lib="dom" />

import { type IndexedImage } from '../types';

interface CacheEntry {
  id: string;
  directoryPath: string;
  directoryName: string;
  lastScan: number;
  imageCount: number;
  metadata: {
    id: string;
    name: string;
    metadataString: string;
    metadata: any; // Store complete metadata including normalizedMetadata
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
  private dbVersion = 3;
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
        if (db.objectStoreNames.contains('thumbnails')) {
          db.deleteObjectStore('thumbnails');
        }

        const cacheStore = db.createObjectStore('cache', { keyPath: 'id' });
        cacheStore.createIndex('directoryName', 'directoryName', { unique: false });

        const thumbStore = db.createObjectStore('thumbnails', { keyPath: 'id' });
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
    console.log(`🔍 Looking for cache with ID: ${cacheId} in DB: ${this.dbName}`);
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readonly');
      const store = transaction.objectStore('cache');
      const request = store.get(cacheId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result || null);
      };
    });
  }

  async cacheData(
    directoryPath: string,
    directoryName: string,
    images: IndexedImage[],
    scanSubfolders: boolean
  ): Promise<void> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return;
    }
    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const cacheEntry: CacheEntry = {
      id: cacheId,
      directoryPath,
      directoryName,
      lastScan: Date.now(),
      imageCount: images.length,
      metadata: images.map(img => ({
        id: img.id,
        name: img.name,
        metadataString: img.metadataString,
        metadata: img.metadata,
        lastModified: img.lastModified,
        models: img.models,
        loras: img.loras,
        scheduler: img.scheduler,
      })),
    };
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      
      transaction.oncomplete = () => {
      };
      
      transaction.onerror = () => {
        console.error('❌ Transaction failed for cache:', transaction.error);
        reject(transaction.error);
      };
      
      const request = store.put(cacheEntry);
      request.onerror = () => {
        console.error('❌ CACHE SAVE REQUEST FAILED:', request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        resolve();
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
      const transaction = this.db!.transaction(['cache', 'thumbnails'], 'readwrite');
      const cacheStore = transaction.objectStore('cache');
      const thumbStore = transaction.objectStore('thumbnails');
      const clearCache = cacheStore.clear();
      const clearThumbs = thumbStore.clear();
      let completed = 0;
      const checkComplete = () => {
        completed++;
        if (completed === 2) resolve();
      };
      clearCache.onerror = () => reject(clearCache.error);
      clearThumbs.onerror = () => reject(clearThumbs.error);
      clearCache.onsuccess = checkComplete;
      clearThumbs.onsuccess = checkComplete;
    });
  }

  async clearDirectoryCache(directoryPath: string, scanSubfolders: boolean): Promise<void> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return;
    }
    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      const request = store.delete(cacheId);
      request.onerror = () => {
        console.error(`❌ Failed to clear cache for directory: ${cacheId}`, request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        resolve();
      };
    });
  }

  async removeImages(imageIds: string[]): Promise<void> {
    if (!this.db || imageIds.length === 0) {
        return;
    }

    return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(['cache', 'thumbnails'], 'readwrite');
        const cacheStore = transaction.objectStore('cache');
        const thumbStore = transaction.objectStore('thumbnails');
        const idsToRemove = new Set(imageIds);

        // Remove thumbnails
        for (const id of imageIds) {
            thumbStore.delete(id);
        }

        // Remove metadata from cache entries
        const request = cacheStore.openCursor();
        request.onerror = (event) => reject((event.target as IDBRequest).error);
        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (cursor) {
                const entry = cursor.value as CacheEntry;
                const initialCount = entry.metadata.length;
                entry.metadata = entry.metadata.filter(meta => !idsToRemove.has(meta.id));

                if (entry.metadata.length < initialCount) {
                    entry.imageCount = entry.metadata.length;
                    cursor.update(entry);
                }
                cursor.continue();
            }
        };

        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject((event.target as IDBTransaction).error);
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