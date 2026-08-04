import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  env,
} from '@huggingface/transformers';
import { l2Normalize, quantizeVector } from '../embeddings/embeddingFormat';

/**
 * Runs the CLIP towers that turn images and query text into vectors.
 *
 * Runs off the main thread because a single vision pass is tens to hundreds of
 * milliseconds and the backfill does hundreds of thousands of them. Everything
 * stays on CPU (WASM) by default: the app must never compete for VRAM with the
 * image generator the user is running alongside it.
 *
 * Vectors are normalized and quantized here rather than in the caller so each
 * result crosses the worker boundary as ~516 bytes instead of ~2KB.
 */

type Device = 'wasm' | 'webgpu';

interface EmbedItem {
  id: string;
  /** Preferred source, normally the 320px cached thumbnail. */
  url: string;
  /** Original file, used when the thumbnail is missing or unreadable. */
  fallbackUrl?: string;
}

type WorkerMessage =
  | {
      type: 'init';
      payload: { modelId: string; modelPath: string; wasmPath: string; device: Device; numThreads?: number };
    }
  | { type: 'embedImages'; payload: { jobId: number; items: EmbedItem[] } }
  | { type: 'embedText'; payload: { jobId: number; text: string } }
  | { type: 'unloadVision' }
  | { type: 'dispose' };

interface EmbedResult {
  id: string;
  scale: number;
  codes: ArrayBuffer | null;
  error?: string;
}

type WorkerResponse =
  | { type: 'ready'; payload: { device: Device } }
  | { type: 'images'; payload: { jobId: number; results: EmbedResult[]; durationMs: number } }
  | { type: 'text'; payload: { jobId: number; scale: number; codes: ArrayBuffer } }
  | { type: 'error'; payload: { jobId?: number; error: string } };

const post = (message: WorkerResponse, transfer?: Transferable[]) => {
  (self as unknown as Worker).postMessage(message, transfer ?? []);
};

let modelId = '';
let device: Device = 'wasm';
let processor: any = null;
let tokenizer: any = null;
let visionModel: any = null;
let textModel: any = null;

const configureEnvironment = (modelPath: string, wasmPath: string, numThreads?: number): void => {
  // Local-first: the weights were already downloaded to userData and are served
  // over the imh-model protocol. Remote model resolution is switched off so a
  // missing file fails loudly instead of silently reaching the network.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = modelPath;
  env.useBrowserCache = false;
  // The ORT runtime binaries ship with the app; without this transformers.js
  // would fetch them from a CDN at first inference.
  env.backends.onnx.wasm.wasmPaths = wasmPath;
  env.backends.onnx.wasm.proxy = false;
  if (numThreads && Number.isFinite(numThreads)) {
    env.backends.onnx.wasm.numThreads = Math.max(1, Math.floor(numThreads));
  }
};

// q8 to match the *_quantized.onnx files the downloader fetches. Without this,
// transformers.js v3 defaults to fp32 and would look for model.onnx, which was
// never downloaded.
const LOAD_OPTIONS = () => ({ device, dtype: 'q8' as const });

const ensureVision = async (): Promise<void> => {
  if (visionModel && processor) return;
  processor = processor ?? (await AutoProcessor.from_pretrained(modelId));
  visionModel = visionModel ?? (await CLIPVisionModelWithProjection.from_pretrained(modelId, LOAD_OPTIONS()));
};

const ensureText = async (): Promise<void> => {
  if (textModel && tokenizer) return;
  tokenizer = tokenizer ?? (await AutoTokenizer.from_pretrained(modelId));
  textModel = textModel ?? (await CLIPTextModelWithProjection.from_pretrained(modelId, LOAD_OPTIONS()));
};

const loadImage = async (item: EmbedItem): Promise<RawImage> => {
  try {
    return await RawImage.fromURL(item.url);
  } catch (error) {
    if (!item.fallbackUrl) throw error;
    return RawImage.fromURL(item.fallbackUrl);
  }
};

const toQuantized = (values: Float32Array): { scale: number; codes: ArrayBuffer } => {
  const quantized = quantizeVector(l2Normalize(values));
  const source = quantized.codes;
  // Copy into a fresh ArrayBuffer so the result is a transferable of exactly the
  // right length (the Int8Array may be a view into a larger allocation).
  const codes = new ArrayBuffer(source.byteLength);
  new Int8Array(codes).set(source);
  return { scale: quantized.scale, codes };
};

const embedImages = async (jobId: number, items: EmbedItem[]): Promise<void> => {
  const startedAt = performance.now();
  await ensureVision();

  const results: EmbedResult[] = [];
  const loaded: Array<{ item: EmbedItem; image: RawImage }> = [];

  for (const item of items) {
    try {
      loaded.push({ item, image: await loadImage(item) });
    } catch (error) {
      // A single unreadable file must not sink the batch; the indexer records
      // it as attempted so the job still makes progress.
      results.push({
        id: item.id,
        scale: 0,
        codes: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (loaded.length > 0) {
    const inputs = await processor(loaded.map((entry) => entry.image));
    const output = await visionModel(inputs);
    const embeddings = output.image_embeds;
    const [batch, width] = embeddings.dims;
    const flat = embeddings.data as Float32Array;

    for (let row = 0; row < batch; row += 1) {
      const slice = new Float32Array(flat.subarray(row * width, (row + 1) * width));
      results.push({ id: loaded[row].item.id, ...toQuantized(slice) });
    }
  }

  post(
    { type: 'images', payload: { jobId, results, durationMs: performance.now() - startedAt } },
    results.map((result) => result.codes).filter((codes): codes is ArrayBuffer => codes !== null)
  );
};

const embedText = async (jobId: number, text: string): Promise<void> => {
  await ensureText();
  const inputs = tokenizer([text], { padding: true, truncation: true });
  const output = await textModel(inputs);
  const embeddings = output.text_embeds;
  const width = embeddings.dims[1];
  const values = new Float32Array((embeddings.data as Float32Array).subarray(0, width));
  const { scale, codes } = toQuantized(values);
  post({ type: 'text', payload: { jobId, scale, codes } }, [codes]);
};

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  const jobId = 'payload' in message && message.payload && 'jobId' in message.payload
    ? (message.payload as { jobId: number }).jobId
    : undefined;

  try {
    switch (message.type) {
      case 'init': {
        modelId = message.payload.modelId;
        device = message.payload.device;
        configureEnvironment(message.payload.modelPath, message.payload.wasmPath, message.payload.numThreads);
        post({ type: 'ready', payload: { device } });
        break;
      }

      case 'embedImages':
        await embedImages(message.payload.jobId, message.payload.items);
        break;

      case 'embedText':
        await embedText(message.payload.jobId, message.payload.text);
        break;

      case 'unloadVision': {
        // Frees the larger of the two towers once a backfill finishes; queries
        // only need the text tower resident.
        await visionModel?.dispose?.();
        visionModel = null;
        processor = null;
        break;
      }

      case 'dispose': {
        await visionModel?.dispose?.();
        await textModel?.dispose?.();
        visionModel = null;
        textModel = null;
        processor = null;
        tokenizer = null;
        break;
      }

      default:
        break;
    }
  } catch (error) {
    post({
      type: 'error',
      payload: { jobId, error: error instanceof Error ? error.message : String(error) },
    });
  }
};

export type { WorkerMessage as EmbeddingWorkerMessage, WorkerResponse as EmbeddingWorkerResponse, EmbedItem, EmbedResult };
