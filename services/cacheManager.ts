/// <reference lib="dom" />

import { type IndexedImage } from '../types';

interface CacheEntry {
  id: string;
  directoryName: string;
  lastScan: number;
  imageCount: number;
  metadata: {
    id: string;
    name: string;
    metadataString: string;
    lastModified: number;
    models: string[];
    loras: string[];
    scheduler: string;
  }[];
  thumbnails: Map<string, Blob>; // Store thumbnail blobs
}

class CacheManager {
  private dbName = 'invokeai-browser-cache';
  private dbVersion = 2; // Increased version to handle schema changes
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

  async getCachedData(directoryName: string): Promise<CacheEntry | null> {
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
      const transaction = this.db.transaction(['cache'], 'readonly');
      const store = transaction.objectStore('cache');
      const request = store.get(directoryName);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result || null;
        resolve(result);
      };
    });
  }

  async cacheData(
    directoryName: string,
    images: IndexedImage[]
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

    const cacheEntry: CacheEntry = {
      id: directoryName,
      directoryName,
      lastScan: Date.now(),
      imageCount: images.length,
      metadata: images.map(img => ({
        id: img.id,
        name: img.name,
        metadataString: img.metadataString,
        lastModified: img.lastModified,
        models: img.models,
        loras: img.loras,
        scheduler: img.scheduler,
      })),
      thumbnails: new Map()
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
              try {
                const parsed = JSON.parse(meta.metadataString);
                return !!parsed.normalizedMetadata;
              } catch {
                return false;
              }
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

  async shouldRefreshCache(
    directoryName: string,
    currentImageCount: number
  ): Promise<{ shouldRefresh: boolean }> {
    const cached = await this.getCachedData(directoryName);
    
    if (!cached) {
      // console.log(`❌ NO CACHE FOUND for "${directoryName}"`);
      return { shouldRefresh: true };
    }
    
    const cacheAge = Date.now() - cached.lastScan;
    const ageMinutes = Math.round(cacheAge / (1000 * 60));
    
    // console.log(`🔍 CACHE ANALYSIS:`);
    // console.log(`   Directory: "${directoryName}"`);
    // console.log(`   Cached count: ${cached.imageCount}`);
    // console.log(`   Current count: ${currentImageCount}`);
    // console.log(`   Cache age: ${ageMinutes} minutes`);
    // console.log(`   Cache timestamp: ${new Date(cached.lastScan).toLocaleString()}`);
    
    // Check if image count changed
    const countDiff = Math.abs(cached.imageCount - currentImageCount);
    
    // If count changed, refresh cache
    if (countDiff > 0) {
      // console.log(`🔄 COUNT CHANGED: ${cached.imageCount} -> ${currentImageCount} (diff: ${countDiff})`);
      return { shouldRefresh: true };
    }

    // Refresh if cache is older than 1 hour
    const maxAge = 60 * 60 * 1000; // 1 hour
    
    if (cacheAge > maxAge) {
      return { shouldRefresh: true };
    }

    return { shouldRefresh: false };
  }

  async updateCacheIncrementally(
    directoryName: string,
    newImages: IndexedImage[]
  ): Promise<void> {
    if (!this.db) await this.init();

    const transaction = this.db!.transaction(['cache'], 'readwrite');
    const store = transaction.objectStore('cache');

    const request = store.get(directoryName);
    request.onerror = () => {
      console.error('❌ CACHE UPDATE FAILED:', request.error);
    };
    request.onsuccess = () => {
      const cachedData: CacheEntry = request.result;
      if (cachedData) {
        // Merge new images with existing cache

        // Ensure no duplicates in the cache
        const existingNames = new Set(cachedData.metadata.map(meta => meta.name));
        const uniqueNewImages = newImages.filter(img => !existingNames.has(img.name));

        const updatedMetadata = [...cachedData.metadata, ...uniqueNewImages.map(img => ({
          id: img.id,
          name: img.name,
          metadataString: img.metadataString,
          lastModified: img.lastModified,
          models: img.models,
          loras: img.loras,
          scheduler: img.scheduler,
        }))];

        cachedData.metadata = updatedMetadata;
        cachedData.imageCount = updatedMetadata.length;
        cachedData.lastScan = Date.now();

        // Save updated cache
        store.put(cachedData);
      } else {
        console.warn('⚠️ CACHE ENTRY NOT FOUND FOR INCREMENTAL UPDATE');
      }
    };
  }

  async cleanStaleCacheEntries(
    directoryName: string,
    validFileNames: string[]
  ): Promise<number> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');

      const request = store.get(directoryName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cachedData: CacheEntry = request.result;
        if (cachedData) {
          const originalCount = cachedData.metadata.length;
          const validMetadata = cachedData.metadata.filter(meta => validFileNames.includes(meta.name));
          const removedCount = originalCount - validMetadata.length;

          if (removedCount > 0) {
            cachedData.metadata = validMetadata;
            cachedData.imageCount = validMetadata.length;
            cachedData.lastScan = Date.now();
            store.put(cachedData);
          }

          resolve(removedCount);
        } else {
          resolve(0);
        }
      };
    });
  }
}

// Export cache manager instance
const cacheManager = new CacheManager();
export { cacheManager };
export default cacheManager;
