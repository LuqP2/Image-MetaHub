import { create } from 'zustand';
import type {
  EmbeddingModelProgress,
  SemanticIndexCoverage,
  SemanticIndexProgress,
  SemanticSearchResult,
} from '../types';
import {
  cancelModelDownload,
  deleteModel,
  downloadModel,
  getModelStatus,
  setOnDeviceChanged,
  setPreferredDevice,
  setPreferredModel,
  stopEmbeddingWorker,
} from '../services/embeddings/embeddingService';
import {
  DEFAULT_EMBEDDING_MODEL_KEY,
  getEmbeddingModel,
  type EmbeddingDevice,
  type EmbeddingModelKey,
} from '../services/embeddings/embeddingModel';
import { runBackfill } from '../services/embeddings/embeddingIndexer';
import type { IndexedImage } from '../types';
import {
  closeLibrary,
  getIndex,
  openLibrary,
  searchByText,
  searchSimilarToImage,
  semanticCacheId,
} from '../services/embeddings/semanticSearchEngine';
import { deleteEmbeddingIndex } from '../services/embeddings/embeddingStore';
import { useImageStore } from './useImageStore';

/**
 * Orchestrates the visual-search feature: model download, the backfill job, and
 * running queries. Kept out of useImageStore so the heavy, opt-in machinery does
 * not weigh on the hot filter/render path; the only thing it pushes into
 * useImageStore is the finished score map, via applySemanticResult.
 */

interface SemanticStoreState {
  /** Backend the user asked for (mirrors settings.semanticSearchDevice). */
  device: EmbeddingDevice;
  /** Backend the worker actually settled on after any fallback. */
  activeDevice: EmbeddingDevice;
  /** Model the user picked (mirrors settings.semanticSearchModel). */
  modelKey: EmbeddingModelKey;

  /** WASM (q8) baseline present — this is what gates the feature at all. */
  modelInstalled: boolean;
  /** fp16 towers present — unlocks the WebGPU accelerator on top of the baseline. */
  gpuModelInstalled: boolean;
  modelDownloading: boolean;
  modelProgress: EmbeddingModelProgress | null;

  indexProgress: SemanticIndexProgress | null;
  coverage: SemanticIndexCoverage | null;
  isBackfilling: boolean;
  isPaused: boolean;

  queryActive: boolean;
  queryRunning: boolean;
  /** Name of the source image when the active result is a "find similar", else null. */
  similarSourceName: string | null;
  /** Why the last query produced nothing, so the search UI can explain itself. */
  queryNotice: 'ok' | 'no-index' | 'no-results' | 'error' | null;
  queryResultCount: number;
  /** Best cosine of the last query, surfaced for tuning/diagnosis. */
  queryTopScore: number | null;
  lastError: string | null;

  setDevice: (device: EmbeddingDevice) => void;
  /** Switches models: swaps the index, the worker and the downloaded weights. */
  setModel: (modelKey: EmbeddingModelKey) => void;
  refreshModelStatus: () => Promise<boolean>;
  startModelDownload: () => Promise<boolean>;
  cancelModelDownload: () => Promise<void>;

  /** Opens the on-disk index and refreshes coverage stats. Never reconciles. */
  openForLibrary: () => Promise<void>;

  startBackfill: (cap: number | null) => Promise<void>;
  pauseBackfill: () => void;
  resumeBackfill: () => void;
  cancelBackfill: () => void;

  runQuery: (query: string) => Promise<void>;
  /** Ranks the grid by visual similarity to an image (embedding it if needed). */
  runVisualSimilar: (image: IndexedImage) => Promise<void>;
  clearQuery: () => void;

  deleteIndex: () => Promise<void>;
  teardown: () => void;
}

let backfillController: AbortController | null = null;
let pauseResolvers: Array<() => void> = [];
let paused = false;
/** Monotonic query id so a slow reply from a superseded query is ignored. */
let queryGeneration = 0;

const waitWhilePaused = (): Promise<void> => {
  if (!paused) return Promise.resolve();
  return new Promise<void>((resolve) => {
    pauseResolvers.push(resolve);
  });
};

const releasePause = (): void => {
  paused = false;
  const resolvers = pauseResolvers;
  pauseResolvers = [];
  for (const resolve of resolvers) resolve();
};

const buildCoverage = (cap: number | null, total: number): SemanticIndexCoverage => {
  const index = getIndex();
  return {
    embedded: index ? index.stats.liveRows : 0,
    total,
    cap,
  };
};

export const useSemanticStore = create<SemanticStoreState>((set, get) => ({
  device: 'wasm',
  activeDevice: 'wasm',
  modelKey: DEFAULT_EMBEDDING_MODEL_KEY,
  modelInstalled: false,
  gpuModelInstalled: false,
  modelDownloading: false,
  modelProgress: null,
  indexProgress: null,
  coverage: null,
  isBackfilling: false,
  isPaused: false,
  queryActive: false,
  queryRunning: false,
  similarSourceName: null,
  queryNotice: null,
  queryResultCount: 0,
  queryTopScore: null,
  lastError: null,

  setDevice: (device) => {
    if (device === get().device) return;
    // Route inference to the new backend (drops the current worker), and keep
    // activeDevice in sync when a later fp16 load forces a fallback.
    setPreferredDevice(device);
    setOnDeviceChanged((resolved) => set({ activeDevice: resolved }));
    set({ device, activeDevice: device });
    // The installed set differs per backend (q8 vs fp16 towers), so re-check.
    void get().refreshModelStatus();
  },

  setModel: (modelKey) => {
    const resolved = getEmbeddingModel(modelKey).key;
    if (resolved === get().modelKey) return;

    // A running query or backfill belongs to the old model's index; both would
    // otherwise keep writing into an index the app no longer considers current.
    get().cancelBackfill();
    get().clearQuery();
    setPreferredModel(resolved);
    // Drops the open index and its search worker. openForLibrary below reopens
    // against the new model, whose vectors have a different width.
    closeLibrary();
    set({ modelKey: resolved, coverage: null, indexProgress: null, lastError: null });

    void get().refreshModelStatus();
    void get().openForLibrary();
  },

  refreshModelStatus: async () => {
    try {
      // Check the always-needed CPU baseline and the optional GPU towers together.
      const modelKey = get().modelKey;
      const [cpu, gpu] = await Promise.all([
        getModelStatus('wasm', modelKey),
        getModelStatus('webgpu', modelKey),
      ]);
      set({ modelInstalled: cpu.installed, gpuModelInstalled: gpu.installed });
      return cpu.installed;
    } catch (error) {
      // Callers fire this from mount effects without awaiting it, so a failure
      // (bridge unavailable, IPC error) must land in state rather than become
      // an unhandled rejection.
      set({ lastError: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  startModelDownload: async () => {
    if (get().modelDownloading) return false;
    set({ modelDownloading: true, modelProgress: null, lastError: null });
    try {
      // The q8 baseline is the CPU fallback and is what modelInstalled gates on,
      // so it must always be fetched — even on GPU, which otherwise pulls only
      // the fp16 towers and would leave modelInstalled stuck false. On GPU we
      // then add the fp16 towers on top (the handler skips files already on disk).
      const onProgress = (progress: EmbeddingModelProgress) => set({ modelProgress: progress });
      let result = await downloadModel(onProgress, 'wasm', get().modelKey);
      if (result.success && get().device === 'webgpu') {
        result = await downloadModel(onProgress, 'webgpu', get().modelKey);
      }
      if (result.success) {
        // Downloaded files depend on the selected backend; re-check both flags.
        await get().refreshModelStatus();
        set({ modelDownloading: false });
        return true;
      }
      set({
        modelDownloading: false,
        lastError: result.cancelled ? null : result.error ?? 'Model download failed',
      });
      return false;
    } catch (error) {
      set({ modelDownloading: false, lastError: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  cancelModelDownload: async () => {
    await cancelModelDownload();
    set({ modelDownloading: false });
  },

  openForLibrary: async () => {
    // Also fired from mount effects — same reasoning as refreshModelStatus above.
    //
    // Deliberately does NOT reconcile against useImageStore.images: this runs from a
    // mount effect that can fire before the library has finished hydrating from the
    // metadata cache, and reconciling against a still-empty/partial image list would
    // tombstone every live vector as "no longer present" and flush that away for real.
    // Reconciliation only happens from runBackfill, which is a deliberate user action
    // that already has the authoritative, fully-loaded image array.
    try {
      await openLibrary(getEmbeddingModel(get().modelKey));
      const total = useImageStore.getState().images.length;
      set({ coverage: buildCoverage(get().coverage?.cap ?? null, total) });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) });
    }
  },

  startBackfill: async (cap) => {
    if (get().isBackfilling) return;

    backfillController = new AbortController();
    paused = false;
    pauseResolvers = [];
    set({ isBackfilling: true, isPaused: false, lastError: null });

    const images = useImageStore.getState().images;

    try {
      await runBackfill({
        model: getEmbeddingModel(get().modelKey),
        images,
        cap,
        signal: backfillController.signal,
        waitWhilePaused,
        onProgress: (progress) => {
          const total = useImageStore.getState().images.length;
          set({ indexProgress: progress, coverage: buildCoverage(cap, total) });
        },
      });
    } catch (error) {
      set({
        indexProgress: {
          phase: 'error',
          current: 0,
          total: 0,
          message: 'Visual search indexing failed',
          error: error instanceof Error ? error.message : String(error),
        },
        lastError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      backfillController = null;
      releasePause();
      const total = useImageStore.getState().images.length;
      set({ isBackfilling: false, isPaused: false, coverage: buildCoverage(cap, total) });
    }
  },

  pauseBackfill: () => {
    if (!get().isBackfilling) return;
    paused = true;
    set({ isPaused: true });
  },

  resumeBackfill: () => {
    if (!get().isBackfilling) return;
    releasePause();
    set({ isPaused: false });
  },

  cancelBackfill: () => {
    backfillController?.abort();
    // A paused job is parked inside the gate; release it so the abort is seen.
    releasePause();
    set({ isPaused: false });
  },

  runQuery: async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      get().clearQuery();
      return;
    }

    const generation = ++queryGeneration;
    set({ queryRunning: true, queryActive: true, lastError: null, queryNotice: null, similarSourceName: null });

    try {
      // Open the index on demand: the search can be run without ever visiting
      // the settings panel, which was previously the only place that opened it.
      const index = await openLibrary(getEmbeddingModel(get().modelKey));
      if (generation !== queryGeneration) return;

      if (index.stats.liveRows === 0) {
        // Nothing embedded yet — leave the grid untouched and say why, rather
        // than blanking it with an empty ranked set.
        set({ queryRunning: false, queryNotice: 'no-index', queryResultCount: 0 });
        return;
      }

      const { hits, stats } = await searchByText(trimmed);
      if (generation !== queryGeneration) return;

      const scoreById = new Map<string, number>();
      for (const hit of hits) scoreById.set(hit.imageId, hit.score);
      const result: SemanticSearchResult = { generation, query: trimmed, scoreById };
      useImageStore.getState().applySemanticResult(result);
      set({
        queryRunning: false,
        queryResultCount: hits.length,
        queryTopScore: stats.topScore ?? null,
        queryNotice: hits.length === 0 ? 'no-results' : 'ok',
      });
    } catch (error) {
      if (generation !== queryGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error('[visual-search] query failed:', error);
      set({ queryRunning: false, queryNotice: 'error', lastError: message });
    }
  },

  runVisualSimilar: async (image) => {
    const generation = ++queryGeneration;
    set({
      queryRunning: true,
      queryActive: true,
      lastError: null,
      queryNotice: null,
      similarSourceName: image.name,
    });

    try {
      const result = await searchSimilarToImage(image);
      if (generation !== queryGeneration) return;

      if (!result) {
        set({ queryRunning: false, queryNotice: 'error', similarSourceName: null, lastError: 'Could not read this image for visual search' });
        return;
      }

      const scoreById = new Map<string, number>();
      // Keep the source in view, pinned at the top, so the comparison is visible.
      scoreById.set(image.id, Number.POSITIVE_INFINITY);
      for (const hit of result.hits) scoreById.set(hit.imageId, hit.score);

      useImageStore.getState().applySemanticResult({
        generation,
        query: `similar to ${image.name}`,
        scoreById,
      });
      set({
        queryRunning: false,
        queryResultCount: result.hits.length,
        queryTopScore: result.hits[0]?.score ?? null,
        queryNotice: result.hits.length === 0 ? 'no-results' : 'ok',
      });
    } catch (error) {
      if (generation !== queryGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error('[visual-search] find similar failed:', error);
      set({ queryRunning: false, queryNotice: 'error', similarSourceName: null, lastError: message });
    }
  },

  clearQuery: () => {
    queryGeneration += 1;
    useImageStore.getState().applySemanticResult(null);
    set({ queryActive: false, queryRunning: false, queryNotice: null, queryResultCount: 0, queryTopScore: null, similarSourceName: null });
  },

  deleteIndex: async () => {
    get().cancelBackfill();
    get().clearQuery();
    closeLibrary();
    await deleteEmbeddingIndex(semanticCacheId(getEmbeddingModel(get().modelKey)));
    set({ coverage: null, indexProgress: null });
  },

  teardown: () => {
    get().cancelBackfill();
    get().clearQuery();
    closeLibrary();
    stopEmbeddingWorker();
    set({
      indexProgress: null,
      coverage: null,
      isBackfilling: false,
      isPaused: false,
      queryActive: false,
      queryRunning: false,
    });
  },
}));

/** Exposed separately because it is only reachable from the settings panel. */
export const deleteSemanticModel = async (): Promise<void> => {
  // Removes the selected model only; the other one's weights stay on disk, so
  // switching back does not re-download.
  await deleteModel(useSemanticStore.getState().modelKey);
  // Both towers go with it, so the GPU flag has to drop too or the panel keeps
  // claiming the fp16 model is installed.
  useSemanticStore.setState({ modelInstalled: false, gpuModelInstalled: false, modelProgress: null });
};
