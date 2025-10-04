/// <reference lib="dom" />

import { type IndexedImage } from '../types';

// This interface is no longer used with the new per-image caching model.
// interface CacheEntry { ... }

export interface CacheDiff {
  newAndModifiedFiles: { name: string; lastModified: number }[];
  deletedFileIds: string[];
  cachedImages: IndexedImage[];
  needsFullRefresh: boolean;
}

class CacheManager {
  private dbName = 'invokeai-browser-cache'; // Default name
  private dbVersion = 4; // Incremented version to trigger schema migration
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
        console.log(`✅ IndexedDB initialized successfully: ${this.dbName}`);
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        console.log(`Upgrading IndexedDB from version ${event.oldVersion} to ${event.newVersion}`);

        // Remove old, monolithic cache store if it exists
        if (db.objectStoreNames.contains('cache')) {
          db.deleteObjectStore('cache');
          console.log("Deleted old 'cache' object store.");
        }

        // Create new, scalable 'images' store if it doesn't exist
        if (!db.objectStoreNames.contains('images')) {
          const imageStore = db.createObjectStore('images', { keyPath: 'id' });
          // Index for retrieving all images in a directory
          imageStore.createIndex('directoryId', 'directoryId', { unique: false });
           // Index for checking for a file's existence by its path (directoryId) and name
          imageStore.createIndex('name_in_directory', ['directoryId', 'name'], { unique: false });
          console.log("Created new 'images' object store.");
        }

        // Re-create thumbnails store if it doesn't exist (might be deleted in older migration logic)
        if (!db.objectStoreNames.contains('thumbnails')) {
            db.createObjectStore('thumbnails', { keyPath: 'id' });
            console.log("Created 'thumbnails' object store.");
        }
      };
    });
  }

  private async handleIndexedDBError(error: any): Promise<void> {
    console.warn("Encountered IndexedDB error, attempting to reset database:", error);
    try {
      const deleteRequest = indexedDB.deleteDatabase(this.dbName);
      await new Promise<void>((resolve, reject) => {
        deleteRequest.onsuccess = () => {
            console.log("Successfully deleted IndexedDB. Re-initializing...");
            resolve();
        };
        deleteRequest.onerror = () => {
          console.error('❌ Failed to delete IndexedDB:', deleteRequest.error);
          reject(deleteRequest.error);
        };
      });
      // Retry initialization after deletion
      return this.init();
    } catch (deleteError) {
      console.error('❌ Failed to reset IndexedDB:', deleteError);
      // Avoid infinite loops if deletion also fails
      return Promise.resolve();
    }
  }

  async getCachedImagesForDirectory(directoryId: string): Promise<IndexedImage[]> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return [];
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['images'], 'readonly');
      const store = transaction.objectStore('images');
      const index = store.index('directoryId');
      const request = index.getAll(directoryId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  async cacheImages(images: IndexedImage[]): Promise<void> {
    if (!this.db || images.length === 0) {
      return;
    }

    const transaction = this.db.transaction(['images'], 'readwrite');
    const store = transaction.objectStore('images');

    // Use a counter to track completion of all put requests
    let putCount = 0;
    const totalImages = images.length;

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`✅ Cache transaction completed. Successfully stored/updated ${putCount} images.`);
        resolve();
      };

      transaction.onerror = () => {
        console.error('❌ Cache transaction failed:', transaction.error);
        reject(transaction.error);
      };

      images.forEach(image => {
        // Each image must have a directoryId to be cached correctly
        if (!image.directoryId) {
          console.warn('Skipping image without directoryId:', image.name);
          return; // Skip this image
        }
        const request = store.put(image);
        request.onsuccess = () => {
          putCount++;
        };
        // Errors on individual requests will bubble up to the transaction's onerror
      });

      // If no images were actually processed, resolve immediately.
      if (images.length === 0) {
          resolve();
      }
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
      const transaction = this.db!.transaction(['images'], 'readwrite');
      const store = transaction.objectStore('images');
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = async () => {
        const images: IndexedImage[] = request.result;
        const idsToDelete: string[] = [];
        for (const image of images) {
          try {
            JSON.parse(image.metadataString);
          } catch (error) {
            console.warn(`❌ Invalid metadata JSON for ${image.name}, scheduling for removal from cache.`);
            idsToDelete.push(image.id);
          }
        }

        if (idsToDelete.length > 0) {
          // Re-open transaction to delete
          const deleteTransaction = this.db!.transaction(['images'], 'readwrite');
          const deleteStore = deleteTransaction.objectStore('images');
          idsToDelete.forEach(id => deleteStore.delete(id));
          await new Promise(res => { deleteTransaction.oncomplete = res });
        }

        resolve(idsToDelete.length);
      };
    });
  }

  async clearCache(): Promise<void> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return;
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['images', 'thumbnails'], 'readwrite');
      const imageStore = transaction.objectStore('images');
      const thumbStore = transaction.objectStore('thumbnails');
      const clearImages = imageStore.clear();
      const clearThumbs = thumbStore.clear();
      let completed = 0;
      const checkComplete = () => {
        completed++;
        if (completed === 2) {
            console.log("Cleared 'images' and 'thumbnails' stores.");
            resolve();
        }
      };
      clearImages.onerror = () => reject(clearImages.error);
      clearThumbs.onerror = () => reject(clearThumbs.error);
      clearImages.onsuccess = checkComplete;
      clearThumbs.onsuccess = checkComplete;
    });
  }

  async clearDirectoryCache(directoryId: string): Promise<void> {
    if (!this.db) {
      console.warn('Cache not initialized. Call init() first.');
      return;
    }
    const imagesToDelete = await this.getCachedImagesForDirectory(directoryId);
    if (imagesToDelete.length === 0) {
      return;
    }

    const transaction = this.db.transaction(['images'], 'readwrite');
    const store = transaction.objectStore('images');
    let deleteCount = 0;

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
            console.log(`✅ Cleared ${deleteCount} cached images for directory: ${directoryId}`);
            resolve();
        };
        transaction.onerror = () => reject(transaction.error);

        for (const image of imagesToDelete) {
            const request = store.delete(image.id);
            request.onsuccess = () => {
                deleteCount++;
            };
        }
    });
  }

  async validateCacheAndGetDiff(
    directoryId: string,
    currentFiles: { name: string; lastModified: number }[]
  ): Promise<CacheDiff> {
    const cachedImages = await this.getCachedImagesForDirectory(directoryId);

    if (cachedImages.length === 0) {
      console.log(`❌ NO CACHE FOUND for "${directoryId}". Performing full scan.`);
      return {
        newAndModifiedFiles: currentFiles,
        deletedFileIds: [],
        cachedImages: [],
        needsFullRefresh: true,
      };
    }
    
    console.log(`✅ CACHE FOUND for "${directoryId}". Analyzing diff...`);

    const cachedImagesMap = new Map(cachedImages.map(img => [img.name, img]));
    const newAndModifiedFiles: { name: string; lastModified: number }[] = [];
    const upToDateCachedImages: IndexedImage[] = [];
    const currentFileNames = new Set<string>();

    for (const file of currentFiles) {
      currentFileNames.add(file.name);
      const cachedFile = cachedImagesMap.get(file.name);

      if (!cachedFile) {
        newAndModifiedFiles.push(file);
      } else if (cachedFile.lastModified < file.lastModified) {
        newAndModifiedFiles.push(file);
      } else {
        // The image is in cache and up-to-date
        upToDateCachedImages.push({
          ...cachedFile,
          handle: { name: cachedFile.name, kind: 'file' } as any, // Mock handle
        });
      }
    }

    const deletedFileIds = cachedImages
      .filter(img => !currentFileNames.has(img.name))
      .map(img => img.id);

    console.log(`   - ${newAndModifiedFiles.length} new or modified files to process.`);
    console.log(`   - ${deletedFileIds.length} deleted files to remove.`);
    console.log(`   - ${upToDateCachedImages.length} images restored from cache.`);

    return {
      newAndModifiedFiles,
      deletedFileIds,
      cachedImages: upToDateCachedImages,
      needsFullRefresh: false,
    };
  }
}

const cacheManager = new CacheManager();
export { cacheManager };
export default cacheManager;