/**
 * Cluster Cache Manager
 * Manages cluster and auto-tag cache storage in userData directory
 *
 * Cache location: app.getPath('userData')/smart-library-cache/
 * This avoids polluting user's image directories with metadata files
 */

import { ImageCluster, AutoTag, TFIDFModel } from '../types';
import { PARSER_VERSION } from './cacheManager';

/**
 * Cluster cache entry structure
 */
export interface ClusterCacheEntry {
  id: string;                           // Directory ID hash
  directoryPath: string;                // Original directory path
  scanSubfolders: boolean;              // Scan mode
  clusters: ImageCluster[];
  lastGenerated: number;                // Timestamp
  parserVersion: number;                // Track clustering version
  similarityThreshold: number;          // Threshold used
}

/**
 * Auto-tag cache entry structure
 */
export interface AutoTagCacheEntry {
  id: string;                           // Directory ID hash
  directoryPath: string;                // Original directory path
  scanSubfolders: boolean;              // Scan mode
  autoTags: Record<string, AutoTag[]>;  // imageId → tags
  tfidfModel: TFIDFModelSerialized;     // Cached IDF scores (serialized)
  lastGenerated: number;                // Timestamp
  parserVersion: number;                // Track tagging version
}

/**
 * Serializable TF-IDF model (Map converted to object for JSON)
 */
export interface TFIDFModelSerialized {
  vocabulary: string[];
  idfScores: Record<string, number>;    // Serialized Map
  documentCount: number;
}

/**
 * Generate a unique ID hash for a directory path
 * Uses a lightweight FNV-1a hash to avoid MAX_PATH issues
 */
export function generateDirectoryIdHash(directoryPath: string, scanSubfolders: boolean): string {
  const normalizedPath = directoryPath.replace(/[\\/]+$/, '');
  const key = `${normalizedPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function decodeCachePayload(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder('utf-8').decode(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder('utf-8').decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  return String(data ?? '');
}

/**
 * Get the cache directory path
 * Returns: {userData}/smart-library-cache/
 */
export async function getCacheDirectory(): Promise<string> {
  if (typeof window !== 'undefined' && window.electronAPI) {
    // Electron environment
    const userDataPath = await window.electronAPI.getUserDataPath();
    const cacheDir = `${userDataPath}/smart-library-cache`;

    // Ensure directory exists
    await window.electronAPI.ensureDirectory(cacheDir);

    return cacheDir;
  } else {
    // Web environment - use IndexedDB or fallback
    throw new Error('Cluster cache is only available in Electron environment');
  }
}

/**
 * Load cluster cache for a directory
 */
export async function loadClusterCache(
  directoryPath: string,
  scanSubfolders: boolean
): Promise<ClusterCacheEntry | null> {
  try {
    const cacheDir = await getCacheDirectory();
    const idHash = generateDirectoryIdHash(directoryPath, scanSubfolders);
    const cachePath = `${cacheDir}/${idHash}-clusters.json`;

    if (typeof window !== 'undefined' && window.electronAPI) {
      const content = await window.electronAPI.readFile(cachePath);
      if (!content.success || !content.data) {
        return null;
      }
      const cache: ClusterCacheEntry = JSON.parse(decodeCachePayload(content.data));

      // Validate cache version
      if (cache.parserVersion !== PARSER_VERSION) {
        console.warn(`Cluster cache version mismatch. Expected ${PARSER_VERSION}, got ${cache.parserVersion}. Invalidating cache.`);
        await invalidateClusterCache(directoryPath, scanSubfolders, 'version_mismatch');
        return null;
      }

      return cache;
    }

    return null;
  } catch (error) {
    // Cache file doesn't exist or is corrupted
    console.debug('Cluster cache not found or corrupted:', error);
    return null;
  }
}

/**
 * Save cluster cache for a directory
 * Uses atomic write (temp file + rename) to prevent corruption
 */
export async function saveClusterCache(
  directoryPath: string,
  scanSubfolders: boolean,
  clusters: ImageCluster[],
  similarityThreshold: number
): Promise<void> {
  try {
    const cacheDir = await getCacheDirectory();
    const idHash = generateDirectoryIdHash(directoryPath, scanSubfolders);
    const cachePath = `${cacheDir}/${idHash}-clusters.json`;
    const tempPath = `${cachePath}.tmp`;

    const cacheEntry: ClusterCacheEntry = {
      id: idHash,
      directoryPath,
      scanSubfolders,
      clusters,
      lastGenerated: Date.now(),
      parserVersion: PARSER_VERSION,
      similarityThreshold,
    };

    if (typeof window !== 'undefined' && window.electronAPI) {
      // Atomic write: write to temp file, then rename
      await window.electronAPI.writeFile(tempPath, JSON.stringify(cacheEntry, null, 2));

      // Rename temp to final (atomic operation on most filesystems)
      try {
        await window.electronAPI.renameFile(tempPath, cachePath);
      } catch (renameError) {
        // Fallback: if rename fails, try delete + rename
        try {
          await window.electronAPI.deleteFile(cachePath);
        } catch {
          // Ignore if file doesn't exist
        }
        await window.electronAPI.renameFile(tempPath, cachePath);
      }

      console.log(`Cluster cache saved atomically: ${clusters.length} clusters`);
    }
  } catch (error) {
    console.error('Failed to save cluster cache:', error);
    throw error;
  }
}

/**
 * Load auto-tag cache for a directory
 */
export async function loadAutoTagCache(
  directoryPath: string,
  scanSubfolders: boolean
): Promise<AutoTagCacheEntry | null> {
  try {
    const cacheDir = await getCacheDirectory();
    const idHash = generateDirectoryIdHash(directoryPath, scanSubfolders);
    const cachePath = `${cacheDir}/${idHash}-autotags.json`;

    if (typeof window !== 'undefined' && window.electronAPI) {
      const content = await window.electronAPI.readFile(cachePath);
      if (!content.success || !content.data) {
        return null;
      }
      const cache: AutoTagCacheEntry = JSON.parse(decodeCachePayload(content.data));

      // Validate cache version
      if (cache.parserVersion !== PARSER_VERSION) {
        console.warn(`Auto-tag cache version mismatch. Expected ${PARSER_VERSION}, got ${cache.parserVersion}. Invalidating cache.`);
        await invalidateAutoTagCache(directoryPath, scanSubfolders, 'version_mismatch');
        return null;
      }

      return cache;
    }

    return null;
  } catch (error) {
    // Cache file doesn't exist or is corrupted
    console.debug('Auto-tag cache not found or corrupted:', error);
    return null;
  }
}

/**
 * Save auto-tag cache for a directory
 * Uses atomic write (temp file + rename) to prevent corruption
 */
export async function saveAutoTagCache(
  directoryPath: string,
  scanSubfolders: boolean,
  autoTags: Record<string, AutoTag[]>,
  tfidfModel: TFIDFModel
): Promise<void> {
  try {
    const cacheDir = await getCacheDirectory();
    const idHash = generateDirectoryIdHash(directoryPath, scanSubfolders);
    const cachePath = `${cacheDir}/${idHash}-autotags.json`;
    const tempPath = `${cachePath}.tmp`;

    // Serialize TF-IDF model (convert Map to object)
    const serializedModel: TFIDFModelSerialized = {
      vocabulary: tfidfModel.vocabulary,
      idfScores: Object.fromEntries(tfidfModel.idfScores),
      documentCount: tfidfModel.documentCount,
    };

    const cacheEntry: AutoTagCacheEntry = {
      id: idHash,
      directoryPath,
      scanSubfolders,
      autoTags,
      tfidfModel: serializedModel,
      lastGenerated: Date.now(),
      parserVersion: PARSER_VERSION,
    };

    if (typeof window !== 'undefined' && window.electronAPI) {
      // Atomic write: write to temp file, then rename
      await window.electronAPI.writeFile(tempPath, JSON.stringify(cacheEntry, null, 2));

      // Rename temp to final (atomic operation)
      try {
        await window.electronAPI.renameFile(tempPath, cachePath);
      } catch (renameError) {
        // Fallback: if rename fails, try delete + rename
        try {
          await window.electronAPI.deleteFile(cachePath);
        } catch {
          // Ignore if file doesn't exist
        }
        await window.electronAPI.renameFile(tempPath, cachePath);
      }

      console.log(`Auto-tag cache saved atomically: ${Object.keys(autoTags).length} images tagged`);
    }
  } catch (error) {
    console.error('Failed to save auto-tag cache:', error);
    throw error;
  }
}

/**
 * Invalidate (delete) cluster cache
 */
export async function invalidateClusterCache(
  directoryPath: string,
  scanSubfolders: boolean,
  reason: string
): Promise<void> {
  try {
    const cacheDir = await getCacheDirectory();
    const idHash = generateDirectoryIdHash(directoryPath, scanSubfolders);
    const cachePath = `${cacheDir}/${idHash}-clusters.json`;

    console.log(`Invalidating cluster cache. Reason: ${reason}`);

    if (typeof window !== 'undefined' && window.electronAPI) {
      // Delete cache file if exists
      try {
        await window.electronAPI.deleteFile(cachePath);
      } catch (error) {
        // File might not exist, ignore
      }
    }
  } catch (error) {
    console.error('Failed to invalidate cluster cache:', error);
  }
}

/**
 * Invalidate (delete) auto-tag cache
 */
export async function invalidateAutoTagCache(
  directoryPath: string,
  scanSubfolders: boolean,
  reason: string
): Promise<void> {
  try {
    const cacheDir = await getCacheDirectory();
    const idHash = generateDirectoryIdHash(directoryPath, scanSubfolders);
    const cachePath = `${cacheDir}/${idHash}-autotags.json`;

    console.log(`Invalidating auto-tag cache. Reason: ${reason}`);

    if (typeof window !== 'undefined' && window.electronAPI) {
      // Delete cache file if exists
      try {
        await window.electronAPI.deleteFile(cachePath);
      } catch (error) {
        // File might not exist, ignore
      }
    }
  } catch (error) {
    console.error('Failed to invalidate auto-tag cache:', error);
  }
}

/**
 * Deserialize TF-IDF model (convert object back to Map)
 */
export function deserializeTFIDFModel(serialized: TFIDFModelSerialized): TFIDFModel {
  return {
    vocabulary: serialized.vocabulary,
    idfScores: new Map(Object.entries(serialized.idfScores)),
    documentCount: serialized.documentCount,
  };
}
