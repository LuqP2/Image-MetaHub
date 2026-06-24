import {
  type IndexedImage,
  type ThumbnailCacheBatchStats,
  type ThumbnailCacheCandidate,
  type ThumbnailCacheResolveResult,
  type ThumbnailGenerateToCacheRequest,
} from '../types';

/**
 * Parser version - increment when parser logic changes significantly
 * This ensures cache is invalidated when parsing rules change
 */
export const PARSER_VERSION = 9; // v9: Preserve probed audio stream metadata on normalized video records

// Simplified metadata structure for the JSON cache
export interface CacheImageMetadata {
  id: string;
  name:string;
  metadataString: string;
  metadata: any;
  lastModified: number;
  contentModifiedMs?: number;
  models: string[];
  loras: string[] | (string | { name: string; model_name?: string; weight?: number; model_weight?: number; clip_weight?: number })[]; // Support both formats for backward compatibility
  sampler?: string;
  scheduler: string;
  board?: string;
  prompt?: string;
  negativePrompt?: string;
  cfgScale?: number;
  steps?: number;
  seed?: number;
  dimensions?: string;
  workflowNodes?: string[];
  enrichmentState?: 'catalog' | 'enriched';
  fileSize?: number;
  fileType?: string;

  // Smart Clustering & Auto-Tagging (Phase 1)
  clusterId?: string;
  clusterPosition?: number;
  autoTags?: string[];
  autoTagsGeneratedAt?: number;
}

// Main structure for the JSON cache file
export interface CacheEntry {
  id: string; // e.g., 'C:/Users/Jules/Pictures-recursive'
  directoryPath: string;
  directoryName: string;
  lastScan: number;
  imageCount: number;
  metadata: CacheImageMetadata[];
  chunkCount?: number;
  parserVersion?: number; // Track which parser version created this cache
}

export interface CacheDiff {
  newAndModifiedFiles: { name: string; lastModified: number; size?: number; type?: string; birthtimeMs?: number; contentModifiedMs?: number }[];
  deletedFileIds: string[];
  cachedImages: IndexedImage[];
  needsFullRefresh: boolean;
}

const DEFAULT_INCREMENTAL_CHUNK_SIZE = 1024;
const MAX_INLINE_RAW_METADATA_BYTES = 32 * 1024;
const RAW_METADATA_PREVIEW_BYTES = 4096;

const logCachePerf = (
  event: string,
  details: Record<string, unknown> = {}
) => {
  console.log('[cache:perf]', { event, ...details });
};

const toFixedMs = (durationMs: number) => Number(durationMs.toFixed(2));
const isSlow = (durationMs: number, thresholdMs = 500) => durationMs >= thresholdMs;

const estimateJsonBytes = (value: unknown): number | null => {
  try {
    return JSON.stringify(value).length;
  } catch {
    return null;
  }
};

const isCurrentParserVersion = (parserVersion: number | undefined): boolean => (
  parserVersion === PARSER_VERSION
);

const warnParserVersionMismatch = (cacheId: string, parserVersion: number | undefined) => {
  console.warn(
    `Cache parser version mismatch for ${cacheId}. Expected ${PARSER_VERSION}, got ${parserVersion ?? 'none'}. Invalidating cache.`
  );
};

function compactCacheMetadataEntry(entry: CacheImageMetadata): CacheImageMetadata {
  const metadataString = typeof entry.metadataString === 'string' ? entry.metadataString : '';
  if (metadataString.length <= MAX_INLINE_RAW_METADATA_BYTES) {
    return entry;
  }

  const metadata = entry.metadata && typeof entry.metadata === 'object'
    ? entry.metadata as Record<string, any>
    : {};
  const normalizedMetadata = metadata.normalizedMetadata;
  const compactedMetadata: Record<string, unknown> = {
    _rawMetadataCompacted: true,
    _rawMetadataSizeBytes: metadataString.length,
    _rawMetadataKeys: Object.keys(metadata).filter(key => key !== 'normalizedMetadata'),
  };

  if (typeof metadata.parameters === 'string') {
    compactedMetadata.parametersPreview = metadata.parameters.slice(0, RAW_METADATA_PREVIEW_BYTES);
  }

  if (metadata.imagemetahub_data && typeof metadata.imagemetahub_data === 'object') {
    const payload = metadata.imagemetahub_data as Record<string, unknown>;
    compactedMetadata.imagemetahub_data = {
      generator: payload.generator,
      analytics: payload.analytics,
      _analytics: payload._analytics,
      imh_pro: payload.imh_pro,
      _metahub_pro: payload._metahub_pro,
      imh_attribution: payload.imh_attribution,
    };
  }

  if (normalizedMetadata) {
    compactedMetadata.normalizedMetadata = normalizedMetadata;
  }

  return {
    ...entry,
    metadata: compactedMetadata,
    metadataString: JSON.stringify(compactedMetadata),
  };
}

function compactCacheMetadataEntries(metadata: CacheImageMetadata[]): CacheImageMetadata[] {
  return metadata.map(compactCacheMetadataEntry);
}

const getRelativeCacheName = (id: string, name: string): string => {
  const separatorIndex = id.indexOf('::');
  const idRelativeName = separatorIndex >= 0
    ? id.slice(separatorIndex + 2)
    : '';
  return (idRelativeName || name)
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
};

export function pruneCacheMetadata(
  metadata: CacheImageMetadata[],
  options: { ids?: Iterable<string>; names?: Iterable<string> }
): CacheImageMetadata[] {
  const ids = new Set(options.ids ?? []);
  const names = new Set(
    Array.from(options.names ?? [])
      .map((name) => name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
  );

  if (ids.size === 0 && names.size === 0) {
    return metadata;
  }

  return metadata.filter((entry) => {
    const normalizedName = getRelativeCacheName(entry.id, entry.name);
    const matchedName = names.has(normalizedName);
    return !ids.has(entry.id) && !matchedName;
  });
}

function toCacheMetadata(images: IndexedImage[]): CacheImageMetadata[] {
  return images.map(img => ({
    id: img.id,
    name: img.name,
    metadataString: img.metadataString,
    metadata: img.metadata,
    lastModified: img.lastModified,
    contentModifiedMs: img.contentModifiedMs,
    models: img.models,
    loras: img.loras,
    sampler: img.sampler,
    scheduler: img.scheduler,
    board: img.board,
    prompt: img.prompt,
    negativePrompt: img.negativePrompt,
    cfgScale: img.cfgScale,
    steps: img.steps,
    seed: img.seed,
    dimensions: img.dimensions,
    workflowNodes: img.workflowNodes,
    enrichmentState: img.enrichmentState,
    fileSize: img.fileSize,
    fileType: img.fileType,

    // Smart Clustering & Auto-Tagging (Phase 1)
    clusterId: img.clusterId,
    clusterPosition: img.clusterPosition,
    autoTags: img.autoTags,
    autoTagsGeneratedAt: img.autoTagsGeneratedAt,
  }));
}

const isCloneError = (error: unknown): boolean => {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /clone|deserialize|DataCloneError|serialize|serializer/i.test(message);
};

const safeJsonClone = (value: unknown): any => {
  try {
    return JSON.parse(JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') {
        return val.toString();
      }
      if (val instanceof Map) {
        return Object.fromEntries(val);
      }
      if (val instanceof Set) {
        return Array.from(val);
      }
      if (val instanceof Date) {
        return val.toISOString();
      }
      if (ArrayBuffer.isView(val)) {
        const view = val as ArrayBufferView;
        return Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      }
      if (val instanceof ArrayBuffer) {
        return Array.from(new Uint8Array(val));
      }
      return val;
    }));
  } catch {
    return null;
  }
};

const sanitizeCacheMetadata = (
  metadata: CacheImageMetadata[],
  options: { forceClone?: boolean } = {}
): CacheImageMetadata[] => {
  const forceClone = options.forceClone ?? false;
  let didChange = false;

  const sanitized = metadata.map(entry => {
    if (!forceClone) {
      return entry;
    }

    didChange = true;
    return {
      ...entry,
      metadata: safeJsonClone(entry.metadata),
    };
  });

  return didChange ? sanitized : metadata;
};

class IncrementalCacheWriter {
  private chunkIndex = 0;
  private totalImages = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly cacheId: string;

  constructor(
    private readonly directoryPath: string,
    private readonly directoryName: string,
    private readonly scanSubfolders: boolean,
    private readonly chunkSize: number = DEFAULT_INCREMENTAL_CHUNK_SIZE
  ) {
    this.cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
  }

  get targetChunkSize(): number {
    return this.chunkSize;
  }

  async initialize(): Promise<void> {
    const start = performance.now();
    const result = await window.electronAPI?.prepareCacheWrite?.({ cacheId: this.cacheId });
    if (result && !result.success) {
      throw new Error(result.error || 'Failed to prepare cache write');
    }
    logCachePerf('incremental-writer:initialize', {
      cacheId: this.cacheId,
      durationMs: toFixedMs(performance.now() - start),
    });
  }

  async append(images: IndexedImage[], precomputed?: CacheImageMetadata[]): Promise<CacheImageMetadata[]> {
    if (!images || images.length === 0) {
      return [];
    }

    const metadata = precomputed ?? toCacheMetadata(images);
    let preparedMetadata = sanitizeCacheMetadata(metadata);
    const chunkNumber = this.chunkIndex++;
    this.totalImages += images.length;

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const writeStart = performance.now();
        const result = await window.electronAPI?.writeCacheChunk?.({
          cacheId: this.cacheId,
          chunkIndex: chunkNumber,
          data: preparedMetadata,
        });
        if (result && !result.success) {
          throw new Error(result.error || 'Failed to write cache chunk');
        }
        const durationMs = performance.now() - writeStart;
        const estimatedBytes = estimateJsonBytes(preparedMetadata);
        if (isSlow(durationMs) || (estimatedBytes ?? 0) > 8_000_000) {
          logCachePerf('incremental-writer:append-chunk:slow', {
            cacheId: this.cacheId,
            chunkIndex: chunkNumber,
            images: images.length,
            estimatedBytes,
            durationMs: toFixedMs(durationMs),
          });
        }
      } catch (err) {
        if (isCloneError(err)) {
          console.warn('[Cache] Cache chunk serialization failed, retrying with sanitized payload.', err);
          preparedMetadata = sanitizeCacheMetadata(metadata, { forceClone: true });
          const retryStart = performance.now();
          const retry = await window.electronAPI?.writeCacheChunk?.({
            cacheId: this.cacheId,
            chunkIndex: chunkNumber,
            data: preparedMetadata,
          });
          if (retry && !retry.success) {
            console.error('[Cache] Failed to write cache chunk after sanitization:', retry.error);
            throw new Error(retry.error || 'Failed to write cache chunk');
          }
          logCachePerf('incremental-writer:append-chunk-retry', {
            cacheId: this.cacheId,
            chunkIndex: chunkNumber,
            images: images.length,
            estimatedBytes: estimateJsonBytes(preparedMetadata),
            durationMs: toFixedMs(performance.now() - retryStart),
          });
          return;
        }
        throw err;
      }
    });

    await this.writeQueue;
    return preparedMetadata;
  }

  async overwrite(chunkIndex: number, metadata: CacheImageMetadata[]): Promise<void> {
    if (!metadata) {
      return;
    }

    const preparedMetadata = sanitizeCacheMetadata(metadata);
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const writeStart = performance.now();
        const result = await window.electronAPI?.writeCacheChunk?.({
          cacheId: this.cacheId,
          chunkIndex,
          data: preparedMetadata,
        });
        if (result && !result.success) {
          throw new Error(result.error || 'Failed to rewrite cache chunk');
        }
        const durationMs = performance.now() - writeStart;
        const estimatedBytes = estimateJsonBytes(preparedMetadata);
        if (isSlow(durationMs) || (estimatedBytes ?? 0) > 8_000_000) {
          logCachePerf('incremental-writer:overwrite-chunk:slow', {
            cacheId: this.cacheId,
            chunkIndex,
            records: metadata.length,
            estimatedBytes,
            durationMs: toFixedMs(durationMs),
          });
        }
      } catch (err) {
        if (isCloneError(err)) {
          console.warn('[Cache] Cache chunk rewrite serialization failed, retrying with sanitized payload.', err);
          const sanitized = sanitizeCacheMetadata(metadata, { forceClone: true });
          metadata.splice(0, metadata.length, ...sanitized);
          const retryStart = performance.now();
          const retry = await window.electronAPI?.writeCacheChunk?.({
            cacheId: this.cacheId,
            chunkIndex,
            data: sanitized,
          });
          if (retry && !retry.success) {
            console.error('[Cache] Failed to rewrite cache chunk after sanitization:', retry.error);
            throw new Error(retry.error || 'Failed to rewrite cache chunk');
          }
          logCachePerf('incremental-writer:overwrite-chunk-retry', {
            cacheId: this.cacheId,
            chunkIndex,
            records: sanitized.length,
            estimatedBytes: estimateJsonBytes(sanitized),
            durationMs: toFixedMs(performance.now() - retryStart),
          });
          return;
        }
        throw err;
      }
    });

    await this.writeQueue;
  }

  async finalize(): Promise<void> {
    const start = performance.now();
    await this.writeQueue;

    const record = {
      id: this.cacheId,
      directoryPath: this.directoryPath,
      directoryName: this.directoryName,
      lastScan: Date.now(),
      imageCount: this.totalImages,
      chunkCount: this.chunkIndex,
      parserVersion: PARSER_VERSION,
    } satisfies Omit<CacheEntry, 'metadata'>;

    const result = await window.electronAPI?.finalizeCacheWrite?.({ cacheId: this.cacheId, record });
    if (result && !result.success) {
      throw new Error(result.error || 'Failed to finalize cache write');
    }
    logCachePerf('incremental-writer:finalize', {
      cacheId: this.cacheId,
      imageCount: this.totalImages,
      chunkCount: this.chunkIndex,
      durationMs: toFixedMs(performance.now() - start),
    });
  }
}

class CacheManager {
  private isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
  private chunkedCacheDeltaLocks = new Map<string, Promise<void>>();

  private async runChunkedCacheDeltaLocked<T>(cacheId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chunkedCacheDeltaLocks.get(cacheId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = previous
      .catch(() => undefined)
      .then(() => new Promise<void>((resolve) => {
        release = resolve;
      }));

    this.chunkedCacheDeltaLocks.set(cacheId, current);
    await previous.catch(() => undefined);

    try {
      return await operation();
    } finally {
      release?.();
      if (this.chunkedCacheDeltaLocks.get(cacheId) === current) {
        this.chunkedCacheDeltaLocks.delete(cacheId);
      }
    }
  }

  // No longer need init() for IndexedDB
  async init(): Promise<void> {
    if (!this.isElectron) {
      console.warn("JSON cache is only supported in Electron. Caching will be disabled.");
    }
    return Promise.resolve();
  }

  // Reads the entire cache from the JSON file via IPC
  async getCachedData(
    directoryPath: string,
    scanSubfolders: boolean,
  ): Promise<CacheEntry | null> {
    if (!this.isElectron) return null;

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const summaryFn = window.electronAPI.getCacheSummary ?? window.electronAPI.getCachedData;
    const start = performance.now();
    const result = await summaryFn(cacheId);

    if (!result.success) {
      console.error('Failed to get cached data:', result.error);
      logCachePerf('get-cached-data:error', {
        cacheId,
        durationMs: toFixedMs(performance.now() - start),
      });
      return null;
    }

    const summary = result.data;
    if (!summary) {
      logCachePerf('get-cached-data:miss', {
        cacheId,
        durationMs: toFixedMs(performance.now() - start),
      });
      return null;
    }
    if (!isCurrentParserVersion(summary.parserVersion)) {
      warnParserVersionMismatch(cacheId, summary.parserVersion);
      return null;
    }

    let metadata: CacheImageMetadata[] = Array.isArray(summary.metadata)
      ? compactCacheMetadataEntries(summary.metadata)
      : [];
    const chunkCount = summary.chunkCount ?? 0;

    if (metadata.length === 0 && chunkCount > 0) {
      const chunks: CacheImageMetadata[] = [];
      let chunkReadMs = 0;
      for (let i = 0; i < chunkCount; i++) {
        const chunkStart = performance.now();
        const chunkResult = await window.electronAPI.getCacheChunk({ cacheId, chunkIndex: i });
        chunkReadMs += performance.now() - chunkStart;
        if (chunkResult.success && Array.isArray(chunkResult.data)) {
          chunks.push(...compactCacheMetadataEntries(chunkResult.data));
        } else if (!chunkResult.success) {
          console.error(`Failed to load cache chunk ${i} for ${cacheId}:`, chunkResult.error);
        }
      }
      metadata = chunks;
      logCachePerf('get-cached-data:chunks-loaded', {
        cacheId,
        chunkCount,
        records: metadata.length,
        chunkReadMs: toFixedMs(chunkReadMs),
      });
    }

    const cacheEntry: CacheEntry = {
      id: summary.id,
      directoryPath: summary.directoryPath,
      directoryName: summary.directoryName,
      lastScan: summary.lastScan,
      imageCount: summary.imageCount,
      metadata,
      chunkCount: summary.chunkCount,
      parserVersion: summary.parserVersion,
    };

    logCachePerf('get-cached-data:hit', {
      cacheId,
      records: metadata.length,
      chunkCount,
      durationMs: toFixedMs(performance.now() - start),
    });
    return cacheEntry;
  }

  async getCacheSummary(
    directoryPath: string,
    scanSubfolders: boolean,
  ): Promise<Pick<CacheEntry, 'id' | 'directoryPath' | 'directoryName' | 'lastScan' | 'imageCount' | 'chunkCount' | 'parserVersion'> & { metadata?: CacheImageMetadata[] } | null> {
    if (!this.isElectron) return null;

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const summaryFn = window.electronAPI.getCacheSummary ?? window.electronAPI.getCachedData;
    const start = performance.now();
    const result = await summaryFn(cacheId);

    if (!result.success || !result.data) {
      if (!result.success) {
        console.error('Failed to get cache summary:', result.error);
      }
      logCachePerf(result.success ? 'get-cache-summary:miss' : 'get-cache-summary:error', {
        cacheId,
        durationMs: toFixedMs(performance.now() - start),
      });
      return null;
    }

    const summary = result.data;
    if (!isCurrentParserVersion(summary.parserVersion)) {
      warnParserVersionMismatch(cacheId, summary.parserVersion);
      return null;
    }

    logCachePerf('get-cache-summary:hit', {
      cacheId,
      imageCount: summary.imageCount ?? 0,
      chunkCount: summary.chunkCount ?? 0,
      hasInlineMetadata: Array.isArray(summary.metadata),
      durationMs: toFixedMs(performance.now() - start),
    });
    return {
      id: summary.id,
      directoryPath: summary.directoryPath,
      directoryName: summary.directoryName,
      lastScan: summary.lastScan,
      imageCount: summary.imageCount,
      chunkCount: summary.chunkCount,
      parserVersion: summary.parserVersion,
      metadata: Array.isArray(summary.metadata)
        ? compactCacheMetadataEntries(summary.metadata)
        : undefined,
    };
  }

  // (No-op) - This functionality is now implicit in getCachedData
  async iterateCachedMetadata(
    directoryPath: string,
    scanSubfolders: boolean,
    onChunk: (chunk: CacheImageMetadata[]) => void | Promise<void>
  ): Promise<void> {
    if (!this.isElectron) return;

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const summaryFn = window.electronAPI.getCacheSummary ?? window.electronAPI.getCachedData;
    const start = performance.now();
    const result = await summaryFn(cacheId);

    if (!result.success || !result.data) {
      if (!result.success) {
        console.error('Failed to iterate cached metadata:', result.error);
      }
      logCachePerf(result.success ? 'iterate-cached-metadata:miss' : 'iterate-cached-metadata:error', {
        cacheId,
        durationMs: toFixedMs(performance.now() - start),
      });
      return;
    }

    const summary = result.data;
    if (!isCurrentParserVersion(summary.parserVersion)) {
      warnParserVersionMismatch(cacheId, summary.parserVersion);
      return;
    }

    if (Array.isArray(summary.metadata) && summary.metadata.length > 0) {
      await onChunk(compactCacheMetadataEntries(summary.metadata));
      logCachePerf('iterate-cached-metadata:inline-complete', {
        cacheId,
        records: summary.metadata.length,
        durationMs: toFixedMs(performance.now() - start),
      });
      return;
    }

    const chunkCount = summary.chunkCount ?? 0;
    let records = 0;
    let chunkReadMs = 0;
    let callbackMs = 0;
    for (let i = 0; i < chunkCount; i++) {
      const chunkStart = performance.now();
      const chunkResult = await window.electronAPI.getCacheChunk({ cacheId, chunkIndex: i });
      chunkReadMs += performance.now() - chunkStart;
      if (chunkResult.success && Array.isArray(chunkResult.data) && chunkResult.data.length > 0) {
        const compacted = compactCacheMetadataEntries(chunkResult.data);
        records += compacted.length;
        const callbackStart = performance.now();
        await onChunk(compacted);
        callbackMs += performance.now() - callbackStart;
      } else if (!chunkResult.success) {
        console.error(`Failed to load cache chunk ${i} for ${cacheId}:`, chunkResult.error);
      }
    }
    logCachePerf('iterate-cached-metadata:chunks-complete', {
      cacheId,
      chunkCount,
      records,
      chunkReadMs: toFixedMs(chunkReadMs),
      callbackMs: toFixedMs(callbackMs),
      durationMs: toFixedMs(performance.now() - start),
    });
  }


  // Writes the entire cache to the JSON file via IPC
  async cacheData(
    directoryPath: string,
    directoryName: string,
    images: IndexedImage[],
    scanSubfolders: boolean
  ): Promise<void> {
    if (!this.isElectron) return;

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const start = performance.now();
    const metadata = sanitizeCacheMetadata(toCacheMetadata(images), { forceClone: true });
    
    const cacheEntry: CacheEntry = {
      id: cacheId,
      directoryPath,
      directoryName,
      lastScan: Date.now(),
      imageCount: images.length,
      metadata: metadata,
      parserVersion: PARSER_VERSION,
    };
    
    const result = await window.electronAPI.cacheData({ cacheId, data: cacheEntry });
    if (!result.success) {
      console.error("Failed to cache data:", result.error);
    }
    logCachePerf(result.success ? 'cache-data:complete' : 'cache-data:error', {
      cacheId,
      images: images.length,
      metadataBuildAndWriteMs: toFixedMs(performance.now() - start),
      estimatedBytes: estimateJsonBytes(metadata),
    });
  }

  async appendToCache(
    directoryPath: string,
    directoryName: string,
    images: IndexedImage[],
    scanSubfolders: boolean,
    options?: { chunkSize?: number }
  ): Promise<void> {
    if (!this.isElectron) return;
    if (!images || images.length === 0) return;

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const summaryFn = window.electronAPI.getCacheSummary ?? window.electronAPI.getCachedData;
    const start = performance.now();
    const summaryResult = await summaryFn(cacheId);

    if (!summaryResult.success || !summaryResult.data) {
      await this.cacheData(directoryPath, directoryName, images, scanSubfolders);
      logCachePerf('append-to-cache:fallback-cache-data', {
        cacheId,
        images: images.length,
        durationMs: toFixedMs(performance.now() - start),
      });
      return;
    }

    const summary = summaryResult.data as CacheEntry;
    const chunkSize = options?.chunkSize ?? DEFAULT_INCREMENTAL_CHUNK_SIZE;
    const metadata = sanitizeCacheMetadata(toCacheMetadata(images), { forceClone: true });

    const inlineMetadata = Array.isArray(summary.metadata)
      ? compactCacheMetadataEntries(summary.metadata)
      : [];
    let chunkIndex = inlineMetadata.length > 0 ? 0 : (summary.chunkCount ?? 0);

    for (let i = 0; i < inlineMetadata.length; i += chunkSize) {
      const chunk = inlineMetadata.slice(i, i + chunkSize);
      const result = await window.electronAPI.writeCacheChunk({
        cacheId,
        chunkIndex,
        data: chunk,
      });
      if (!result.success) {
        console.error('Failed to migrate inline cache chunk:', result.error);
        return;
      }
      chunkIndex += 1;
    }

    for (let i = 0; i < metadata.length; i += chunkSize) {
      const chunk = metadata.slice(i, i + chunkSize);
      const result = await window.electronAPI.writeCacheChunk({
        cacheId,
        chunkIndex,
        data: chunk,
      });
      if (!result.success) {
        console.error('Failed to append cache chunk:', result.error);
        return;
      }
      chunkIndex += 1;
    }

    const record = {
      id: cacheId,
      directoryPath,
      directoryName: summary.directoryName ?? directoryName,
      lastScan: Date.now(),
      imageCount: (inlineMetadata.length > 0 ? inlineMetadata.length : (summary.imageCount ?? 0)) + images.length,
      chunkCount: chunkIndex,
      parserVersion: PARSER_VERSION,
    } satisfies Omit<CacheEntry, 'metadata'>;

    const finalizeResult = await window.electronAPI.finalizeCacheWrite({ cacheId, record });
    if (!finalizeResult.success) {
      console.error('Failed to finalize appended cache write:', finalizeResult.error);
    }
    logCachePerf(finalizeResult.success ? 'append-to-cache:complete' : 'append-to-cache:error', {
      cacheId,
      images: images.length,
      chunkCount: chunkIndex,
      durationMs: toFixedMs(performance.now() - start),
    });
  }

  async createIncrementalWriter(
    directoryPath: string,
    directoryName: string,
    scanSubfolders: boolean,
    options?: { chunkSize?: number }
  ): Promise<IncrementalCacheWriter | null> {
    if (!this.isElectron) return null;

    const writer = new IncrementalCacheWriter(
      directoryPath,
      directoryName,
      scanSubfolders,
      options?.chunkSize ?? DEFAULT_INCREMENTAL_CHUNK_SIZE
    );

    await writer.initialize();
    return writer;
  }

  async updateCachedImages(
    directoryPath: string,
    directoryName: string,
    images: IndexedImage[],
    scanSubfolders: boolean
  ): Promise<void> {
    if (!this.isElectron || !images || images.length === 0) return;

    const sanitizedUpdates = sanitizeCacheMetadata(toCacheMetadata(images), { forceClone: true });
    const updates = new Map<string, CacheImageMetadata>();
    for (const image of sanitizedUpdates) {
      updates.set(image.id, image);
    }

    const candidateModes = Array.from(new Set([scanSubfolders, !scanSubfolders]));
    for (const mode of candidateModes) {
      const existing = await this.getCachedData(directoryPath, mode);
      if (!existing) {
        continue;
      }

      const metadata = existing.metadata.map((entry) => updates.get(entry.id) ?? entry);
      const didChange = metadata.some((entry, index) => entry !== existing.metadata[index]);
      if (!didChange) {
        continue;
      }

      const cacheId = `${directoryPath}-${mode ? 'recursive' : 'flat'}`;
      const result = await window.electronAPI.cacheData({
        cacheId,
        data: {
          id: existing.id,
          directoryPath,
          directoryName: existing.directoryName ?? directoryName,
          lastScan: Date.now(),
          imageCount: metadata.length,
          metadata,
          parserVersion: PARSER_VERSION,
        },
      });

      if (!result.success) {
        console.error('Failed to update cached images:', result.error);
      }
    }
  }

  async removeCachedImages(
    directoryPath: string,
    directoryName: string,
    imageIds: string[],
    imageNames: string[],
    scanSubfolders: boolean
  ): Promise<void> {
    if (!this.isElectron || (imageIds.length === 0 && imageNames.length === 0)) return;

    const candidateModes = Array.from(new Set([scanSubfolders, !scanSubfolders]));
    for (const mode of candidateModes) {
      const existing = await this.getCachedData(directoryPath, mode);
      if (!existing) {
        continue;
      }

      const metadata = pruneCacheMetadata(existing.metadata, {
        ids: imageIds,
        names: imageNames,
      });

      if (metadata.length === existing.metadata.length) {
        continue;
      }

      const cacheId = `${directoryPath}-${mode ? 'recursive' : 'flat'}`;
      const result = await window.electronAPI.cacheData({
        cacheId,
        data: {
          id: existing.id,
          directoryPath,
          directoryName: existing.directoryName ?? directoryName,
          lastScan: Date.now(),
          imageCount: metadata.length,
          metadata,
          parserVersion: PARSER_VERSION,
        },
      });

      if (!result.success) {
        console.error('Failed to remove cached images:', result.error);
      }
    }
  }

  async applyChunkedCacheDelta(
    directoryPath: string,
    directoryName: string,
    imagesToUpsert: IndexedImage[],
    removedImageIds: string[],
    removedImageNames: string[],
    scanSubfolders: boolean,
    options: { fallbackImages?: IndexedImage[]; createIfMissing?: boolean } = {}
  ): Promise<void> {
    if (!this.isElectron) return;
    if (imagesToUpsert.length === 0 && removedImageIds.length === 0 && removedImageNames.length === 0) return;

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    await this.runChunkedCacheDeltaLocked(cacheId, async () => {
    const outputCacheId = `${cacheId}-delta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const start = performance.now();
    const summary = await this.getCacheSummary(directoryPath, scanSubfolders);
    if (!summary) {
      if (options.createIfMissing === false) {
        return;
      }
      const fallbackById = new Map<string, IndexedImage>();
      for (const image of options.fallbackImages ?? []) {
        fallbackById.set(image.id, image);
      }
      for (const image of imagesToUpsert) {
        fallbackById.set(image.id, image);
      }
      for (const imageId of removedImageIds) {
        fallbackById.delete(imageId);
      }
      const removedNames = new Set(
        removedImageNames.map((name) => name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
      );
      const fallbackImages = Array.from(fallbackById.values()).filter(
        (image) => !removedNames.has(getRelativeCacheName(image.id, image.name))
      );

      if (fallbackImages.length > 0) {
        await this.cacheData(directoryPath, directoryName, fallbackImages, scanSubfolders);
      }
      logCachePerf('chunked-delta:fallback-cache-data', {
        cacheId,
        upserts: imagesToUpsert.length,
        fallbackImages: fallbackImages.length,
        removedIds: removedImageIds.length,
        removedNames: removedImageNames.length,
        durationMs: toFixedMs(performance.now() - start),
      });
      return;
    }

    const buildUpsertsStart = performance.now();
    const upserts = sanitizeCacheMetadata(toCacheMetadata(imagesToUpsert), { forceClone: true });
    const buildUpsertsMs = performance.now() - buildUpsertsStart;
    const pruneIds = [
      ...removedImageIds,
      ...upserts.map((image) => image.id),
    ];
    const pruneNames = [
      ...removedImageNames,
    ];
    const outputChunkSize = DEFAULT_INCREMENTAL_CHUNK_SIZE;
    const outputBuffer: CacheImageMetadata[] = [];
    let outputChunkIndex = 0;
    let imageCount = 0;
    let readChunks = 0;
    let readChunkMs = 0;
    let writeChunkMs = 0;
    let pruneMs = 0;

    const flushOutputChunk = async (force = false) => {
      if (outputBuffer.length === 0 || (!force && outputBuffer.length < outputChunkSize)) {
        return;
      }

      const chunk = outputBuffer.splice(0, outputBuffer.length);
      const writeStart = performance.now();
      const result = await window.electronAPI.writeCacheChunk({
        cacheId: outputCacheId,
        chunkIndex: outputChunkIndex,
        data: chunk,
      });
      writeChunkMs += performance.now() - writeStart;

      if (!result.success) {
        throw new Error(result.error || 'Failed to write cache delta chunk');
      }

      outputChunkIndex += 1;
    };

    const appendOutputEntries = async (entries: CacheImageMetadata[]) => {
      for (const entry of entries) {
        outputBuffer.push(entry);
        imageCount += 1;
        await flushOutputChunk();
      }
    };

    if (Array.isArray(summary.metadata) && summary.metadata.length > 0) {
      const pruneStart = performance.now();
      const pruned = pruneCacheMetadata(summary.metadata, {
        ids: pruneIds,
        names: pruneNames,
      });
      pruneMs += performance.now() - pruneStart;
      await appendOutputEntries(pruned);
    }

    const chunkCount = summary.chunkCount ?? 0;
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const readStart = performance.now();
      const chunkResult = await window.electronAPI.getCacheChunk({ cacheId, chunkIndex });
      readChunkMs += performance.now() - readStart;
      readChunks += 1;
      if (!chunkResult.success || !Array.isArray(chunkResult.data)) {
        throw new Error(chunkResult.error || `Failed to read cache chunk ${chunkIndex}`);
      }

      const pruneStart = performance.now();
      const pruned = pruneCacheMetadata(compactCacheMetadataEntries(chunkResult.data), {
        ids: pruneIds,
        names: pruneNames,
      });
      pruneMs += performance.now() - pruneStart;
      await appendOutputEntries(pruned);
    }

    await appendOutputEntries(upserts);
    await flushOutputChunk(true);

    const finalizeResult = await window.electronAPI.finalizeCacheWrite({
      cacheId,
      sourceCacheId: outputCacheId,
      record: {
        id: cacheId,
        directoryPath,
        directoryName: summary.directoryName ?? directoryName,
        lastScan: Date.now(),
        imageCount,
        chunkCount: outputChunkIndex,
        parserVersion: PARSER_VERSION,
      },
    });

       if (!finalizeResult.success) {
      throw new Error(finalizeResult.error || 'Failed to finalize cache delta');
    }

    logCachePerf('chunked-delta:complete', {
      cacheId,
      outputCacheId,
      upserts: imagesToUpsert.length,
      removedIds: removedImageIds.length,
      removedNames: removedImageNames.length,
      inputChunks: chunkCount,
      readChunks,
      outputChunks: outputChunkIndex,
      finalImageCount: imageCount,
      buildUpsertsMs: toFixedMs(buildUpsertsMs),
      readChunkMs: toFixedMs(readChunkMs),
      pruneMs: toFixedMs(pruneMs),
      writeChunkMs: toFixedMs(writeChunkMs),
      durationMs: toFixedMs(performance.now() - start),
    });
  });
}

async replaceCachedImages(
  directoryPath: string,
  directoryName: string,
    images: IndexedImage[],
    removedImageIds: string[],
    removedImageNames: string[],
    scanSubfolders: boolean
  ): Promise<void> {
    if (!this.isElectron || images.length === 0 || (removedImageIds.length === 0 && removedImageNames.length === 0)) return;

    const replacements = sanitizeCacheMetadata(toCacheMetadata(images), { forceClone: true });
    const replacementIds = replacements.map((image) => image.id);
    const candidateModes = Array.from(new Set([scanSubfolders, !scanSubfolders]));

    for (const mode of candidateModes) {
      const cacheId = `${directoryPath}-${mode ? 'recursive' : 'flat'}`;
      await this.runChunkedCacheDeltaLocked(cacheId, async () => {
        const existing = await this.getCachedData(directoryPath, mode);
        if (!existing) {
          return;
        }

        const metadataWithoutOldEntries = pruneCacheMetadata(existing.metadata, {
          ids: removedImageIds,
          names: removedImageNames,
        });

        if (metadataWithoutOldEntries.length === existing.metadata.length) {
          return;
        }

        const metadata = [
          ...pruneCacheMetadata(metadataWithoutOldEntries, {
            ids: replacementIds,
          }),
          ...replacements,
        ];
        const result = await window.electronAPI.cacheData({
          cacheId,
          data: {
            id: existing.id,
            directoryPath,
            directoryName: existing.directoryName ?? directoryName,
            lastScan: Date.now(),
            imageCount: metadata.length,
            metadata,
            parserVersion: PARSER_VERSION,
          },
        });

        if (!result.success) {
          console.error('Failed to replace cached images:', result.error);
        }
      });
    }
  }

  async cacheThumbnail(imageId: string, blob: Blob): Promise<void> {
    if (!this.isElectron) return;
    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const result = await window.electronAPI.cacheThumbnail({ thumbnailId: imageId, data });
    if (!result.success) {
      // Only log non-path-related errors (path errors should be handled by the hash fix in Electron)
      const isPathError = result.errorCode === 'ENAMETOOLONG' || result.error?.includes('path too long') || result.error?.includes('ENOENT');
      if (!isPathError) {
        console.error("Failed to cache thumbnail:", result.error);
      }
    }
  }

  async getCachedThumbnail(imageId: string): Promise<Blob | null> {
    if (!this.isElectron) return null;
    const result = await window.electronAPI.getThumbnail(imageId);
    if (result.success && result.data) {
      return new Blob([new Uint8Array(result.data)]);
    }
    // Don't log errors for thumbnails that don't exist yet (expected during first load)
    // Only log unexpected errors
    if (!result.success && result.error && !result.error.includes('ENOENT')) {
      console.error("Failed to get cached thumbnail:", result.error);
    }
    return null;
  }

  async resolveCachedThumbnails(
    candidates: ThumbnailCacheCandidate[]
  ): Promise<{
    results: Record<string, ThumbnailCacheResolveResult>;
    stats?: ThumbnailCacheBatchStats;
  } | null> {
    if (!this.isElectron || !window.electronAPI.resolveThumbnailCacheBatch || candidates.length === 0) {
      return null;
    }

    const result = await window.electronAPI.resolveThumbnailCacheBatch({ candidates });
    if (!result.success) {
      if (result.error) {
        console.error('Failed to resolve thumbnail cache batch:', result.error);
      }
      return null;
    }

    return {
      results: result.results ?? {},
      stats: result.stats,
    };
  }

  async generateThumbnailToCache(
    request: ThumbnailGenerateToCacheRequest
  ): Promise<{ url: string; thumbnailId?: string; extension?: string } | null> {
    if (!this.isElectron || !window.electronAPI.generateThumbnailToCache) {
      return null;
    }

    const result = await window.electronAPI.generateThumbnailToCache(request);
    if (!result.success || !result.url) {
      if (result.error) {
        console.error('Failed to generate thumbnail into cache:', result.error);
      }
      return null;
    }

    return {
      url: result.url,
      thumbnailId: result.thumbnailId,
      extension: result.extension,
    };
  }

  
  // Deletes the JSON cache file via IPC
  async clearDirectoryCache(directoryPath: string, scanSubfolders: boolean): Promise<void> {
    if (!this.isElectron) return;
    
    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const result = await window.electronAPI.clearCacheData(cacheId);
    
    if (!result.success) {
      console.error("Failed to clear directory cache:", result.error);
    }
  }

  // Compares current file system state with the cache to find differences
  async validateCacheAndGetDiff(
    directoryPath: string,
    directoryName: string,
    currentFiles: { name: string; lastModified: number; size?: number; type?: string; birthtimeMs?: number; contentModifiedMs?: number }[],
    scanSubfolders: boolean,
    scopePath?: string,
    options: { includeCachedImages?: boolean } = {}
  ): Promise<CacheDiff> {
    const start = performance.now();
    if (!this.isElectron) {
      logCachePerf('validate-diff:browser-full-refresh', {
        directoryPath,
        currentFiles: currentFiles.length,
        durationMs: toFixedMs(performance.now() - start),
      });
      return {
        newAndModifiedFiles: currentFiles,
        deletedFileIds: [],
        cachedImages: [],
        needsFullRefresh: true,
      };
    }

    const summaryStart = performance.now();
    const cachedSummary = await this.getCacheSummary(directoryPath, scanSubfolders);
    const summaryMs = performance.now() - summaryStart;
    
    // If no cache exists, all files are new
    if (!cachedSummary) {
      logCachePerf('validate-diff:no-cache', {
        directoryPath,
        directoryName,
        currentFiles: currentFiles.length,
        scanSubfolders,
        scopePath: scopePath ?? null,
        summaryMs: toFixedMs(summaryMs),
        durationMs: toFixedMs(performance.now() - start),
      });
      return {
        newAndModifiedFiles: currentFiles,
        deletedFileIds: [],
        cachedImages: [],
        needsFullRefresh: true,
      };
    }

    const includeCachedImages = options.includeCachedImages ?? true;
    const newAndModifiedFiles: { name: string; lastModified: number; size?: number; type?: string; birthtimeMs?: number; contentModifiedMs?: number }[] = [];
    const cachedImages: IndexedImage[] = [];
    const deletedFileIds: string[] = [];
    const mapStart = performance.now();
    const currentFilesMap = new Map<string, { name: string; lastModified: number; size?: number; type?: string; birthtimeMs?: number; contentModifiedMs?: number }>();
    for (const file of currentFiles) {
      currentFilesMap.set(file.name, file);
    }
    const currentMapMs = performance.now() - mapStart;
    const seenCachedFileNames = new Set<string>();

    // Helper to normalize paths for comparison (ensure forward slashes)
    const normalize = (p: string) => p.replace(/\\/g, '/');
    const normalizedScope = scopePath ? normalize(scopePath) : undefined;

    const iterateStart = performance.now();
    let cachedRecordsScanned = 0;
    let cachedChunksScanned = 0;
    await this.iterateCachedMetadata(directoryPath, scanSubfolders, async (cachedChunk) => {
      cachedChunksScanned += 1;
      cachedRecordsScanned += cachedChunk.length;
      for (const cachedFile of cachedChunk) {
        seenCachedFileNames.add(cachedFile.name);
        const file = currentFilesMap.get(cachedFile.name);

        if (!file) {
          if (normalizedScope) {
            const authorized = cachedFile.name.startsWith(`${normalizedScope}/`) || cachedFile.name === normalizedScope;
            if (!authorized) {
              continue;
            }
          }
          deletedFileIds.push(cachedFile.id);
          continue;
        }

        const fileModifiedMs = file.contentModifiedMs ?? file.lastModified;
        const cacheModifiedMs = cachedFile.contentModifiedMs ?? cachedFile.lastModified;
        if (cacheModifiedMs < fileModifiedMs || cachedFile.enrichmentState === 'catalog') {
          newAndModifiedFiles.push({
            name: file.name,
            lastModified: file.lastModified,
            size: file.size,
            type: file.type,
            birthtimeMs: file.birthtimeMs,
            contentModifiedMs: file.contentModifiedMs,
          });
          continue;
        }

        if (includeCachedImages) {
          cachedImages.push({
            ...cachedFile,
            handle: { name: cachedFile.name, kind: 'file' } as any,
          });
        }
      }
    });
    const iterateMs = performance.now() - iterateStart;

    const newFileScanStart = performance.now();
    for (const file of currentFiles) {
      if (!seenCachedFileNames.has(file.name)) {
        newAndModifiedFiles.push({
          name: file.name,
          lastModified: file.lastModified,
          size: file.size,
          type: file.type,
          birthtimeMs: file.birthtimeMs,
          contentModifiedMs: file.contentModifiedMs,
        });
      }
    }
    const newFileScanMs = performance.now() - newFileScanStart;

    logCachePerf('validate-diff:complete', {
      directoryPath,
      directoryName,
      currentFiles: currentFiles.length,
      cachedImageCount: cachedSummary.imageCount ?? 0,
      cachedChunksScanned,
      cachedRecordsScanned,
      cachedImagesReturned: cachedImages.length,
      newAndModifiedFiles: newAndModifiedFiles.length,
      deletedFileIds: deletedFileIds.length,
      includeCachedImages,
      scanSubfolders,
      scopePath: scopePath ?? null,
      summaryMs: toFixedMs(summaryMs),
      currentMapMs: toFixedMs(currentMapMs),
      iterateMs: toFixedMs(iterateMs),
      newFileScanMs: toFixedMs(newFileScanMs),
      durationMs: toFixedMs(performance.now() - start),
    });

    return {
      newAndModifiedFiles,
      deletedFileIds,
      cachedImages,
      // If scoped, we NEVER need a full refresh, just an update
      needsFullRefresh: false, 
    };
  }
}

const cacheManager = new CacheManager();
export { cacheManager, IncrementalCacheWriter };
export default cacheManager;
