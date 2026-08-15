const MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'preprocessor_config.json',
  'special_tokens_map.json',
  'onnx/text_model_quantized.onnx',
  'onnx/vision_model_quantized.onnx',
  'onnx/text_model_fp16.onnx',
  'onnx/vision_model_fp16.onnx',
];

const ALLOWED_MODELS = new Set([
  'Xenova/clip-vit-base-patch32',
  'Xenova/clip-vit-base-patch16',
]);

const ALLOWED_FILES = new Set(MODEL_FILES);

export const validateEmbeddingModelId = (modelId) => {
  if (!ALLOWED_MODELS.has(modelId)) {
    throw new Error(`Rejected embedding model: ${modelId}`);
  }
  return modelId;
};

export const validateEmbeddingModelRequest = ({ modelId, revision = 'main', files } = {}) => {
  validateEmbeddingModelId(modelId);
  if (revision !== 'main') {
    throw new Error(`Rejected embedding model revision: ${revision}`);
  }
  if (!Array.isArray(files) || files.length === 0 || files.some((file) => !ALLOWED_FILES.has(file))) {
    throw new Error('Rejected embedding model file list');
  }
  return { modelId, revision, files: [...files] };
};

export const buildEmbeddingModelDownloadUrl = ({ modelId, revision = 'main', file }) => {
  validateEmbeddingModelRequest({ modelId, revision, files: [file] });
  const encodedModel = modelId.split('/').map(encodeURIComponent).join('/');
  const encodedFile = file.split('/').map(encodeURIComponent).join('/');
  return `https://huggingface.co/${encodedModel}/resolve/${encodeURIComponent(revision)}/${encodedFile}`;
};
