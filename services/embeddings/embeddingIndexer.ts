import type { IndexedImage, SemanticIndexProgress } from '../../types';
import { buildEmbedItems, embedImages, unloadVisionTower } from './embeddingService';
import { contentKeyForImage } from './embeddingStore';
import { openLibrary, syncWorker } from './semanticSearchEngine';

/**
 * Resumable backfill that fills the vector index for a library.
 *
 * Modeled on the file indexer's enrichment phase rather than the one-shot
 * workers: it takes a real AbortSignal and a pause gate, and its progress
 * ledger is the manifest on disk, so killing the app mid-run costs at most one
 * flush window of work instead of restarting from zero.
 *
 * Deliberately no `embeddingState` field on IndexedImage: that would mean a
 * PARSER_VERSION bump, and a bump discards every user's metadata cache.
 */

// Images per batch. The batch is decoded concurrently and run through the
// vision tower in one pass, so a larger batch amortizes per-batch overhead
// (IPC, GPU upload) without hurting cancel latency much.
const DEFAULT_BATCH_SIZE = 16;

/** Vectors buffered before they are written out. Caps crash loss to ~40s. */
const FLUSH_EVERY_VECTORS = 256;

const FLUSH_EVERY_MS = 30_000;

// Yield between batches so the grid keeps rendering. Kept small: the heavy work
// runs in the worker, so the main thread only needs a brief breather.
const DEFAULT_THROTTLE_MS = 15;

const PROGRESS_INTERVAL_MS = 300;

export interface BackfillOptions {
  cacheId: string;
  images: IndexedImage[];
  /** Free-tier ceiling on live vectors, or null for unlimited. */
  cap: number | null;
  signal: AbortSignal;
  waitWhilePaused?: () => Promise<void>;
  onProgress?: (progress: SemanticIndexProgress) => void;
  batchSize?: number;
  throttleMs?: number;
}

export interface BackfillResult {
  embedded: number;
  failed: number;
  pendingAtStart: number;
  cancelled: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

const recencyOf = (image: IndexedImage): number =>
  image.contentModifiedMs ?? image.lastModified ?? 0;

/**
 * Images that still need a vector: never embedded, or embedded from content
 * that has since changed on disk.
 *
 * Newest first, because that is the order users search in and it makes the
 * free-tier ceiling a natural prefix of the same list rather than a separate
 * selection rule.
 */
export const selectPendingImages = (
  images: IndexedImage[],
  embedded: Map<string, string>,
  remainingCapacity: number | null
): IndexedImage[] => {
  const pending: IndexedImage[] = [];
  for (const image of images) {
    const storedKey = embedded.get(image.id);
    if (storedKey !== undefined && storedKey === contentKeyForImage(image)) continue;
    pending.push(image);
  }

  pending.sort((left, right) => recencyOf(right) - recencyOf(left));

  if (remainingCapacity === null) return pending;
  return pending.slice(0, Math.max(0, remainingCapacity));
};

export const runBackfill = async (options: BackfillOptions): Promise<BackfillResult> => {
  const {
    cacheId,
    images,
    cap,
    signal,
    waitWhilePaused,
    onProgress,
    batchSize = DEFAULT_BATCH_SIZE,
    throttleMs = DEFAULT_THROTTLE_MS,
  } = options;

  const index = await openLibrary(cacheId);
  const embedded = index.liveEntries();
  const remainingCapacity = cap === null ? null : cap - index.stats.liveRows;
  const pending = selectPendingImages(images, embedded, remainingCapacity);

  const result: BackfillResult = {
    embedded: 0,
    failed: 0,
    pendingAtStart: pending.length,
    cancelled: false,
  };

  if (pending.length === 0) {
    onProgress?.({
      phase: 'complete',
      current: 0,
      total: 0,
      message: 'Visual search index is up to date',
    });
    return result;
  }

  const startedAt = Date.now();
  let lastFlushAt = Date.now();
  let lastProgressAt = 0;

  const report = (phase: SemanticIndexProgress['phase'], message: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    const done = result.embedded + result.failed;
    const elapsedSeconds = (now - startedAt) / 1000;
    const rate = elapsedSeconds > 0 ? done / elapsedSeconds : 0;
    onProgress?.({
      phase,
      current: done,
      total: pending.length,
      message,
      imagesPerSecond: rate,
      etaMs: rate > 0 ? ((pending.length - done) / rate) * 1000 : undefined,
    });
  };

  report('embedding', 'Preparing visual search index…', true);

  try {
    for (let offset = 0; offset < pending.length; offset += batchSize) {
      if (signal.aborted) {
        result.cancelled = true;
        break;
      }
      if (waitWhilePaused) {
        report('paused', 'Paused', true);
        await waitWhilePaused();
        if (signal.aborted) {
          result.cancelled = true;
          break;
        }
      }

      const batch = pending.slice(offset, offset + batchSize);
      const items = await buildEmbedItems(batch);
      const vectors = await embedImages(items);

      for (const vector of vectors) {
        if (!vector.codes || vector.scale === 0) {
          result.failed += 1;
          continue;
        }
        const image = batch.find((candidate) => candidate.id === vector.id);
        if (!image) continue;
        index.append(image.id, contentKeyForImage(image), { scale: vector.scale, codes: vector.codes });
        result.embedded += 1;
      }
      // Images with neither a thumbnail nor a readable original never become
      // work items, so they never come back as results. Count them here or
      // progress would stall short of the total.
      result.failed += batch.length - items.length;

      const now = Date.now();
      if (index.pendingCount >= FLUSH_EVERY_VECTORS || now - lastFlushAt >= FLUSH_EVERY_MS) {
        await index.flush();
        lastFlushAt = now;
      }

      report('embedding', `Indexing images for visual search…`);

      if (throttleMs > 0) {
        await sleep(throttleMs);
      }
    }
  } finally {
    // Always commit what was produced, including on cancel: the whole point of
    // the design is that a stopped run keeps its work.
    await index.flush().catch(() => undefined);
    unloadVisionTower();
    await syncWorker().catch(() => undefined);
  }

  report(
    result.cancelled ? 'paused' : 'complete',
    result.cancelled ? 'Visual search indexing stopped' : 'Visual search index ready',
    true
  );

  return result;
};
