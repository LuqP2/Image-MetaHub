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
  private dbName = 'invokeai-browser-cache';
  private dbVersion = 3; // Increased version to include complete metadata in cache
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('❌ IndexedDB open error:', request.error);
        // If IndexedDB fails to open, try to delete and recreate it
        this.handleIndexedDBError(request.error).then(resolve).catch(reject);
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Delete old stores if they exist (for clean upgrade)
        if (db.objectStoreNames.contains('cache')) {
          db.deleteObjectStore('cache');
        }
        if (db.objectStoreNames.contains('thumbnails')) {
          db.deleteObjectStore('thumbnails');
        }

        // Create cache store
        const cacheStore = db.createObjectStore('cache', { keyPath: 'id' });
        cacheStore.createIndex('directoryName', 'directoryName', { unique: false });

        // Create thumbnails store
        const thumbStore = db.createObjectStore('thumbnails', { keyPath: 'id' });
      };
    });
  }

  private async handleIndexedDBError(error: any): Promise<void> {

    try {
      // Delete the corrupted database
      const deleteRequest = indexedDB.deleteDatabase(this.dbName);
      await new Promise<void>((resolve, reject) => {
        deleteRequest.onsuccess = () => {
          resolve();
        };
        deleteRequest.onerror = () => {
          console.error('❌ Failed to delete IndexedDB:', deleteRequest.error);
          reject(deleteRequest.error);
        };
      });

      // Try to recreate the database
      return this.init();
    } catch (deleteError) {
      console.error('❌ Failed to reset IndexedDB:', deleteError);
      // If we can't reset, continue without cache
      return Promise.resolve();
    }
  }

  async getCachedData(directoryPath: string, scanSubfolders: boolean): Promise<CacheEntry | null> {
    if (!this.db) {
      try {
        await this.init();
      } catch (error) {
        return null;
      }
    }

    if (!this.db) {
      return null;
    }

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['cache'], 'readonly');
      const store = transaction.objectStore('cache');
      const request = store.get(cacheId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result || null;
        resolve(result);
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
      try {
        await this.init();
      } catch (error) {
        return;
      }
    }

    if (!this.db) {
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
        metadata: img.metadata, // Store complete metadata including normalizedMetadata
        lastModified: img.lastModified,
        models: img.models,
        loras: img.loras,
        scheduler: img.scheduler,
      })),
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      const request = store.put(cacheEntry);

      request.onerror = () => {
        console.error('❌ CACHE SAVE FAILED:', request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        resolve();
      };
    });
  }

  async cacheThumbnail(imageId: string, blob: Blob): Promise<void> {
    if (!this.db) {
      try {
        await this.init();
      } catch (error) {
        return;
      }
    }

    if (!this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['thumbnails'], 'readwrite');
      const store = transaction.objectStore('thumbnails');
      const request = store.put({ id: imageId, blob });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getCachedThumbnail(imageId: string): Promise<Blob | null> {
    if (!this.db) {
      try {
        await this.init();
      } catch (error) {
        return null;
      }
    }

    if (!this.db) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['thumbnails'], 'readonly');
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
      try {
        await this.init();
      } catch (error) {
        return 0;
      }
    }

    if (!this.db) {
      return 0;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');

      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cacheEntries: CacheEntry[] = request.result;
        let cleanedCount = 0;

        for (const entry of cacheEntries) {
          const invalidImages = entry.metadata.filter(meta => {
            try {
              const parsed = JSON.parse(meta.metadataString);
              return !parsed.normalizedMetadata;
            } catch (error) {
              console.warn(`❌ Invalid metadata JSON for ${meta.name}, removing from cache`);
              return true; // Remove invalid JSON entries
            }
          });

          if (invalidImages.length > 0) {
            entry.metadata = entry.metadata.filter(meta => {
              // Check if metadata has normalizedMetadata
              return !!(meta.metadata && meta.metadata.normalizedMetadata);
            });
            entry.imageCount = entry.metadata.length;
            entry.lastScan = Date.now();

            // Update the cache entry
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
      try {
        await this.init();
      } catch (error) {
        return;
      }
    }

    if (!this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['cache', 'thumbnails'], 'readwrite');
      
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

  async validateCacheAndGetDiff(
    directoryPath: string,
    directoryName: string,
    currentFiles: { name: string; lastModified: number }[],
    scanSubfolders: boolean
  ): Promise<CacheDiff> {
    const cached = await this.getCachedData(directoryPath, scanSubfolders);

    if (!cached) {
      const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
      console.log(`❌ NO CACHE FOUND for "${cacheId}". Performing full scan.`);
      return {
        newAndModifiedFiles: currentFiles,
        deletedFileIds: [],
        cachedImages: [],
        needsFullRefresh: true,
      };
    }
    
    console.log(`✅ CACHE FOUND for "${directoryName}". Analyzing diff...`);

    const cachedMetadataMap = new Map(cached.metadata.map(m => [m.name, m]));
    const newAndModifiedFiles: { name: string; lastModified: number }[] = [];
    const cachedImages: IndexedImage[] = [];
    const currentFileNames = new Set<string>();

    for (const file of currentFiles) {
      currentFileNames.add(file.name);
      const cachedFile = cachedMetadataMap.get(file.name);

      if (!cachedFile) {
        // File is new
        newAndModifiedFiles.push(file);
      } else if (cachedFile.lastModified < file.lastModified) {
        // File has been modified
        newAndModifiedFiles.push(file);
      } else {
        // File is unchanged, restore from cache
        cachedImages.push({
          ...cachedFile,
          metadata: cachedFile.metadata, // Use the complete metadata that was stored
          // Mock handle for cached items, getFile will be implemented in the hook
          handle: { name: cachedFile.name, kind: 'file' } as any,
        });
      }
    }

    const deletedFileIds = cached.metadata
      .filter(m => !currentFileNames.has(m.name))
      .map(m => m.id);

    console.log(`   - ${newAndModifiedFiles.length} new or modified files to process.`);
    console.log(`   - ${deletedFileIds.length} deleted files to remove.`);
    console.log(`   - ${cachedImages.length} images restored from cache.`);

    return {
      newAndModifiedFiles,
      deletedFileIds,
      cachedImages,
      needsFullRefresh: false,
    };
  }
}

// Export cache manager instance
const cacheManager = new CacheManager();
export { cacheManager };
export default cacheManager;
