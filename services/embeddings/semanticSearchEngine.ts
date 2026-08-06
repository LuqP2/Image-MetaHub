import type { IndexedImage } from '../../types';
import { ROW_FLAG_TOMBSTONE } from './embeddingFormat';
import type { EmbeddingModelDescriptor } from './embeddingModel';
import { EmbeddingIndex, contentKeyForImage } from './embeddingStore';
import { buildEmbedItems, embedImages, embedText, getPreferredModel } from './embeddingService';

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
 * One index per model, named by the model descriptor's `cacheId`.
 *
 * Within a model the id is fixed: the metadata cache is per directory, but the
 * store materializes every directory into one flat `images` array, and image
 * ids are already globally unique (`directoryId::relativePath`). A single index
 * mirrors that array exactly; rows for images no longer present are reconciled
 * away rather than swept per directory, so a directory's metadata rebuild does
 * not throw away its vectors.
 */
export const semanticCacheId = (model: EmbeddingModelDescriptor): string => model.cacheId;

/** Candidates to gather from the worker before the relevance cutoff trims them. */
export const DEFAULT_TOP_K = 5000;

/** Hard cap on what a query actually shows, so it reads as "best matches". */
export const DEFAULT_RESULT_LIMIT = 300;

/**
 * Floor used only to gather candidates from the worker. Uncentered CLIP
 * text↔image cosines sit in a narrow, query-dependent band, so this alone does
 * not decide what the user sees — the relevance cutoff below does.
 */
export const DEFAULT_MIN_SCORE = 0.15;

/**
 * Gather floor for centered scores. The centered formula (`q·v − λ·hubness`)
 * shifts scores negative — typical hubness sits around 0.6-0.9 while text↔image
 * cosines sit at 0.2-0.3 — so a floor of 0 would drop every row before the heap
 * ever saw them. Negative infinity effectively disables the pre-filter and lets
 * the heap do the top-K work, then the relevance cutoff (which is scale-free)
 * decides what actually surfaces to the user.
 */
export const DEFAULT_CENTERED_MIN_SCORE = -Infinity;

/**
 * How many standard deviations above the library's mean score a row must sit to
 * be considered at all. This is a sanity floor, not the real discriminator: it
 * exists so a query with nothing to find ("cat" in a library of landscapes)
 * returns empty instead of returning the least-bad rows.
 */
export const DEFAULT_RELEVANCE_Z = 2.0;

/**
 * The actual discriminator: a row must sit at least this fraction of the way
 * from the library mean to the best row to count as a match.
 *
 * A pure z-threshold does not survive a change of library size. At 125 images,
 * 2σ is far out in the tail and only genuine matches clear it. At 17.5k images
 * the same 2σ is roughly the 98th percentile, so ~350 rows clear it on *every*
 * query and DEFAULT_RESULT_LIMIT does the real cutting — which is why a query
 * returned 300 results whether or not it matched anything. A cutoff expressed
 * relative to the best row is scale-free: it asks "is this row comparable to the
 * best thing we found?", which is the question the user is actually asking.
 */
export const DEFAULT_TOP_FRACTION = 0.70;

export interface ScoreDistribution {
  mean: number;
  std: number;
}

/**
 * Keeps rows that are both statistical outliers and comparable to the best hit.
 * Exported for unit testing the cutoff independent of the worker.
 *
 * `hits` must be sorted by score descending (as the worker returns them).
 */
export const applyRelevanceCutoff = (
  hits: SemanticHit[],
  distribution: ScoreDistribution,
  z = DEFAULT_RELEVANCE_Z,
  limit = DEFAULT_RESULT_LIMIT,
  topFraction = DEFAULT_TOP_FRACTION
): SemanticHit[] => {
  if (hits.length === 0) return hits;

  // A flat distribution has no outliers: nothing meaningfully matches, so
  // returning the top-K reordered would just be the "whole library" bug again.
  if (distribution.std < 1e-4) return [];

  const sanityFloor = distribution.mean + z * distribution.std;

  // The sanity floor gates the entire query: if even the best hit is not a
  // statistical outlier, nothing genuinely matches and we return empty.
  if (hits[0].score < sanityFloor) return [];

  // Within a genuine result set, the relative floor decides which rows are
  // comparable to the best.  Using max(sanityFloor, relativeFloor) let the
  // z-threshold also act as a filter inside the results, which clips matches
  // that sit above the relative floor but below 2σ — exactly the symptom that
  // made text search return nothing for queries with many real matches.
  const threshold = distribution.mean + topFraction * (hits[0].score - distribution.mean);

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
/** Centroid version the worker currently holds; -1 until the first sync. */
let syncedCentroidVersion = -1;

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

/**
 * Opens the index belonging to a model. Switching models swaps the whole index
 * — including the search worker, whose matrix is bound to the model's `dim` —
 * rather than reinterpreting vectors that mean nothing to the new model.
 */
export const openLibrary = async (
  model: EmbeddingModelDescriptor = getPreferredModel()
): Promise<EmbeddingIndex> => {
  const cacheId = semanticCacheId(model);
  if (index && currentCacheId === cacheId) return index;
  closeLibrary();
  index = await EmbeddingIndex.open(cacheId, model.id, model.revision, model.dim);
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
  syncedCentroidVersion = -1;
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
  // The matrix width comes from the open index, not from a global: a model
  // switch replaces both together, and a mismatch would silently misread rows.
  instance.postMessage({ type: 'init', payload: { dim: index?.dim ?? getPreferredModel().dim } });
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

  // After the segments, so a mean that moved re-derives the norms for every
  // segment the worker holds — including any just added above.
  if (syncedCentroidVersion !== index.centroidVersion) {
    const centroid = index.centroid();
    const buffer = centroid ? centroid.buffer.slice(0) : null;
    instance.postMessage({ type: 'setMean', payload: { mean: buffer } }, buffer ? [buffer] : []);
    syncedCentroidVersion = index.centroidVersion;
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
  options: { topK?: number; minScore?: number; topFraction?: number } = {}
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
      minScore: options.minScore ?? DEFAULT_CENTERED_MIN_SCORE,
      // Text↔image is the only direction with a modality gap to correct. The
      // worker falls back to plain cosine while the index has no mean yet.
      centered: true,
    },
  });

  const candidates = toHits(result.rows, result.scores);
  const distribution = distributionFrom(result.scoreSum, result.scoreSqSum, result.scannedRows);
  const hits = applyRelevanceCutoff(
    candidates,
    distribution,
    DEFAULT_RELEVANCE_Z,
    DEFAULT_RESULT_LIMIT,
    options.topFraction ?? DEFAULT_TOP_FRACTION
  );

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
  const activeIndex = await openLibrary();
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
