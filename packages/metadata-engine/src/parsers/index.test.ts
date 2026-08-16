import { describe, expect, it } from 'vitest';
import { getMetadataParser } from './index';

describe('metadata-engine ComfyUI detection (issue #502)', () => {
  it('prefers a valid ComfyUI graph over A1111-compatible parameters', () => {
    const parser = getMetadataParser({
      workflow: { nodes: [] },
      prompt: {
        '1': {
          class_type: 'CLIPTextEncode',
          inputs: { text: 'canonical ComfyUI prompt' },
        },
      },
      parameters: 'wrong prompt\nSteps: 1, Sampler: wrong, Seed: 1',
    });

    expect(parser?.generator).toBe('ComfyUI');
  });

  it('falls back to A1111 parameters when the ComfyUI graph is empty', () => {
    const metadata = {
      workflow: {},
      parameters: 'fallback prompt\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 42, Size: 512x768, Model: fallback.safetensors',
    } as any;
    const parser = getMetadataParser(metadata);

    expect(parser?.generator).toBe('Automatic1111');
    expect(parser?.parse(metadata)).toMatchObject({
      prompt: 'fallback prompt',
      model: 'fallback.safetensors',
      steps: 20,
    });
  });
});
