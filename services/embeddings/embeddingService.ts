import type { EmbeddingModelProgress, IndexedImage } from '../../types';
import { getThumbnailCacheCandidate } from '../thumbnailCache';
import {
  CLIP_MODEL,
  MODEL_LOCAL_PATH,
  approxBytesForDevice,
  buildMediaUrl,
  filesForDevice,
  type EmbeddingDevice,
} from './embeddingModel';
import type { EmbedItem, EmbedResult } from '../workers/embeddingWorker';

/**
 * Renderer-side owner of the CLIP model: downloads the weights, runs the
 * embedding worker, and turns images into quantized vectors.
 *
 * Everything here is inert until the user opts in. Nothing is downloaded, no
 * worker is spawned and no file is written before that.
 */

type Device = EmbeddingDevice;

/** Backend the next worker start should try. Falls back to WASM at load time. */
let preferredDevice: Device = 'wasm';
/** Backend the running worker actually settled on (after any fallback). */
let activeDevice: Device = 'wasm';

export const getActiveDevice = (): Device => activeDevice;

/** Notified when the running worker's backend changes (e.g. webgpu→wasm). */
let onDeviceChanged: ((device: Device) => void) | null = null;
export const setOnDeviceChanged = (cb: ((device: Device) => void) | null): void => {
  onDeviceChanged = cb;
};

export const setPreferredDevice = (device: Device): void => {
  if (device === preferredDevice) return;
  preferredDevice = device;
  // The device is chosen at worker init, so a change only takes effect on the
  // next start; drop the current worker so the new backend is picked up.
  stopEmbeddingWorker();
};

export interface QuantizedResult {
  id: string;
  scale: number;
  codes: Int8Array | null;
  error?: string;
}

const getElectronAPI = () => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api) {
    throw new Error('Visual search requires the Electron bridge');
  }
  return api;
};

export const getModelStatus = async (
  device: Device = 'wasm'
): Promise<{ installed: boolean; missing: string[]; totalBytes: number }> => {
  const api = getElectronAPI();
  const files = filesForDevice(device);
  const result = await api.getEmbeddingModelStatus({ modelId: CLIP_MODEL.id, files });
  return {
    installed: Boolean(result.success && result.installed),
    missing: result.missing ?? files,
    totalBytes: result.totalBytes ?? 0,
  };
};

export const getModelDownloadSize = (device: Device = 'wasm'): number => approxBytesForDevice(device);

export const downloadModel = async (
  onProgress?: (progress: EmbeddingModelProgress) => void,
  device: Device = 'wasm'
): Promise<{ success: boolean; cancelled?: boolean; error?: string }> => {
  const api = getElectronAPI();
  const unsubscribe = onProgress ? api.onEmbeddingModelProgress(onProgress) : null;
  try {
    return await api.downloadEmbeddingModel({
      modelId: CLIP_MODEL.id,
      revision: CLIP_MODEL.revision,
      // The handler skips files already on disk, so passing the full set for the
      // device downloads only the missing towers (e.g. just fp16 when adding GPU).
      files: filesForDevice(device),
    });
  } finally {
    unsubscribe?.();
  }
};

export const cancelModelDownload = async (): Promise<void> => {
  await getElectronAPI().cancelEmbeddingModelDownload();
};

export const deleteModel = async (): Promise<void> => {
  await getElectronAPI().deleteEmbeddingModel({ modelId: CLIP_MODEL.id });
};

let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let nextJobId = 1;

type PendingJob = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

const pendingJobs = new Map<number, PendingJob>();

const resolveWasmPath = (): string => {
  // Resolved against the document rather than the worker script: in dev the
  // worker is served from a different directory than in a packaged build, but
  // public/ort lands next to the document in both.
  const base = typeof document !== 'undefined' ? document.baseURI : self.location.href;
  return new URL('ort/', base).href;
};

export const startEmbeddingWorker = async (device: Device = preferredDevice): Promise<void> => {
  if (workerReady) return workerReady;

  workerReady = new Promise<void>((resolve, reject) => {
    const instance = new Worker(new URL('../workers/embeddingWorker.ts', import.meta.url), { type: 'module' });

    instance.onmessage = (event: MessageEvent<any>) => {
      const message = event.data;
      if (message?.type === 'ready') {
        // The worker may downgrade webgpu→wasm if no adapter or the fp16 load
        // fails, and reports what it actually settled on.
        activeDevice = message.payload?.device === 'webgpu' ? 'webgpu' : 'wasm';
        resolve();
        return;
      }
      if (message?.type === 'deviceChanged') {
        // A later fp16 load failure dropped us to CPU; reflect that so the UI
        // stops claiming GPU acceleration.
        activeDevice = message.payload?.device === 'webgpu' ? 'webgpu' : 'wasm';
        onDeviceChanged?.(activeDevice);
        return;
      }
      if (message?.type === 'error') {
        const error = new Error(message.payload?.error || 'Embedding worker failed');
        const jobId = message.payload?.jobId;
        if (typeof jobId === 'number' && pendingJobs.has(jobId)) {
          pendingJobs.get(jobId)!.reject(error);
          pendingJobs.delete(jobId);
        } else {
          reject(error);
        }
        return;
      }
      const jobId = message?.payload?.jobId;
      const pending = typeof jobId === 'number' ? pendingJobs.get(jobId) : undefined;
      if (pending) {
        pending.resolve(message.payload);
        pendingJobs.delete(jobId);
      }
    };

    instance.onerror = (event) => {
      const error = new Error(event.message || 'Embedding worker crashed');
      for (const pending of pendingJobs.values()) {
        pending.reject(error);
      }
      pendingJobs.clear();
      reject(error);
    };

    worker = instance;
    instance.postMessage({
      type: 'init',
      payload: {
        modelId: CLIP_MODEL.id,
        modelPath: MODEL_LOCAL_PATH,
        wasmPath: resolveWasmPath(),
        device,
        fallbackDevice: 'wasm' as Device,
      },
    });
  }).catch((error) => {
    // A failed init must not leave a poisoned promise that every later call
    // rethrows without ever retrying the worker.
    workerReady = null;
    worker?.terminate();
    worker = null;
    throw error;
  });

  return workerReady;
};

const call = async <T>(message: { type: string; payload: Record<string, unknown> }): Promise<T> => {
  await startEmbeddingWorker();
  if (!worker) throw new Error('Embedding worker is not running');

  const jobId = nextJobId;
  nextJobId += 1;

  return new Promise<T>((resolve, reject) => {
    pendingJobs.set(jobId, { resolve, reject });
    worker!.postMessage({ ...message, payload: { ...message.payload, jobId } });
  });
};

const toQuantizedResults = (results: EmbedResult[]): QuantizedResult[] =>
  results.map((result) => ({
    id: result.id,
    scale: result.scale,
    codes: result.codes ? new Int8Array(result.codes) : null,
    error: result.error,
  }));

export const embedImages = async (items: EmbedItem[]): Promise<QuantizedResult[]> => {
  if (items.length === 0) return [];
  const payload = await call<{ results: EmbedResult[] }>({ type: 'embedImages', payload: { items } });
  return toQuantizedResults(payload.results);
};

export const embedText = async (
  text: string,
  negatives: string[] = []
): Promise<{ scale: number; codes: Int8Array }> => {
  const payload = await call<{ scale: number; codes: ArrayBuffer }>({
    type: 'embedText',
    payload: { text, negatives },
  });
  return { scale: payload.scale, codes: new Int8Array(payload.codes) };
};

/** Drops the vision tower once a backfill is done; queries only need the text tower. */
export const unloadVisionTower = (): void => {
  worker?.postMessage({ type: 'unloadVision' });
};

export const stopEmbeddingWorker = (): void => {
  worker?.postMessage({ type: 'dispose' });
  worker?.terminate();
  worker = null;
  workerReady = null;
  for (const pending of pendingJobs.values()) {
    pending.reject(new Error('Embedding worker stopped'));
  }
  pendingJobs.clear();
};

type ElectronFileHandle = FileSystemFileHandle & { _filePath?: string };

const getFilePath = (image: IndexedImage): string | undefined =>
  (image.handle as ElectronFileHandle | undefined)?._filePath;

/**
 * Builds the worker payload for a batch of images.
 *
 * Thumbnails are the preferred source: they are already ~320px, CLIP resamples
 * to 224 anyway, and decoding them instead of full-resolution originals is what
 * makes a 400k-image backfill viable. Missing thumbnails are generated first,
 * so the backfill doubles as a thumbnail warm-up.
 */
export const buildEmbedItems = async (images: IndexedImage[]): Promise<EmbedItem[]> => {
  const api = getElectronAPI();
  const candidates = images.map((image) => getThumbnailCacheCandidate(image));
  const resolved = await api.resolveThumbnailCacheBatch({ candidates });
  const results = resolved.success ? resolved.results ?? {} : {};

  // Resolve each image's source in parallel. On a first run every thumbnail is
  // a miss, so generating them one at a time (one IPC round-trip each) was the
  // dominant cost — far more than the embedding itself. Order does not matter:
  // the worker returns results keyed by id.
  const built = await Promise.all(images.map(async (image): Promise<EmbedItem | null> => {
    const filePath = getFilePath(image);
    const fallbackUrl = filePath ? buildMediaUrl(filePath) : undefined;
    const hit = results[image.id];

    if (hit?.hit && hit.url) {
      return { id: image.id, url: hit.url, fallbackUrl };
    }

    if (filePath) {
      const generated = await api.generateThumbnailToCache({
        ...getThumbnailCacheCandidate(image),
        filePath,
      }).catch(() => null);
      if (generated?.success && generated.url) {
        return { id: image.id, url: generated.url, fallbackUrl };
      }
    }

    return fallbackUrl ? { id: image.id, url: fallbackUrl } : null;
  }));

  return built.filter((item): item is EmbedItem => item !== null);
};
