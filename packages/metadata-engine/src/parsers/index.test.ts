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
});
