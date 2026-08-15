import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  buildEmbeddingModelDownloadUrl,
  validateEmbeddingModelRequest,
} from '../electron/embeddingModelPolicy.mjs';
import {
  verifyDownloadedModelFile,
  waitForWritableDrain,
} from '../electron/embeddingModelIntegrity.mjs';
import { EMBEDDING_MODELS, filesForDevice } from '../services/embeddings/embeddingModel';

describe('embedding model download policy', () => {
  const allowedFiles = ['config.json', 'onnx/vision_model_quantized.onnx'];

  it('builds downloads only from the fixed HTTPS Hugging Face origin', () => {
    expect(buildEmbeddingModelDownloadUrl({
      modelId: 'Xenova/clip-vit-base-patch32',
      revision: 'd15189d7028b43f1d3e65039190477f6af591c2a',
      file: allowedFiles[1],
    })).toBe('https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/d15189d7028b43f1d3e65039190477f6af591c2a/onnx/vision_model_quantized.onnx');
  });

  it('resolves size and SHA-256 exclusively from the main-process policy', () => {
    const validated = validateEmbeddingModelRequest({
      modelId: 'Xenova/clip-vit-base-patch32',
      files: [allowedFiles[1]],
      sha256: 'renderer-controlled',
    } as any);

    expect(validated).toEqual({
      modelId: 'Xenova/clip-vit-base-patch32',
      revision: 'd15189d7028b43f1d3e65039190477f6af591c2a',
      files: [{
        file: 'onnx/vision_model_quantized.onnx',
        size: 89117001,
        sha256: '583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299',
      }],
    });
  });

  it('covers every renderer model file with the same pinned main-process revision', () => {
    for (const model of Object.values(EMBEDDING_MODELS)) {
      const requestedFiles = [...new Set([
        ...filesForDevice(model, 'wasm'),
        ...filesForDevice(model, 'webgpu'),
      ])];
      const validated = validateEmbeddingModelRequest({
        modelId: model.id,
        revision: model.revision,
        files: requestedFiles,
      });

      expect(validated.revision).toBe(model.revision);
      expect(validated.files).toHaveLength(requestedFiles.length);
      expect(validated.files.every((file) => file.size > 0 && /^[a-f0-9]{64}$/.test(file.sha256)))
        .toBe(true);
    }
  });

  it('rejects unknown models, revisions, and files supplied by the renderer', () => {
    expect(() => validateEmbeddingModelRequest({ modelId: 'other/model', files: allowedFiles })).toThrow(/model/);
    expect(() => validateEmbeddingModelRequest({
      modelId: 'Xenova/clip-vit-base-patch32',
      revision: 'main',
      files: allowedFiles,
    })).toThrow(/revision/);
    expect(() => validateEmbeddingModelRequest({
      modelId: 'Xenova/clip-vit-base-patch32',
      files: ['../../payload.exe'],
    })).toThrow(/file list/);
  });
});

describe('embedding model integrity', () => {
  it('accepts a matching verified download', async () => {
    const expected = 'b'.repeat(64);
    const removeFile = vi.fn();
    await expect(verifyDownloadedModelFile('model.part', { size: 123, sha256: expected }, {
      statFile: async () => ({ size: 123 }),
      sha256File: async () => expected,
      removeFile,
    })).resolves.toEqual({ verified: true, sha256: expected, size: 123 });
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('deletes and rejects a file when trusted integrity metadata is absent', async () => {
    const removeFile = vi.fn().mockResolvedValue(undefined);
    await expect(verifyDownloadedModelFile('model.part', null, { removeFile }))
      .rejects.toThrow(/Missing trusted/);
    expect(removeFile).toHaveBeenCalledWith('model.part');
  });

  it('deletes and rejects an incomplete cached or resumed file', async () => {
    const removeFile = vi.fn().mockResolvedValue(undefined);
    await expect(verifyDownloadedModelFile('model.part', { size: 123, sha256: 'c'.repeat(64) }, {
      statFile: async () => ({ size: 122 }),
      removeFile,
    })).rejects.toThrow(/Size mismatch/);
    expect(removeFile).toHaveBeenCalledWith('model.part');
  });

  it('deletes and rejects a corrupted or adulterated download', async () => {
    const expected = 'c'.repeat(64);
    const actual = 'd'.repeat(64);
    const removeFile = vi.fn().mockResolvedValue(undefined);
    await expect(verifyDownloadedModelFile('model.part', { size: 123, sha256: expected }, {
      statFile: async () => ({ size: 123 }),
      sha256File: async () => actual,
      removeFile,
    })).rejects.toThrow(/Checksum mismatch/);
    expect(removeFile).toHaveBeenCalledWith('model.part');
  });

  it('deletes and rejects a cached file that cannot be hashed', async () => {
    const removeFile = vi.fn().mockResolvedValue(undefined);
    await expect(verifyDownloadedModelFile('model.part', { size: 123, sha256: 'c'.repeat(64) }, {
      statFile: async () => ({ size: 123 }),
      sha256File: async () => { throw new Error('read failed'); },
      removeFile,
    })).rejects.toThrow(/Unable to hash/);
    expect(removeFile).toHaveBeenCalledWith('model.part');
  });

  it('rejects a backpressure wait when the destination errors', async () => {
    const stream = new EventEmitter();
    const waiting = waitForWritableDrain(stream);
    const error = new Error('disk full');
    stream.emit('error', error);
    await expect(waiting).rejects.toBe(error);
  });

  it('rejects a backpressure wait when the destination closes before drain', async () => {
    const stream = new EventEmitter();
    const waiting = waitForWritableDrain(stream);
    stream.emit('close');
    await expect(waiting).rejects.toThrow(/closed before draining/);
  });
});
