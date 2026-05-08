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
  sourceSignature: string;              // Signature of prompt-bearing images used for cache validity
  sourceImageCount: number;             // Total prompt-bearing images at generation time
  processedImageCount: number;          // Images actually clustered under the active license
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

type SmartLibraryCacheKind = 'clusters' | 'autotags';

const canUseSmartLibraryCacheIpc = (): boolean =>
  typeof window !== 'undefined' &&
  !!window.electronAPI?.readSmartLibraryCache &&
  !!window.electronAPI?.writeSmartLibraryCache &&
  !!window.electronAPI?.deleteSmartLibraryCache;

async function readSmartLibraryCache(cacheId: string, kind: SmartLibraryCacheKind): Promise<string | null> {
  if (!canUseSmartLibraryCacheIpc()) {
    return null;
  }

  const result = await window.electronAPI!.readSmartLibraryCache({ cacheId, kind });
  if (!result.success || !result.data) {
    return null;
  }

  return decodeCachePayload(result.data);
}

async function writeSmartLibraryCache(cacheId: string, kind: SmartLibraryCacheKind, data: unknown): Promise<void> {
  if (!canUseSmartLibraryCacheIpc()) {
    return;
  }

  const result = await window.electronAPI!.writeSmartLibraryCache({ cacheId, kind, data });
  if (!result.success) {
    throw new Error(result.error || `Failed to write smart library ${kind} cache.`);
  }
}

async function deleteSmartLibraryCache(cacheId: string, kind: SmartLibraryCacheKind): Promise<void> {
  if (!canUseSmartLibraryCacheIpc()) {
    return;
  }

  const result = await window.electronAPI!.deleteSmartLibraryCache({ cacheId, kind });
  if (!result.success) {
    throw new Error(result.error || `Failed to delete smart library ${kind} cache.`);
  }
}

/**
 * Get the cache directory path
 * Returns: {userData}/smart-library-cache/
 */
export async function getCacheDirectory(): Promise<string> {
  if (typeof window !== 'undefined' && window.electronAPI) {
    const electronAPI = window.electronAPI;
    let basePath: string | undefined;

    if (typeof electronAPI.getUserDataPath === 'function') {
      try {
        basePath = await electronAPI.getUserDataPath();
      } catch (error) {
        console.warn('[ClusterCacheManager] getUserDataPath failed, falling back:', error);
      }
    }

    if (!basePath && typeof electronAPI.getDefaultCachePath === 'function') {
      const result = await electronAPI.getDefaultCachePath();
      if (result?.success && result.path) {
        basePath = result.path;
      }
    }

    if (!basePath) {
      throw new Error('Unable to resolve cache directory base path');
    }

    let cacheDir = `${basePath}/smart-library-cache`;
    if (typeof electronAPI.joinPaths === 'function') {
      const joined = await electronAPI.joinPaths(basePath, 'smart-library-cache');
      if (joined?.success && joined.path) {
        cacheDir = joined.path;
      }
    }

    if (typeof electronAPI.ensureDirectory === 'function') {
      await electronAPI.ensureDirectory(cacheDir);
    } else {
      console.warn('[ClusterCacheManager] ensureDirectory unavailable; cache folder creation skipped');
    }

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
  scanSubfolders: boolean,
  expectedSourceSignature?: string
): Promise<ClusterCacheEntry | null> {
  try {
    const idHash = generateDirectoryIdHash(directoryPath, scanSubfolders);

    if (typeof window !== 'undefined' && window.electronAPI) {
      const content = await readSmartLibraryCache(idHash, 'clusters');
      if (!content) {
        return null;
      }
      const cache: ClusterCacheEntry = JSON.parse(content);

      // Validate cache version
      if (cache.parserVersion !== PARSER_VERSION) {
        console.warn(`Cluster cache version mismatch. Expected ${PARSER_VERSION}, got ${cache.parserVersion}. Invalidating cache.`);
        await invalidateClusterCache(directoryPath, scanSubfolders, 'version_mismatch');
        return null;
      }

      if (expectedSourceSignature && cache.sourceSignature !== expectedSourceSignature) {
        console.warn('Cluster cache source signature mismatch. Invalidating cache.');
        await invalidateClusterCache(directoryPath, scanSubfolders, 'source_signature_mismatch');
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
  similarityThreshold: number,
  sourceSignature: string,
  sourceImageCount: number,
  processedImageCount: number
): Promise<void> {
  try {
    const idHash = generateDirectoryIdHash(directoryPath, scanSubfolders);

    const cacheEntry: ClusterCacheEntry = {
      id: idHash,
      directoryPath,
      scanSubfolders,
      clusters,
      sourceSignature,
      sourceImageCount,
      processedImageCount,
      lastGenerated: Date.now(),
      parserVersion: PARSER_VERSION,
      similarityThreshold,
    };

    if (typeof window !== 'undefined' && window.electronAPI) {
      await writeSmartLibraryCache(idHash, 'clusters', cacheEntry);
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
    const idHash = generateDirectoryIdHash(directoryPath, scanSubfolders);

    if (typeof window !== 'undefined' && window.electronAPI) {
      const content = await readSmartLibraryCache(idHash, 'autotags');
      if (!content) {
        return null;
      }
      const cache: AutoTagCacheEntry = JSON.parse(content);

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
    const idHash = generateDirectoryIdHash(directoryPath, scanSubfolders);

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
      await writeSmartLibraryCache(idHash, 'autotags', cacheEntry);
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
    const idHash = generateDirectoryIdHash(directoryPath, scanSubfolders);

    console.log(`Invalidating cluster cache. Reason: ${reason}`);

    if (typeof window !== 'undefined' && window.electronAPI) {
      await deleteSmartLibraryCache(idHash, 'clusters');
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
    const idHash = generateDirectoryIdHash(directoryPath, scanSubfolders);

    console.log(`Invalidating auto-tag cache. Reason: ${reason}`);

    if (typeof window !== 'undefined' && window.electronAPI) {
      await deleteSmartLibraryCache(idHash, 'autotags');
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
