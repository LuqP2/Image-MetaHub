import { describe, expect, it } from 'vitest';
import {
  applyImageMetaHubAvifExtension,
  buildImageMetaHubAvifExtension,
  getAvifCarrierConflicts,
} from '../utils/imageMetaHubAvifExtension.mjs';

describe('Image MetaHub AVIF extension', () => {
  it('writes only app-specific fields instead of duplicating workflow metadata', () => {
    const extension = buildImageMetaHubAvifExtension({
      generator: 'ComfyUI',
      prompt: 'do not duplicate me',
      workflow: { nodes: [] },
      seed: 42,
      tags: ['Favorite', ' Favorite ', ''],
      notes: 'Keep this',
      _analytics: { gpu_device: 'Example GPU' },
    });

    expect(extension).toEqual({
      version: 1,
      source_generator: 'ComfyUI',
      tags: ['Favorite'],
      notes: 'Keep this',
      analytics: { gpu_device: 'Example GPU' },
    });
    expect(extension).not.toHaveProperty('prompt');
    expect(extension).not.toHaveProperty('workflow');
    expect(extension).not.toHaveProperty('seed');
  });

  it('overlays app-specific fields after standard metadata has been parsed', () => {
    const normalized = applyImageMetaHubAvifExtension(
      { prompt: 'canonical prompt', model: 'model.safetensors' },
      {
        version: 1,
        source_generator: 'ComfyUI',
        tags: ['one', ' one ', 'two'],
        notes: 'A note',
        attribution: { token: 'attribution-token' },
        analytics: { generation_time_ms: 1000 },
      },
    );

    expect(normalized).toMatchObject({
      prompt: 'canonical prompt',
      model: 'model.safetensors',
      generator: 'ComfyUI',
      tags: ['one', 'two'],
      notes: 'A note',
      imh_attribution: { token: 'attribution-token' },
      analytics: { generation_time_ms: 1000 },
      _analytics: { generation_time_ms: 1000 },
    });
  });

  it('exposes only well-formed carrier conflicts', () => {
    expect(getAvifCarrierConflicts({
      _carrierConflicts: [
        { field: 'prompt', canonicalSource: 'xmp.prompt', conflictingSource: 'legacy.prompt' },
        { field: 'model', canonicalSource: 'one', conflictingSource: 'two' },
      ],
    })).toEqual([
      { field: 'prompt', canonicalSource: 'xmp.prompt', conflictingSource: 'legacy.prompt' },
    ]);
  });
});
