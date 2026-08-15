import { describe, expect, it } from 'vitest';
import { extractComfyUIExifGraphMetadata } from '../services/fileIndexer';
import { parseImageMetadata } from '../services/parsers/metadataParserFactory';

describe('ComfyUI EXIF graph priority (issue #502)', () => {
  it('recognizes workflow/prompt EXIF tags before A1111-compatible parameters', async () => {
    const graph = extractComfyUIExifGraphMetadata({
      Make: `workflow:${JSON.stringify({ nodes: [] })}`,
      Model: `prompt:${JSON.stringify({
        '1': {
          class_type: 'CLIPTextEncode',
          inputs: { text: 'canonical ComfyUI prompt' },
        },
      })}`,
      UserComment: 'wrong prompt\nSteps: 1, Sampler: wrong, Seed: 1',
    });

    expect(graph).toEqual({
      workflow: { nodes: [] },
      prompt: {
        '1': {
          class_type: 'CLIPTextEncode',
          inputs: { text: 'canonical ComfyUI prompt' },
        },
      },
    });

    const result = await parseImageMetadata({
      ...graph,
      parameters: 'wrong prompt\nSteps: 1, Sampler: wrong, Seed: 1',
    } as any);

    expect(result?.generator).toBe('ComfyUI');
  });

  it('does not treat ordinary camera make/model values as ComfyUI graphs', () => {
    expect(extractComfyUIExifGraphMetadata({
      Make: 'Canon',
      Model: 'EOS R5',
    })).toBeNull();
  });
});
