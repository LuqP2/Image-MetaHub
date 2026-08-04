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

export interface EmbeddingModelDescriptor {
  id: string;
  revision: string;
  /** Embedding width. Changing this invalidates every stored vector. */
  dim: number;
  /** Shared config/tokenizer/processor files, needed by every backend. */
  baseFiles: string[];
  /** The two ONNX towers, per dtype. WASM needs q8; WebGPU needs fp16. */
  onnxByDtype: Record<'q8' | 'fp16', string[]>;
  /** Rounded download total per dtype, shown before the download starts. */
  approxBytesByDtype: Record<'q8' | 'fp16', number>;
  /** Square input the vision tower expects. */
  imageSize: number;
}

/**
 * ViT-B/32 is the cheapest CLIP vision tower that still ranks well, and the
 * OpenAI weights are MIT licensed. SigLIP is the upgrade path if the quality
 * gate fails: the manifest records modelId and dim, so switching models means
 * rebuilding the index, not migrating its format.
 *
 * File paths verified against the Hugging Face repo tree (q8 = *_quantized,
 * fp16 = *_fp16). A wrong entry surfaces as an HTTP 404 naming the file.
 */
export const CLIP_MODEL: EmbeddingModelDescriptor = {
  id: 'Xenova/clip-vit-base-patch32',
  revision: 'main',
  dim: 512,
  baseFiles: [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'preprocessor_config.json',
    'special_tokens_map.json',
  ],
  onnxByDtype: {
    q8: ['onnx/text_model_quantized.onnx', 'onnx/vision_model_quantized.onnx'],
    fp16: ['onnx/text_model_fp16.onnx', 'onnx/vision_model_fp16.onnx'],
  },
  approxBytesByDtype: {
    q8: 155 * 1024 * 1024,
    fp16: 290 * 1024 * 1024,
  },
  imageSize: 224,
};

/** Files that must be present to run the model on a given backend. */
export const filesForDevice = (device: EmbeddingDevice): string[] => [
  ...CLIP_MODEL.baseFiles,
  ...CLIP_MODEL.onnxByDtype[dtypeForDevice(device)],
];

/** Only the ONNX towers a device adds on top of an existing install. */
export const onnxFilesForDevice = (device: EmbeddingDevice): string[] =>
  CLIP_MODEL.onnxByDtype[dtypeForDevice(device)];

export const approxBytesForDevice = (device: EmbeddingDevice): number =>
  CLIP_MODEL.approxBytesByDtype[dtypeForDevice(device)];

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
