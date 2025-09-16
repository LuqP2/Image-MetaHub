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
  }[];
  thumbnails: Map<string, Blob>; // Store thumbnail blobs
}

class CacheManager {
  private dbName = 'invokeai-browser-cache';
  private dbVersion = 1;
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create cache store
        if (!db.objectStoreNames.contains('cache')) {
          const cacheStore = db.createObjectStore('cache', { keyPath: 'id' });
          cacheStore.createIndex('directoryName', 'directoryName', { unique: false });
        }

        // Create thumbnails store
        if (!db.objectStoreNames.contains('thumbnails')) {
          const thumbStore = db.createObjectStore('thumbnails', { keyPath: 'id' });
        }
      };
    });
  }

  async getCachedData(directoryName: string): Promise<CacheEntry | null> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readonly');
      const store = transaction.objectStore('cache');
      const request = store.get(directoryName);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async cacheData(
    directoryName: string,
    images: IndexedImage[]
  ): Promise<void> {
    if (!this.db) await this.init();

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
      })),
      thumbnails: new Map()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      const request = store.put(cacheEntry);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        // console.log removed
        resolve();
      };
    });
  }

  async cacheThumbnail(imageId: string, blob: Blob): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['thumbnails'], 'readwrite');
      const store = transaction.objectStore('thumbnails');
      const request = store.put({ id: imageId, blob });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getCachedThumbnail(imageId: string): Promise<Blob | null> {
    if (!this.db) await this.init();

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

  async clearCache(): Promise<void> {
    if (!this.db) await this.init();

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

  async shouldRefreshCache(
    directoryName: string,
    currentImageCount: number
  ): Promise<boolean> {
    const cached = await this.getCachedData(directoryName);
    
    if (!cached) return true;
    
    // Refresh if image count changed significantly
    const countDiff = Math.abs(cached.imageCount - currentImageCount);
    const countChangeThreshold = Math.max(10, cached.imageCount * 0.05); // 5% or 10 images
    
    if (countDiff > countChangeThreshold) {
      // console.log removed
      return true;
    }

    // Refresh if cache is older than 1 hour
    const cacheAge = Date.now() - cached.lastScan;
    const maxAge = 60 * 60 * 1000; // 1 hour
    
    if (cacheAge > maxAge) {
      // console.log removed
      return true;
    }

    return false;
  }
}

// Export cache manager instance
const cacheManager = new CacheManager();
export { cacheManager };
export default cacheManager;
