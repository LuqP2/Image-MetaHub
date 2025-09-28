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
  private dbVersion = 1;
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    console.log('🔧 cacheManager.init() starting...');
    return new Promise((resolve, reject) => {
      console.log('🔧 Opening IndexedDB:', this.dbName, 'version:', this.dbVersion);
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('❌ IndexedDB open error:', request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        console.log('✅ IndexedDB opened successfully');
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        console.log('🔧 IndexedDB upgrade needed, creating stores...');
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create cache store
        if (!db.objectStoreNames.contains('cache')) {
          console.log('🔧 Creating cache store...');
          const cacheStore = db.createObjectStore('cache', { keyPath: 'id' });
          cacheStore.createIndex('directoryName', 'directoryName', { unique: false });
        }

        // Create thumbnails store
        if (!db.objectStoreNames.contains('thumbnails')) {
          console.log('🔧 Creating thumbnails store...');
          const thumbStore = db.createObjectStore('thumbnails', { keyPath: 'id' });
        }
        console.log('✅ IndexedDB stores created');
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
      request.onsuccess = () => {
        const result = request.result || null;
        // if (result) {
        //   console.log(`🔍 CACHE LOOKUP: "${directoryName}" -> Found ${result.imageCount} images (saved ${new Date(result.lastScan).toLocaleString()})`);
        // } else {
        //   console.log(`🔍 CACHE LOOKUP: "${directoryName}" -> Not found`);
        // }
        resolve(result);
      };
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
        scheduler: img.scheduler,
      })),
      thumbnails: new Map()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      const request = store.put(cacheEntry);

      request.onerror = () => {
        console.error('❌ CACHE SAVE FAILED:', request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        // console.log(`✅ CACHE SAVED: ${directoryName} with ${images.length} images`);
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
      console.log(`⏰ CACHE EXPIRED: ${ageMinutes} minutes old (max: 60 minutes)`);
      return { shouldRefresh: true };
    }

    console.log(`✅ CACHE VALID: Using cached data`);
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
        console.log(`✅ CACHE UPDATED INCREMENTALLY: ${newImages.length} new images added`);
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
            console.log(`🧹 CLEANED ${removedCount} STALE CACHE ENTRIES`);
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
