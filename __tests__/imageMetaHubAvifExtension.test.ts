import { describe, expect, it } from 'vitest';
import {
  applyImageMetaHubAvifExtension,
  buildImageMetaHubAvifExtension,
  getAvifCarrierConflicts,
} from '../utils/imageMetaHubAvifExtension.mjs';

describe('Image MetaHub AVIF extension', () => {
  it('keeps the extracted parameter snapshot but never duplicates the workflow graph', () => {
    const extension = buildImageMetaHubAvifExtension({
      generator: 'ComfyUI',
      prompt: 'do not duplicate me',
      workflow: { nodes: [] },
      model: 'model.safetensors',
      seed: 42,
      steps: 25,
      cfg_scale: 6.5,
      sampler: 'euler',
      scheduler: 'karras',
      negativePrompt: 'blurry, low quality',
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
      extracted_parameters: {
        model: 'model.safetensors',
        seed: 42,
        steps: 25,
        cfg: 6.5,
        sampler_name: 'euler',
        scheduler: 'karras',
        negativePrompt: 'blurry, low quality',
      },
    });
    // The full prompt/workflow graph is never copied into the extension.
    expect(extension).not.toHaveProperty('prompt');
    expect(extension).not.toHaveProperty('workflow');
  });

  it('restores the extracted snapshot as authoritative over graph re-derivation', () => {
    const normalized = applyImageMetaHubAvifExtension(
      // What the standard parser managed to re-derive from an obscure custom
      // node: blank/zeroed sampling fields it could not resolve.
      { prompt: 'canonical prompt', model: '', seed: 0, steps: 0, sampler: '', scheduler: '', negativePrompt: '' },
      {
        version: 1,
        extracted_parameters: {
          model: 'custom.safetensors',
          seed: 987654321,
          steps: 30,
          cfg: 7.5,
          sampler_name: 'dpmpp_2m_sde',
          scheduler: 'karras',
          negativePrompt: 'watermark',
        },
      },
    );

    expect(normalized).toMatchObject({
      prompt: 'canonical prompt',
      model: 'custom.safetensors',
      seed: 987654321,
      steps: 30,
      cfg_scale: 7.5,
      sampler: 'dpmpp_2m_sde',
      scheduler: 'karras',
      negativePrompt: 'watermark',
    });
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
