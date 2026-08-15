/**
 * The CLIP model the visual index is built from, and the contract shared by the
 * renderer (which downloads it) and the embedding worker (which loads it).
 *
 * Kept in its own module with no imports so both sides can read it without
 * dragging the Electron bridge or transformers.js into each other's bundle.
 */

export type EmbeddingDevice = 'wasm' | 'webgpu';

/**
 * transformers.js dtype per backend. WASM/CPU runs the int8 weights; WebGPU runs
 * fp16, which the GPU executes natively (q8 would dequantize op-by-op and lose
 * the speedup). Each maps to a different `*_<dtype>.onnx` file.
 */
export const dtypeForDevice = (device: EmbeddingDevice): 'q8' | 'fp16' =>
  device === 'webgpu' ? 'fp16' : 'q8';

/** Selectable models. The key is persisted in settings and names the index. */
export type EmbeddingModelKey = 'clip-b32' | 'clip-b16';

export interface EmbeddingModelDescriptor {
  key: EmbeddingModelKey;
  id: string;
  revision: string;
  /** Embedding width. Changing this invalidates every stored vector. */
  dim: number;
  /**
   * Vector index this model's embeddings live in. Per model, so switching back
   * and forth reuses an index that is already built instead of rebuilding it —
   * vectors from two models are not comparable and cannot share one.
   */
  cacheId: string;
  /** Settings label. Describes the trade-off, not the architecture. */
  label: string;
  description: string;
  /** Indexing cost relative to the cheapest model, for the settings copy. */
  relativeIndexingCost: number;
  /** Shared config/tokenizer/processor files, needed by every backend. */
  baseFiles: string[];
  /** The two ONNX towers, per dtype. WASM needs q8; WebGPU needs fp16. */
  onnxByDtype: Record<'q8' | 'fp16', string[]>;
  /** Rounded download total per dtype, shown before the download starts. */
  approxBytesByDtype: Record<'q8' | 'fp16', number>;
  /** Square input the vision tower expects. */
  imageSize: number;
}

const CLIP_BASE_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'preprocessor_config.json',
  'special_tokens_map.json',
];

const CLIP_ONNX_BY_DTYPE = {
  q8: ['onnx/text_model_quantized.onnx', 'onnx/vision_model_quantized.onnx'],
  fp16: ['onnx/text_model_fp16.onnx', 'onnx/vision_model_fp16.onnx'],
};

/**
 * The models the user can pick between, both OpenAI CLIP under the MIT license.
 *
 * They differ only in patch size, which is a pure quality/indexing-time dial:
 * at 224px, /32 gives the vision tower 49 patches and /16 gives it 196, so /16
 * sees four times as much detail and costs roughly four times as much per image
 * to index. Everything downstream is identical — same 512-dim vectors, same
 * index size on disk, same query latency, same text tower — so the choice only
 * ever trades one-time indexing time for retrieval quality.
 *
 * File paths verified against the Hugging Face repo trees (q8 = *_quantized,
 * fp16 = *_fp16). A wrong entry surfaces as an HTTP 404 naming the file.
 */
export const EMBEDDING_MODELS: Record<EmbeddingModelKey, EmbeddingModelDescriptor> = {
  'clip-b32': {
    key: 'clip-b32',
    id: 'Xenova/clip-vit-base-patch32',
    revision: 'main',
    dim: 512,
    // Keeps the original, un-suffixed id so an index built before models were
    // selectable is found — and, being format-incompatible, properly reclaimed
    // by open() rather than orphaned under a name nothing looks at.
    cacheId: 'imh-visual-search',
    label: 'Balanced',
    description: 'Fastest to index. Good for finding subjects and overall composition.',
    relativeIndexingCost: 1,
    baseFiles: CLIP_BASE_FILES,
    onnxByDtype: CLIP_ONNX_BY_DTYPE,
    approxBytesByDtype: {
      q8: 155 * 1024 * 1024,
      fp16: 290 * 1024 * 1024,
    },
    imageSize: 224,
  },
  'clip-b16': {
    key: 'clip-b16',
    id: 'Xenova/clip-vit-base-patch16',
    revision: 'main',
    dim: 512,
    cacheId: 'imh-visual-search-b16',
    label: 'Higher quality',
    description: 'Captures more visual detail. Takes about four times as long to index.',
    relativeIndexingCost: 4,
    baseFiles: CLIP_BASE_FILES,
    onnxByDtype: CLIP_ONNX_BY_DTYPE,
    // Near-identical parameter count to /32 — the smaller patch shrinks the
    // patch embedding and grows the position embedding, roughly cancelling out.
    approxBytesByDtype: {
      q8: 155 * 1024 * 1024,
      fp16: 290 * 1024 * 1024,
    },
    imageSize: 224,
  },
};

export const DEFAULT_EMBEDDING_MODEL_KEY: EmbeddingModelKey = 'clip-b32';

/** Resolves a persisted key, falling back when it names a model we dropped. */
export const getEmbeddingModel = (key: string | undefined | null): EmbeddingModelDescriptor =>
  EMBEDDING_MODELS[(key ?? '') as EmbeddingModelKey] ?? EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL_KEY];

/**
 * Caption templates a short query is expanded into before embedding.
 *
 * CLIP's text tower was trained on alt-text captions, never on bare nouns, so
 * "dog" sits in a thinner part of the text space than "a photo of a dog" does.
 * Embedding several phrasings and averaging them — the same prompt-ensembling
 * trick the original zero-shot results relied on — lands closer to the region
 * the image tower actually maps dogs to, and averages away the wording quirks of
 * any single template.
 *
 * Skewed toward rendered/illustrated phrasing rather than the photographic
 * templates of the ImageNet ensemble, because this library is generated art.
 * The bare query is kept in the set so an already well-phrased one is not
 * diluted by templates that fit it badly.
 */
export const QUERY_TEMPLATES = [
  '{}',
  'a photo of {}',
  'a picture of {}',
  'digital art of {}',
  'an illustration of {}',
  'a rendering of {}',
  'a close-up of {}',
];

/**
 * Word count past which a query is embedded verbatim. A long query is already
 * caption-shaped, and wrapping it ("a photo of a misty forest at dawn with a
 * lone figure walking") adds noise instead of context.
 */
export const MAX_TEMPLATED_WORDS = 4;

/**
 * The phrasings a query should be embedded as and averaged over. Returns the
 * query alone when templating would not help.
 */
export const expandQuery = (text: string): string[] => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/).length;
  if (words > MAX_TEMPLATED_WORDS) return [trimmed];
  return QUERY_TEMPLATES.map((template) => template.replace('{}', trimmed));
};

/** Files that must be present to run a model on a given backend. */
export const filesForDevice = (
  model: EmbeddingModelDescriptor,
  device: EmbeddingDevice
): string[] => [
  ...model.baseFiles,
  ...model.onnxByDtype[dtypeForDevice(device)],
];

/** Only the ONNX towers a device adds on top of an existing install. */
export const onnxFilesForDevice = (
  model: EmbeddingModelDescriptor,
  device: EmbeddingDevice
): string[] => model.onnxByDtype[dtypeForDevice(device)];

export const approxBytesForDevice = (
  model: EmbeddingModelDescriptor,
  device: EmbeddingDevice
): number => model.approxBytesByDtype[dtypeForDevice(device)];

/**
 * Base transformers.js resolves model files against. No trailing slash: it
 * joins with the model id itself, producing imh-model://local/<id>/<file>.
 */
export const MODEL_LOCAL_PATH = 'imh-model://local';

/** Origin the thumbnail protocol serves cached thumbnails from. */
export const THUMBNAIL_PROTOCOL_ORIGIN = 'imh-thumb://local/';

/** Origin the media protocol serves original library files from. */
export const MEDIA_PROTOCOL_ORIGIN = 'imh-media://local/';

export const buildThumbnailUrl = (thumbnailId: string, extension = 'webp'): string =>
  `${THUMBNAIL_PROTOCOL_ORIGIN}?id=${encodeURIComponent(thumbnailId)}&ext=${encodeURIComponent(extension)}`;

export const buildMediaUrl = (absolutePath: string): string =>
  `${MEDIA_PROTOCOL_ORIGIN}?path=${encodeURIComponent(absolutePath)}`;
