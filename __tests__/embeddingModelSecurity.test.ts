import { describe, expect, it, vi } from 'vitest';
import {
  buildEmbeddingModelDownloadUrl,
  validateEmbeddingModelRequest,
} from '../electron/embeddingModelPolicy.mjs';
import {
  expectedSha256FromHeaders,
  verifyDownloadedModelFile,
} from '../electron/embeddingModelIntegrity.mjs';

describe('embedding model download policy', () => {
  const allowedFiles = ['config.json', 'onnx/vision_model_quantized.onnx'];

  it('builds downloads only from the fixed HTTPS Hugging Face origin', () => {
    expect(buildEmbeddingModelDownloadUrl({
      modelId: 'Xenova/clip-vit-base-patch32',
      revision: 'main',
      file: allowedFiles[1],
    })).toBe('https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx');
  });

  it('rejects unknown models, revisions, and files supplied by the renderer', () => {
    expect(() => validateEmbeddingModelRequest({ modelId: 'other/model', files: allowedFiles })).toThrow(/model/);
    expect(() => validateEmbeddingModelRequest({
      modelId: 'Xenova/clip-vit-base-patch32',
      revision: '../unsafe',
      files: allowedFiles,
    })).toThrow(/revision/);
    expect(() => validateEmbeddingModelRequest({
      modelId: 'Xenova/clip-vit-base-patch32',
      files: ['../../payload.exe'],
    })).toThrow(/file list/);
  });
});

describe('embedding model integrity', () => {
  it('parses a quoted SHA-256 LFS ETag', () => {
    const expected = 'a'.repeat(64);
    const headers = new Headers({ 'x-linked-etag': `"${expected}"` });
    expect(expectedSha256FromHeaders(headers)).toBe(expected);
  });

  it('accepts a matching verified download', async () => {
    const expected = 'b'.repeat(64);
    const removeFile = vi.fn();
    await expect(verifyDownloadedModelFile('model.part', expected, {
      sha256File: async () => expected,
      removeFile,
    })).resolves.toEqual({ verified: true, sha256: expected });
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('deletes and rejects a corrupted or adulterated download', async () => {
    const expected = 'c'.repeat(64);
    const actual = 'd'.repeat(64);
    const removeFile = vi.fn().mockResolvedValue(undefined);
    await expect(verifyDownloadedModelFile('model.part', expected, {
      sha256File: async () => actual,
      removeFile,
    })).rejects.toThrow(/Checksum mismatch/);
    expect(removeFile).toHaveBeenCalledWith('model.part');
  });
});
