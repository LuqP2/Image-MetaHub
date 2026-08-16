import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EMBEDDING_MODEL_KEY,
  EMBEDDING_MODELS,
  QUERY_TEMPLATES,
  expandQuery,
  filesForDevice,
  getEmbeddingModel,
} from '../services/embeddings/embeddingModel';

describe('expandQuery', () => {
  it('expands a short query into every template phrasing', () => {
    const prompts = expandQuery('dog');
    expect(prompts).toHaveLength(QUERY_TEMPLATES.length);
    expect(prompts).toContain('dog');
    expect(prompts).toContain('a photo of dog');
  });

  it('keeps a caption-shaped query verbatim', () => {
    const query = 'a misty forest at dawn with a lone figure';
    expect(expandQuery(query)).toEqual([query]);
  });

  it('templates up to the word limit and not past it', () => {
    expect(expandQuery('a red sports car')).toHaveLength(QUERY_TEMPLATES.length);
    expect(expandQuery('a red sports car driving')).toEqual(['a red sports car driving']);
  });

  it('trims surrounding whitespace before templating', () => {
    expect(expandQuery('  cat  ')).toContain('a photo of cat');
  });

  it('returns nothing for an empty query', () => {
    expect(expandQuery('   ')).toEqual([]);
  });
});

describe('embedding model registry', () => {
  const models = Object.values(EMBEDDING_MODELS);

  it('keys every entry by its own key', () => {
    for (const [key, model] of Object.entries(EMBEDDING_MODELS)) {
      expect(model.key).toBe(key);
    }
  });

  it('gives each model its own index, so switching never clobbers the other', () => {
    const cacheIds = models.map((model) => model.cacheId);
    expect(new Set(cacheIds).size).toBe(models.length);
  });

  it('falls back to the default for an unknown or missing persisted key', () => {
    expect(getEmbeddingModel('a-model-we-dropped').key).toBe(DEFAULT_EMBEDDING_MODEL_KEY);
    expect(getEmbeddingModel(undefined).key).toBe(DEFAULT_EMBEDDING_MODEL_KEY);
    expect(getEmbeddingModel(null).key).toBe(DEFAULT_EMBEDDING_MODEL_KEY);
  });

  it('resolves a distinct file set per backend for every model', () => {
    for (const model of models) {
      const wasm = filesForDevice(model, 'wasm');
      const webgpu = filesForDevice(model, 'webgpu');
      expect(wasm).toContain('onnx/text_model_quantized.onnx');
      expect(wasm).toContain('onnx/vision_model_quantized.onnx');
      expect(webgpu).toContain('onnx/text_model_fp16.onnx');
      expect(webgpu).toContain('onnx/vision_model_fp16.onnx');
      // Both towers plus the shared config/tokenizer files.
      expect(wasm).toHaveLength(model.baseFiles.length + 2);
    }
  });
});
