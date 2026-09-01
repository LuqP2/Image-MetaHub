import {
  type IndexedImage,
  type ThumbnailCacheBatchStats,
  type ThumbnailCacheCandidate,
  type ThumbnailCacheResolveResult,
  type ThumbnailGenerateToCacheRequest,
} from '../types';
import { isUsableTimestamp } from '../utils/fileTimestamps.js';

/**
 * Parser version - increment when parser logic changes significantly
 * This ensures cache is invalidated when parsing rules change
 */
export const PARSER_VERSION = 10; // v10: Parse AVIF XMP/EXIF metadata and compact Image MetaHub extensions

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
  // Number of ids in the removed-ids sidecar. `imageCount` counts live entries,
  // so the chunks physically hold `imageCount + tombstoneCount` entries.
  tombstoneCount?: number;
}

export interface CacheDiff {
  newAndModifiedFiles: { name: string; lastModified: number; size?: number; type?: string; birthtimeMs?: number; contentModifiedMs?: number }[];
  deletedFileIds: string[];
  cachedImages: IndexedImage[];
  needsFullRefresh: boolean;
}

// Entries-per-chunk is only an upper bound. Chunk files are read and rewritten
// whole, so what actually matters is their size in bytes: on a ComfyUI library
// a single entry carries the workflow graph, so 1024 entries produced ~58MB
// chunk files (measured: 326MB across 7 chunks for 6.2k images) and removing
// one image meant reading and rewriting all 326MB. Cap by bytes as well.
const DEFAULT_INCREMENTAL_CHUNK_SIZE = 1024;
const TARGET_CHUNK_BYTES = 2 * 1024 * 1024;

// Raw metadata above this is stripped from the cache and replaced by a compact
// summary; the full text is re-read from the file on demand by
// hydrateImageRawMetadata (wired into ImageModal, ImagePreviewSidebar,
// ImageEditorWorkspace and the ComfyUI workspace). Kept low deliberately: the
// raw string is by far the biggest field and the cache only needs the derived
// fields to drive search, filters and facets.
const MAX_INLINE_RAW_METADATA_BYTES = 4 * 1024;
const RAW_METADATA_PREVIEW_BYTES = 4096;

// Deleting an image appends its id to the removed-ids sidecar instead of
// rewriting the chunk that holds it, so the delete costs the same no matter how
// big the chunk is. The dead entries are still read (and skipped) on every cache
// load, so past this many the next delete pays for a full rewrite that drops
// them for good — one compaction per this many deletions, amortized.
const MAX_TOMBSTONES_BEFORE_COMPACTION = 500;

// Cheap proxy for an entry's serialized size. The raw metadata string dominates
// every other field, so this avoids a JSON.stringify per entry just to measure.
const estimateEntryBytes = (entry: CacheImageMetadata): number => {
  const raw = typeof entry.metadataString === 'string' ? entry.metadataString.length : 0;
  return raw + 1024;
};

// Splits entries so a chunk stays under both the entry-count and the byte cap.
// A single oversized entry still gets its own chunk rather than being dropped.
const chunkByBudget = (
  entries: CacheImageMetadata[],
  maxEntries: number
): CacheImageMetadata[][] => {
  const chunks: CacheImageMetadata[][] = [];
  let current: CacheImageMetadata[] = [];
  let currentBytes = 0;

  for (const entry of entries) {
    const entryBytes = estimateEntryBytes(entry);
    if (current.length > 0 && (current.length >= maxEntries || currentBytes + entryBytes > TARGET_CHUNK_BYTES)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(entry);
    currentBytes += entryBytes;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
};

const logCachePerf = (
  event: string,
  details: Record<string, unknown> = {}
) => {
  // Surface every *Ms field in the message itself. They were already being
  // measured but sat behind a collapsed object in DevTools, so the one number
  // that matters was never visible in a pasted log.
  const timings = Object.entries(details)
    .filter(([key, value]) => key.endsWith('Ms') && typeof value === 'number')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.log(`[cache:perf] ${event}${timings ? ` | ${timings}` : ''}`, { event, ...details });
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

/**
 * Repairs entries indexed before birth times of 0 were rejected (SMB/CIFS shares
 * report one, which dated every image 1970-01-01 UTC). The cache diff only looks
 * at contentModifiedMs, which stayed correct, so these entries would never be
 * reindexed on their own.
 */
export function healCachedSortDate(entry: CacheImageMetadata): CacheImageMetadata {
  if (isUsableTimestamp(entry.lastModified) || !isUsableTimestamp(entry.contentModifiedMs)) {
    return entry;
  }
  return { ...entry, lastModified: entry.contentModifiedMs as number };
}

function compactCacheMetadataEntry(rawEntry: CacheImageMetadata): CacheImageMetadata {
  const entry = healCachedSortDate(rawEntry);
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

  if (metadata._provenanceMetadataSource === 'sidecar' || metadata._provenanceMetadataSource === 'embedded') {
    compactedMetadata._provenanceMetadataSource = metadata._provenanceMetadataSource;
  }

  if (typeof metadata.parameters === 'string') {
    compactedMetadata.parametersPreview = metadata.parameters.slice(0, RAW_METADATA_PREVIEW_BYTES);
  }

  if (metadata.imagemetahub_data && typeof metadata.imagemetahub_data === 'object') {
    const payload = metadata.imagemetahub_data as Record<string, unknown>;
    compactedMetadata.imagemetahub_data = {
      generator: payload.generator,
      source_generator: payload.source_generator,
      edited_at: payload.edited_at,
      edit: payload.edit,
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

    const tombstoned = await this.readValidCacheTombstones(cacheId, summary);
    const keepEntry = tombstoned
      ? (entry: CacheImageMetadata) => !tombstoned.has(entry.id)
      : null;

    let metadata: CacheImageMetadata[] = Array.isArray(summary.metadata)
      ? compactCacheMetadataEntries(keepEntry ? summary.metadata.filter(keepEntry) : summary.metadata)
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
          const entries = keepEntry ? chunkResult.data.filter(keepEntry) : chunkResult.data;
          chunks.push(...compactCacheMetadataEntries(entries));
        } else if (!chunkResult.success) {
          console.error(`Failed to load cache chunk ${i} for ${cacheId}:`, chunkResult.error);
        }
      }
      metadata = chunks;
      logCachePerf('get-cached-data:chunks-loaded', {
        cacheId,
        chunkCount,
        records: metadata.length,
        tombstoned: tombstoned?.size ?? 0,
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
  ): Promise<Pick<CacheEntry, 'id' | 'directoryPath' | 'directoryName' | 'lastScan' | 'imageCount' | 'chunkCount' | 'parserVersion' | 'tombstoneCount'> & { metadata?: CacheImageMetadata[] } | null> {
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
      tombstoneCount: summary.tombstoneCount ?? 0,
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
      tombstoneCount: summary.tombstoneCount,
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

    const tombstoned = await this.readValidCacheTombstones(cacheId, summary);
    const keepEntry = tombstoned
      ? (entry: CacheImageMetadata) => !tombstoned.has(entry.id)
      : null;

    if (Array.isArray(summary.metadata) && summary.metadata.length > 0) {
      const entries = keepEntry ? summary.metadata.filter(keepEntry) : summary.metadata;
      await onChunk(compactCacheMetadataEntries(entries));
      logCachePerf('iterate-cached-metadata:inline-complete', {
        cacheId,
        records: entries.length,
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
        const entries = keepEntry ? chunkResult.data.filter(keepEntry) : chunkResult.data;
        const compacted = compactCacheMetadataEntries(entries);
        records += compacted.length;
        if (compacted.length > 0) {
          const callbackStart = performance.now();
          await onChunk(compacted);
          callbackMs += performance.now() - callbackStart;
        }
      } else if (!chunkResult.success) {
        console.error(`Failed to load cache chunk ${i} for ${cacheId}:`, chunkResult.error);
      }
    }
    logCachePerf('iterate-cached-metadata:chunks-complete', {
      cacheId,
      chunkCount,
      records,
      tombstoned: tombstoned?.size ?? 0,
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
    options?: { chunkSize?: number; getFallbackImages?: () => IndexedImage[] }
  ): Promise<void> {
    if (!this.isElectron) return;
    if (!images || images.length === 0) return;

    const cacheId = `${directoryPath}-${scanSubfolders ? 'recursive' : 'flat'}`;
    const appended = await this.runChunkedCacheDeltaLocked(cacheId, () =>
      this.appendToCacheLocked(cacheId, directoryPath, directoryName, images, scanSubfolders, options)
    );

    // Appending alone can't undo a tombstone: the removed entry is still sitting
    // in its chunk, so re-adding the same id would leave two entries for it.
    // The full rewrite drops the old copy and clears the sidecar. Run it outside
    // the lock above — applyChunkedCacheDelta takes the same one.
    if (!appended) {
      await this.applyChunkedCacheDelta(
        directoryPath,
        directoryName,
        images,
        [],
        [],
        scanSubfolders,
        { fallbackImages: options?.getFallbackImages?.() }
      );
    }
  }

  /**
   * Returns false when the append can't be done incrementally and the caller
   * must fall back to a full rewrite. Every other failure is logged and
   * swallowed, as before.
   */
  private async appendToCacheLocked(
    cacheId: string,
    directoryPath: string,
    directoryName: string,
    images: IndexedImage[],
    scanSubfolders: boolean,
    options?: { chunkSize?: number; getFallbackImages?: () => IndexedImage[] }
  ): Promise<boolean> {
    const summaryFn = window.electronAPI.getCacheSummary ?? window.electronAPI.getCachedData;
    const start = performance.now();
    const summaryResult = await summaryFn(cacheId);

    if (!summaryResult.success || !summaryResult.data) {
      // No cache exists for this variant yet (missing/cleared/invalidated, or
      // a prior write failed). Writing just `images` here would create a
      // cache that only knows about this batch's new files, so the next
      // launch would think the directory has nothing else and reparse every
      // pre-existing file. Merge in the caller-supplied full directory image
      // list first, same fallback pattern as applyChunkedCacheDelta.
      const fallbackImages = options?.getFallbackImages?.() ?? [];
      const merged = new Map<string, IndexedImage>();
      for (const image of fallbackImages) {
        merged.set(image.id, image);
      }
      for (const image of images) {
        merged.set(image.id, image);
      }
      await this.cacheData(directoryPath, directoryName, Array.from(merged.values()), scanSubfolders);
      logCachePerf('append-to-cache:fallback-cache-data', {
        cacheId,
        images: images.length,
        fallbackImages: fallbackImages.length,
        durationMs: toFixedMs(performance.now() - start),
      });
      return true;
    }

    const summary = summaryResult.data as CacheEntry;
    const chunkSize = options?.chunkSize ?? DEFAULT_INCREMENTAL_CHUNK_SIZE;

    // Checked before anything is written, so handing over to the full rewrite
    // never leaves a half-appended cache behind.
    const tombstoned = await this.readValidCacheTombstones(cacheId, summary);
    if (!tombstoned && (summary.tombstoneCount ?? 0) > 0) {
      return false;
    }
    if (tombstoned && images.some((image) => tombstoned.has(image.id))) {
      logCachePerf('append-to-cache:rewrite-for-tombstoned-id', {
        cacheId,
        images: images.length,
        tombstones: tombstoned.size,
      });
      return false;
    }

    let metadata = sanitizeCacheMetadata(toCacheMetadata(images), { forceClone: true });

    const inlineMetadata = Array.isArray(summary.metadata)
      ? compactCacheMetadataEntries(summary.metadata)
      : [];
    let chunkIndex = inlineMetadata.length > 0 ? 0 : (summary.chunkCount ?? 0);
    const indexUpdates: Record<string, number> = {};

    for (const chunk of chunkByBudget(inlineMetadata, chunkSize)) {
      const result = await window.electronAPI.writeCacheChunk({
        cacheId,
        chunkIndex,
        data: chunk,
      });
      if (!result.success) {
        console.error('Failed to migrate inline cache chunk:', result.error);
        return true;
      }
      chunkIndex += 1;
    }

    // Top off the last existing chunk before creating new ones, so a steady
    // trickle of single-file appends (auto-watch) doesn't fragment the cache
    // into many tiny chunk files. Only applies to the already-chunked case —
    // the inline-metadata migration above always starts a fresh chunk layout.
    const existingIndex = inlineMetadata.length === 0 && (summary.chunkCount ?? 0) > 0
      ? await this.readValidCacheIndex(cacheId, summary.lastScan, summary.chunkCount ?? 0)
      : null;
    if (inlineMetadata.length === 0 && chunkIndex > 0 && metadata.length > 0) {
      const lastChunkIndex = chunkIndex - 1;
      const lastChunkResult = await window.electronAPI.getCacheChunk({ cacheId, chunkIndex: lastChunkIndex });
      if (lastChunkResult.success && Array.isArray(lastChunkResult.data)) {
        const lastChunkEntries = lastChunkResult.data as CacheImageMetadata[];
        const room = chunkSize - lastChunkEntries.length;
        if (room > 0) {
          const toAdd = metadata.slice(0, room);
          metadata = metadata.slice(room);
          const merged = [...lastChunkEntries, ...toAdd];
          const writeResult = await window.electronAPI.writeCacheChunk({ cacheId, chunkIndex: lastChunkIndex, data: merged });
          if (!writeResult.success) {
            console.error('Failed to top off cache chunk:', writeResult.error);
            return true;
          }
          for (const entry of toAdd) indexUpdates[entry.id] = lastChunkIndex;
        }
      }
    }

    for (const chunk of chunkByBudget(metadata, chunkSize)) {
      const result = await window.electronAPI.writeCacheChunk({
        cacheId,
        chunkIndex,
        data: chunk,
      });
      if (!result.success) {
        console.error('Failed to append cache chunk:', result.error);
        return true;
      }
      for (const entry of chunk) indexUpdates[entry.id] = chunkIndex;
      chunkIndex += 1;
    }

    const newLastScan = Date.now();
    const record = {
      id: cacheId,
      directoryPath,
      directoryName: summary.directoryName ?? directoryName,
      lastScan: newLastScan,
      imageCount: (inlineMetadata.length > 0 ? inlineMetadata.length : (summary.imageCount ?? 0)) + images.length,
      chunkCount: chunkIndex,
      parserVersion: PARSER_VERSION,
    } satisfies Omit<CacheEntry, 'metadata'>;

    const finalizeResult = await window.electronAPI.finalizeCacheWrite({
      cacheId,
      record,
      // Carried forward with the new chunk count: none of the removed ids came
      // back (checked above) and no existing entry moved chunks.
      tombstones: tombstoned ? { chunkCount: chunkIndex, ids: [...tombstoned] } : undefined,
    });
    if (!finalizeResult.success) {
      console.error('Failed to finalize appended cache write:', finalizeResult.error);
    } else if (existingIndex) {
      // Keep the id->chunk index in sync so a subsequent patch/remove call can
      // still use its own fast path instead of falling back to a full scan.
      await window.electronAPI.writeCacheIndex?.({
        cacheId,
        data: { lastScan: newLastScan, chunkCount: chunkIndex, ids: { ...existingIndex, ...indexUpdates } },
      });
    }
    logCachePerf(finalizeResult.success ? 'append-to-cache:complete' : 'append-to-cache:error', {
      cacheId,
      images: images.length,
      chunkCount: chunkIndex,
      durationMs: toFixedMs(performance.now() - start),
    });
    return true;
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

  /**
   * Patches specific images in an existing cache without rewriting the whole
   * directory cache. `applyChunkedCacheDelta` reads and re-serializes every
   * entry, so a single-image "Reparse Metadata" ends up scaling with the whole
   * library. Here we only touch the chunk(s) that actually hold the reparsed
   * images, so the cost is proportional to the number of reparsed images, not
   * the folder size (#448 follow-up).
   *
   * Only updates entries that already exist in the cache (which reparse targets
   * always do, since they come from the indexed/cached library). Returns true if
   * at least one cache variant was updated.
   */
  async patchCachedImages(
    directoryPath: string,
    directoryName: string,
    images: IndexedImage[],
    scanSubfolders: boolean
  ): Promise<boolean> {
    if (!this.isElectron || !images || images.length === 0) return false;

    const sanitizedUpdates = sanitizeCacheMetadata(toCacheMetadata(images), { forceClone: true });
    const updatesById = new Map<string, CacheImageMetadata>();
    for (const image of sanitizedUpdates) {
      updatesById.set(image.id, image);
    }
    if (updatesById.size === 0) return false;

    let patchedAny = false;
    const candidateModes = Array.from(new Set([scanSubfolders, !scanSubfolders]));
    for (const mode of candidateModes) {
      const cacheId = `${directoryPath}-${mode ? 'recursive' : 'flat'}`;
      const patched = await this.runChunkedCacheDeltaLocked(cacheId, () =>
        this.patchCacheVariant(cacheId, directoryPath, directoryName, updatesById, mode)
      );
      patchedAny = patchedAny || patched;
    }

    return patchedAny;
  }

  private async patchCacheVariant(
    cacheId: string,
    directoryPath: string,
    directoryName: string,
    updatesById: Map<string, CacheImageMetadata>,
    scanSubfolders: boolean
  ): Promise<boolean> {
    const start = performance.now();
    const summary = await this.getCacheSummary(directoryPath, scanSubfolders);
    if (!summary) {
      return false;
    }

    const remaining = new Set(updatesById.keys());

    // Small caches keep their metadata inline in the main record; there are no
    // chunk files to patch, so rewrite the (small) inline blob directly.
    if (Array.isArray(summary.metadata) && summary.metadata.length > 0) {
      let changed = false;
      const metadata = summary.metadata.map((entry) => {
        const update = updatesById.get(entry.id);
        if (!update) return entry;
        changed = true;
        remaining.delete(entry.id);
        return update;
      });

      if (!changed) return false;

      const result = await window.electronAPI.cacheData({
        cacheId,
        data: {
          id: summary.id,
          directoryPath,
          directoryName: summary.directoryName ?? directoryName,
          lastScan: Date.now(),
          imageCount: metadata.length,
          metadata,
          parserVersion: PARSER_VERSION,
        },
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to patch inline cache');
      }
      logCachePerf('patch-cached-images:inline', {
        cacheId,
        patched: updatesById.size - remaining.size,
        records: metadata.length,
        durationMs: toFixedMs(performance.now() - start),
      });
      return true;
    }

    // Chunked cache. Prefer a direct id->chunk lookup so reparse reads only the
    // chunk(s) that hold the target images instead of scanning every (potentially
    // tens-of-MB) chunk — that scan is what made reparse latency track library
    // size and, on large ComfyUI libraries, risk the renderer running out of
    // memory. The index is a best-effort hint: it is validated against the
    // current record (lastScan + chunkCount) and every lookup is re-verified
    // against the chunk's real contents, falling back to a full scan otherwise.
    const chunkCount = summary.chunkCount ?? 0;
    const newLastScan = Date.now();

    const finalizePatch = async () => {
      // sourceCacheId is omitted so the handler only rewrites the (small) record
      // and leaves the untouched chunks in place.
      const finalizeResult = await window.electronAPI.finalizeCacheWrite({
        cacheId,
        record: {
          id: summary.id,
          directoryPath,
          directoryName: summary.directoryName ?? directoryName,
          lastScan: newLastScan,
          imageCount: summary.imageCount,
          chunkCount,
          parserVersion: PARSER_VERSION,
        },
        // Entries are updated in place, so no removed id becomes live again.
        tombstones: 'preserve',
      });
      if (!finalizeResult.success) {
        throw new Error(finalizeResult.error || 'Failed to finalize cache patch');
      }
    };

    // --- Fast path: id->chunk index ---
    const index = await this.readValidCacheIndex(cacheId, summary.lastScan, chunkCount);
    if (index) {
      const idsByChunk = new Map<number, string[]>();
      let allMapped = true;
      for (const id of remaining) {
        const targetChunk = index[id];
        if (typeof targetChunk !== 'number' || targetChunk < 0 || targetChunk >= chunkCount) {
          allMapped = false;
          break;
        }
        const list = idsByChunk.get(targetChunk);
        if (list) list.push(id);
        else idsByChunk.set(targetChunk, [id]);
      }

      if (allMapped) {
        let stale = false;
        let rewrittenChunks = 0;
        for (const [targetChunk, ids] of idsByChunk) {
          const chunkResult = await window.electronAPI.getCacheChunk({ cacheId, chunkIndex: targetChunk });
          if (!chunkResult.success || !Array.isArray(chunkResult.data)) {
            throw new Error(chunkResult.error || `Failed to read cache chunk ${targetChunk}`);
          }
          const entries = chunkResult.data as CacheImageMetadata[];
          const wanted = new Set(ids);
          for (let i = 0; i < entries.length && wanted.size > 0; i += 1) {
            if (wanted.has(entries[i].id)) {
              entries[i] = updatesById.get(entries[i].id)!;
              wanted.delete(entries[i].id);
            }
          }
          if (wanted.size > 0) {
            // The index pointed at the wrong chunk (stale layout); give up on the
            // fast path and let the full scan below rebuild it.
            stale = true;
            break;
          }
          const writeResult = await window.electronAPI.writeCacheChunk({ cacheId, chunkIndex: targetChunk, data: entries });
          if (!writeResult.success) {
            throw new Error(writeResult.error || `Failed to write cache chunk ${targetChunk}`);
          }
          rewrittenChunks += 1;
        }

        if (!stale) {
          await finalizePatch();
          // Chunk membership did not change, so keep the same map and just refresh
          // its lastScan to match the new record.
          await window.electronAPI.writeCacheIndex?.({
            cacheId,
            data: { lastScan: newLastScan, chunkCount, ids: index },
          });
          logCachePerf('patch-cached-images:indexed', {
            cacheId,
            patched: updatesById.size,
            readChunks: rewrittenChunks,
            chunkCount,
            durationMs: toFixedMs(performance.now() - start),
          });
          return true;
        }
      }
    }

    // --- Fallback: sequential scan (also (re)builds the id->chunk index) ---
    // Chunks are read one at a time and released each iteration, so peak memory
    // stays at ~one chunk even on large libraries. This pays the full read once;
    // subsequent reparses take the indexed fast path above.
    const rebuiltIds: Record<string, number> = {};
    let readChunks = 0;
    let rewrittenChunks = 0;

    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const chunkResult = await window.electronAPI.getCacheChunk({ cacheId, chunkIndex });
      readChunks += 1;
      if (!chunkResult.success || !Array.isArray(chunkResult.data)) {
        throw new Error(chunkResult.error || `Failed to read cache chunk ${chunkIndex}`);
      }

      const entries = chunkResult.data as CacheImageMetadata[];
      let chunkChanged = false;
      for (let i = 0; i < entries.length; i += 1) {
        const id = entries[i].id;
        rebuiltIds[id] = chunkIndex;
        const update = updatesById.get(id);
        if (update) {
          entries[i] = update;
          remaining.delete(id);
          chunkChanged = true;
        }
      }

      if (chunkChanged) {
        const writeResult = await window.electronAPI.writeCacheChunk({ cacheId, chunkIndex, data: entries });
        if (!writeResult.success) {
          throw new Error(writeResult.error || `Failed to write cache chunk ${chunkIndex}`);
        }
        rewrittenChunks += 1;
      }
    }

    if (rewrittenChunks === 0) {
      // Nothing to update in this variant (e.g. the image lives only in the other
      // scan-mode variant). The record was not touched, so persist the freshly
      // built index against the existing lastScan for next time.
      await window.electronAPI.writeCacheIndex?.({
        cacheId,
        data: { lastScan: summary.lastScan, chunkCount, ids: rebuiltIds },
      });
      return false;
    }

    await finalizePatch();
    await window.electronAPI.writeCacheIndex?.({
      cacheId,
      data: { lastScan: newLastScan, chunkCount, ids: rebuiltIds },
    });

    logCachePerf('patch-cached-images:scanned', {
      cacheId,
      patched: updatesById.size - remaining.size,
      readChunks,
      rewrittenChunks,
      chunkCount,
      durationMs: toFixedMs(performance.now() - start),
    });
    return true;
  }

  /**
   * Reads the id->chunk sidecar index for a cache variant, returning the id map
   * only when it is safe to trust: it must match the record's current chunkCount
   * and lastScan. Any external cache write bumps lastScan, so a stale index is
   * rejected here and rebuilt by the caller's fallback scan. Callers must still
   * verify each looked-up id against the chunk contents before relying on it.
   */
  private async readValidCacheIndex(
    cacheId: string,
    lastScan: number | undefined,
    chunkCount: number
  ): Promise<Record<string, number> | null> {
    if (!window.electronAPI?.readCacheIndex) return null;
    try {
      const result = await window.electronAPI.readCacheIndex({ cacheId });
      if (!result.success || !result.data) return null;
      const { lastScan: indexLastScan, chunkCount: indexChunkCount, ids } = result.data;
      if (indexChunkCount !== chunkCount) return null;
      if (typeof lastScan === 'number' && indexLastScan !== lastScan) return null;
      if (!ids || typeof ids !== 'object') return null;
      return ids as Record<string, number>;
    } catch {
      return null;
    }
  }

  /**
   * Reads the removed-ids sidecar for a cache variant. The ids listed there are
   * still physically present in their chunks and must be skipped by every read
   * path until a full rewrite drops them.
   *
   * Returns null when the record says there is nothing to skip, and also when
   * the sidecar disagrees with the record — a missing file, a torn write, or a
   * record written by a build that predates tombstones. That is the safe
   * direction on purpose: ignoring the sidecar shows an already-deleted image
   * again until the next scan removes it, while trusting a stale one would hide
   * images that are still on disk.
   */
  private async readValidCacheTombstones(
    cacheId: string,
    record: { chunkCount?: number; tombstoneCount?: number }
  ): Promise<Set<string> | null> {
    const expected = record.tombstoneCount ?? 0;
    if (expected <= 0) return null;
    if (!window.electronAPI?.readCacheTombstones) return null;

    try {
      const result = await window.electronAPI.readCacheTombstones({ cacheId });
      const data = result?.success ? result.data : null;
      if (!data || !Array.isArray(data.ids)) {
        console.warn(`Cache tombstones missing for ${cacheId} (record expects ${expected}); serving the cache uncompacted.`);
        return null;
      }
      if (data.ids.length !== expected || (data.chunkCount ?? 0) !== (record.chunkCount ?? 0)) {
        console.warn(
          `Cache tombstones out of sync for ${cacheId} (sidecar ${data.ids.length}/${data.chunkCount ?? 0}, record ${expected}/${record.chunkCount ?? 0}); serving the cache uncompacted.`
        );
        return null;
      }
      return new Set(data.ids);
    } catch {
      return null;
    }
  }

  /**
   * Removes specific images from an existing cache without touching any chunk
   * file: the removed ids are appended to the sidecar and the record's live
   * image count is adjusted, so a delete costs two small writes regardless of
   * library size. Falls back to the full applyChunkedCacheDelta rewrite (which
   * also matches by name, drops the tombstoned entries and clears the sidecar)
   * whenever the sidecar path can't account for every id, so correctness never
   * regresses versus the old always-full-rewrite behavior.
   */
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
      const cacheId = `${directoryPath}-${mode ? 'recursive' : 'flat'}`;
      // Names are resolved against the index too (see tombstoneCacheVariant):
      // its keys are the entry ids, and getRelativeCacheName derives the match
      // name from the id, so a name-based removal needs no chunk reads either.
      // This matters because the watcher path (App.tsx) always supplies names —
      // gating the fast path on `imageNames.length === 0` meant the dominant
      // delete path always fell through to the full 22s scan-and-rewrite.
      const tombstoned = await this.runChunkedCacheDeltaLocked(cacheId, () =>
        this.tombstoneCacheVariant(cacheId, directoryPath, directoryName, imageIds, imageNames, mode)
      );

      if (!tombstoned) {
        await this.applyChunkedCacheDelta(
          directoryPath,
          directoryName,
          [],
          imageIds,
          imageNames,
          mode,
          { createIfMissing: false }
        );
      }
    }
  }

  /**
   * Fast path for removeCachedImages: marks the ids as removed in the sidecar
   * and leaves the chunk files alone. Returns false (nothing written) if the
   * cache uses the legacy inline-metadata format, has no usable id->chunk index
   * or sidecar, or has accumulated enough tombstones to be worth compacting —
   * callers fall back to the full rewrite path in that case.
   */
  private async tombstoneCacheVariant(
    cacheId: string,
    directoryPath: string,
    directoryName: string,
    imageIds: string[],
    imageNames: string[],
    scanSubfolders: boolean
  ): Promise<boolean> {
    const start = performance.now();
    const summary = await this.getCacheSummary(directoryPath, scanSubfolders);
    const summaryMs = performance.now() - start;
    if (!summary) {
      // No cache for this variant — nothing to remove, no fallback needed.
      return true;
    }
    if (Array.isArray(summary.metadata) && summary.metadata.length > 0) {
      return false;
    }

    const chunkCount = summary.chunkCount ?? 0;
    if (chunkCount === 0) {
      return true;
    }

    const indexStart = performance.now();
    const index = await this.readValidCacheIndex(cacheId, summary.lastScan, chunkCount);
    const indexMs = performance.now() - indexStart;
    if (!index) {
      return false;
    }

    const tombstonesStart = performance.now();
    const tombstoned = await this.readValidCacheTombstones(cacheId, summary);
    const tombstonesMs = performance.now() - tombstonesStart;
    if (!tombstoned && (summary.tombstoneCount ?? 0) > 0) {
      // Sidecar unusable but the record expects one. A full rewrite is the only
      // way back to a consistent pair, and it fixes both files at once.
      return false;
    }
    const alreadyRemoved = tombstoned ?? new Set<string>();

    if (Object.keys(index).length !== (summary.imageCount ?? 0) + alreadyRemoved.size) {
      // Index doesn't account for every entry the chunks physically hold (e.g.
      // it was never populated for this cache — appendToCache only maintains an
      // index that already existed, it doesn't create one from scratch).
      // Treating a missing-from-index id as "genuinely absent" in that case
      // would report success without actually removing anything. Bail to the
      // full scan in applyChunkedCacheDelta, which rebuilds the index from a
      // complete read so this only costs a full rewrite once.
      return false;
    }

    const targetIds = new Set(imageIds);
    if (imageNames.length > 0) {
      const wantedNames = new Set(
        imageNames.map((name) => name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
      );
      for (const id of Object.keys(index)) {
        // getRelativeCacheName falls back to the entry's `name` field when the
        // id carries no '::' separator, and the index doesn't hold names — so a
        // name match can't be decided here. Bail to the full scan in that case.
        if (id.indexOf('::') < 0) {
          return false;
        }
        if (wantedNames.has(getRelativeCacheName(id, ''))) {
          targetIds.add(id);
        }
      }
    }

    const newlyRemoved: string[] = [];
    for (const id of targetIds) {
      const targetChunk = index[id];
      if (typeof targetChunk !== 'number' || targetChunk < 0 || targetChunk >= chunkCount) {
        // Not in this cache variant per the index. Could genuinely be absent
        // (e.g. only exists in the other scan-mode variant) — skip rather than
        // forcing a fallback scan for every removal that touches one variant.
        continue;
      }
      if (alreadyRemoved.has(id)) {
        continue;
      }
      newlyRemoved.push(id);
    }

    if (newlyRemoved.length === 0) {
      return true;
    }

    const nextIds = [...alreadyRemoved, ...newlyRemoved];
    if (nextIds.length > MAX_TOMBSTONES_BEFORE_COMPACTION) {
      // Enough dead weight to be worth paying for a rewrite. The fallback path
      // prunes these ids along with the new ones and clears the sidecar, so
      // nothing is lost by not writing it here.
      logCachePerf('remove-cached-images:compacting', {
        cacheId,
        tombstones: nextIds.length,
        threshold: MAX_TOMBSTONES_BEFORE_COMPACTION,
      });
      return false;
    }

    const finalizeStart = performance.now();
    const finalizeResult = await window.electronAPI.finalizeCacheWrite({
      cacheId,
      record: {
        id: summary.id,
        directoryPath,
        directoryName: summary.directoryName ?? directoryName,
        // Deliberately unchanged: no chunk moved, so the id->chunk index stays
        // valid and the next delete can take this path again.
        lastScan: summary.lastScan,
        imageCount: Math.max(0, (summary.imageCount ?? 0) - newlyRemoved.length),
        chunkCount,
        parserVersion: PARSER_VERSION,
      },
      tombstones: { chunkCount, ids: nextIds },
    });
    const finalizeMs = performance.now() - finalizeStart;
    if (!finalizeResult.success) {
      return false;
    }

    logCachePerf('remove-cached-images:tombstoned', {
      cacheId,
      removed: newlyRemoved.length,
      tombstones: nextIds.length,
      chunkCount,
      summaryMs: toFixedMs(summaryMs),
      indexMs: toFixedMs(indexMs),
      tombstonesMs: toFixedMs(tombstonesMs),
      finalizeMs: toFixedMs(finalizeMs),
      durationMs: toFixedMs(performance.now() - start),
    });
    return true;
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
    // This path rewrites every chunk, which is the only place tombstoned
    // entries actually get dropped. finalizeCacheWrite below is called without
    // a `tombstones` argument, so the sidecar is cleared at the same time.
    const tombstoned = await this.readValidCacheTombstones(cacheId, summary);
    const pruneIds = [
      ...removedImageIds,
      ...upserts.map((image) => image.id),
      ...(tombstoned ?? []),
    ];
    const pruneNames = [
      ...removedImageNames,
    ];
    const outputChunkSize = DEFAULT_INCREMENTAL_CHUNK_SIZE;
    const outputBuffer: CacheImageMetadata[] = [];
    let outputBufferBytes = 0;
    let outputChunkIndex = 0;
    let imageCount = 0;
    let readChunks = 0;
    let readChunkMs = 0;
    let writeChunkMs = 0;
    let pruneMs = 0;

    // Rebuilt as chunks stream out, so the id->chunk sidecar index survives this
    // path. Without it the index kept the pre-delta lastScan, readValidCacheIndex
    // rejected it, removeCacheVariantByIndex bailed, and every delete fell back
    // here again — a full read+rewrite of every chunk, forever. Measured at 22.5s
    // per deleted file on a 6.2k-image cache.
    const rebuiltIds: Record<string, number> = {};

    const flushOutputChunk = async (force = false) => {
      const budgetReached =
        outputBuffer.length >= outputChunkSize || outputBufferBytes >= TARGET_CHUNK_BYTES;
      if (outputBuffer.length === 0 || (!force && !budgetReached)) {
        return;
      }

      const chunk = outputBuffer.splice(0, outputBuffer.length);
      outputBufferBytes = 0;
      for (const entry of chunk) {
        rebuiltIds[entry.id] = outputChunkIndex;
      }
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
        outputBufferBytes += estimateEntryBytes(entry);
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

    const newLastScan = Date.now();
    const finalizeResult = await window.electronAPI.finalizeCacheWrite({
      cacheId,
      sourceCacheId: outputCacheId,
      record: {
        id: cacheId,
        directoryPath,
        directoryName: summary.directoryName ?? directoryName,
        lastScan: newLastScan,
        imageCount,
        chunkCount: outputChunkIndex,
        parserVersion: PARSER_VERSION,
      },
    });

       if (!finalizeResult.success) {
      throw new Error(finalizeResult.error || 'Failed to finalize cache delta');
    }

    // Must carry the same lastScan the record was just finalized with, or the
    // next removal rejects the index and falls back here again.
    await window.electronAPI.writeCacheIndex?.({
      cacheId,
      data: { lastScan: newLastScan, chunkCount: outputChunkIndex, ids: rebuiltIds },
    });

    logCachePerf('chunked-delta:complete', {
      cacheId,
      outputCacheId,
      upserts: imagesToUpsert.length,
      removedIds: removedImageIds.length,
      removedNames: removedImageNames.length,
      compactedTombstones: tombstoned?.size ?? 0,
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
