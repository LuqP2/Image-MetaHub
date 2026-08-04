/**
 * The CLIP model the visual index is built from, and the contract shared by the
 * renderer (which downloads it) and the embedding worker (which loads it).
 *
 * Kept in its own module with no imports so both sides can read it without
 * dragging the Electron bridge or transformers.js into each other's bundle.
 */

export interface EmbeddingModelDescriptor {
  id: string;
  revision: string;
  /** Embedding width. Changing this invalidates every stored vector. */
  dim: number;
  /** Files transformers.js needs present before it can load the model. */
  files: string[];
  /** Rounded total, shown to the user before the download starts. */
  approxBytes: number;
  /** Square input the vision tower expects. */
  imageSize: number;
}

/**
 * ViT-B/32 is the cheapest CLIP vision tower that still ranks well, and the
 * OpenAI weights are MIT licensed. SigLIP is the upgrade path if the quality
 * gate fails: the manifest records modelId and dim, so switching models means
 * rebuilding the index, not migrating its format.
 *
 * ASSUMPTION TO VALIDATE: the file list below matches the Hugging Face repo
 * layout. A wrong entry surfaces as an HTTP 404 naming the file on first opt-in.
 */
export const CLIP_MODEL: EmbeddingModelDescriptor = {
  id: 'Xenova/clip-vit-base-patch32',
  revision: 'main',
  dim: 512,
  files: [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'preprocessor_config.json',
    'special_tokens_map.json',
    'onnx/text_model_quantized.onnx',
    'onnx/vision_model_quantized.onnx',
  ],
  approxBytes: 155 * 1024 * 1024,
  imageSize: 224,
};

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
