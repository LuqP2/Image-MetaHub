import type { IndexedImage } from '../../types';
import { ROW_FLAG_TOMBSTONE } from './embeddingFormat';
import { CLIP_MODEL } from './embeddingModel';
import { EmbeddingIndex, contentKeyForImage } from './embeddingStore';
import { buildEmbedItems, embedImages, embedText } from './embeddingService';

/**
 * Owns the searchable side of the vector index: the on-disk store plus the
 * long-lived worker that holds the matrix in memory and ranks it.
 *
 * Split from embeddingService on purpose — producing vectors and searching them
 * have different lifetimes. The search worker only exists while visual search is
 * in use, and the embedding worker only while a backfill or a text query runs.
 */

export interface SemanticHit {
  imageId: string;
  score: number;
}

export interface SemanticQueryStats {
  scannedRows: number;
  durationMs: number;
  embedMs: number;
  /** Best cosine among all candidates, before the cutoff trimmed the list. */
  topScore?: number;
  /** How many rows cleared the gather floor, before the relevance cutoff. */
  candidateCount?: number;
}

/**
 * Fixed id for the vector index. The metadata cache is per directory, but the
 * store materializes every directory into one flat `images` array, and image
 * ids are already globally unique (`directoryId::relativePath`). A single index
 * mirrors that array exactly; rows for images no longer present are reconciled
 * away rather than swept per directory, so a directory's metadata rebuild does
 * not throw away its vectors.
 */
export const SEMANTIC_CACHE_ID = 'imh-visual-search';

/** Candidates to gather from the worker before the relevance cutoff trims them. */
export const DEFAULT_TOP_K = 5000;

/** Hard cap on what a query actually shows, so it reads as "best matches". */
export const DEFAULT_RESULT_LIMIT = 300;

/**
 * Floor used only to gather candidates from the worker. CLIP text↔image cosines
 * sit in a narrow, query-dependent band, so this alone does not decide what the
 * user sees — the relevance cutoff below does.
 */
export const DEFAULT_MIN_SCORE = 0.15;

/**
 * How many standard deviations above the library's mean score a row must sit to
 * count as a match. CLIP absolute cosines are compressed and query-dependent
 * (~0.22–0.25 here regardless of the query), so an absolute floor is useless —
 * but a real match is a statistical *outlier* within a query's own score
 * distribution. Measured on a 125-image set: "dog" (3 dogs present) peaked ~2.3σ
 * above the mean while "cat" (none present) barely cleared 1.5σ, so ~2.0 admits
 * true matches and rejects queries with nothing to find.
 */
export const DEFAULT_RELEVANCE_Z = 2.0;

export interface ScoreDistribution {
  mean: number;
  std: number;
}

/**
 * Keeps rows that are strong outliers in the query's own score distribution.
 * Exported for unit testing the cutoff independent of the worker.
 *
 * `hits` must be sorted by score descending (as the worker returns them).
 */
export const applyRelevanceCutoff = (
  hits: SemanticHit[],
  distribution: ScoreDistribution,
  z = DEFAULT_RELEVANCE_Z,
  limit = DEFAULT_RESULT_LIMIT
): SemanticHit[] => {
  if (hits.length === 0) return hits;

  // A flat distribution has no outliers: nothing meaningfully matches, so
  // returning the top-K reordered would just be the "whole library" bug again.
  if (distribution.std < 1e-4) return [];

  const threshold = distribution.mean + z * distribution.std;
  const kept: SemanticHit[] = [];
  for (const hit of hits) {
    if (hit.score < threshold) break; // sorted desc
    kept.push(hit);
    if (kept.length >= limit) break;
  }
  return kept;
};

/** Find Similar is a tighter question than search, so it uses its own floor. */
export const DEFAULT_VISUAL_SIMILARITY_MIN_SCORE = 0.75;

let index: EmbeddingIndex | null = null;
let currentCacheId: string | null = null;
let worker: Worker | null = null;
let workerReady = false;
let nextQueryId = 1;
/** Rows already handed to the worker, per segment index. */
let syncedSegmentRows: number[] = [];

interface WorkerQueryResult {
  rows: number[];
  scores: number[];
  scannedRows: number;
  durationMs: number;
  scoreSum: number;
  scoreSqSum: number;
}

const pendingQueries = new Map<number, {
  resolve: (value: WorkerQueryResult) => void;
  reject: (error: Error) => void;
}>();

export const getIndex = (): EmbeddingIndex | null => index;

export const isOpen = (): boolean => index !== null;

export const openLibrary = async (cacheId: string = SEMANTIC_CACHE_ID): Promise<EmbeddingIndex> => {
  if (index && currentCacheId === cacheId) return index;
  closeLibrary();
  index = await EmbeddingIndex.open(cacheId, CLIP_MODEL.id, CLIP_MODEL.revision, CLIP_MODEL.dim);
  currentCacheId = cacheId;
  return index;
};

/**
 * Tombstones vectors for images that have left the library (directory removed,
 * files deleted outside the app). Keeps the searchable set aligned with what the
 * grid actually shows.
 *
 * Callers must pass the *complete, hydrated* image set: an empty or partial set
 * here does not mean "the library is empty", it means "not loaded yet", and
 * treating it as authoritative would tombstone every live vector. Only call this
 * from a point that already has the real, fully-loaded image array (currently:
 * runBackfill, which runs on an explicit user action).
 */
export const reconcileWithImages = async (presentImageIds: Set<string>): Promise<void> => {
  if (!index || presentImageIds.size === 0) return;
  const stale: string[] = [];
  for (const imageId of index.liveEntries().keys()) {
    if (!presentImageIds.has(imageId)) stale.push(imageId);
  }
  if (stale.length > 0) {
    index.tombstone(stale);
    await index.flush();
  }
};

export const closeLibrary = (): void => {
  stopSearchWorker();
  index = null;
  currentCacheId = null;
};

const stopSearchWorker = (): void => {
  if (worker) {
    worker.postMessage({ type: 'dispose' });
    worker.terminate();
  }
  worker = null;
  workerReady = false;
  syncedSegmentRows = [];
  for (const pending of pendingQueries.values()) {
    pending.reject(new Error('Vector search worker stopped'));
  }
  pendingQueries.clear();
};

const ensureWorker = (): Worker => {
  if (worker) return worker;

  const instance = new Worker(new URL('../workers/vectorSearchWorker.ts', import.meta.url), { type: 'module' });
  instance.onmessage = (event: MessageEvent<any>) => {
    const message = event.data;
    if (message?.type === 'ready') {
      workerReady = true;
      return;
    }
    if (message?.type === 'result') {
      pendingQueries.get(message.payload.queryId)?.resolve(message.payload);
      pendingQueries.delete(message.payload.queryId);
      return;
    }
    if (message?.type === 'error') {
      const error = new Error(message.payload?.error || 'Vector search failed');
      for (const pending of pendingQueries.values()) pending.reject(error);
      pendingQueries.clear();
    }
  };
  instance.onerror = () => {
    const error = new Error('Vector search worker crashed');
    for (const pending of pendingQueries.values()) pending.reject(error);
    pendingQueries.clear();
    stopSearchWorker();
  };

  worker = instance;
  instance.postMessage({ type: 'init', payload: { dim: CLIP_MODEL.dim } });
  return instance;
};

/**
 * Brings the worker's matrix up to date. Only segments whose row count changed
 * are re-sent, so a backfill flush costs one segment transfer rather than a
 * reload of the whole index.
 */
export const syncWorker = async (): Promise<void> => {
  if (!index) return;
  const instance = ensureWorker();
  if (!workerReady) {
    // init is handled synchronously by the worker before it processes anything
    // else, so there is nothing to wait on beyond the message ordering.
    workerReady = true;
  }

  // Check rowCount against what the worker already has *before* reading —
  // otherwise every query pays for reading the whole index off disk just to
  // discard the segments that did not change.
  for (const descriptor of index.segmentDescriptors()) {
    if (syncedSegmentRows[descriptor.index] === descriptor.rowCount) continue;
    const buffer = await index.readSegment(descriptor.index);
    if (!buffer) continue;
    instance.postMessage(
      { type: 'addSegment', payload: { index: descriptor.index, buffer, rowCount: descriptor.rowCount } },
      [buffer]
    );
    syncedSegmentRows[descriptor.index] = descriptor.rowCount;
  }

  const rows = index.rowSnapshot();
  const mask = new Uint8Array(rows.length);
  for (let row = 0; row < rows.length; row += 1) {
    mask[row] = (rows[row][2] & ROW_FLAG_TOMBSTONE) === 0 ? 1 : 0;
  }
  instance.postMessage({ type: 'setLiveMask', payload: { mask: mask.buffer } }, [mask.buffer]);
};

const runWorkerQuery = (
  message: { type: string; payload: Record<string, unknown> }
): Promise<WorkerQueryResult> => {
  const instance = ensureWorker();
  const queryId = nextQueryId;
  nextQueryId += 1;

  return new Promise((resolve, reject) => {
    pendingQueries.set(queryId, { resolve, reject });
    instance.postMessage({ ...message, payload: { ...message.payload, queryId } });
  });
};

/** Mean and standard deviation of scores over every scanned row. */
const distributionFrom = (scoreSum: number, scoreSqSum: number, count: number): ScoreDistribution => {
  if (count <= 0) return { mean: 0, std: 0 };
  const mean = scoreSum / count;
  const variance = Math.max(0, scoreSqSum / count - mean * mean);
  return { mean, std: Math.sqrt(variance) };
};

const toHits = (rows: number[], scores: number[]): SemanticHit[] => {
  if (!index) return [];
  const hits: SemanticHit[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const imageId = index.imageIdForRow(rows[i]);
    if (imageId) {
      hits.push({ imageId, score: scores[i] });
    }
  }
  return hits;
};

export interface ParsedQuery {
  positive: string;
  negatives: string[];
}

/**
 * Splits a query into its positive phrase and any negative phrases. Everything
 * before the first ` -` is positive; each following ` -<phrase>` is a concept to
 * push away from. Splitting on space-hyphen (not bare `-`) leaves hyphenated
 * words like "state-of-the-art" intact.
 *
 * Examples: `beach -people` → {positive:'beach', negatives:['people']};
 * `a city at night -cars -crowds` → negatives ['cars','crowds'].
 */
export const parseSemanticQuery = (query: string): ParsedQuery => {
  const parts = query.split(/\s+-(?=\S)/);
  const positive = (parts[0] ?? '').trim();
  const negatives = parts
    .slice(1)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return { positive, negatives };
};

export const searchByText = async (
  query: string,
  options: { topK?: number; minScore?: number } = {}
): Promise<{ hits: SemanticHit[]; stats: SemanticQueryStats }> => {
  if (!index || index.stats.liveRows === 0) {
    return { hits: [], stats: { scannedRows: 0, durationMs: 0, embedMs: 0 } };
  }

  const { positive, negatives } = parseSemanticQuery(query);
  // A query that is only negatives ("-people") has no anchor to rank against.
  if (!positive) {
    return { hits: [], stats: { scannedRows: 0, durationMs: 0, embedMs: 0 } };
  }

  const embedStartedAt = performance.now();
  const { scale, codes } = await embedText(positive, negatives);
  const embedMs = performance.now() - embedStartedAt;

  await syncWorker();
  const buffer = codes.buffer.slice(codes.byteOffset, codes.byteOffset + codes.byteLength);
  const result = await runWorkerQuery({
    type: 'query',
    payload: {
      codes: buffer,
      scale,
      topK: options.topK ?? DEFAULT_TOP_K,
      minScore: options.minScore ?? DEFAULT_MIN_SCORE,
    },
  });

  const candidates = toHits(result.rows, result.scores);
  const distribution = distributionFrom(result.scoreSum, result.scoreSqSum, result.scannedRows);
  const hits = applyRelevanceCutoff(candidates, distribution);

  return {
    hits,
    stats: {
      scannedRows: result.scannedRows,
      durationMs: result.durationMs,
      embedMs,
      topScore: candidates[0]?.score,
      candidateCount: candidates.length,
    },
  };
};

/** Ranks the library against an image already present in the index. */
export const searchByImageId = async (
  imageId: string,
  options: { topK?: number; minScore?: number } = {}
): Promise<{ hits: SemanticHit[]; stats: SemanticQueryStats } | null> => {
  if (!index) return null;
  const rows = index.rowSnapshot();
  let sourceRow = -1;
  for (let row = 0; row < rows.length; row += 1) {
    if (rows[row][0] === imageId && (rows[row][2] & ROW_FLAG_TOMBSTONE) === 0) {
      sourceRow = row;
      break;
    }
  }
  if (sourceRow < 0) return null;

  await syncWorker();
  const result = await runWorkerQuery({
    type: 'queryByRow',
    payload: {
      row: sourceRow,
      topK: options.topK ?? 250,
      minScore: options.minScore ?? DEFAULT_VISUAL_SIMILARITY_MIN_SCORE,
    },
  });

  return {
    hits: toHits(result.rows, result.scores).filter((hit) => hit.imageId !== imageId),
    stats: { scannedRows: result.scannedRows, durationMs: result.durationMs, embedMs: 0 },
  };
};

/**
 * Ensures an image has a vector in the index, embedding it on demand if not.
 * This is what lets Find Similar work on an image with no metadata that a
 * capped or partial backfill never reached.
 */
export const ensureImageEmbedded = async (image: IndexedImage): Promise<boolean> => {
  const activeIndex = await openLibrary(SEMANTIC_CACHE_ID);
  if (activeIndex.hasVector(image.id)) return true;

  const items = await buildEmbedItems([image]);
  const [vector] = await embedImages(items);
  if (!vector?.codes || vector.scale === 0) return false;

  activeIndex.append(image.id, contentKeyForImage(image), { scale: vector.scale, codes: vector.codes });
  await activeIndex.flush();
  await syncWorker();
  return true;
};

/**
 * Ranks the library by visual similarity to a given image, embedding the source
 * first if needed. Returns null when the source cannot be embedded.
 */
export const searchSimilarToImage = async (
  image: IndexedImage,
  options: { topK?: number; minScore?: number } = {}
): Promise<{ hits: SemanticHit[]; stats: SemanticQueryStats } | null> => {
  const embedded = await ensureImageEmbedded(image);
  if (!embedded) return null;
  return searchByImageId(image.id, options);
};

export const applyRename = async (oldImageId: string, newImageId: string): Promise<void> => {
  if (!index) return;
  if (index.rename(oldImageId, newImageId)) {
    await index.flush();
  }
};

export const applyDeletions = async (imageIds: string[]): Promise<void> => {
  if (!index || imageIds.length === 0) return;
  if (index.tombstone(imageIds) > 0) {
    await index.flush();
    await syncWorker();
  }
};
