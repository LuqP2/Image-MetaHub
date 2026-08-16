const MODEL_ORIGIN = 'https://huggingface.co';

// Main-process trust policy for every byte the embedding runtime may load.
// Revisions are immutable commits; sizes and SHA-256 values are pinned from
// those exact revisions. Renderer requests can select an allowed subset, but
// cannot supply or replace any integrity metadata.
const MODEL_POLICIES = Object.freeze({
  'Xenova/clip-vit-base-patch32': Object.freeze({
    revision: 'd15189d7028b43f1d3e65039190477f6af591c2a',
    files: Object.freeze({
      'config.json': { size: 4524, sha256: '493ef57ff783e42d1530c91b53469b7fdf8db8a9c1408e86998fcb7899a4f495' },
      'tokenizer.json': { size: 2224119, sha256: 'f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd' },
      'tokenizer_config.json': { size: 775, sha256: '60ba2912bc6344c94bc16bbdec27fa1209409167b6f2fdf3cfe9e65462ea3967' },
      'preprocessor_config.json': { size: 520, sha256: '6f638fb9401a6d6296feff533ee7efe657b787c49f954f82f5906b36ef2a1b1f' },
      'special_tokens_map.json': { size: 472, sha256: 'c4864a9376a8401918425bed71fc14fc0e81f9b59ec45c1cf96cccb2df508eac' },
      'onnx/text_model_quantized.onnx': { size: 64504507, sha256: '73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a' },
      'onnx/vision_model_quantized.onnx': { size: 89117001, sha256: '583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299' },
      'onnx/text_model_fp16.onnx': { size: 127339794, sha256: 'df587ffbf248bf20d44fa6e16adc5ebc27ead691860e5333dbdaab5fd6bf3f6e' },
      'onnx/vision_model_fp16.onnx': { size: 176080659, sha256: '35c4e0fb0aeee527dcde1693520b214a34424a786babd530f35366bad5844efd' },
    }),
  }),
  'Xenova/clip-vit-base-patch16': Object.freeze({
    revision: '342fdf2f67aded64d138ff074745fb4a5d2bba5f',
    files: Object.freeze({
      'config.json': { size: 4523, sha256: '854ce4599422a24841d34a129de5b28c092f7175db3db4a23ad965c8fda87cf0' },
      'tokenizer.json': { size: 2224081, sha256: '72ed5c96db5729294468543e4bc75fce14ca63f58e37300290189ba1c1e52b85' },
      'tokenizer_config.json': { size: 775, sha256: '60ba2912bc6344c94bc16bbdec27fa1209409167b6f2fdf3cfe9e65462ea3967' },
      'preprocessor_config.json': { size: 520, sha256: '6f638fb9401a6d6296feff533ee7efe657b787c49f954f82f5906b36ef2a1b1f' },
      'special_tokens_map.json': { size: 472, sha256: 'c4864a9376a8401918425bed71fc14fc0e81f9b59ec45c1cf96cccb2df508eac' },
      'onnx/text_model_quantized.onnx': { size: 64504507, sha256: '9106b51e6c663a56b99182ec617c2b3d53577b037e7e24a7717eb78048a0c97a' },
      'onnx/vision_model_quantized.onnx': { size: 87461602, sha256: '44eece4fe5fe4e0359a88268a327adf758633a1aade3917690b952bef1501f96' },
      'onnx/text_model_fp16.onnx': { size: 127339794, sha256: '9e423931894ecbfc018894006883082edf010fce63f9cba02ffb6659582d8101' },
      'onnx/vision_model_fp16.onnx': { size: 172768684, sha256: '3e261924f7d66d04f10bb131f7f212162d9ee82199544771aa2dd318bb7e2b7b' },
    }),
  }),
});

export const validateEmbeddingModelId = (modelId) => {
  if (!Object.hasOwn(MODEL_POLICIES, modelId)) {
    throw new Error(`Rejected embedding model: ${modelId}`);
  }
  return modelId;
};

export const validateEmbeddingModelRequest = ({ modelId, revision, files } = {}) => {
  validateEmbeddingModelId(modelId);
  const policy = MODEL_POLICIES[modelId];
  if (revision !== undefined && revision !== policy.revision) {
    throw new Error(`Rejected embedding model revision: ${revision}`);
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Rejected embedding model file list');
  }

  const resolvedFiles = files.map((file) => {
    const integrity = policy.files[file];
    if (!integrity) {
      throw new Error('Rejected embedding model file list');
    }
    return Object.freeze({ file, size: integrity.size, sha256: integrity.sha256 });
  });

  return {
    modelId,
    revision: policy.revision,
    files: resolvedFiles,
  };
};

export const buildEmbeddingModelDownloadUrl = ({ modelId, revision, file }) => {
  const validated = validateEmbeddingModelRequest({ modelId, revision, files: [file] });
  const encodedModel = modelId.split('/').map(encodeURIComponent).join('/');
  const encodedFile = file.split('/').map(encodeURIComponent).join('/');
  return `${MODEL_ORIGIN}/${encodedModel}/resolve/${validated.revision}/${encodedFile}`;
};
