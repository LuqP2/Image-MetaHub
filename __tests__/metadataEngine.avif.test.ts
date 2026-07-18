import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseImageFile } from '../services/metadataEngine';

describe('metadata engine AVIF integration', () => {
  it('normalizes a real AVIF carrying ComfyUI XMP', async () => {
    const fixturePath = path.resolve('__tests__/fixtures/avif/comfy-xmp.avif');

    const result = await parseImageFile(fixturePath);

    expect(result.rawSource).toBe('avif');
    expect(result.dimensions).toEqual({ width: 2, height: 2 });
    expect(result.rawMetadata).toMatchObject({ _carrierFormat: 'avif' });
    expect(result.metadata).toMatchObject({
      generator: 'ComfyUI',
      prompt: 'AVIF fixture prompt',
      negativePrompt: 'fixture negative',
      model: 'fixture-model.safetensors',
      seed: 42,
      steps: 20,
      cfg_scale: 7,
      sampler: 'euler',
      scheduler: 'normal',
      width: 2,
      height: 2,
    });
    expect(result.errors).toBeUndefined();
  });
});
