import { describe, expect, it } from 'vitest';
import {
  buildEmbeddedMetaHubPayload,
  EMBEDDED_METADATA_SCHEMA,
  formatEmbeddedMetaHubParameters,
  parseEmbeddedMetaHubMetadata,
} from '../utils/embeddedMetadataPayload';

describe('embeddedMetadataPayload', () => {
  it('builds and parses Image MetaHub embedded metadata', () => {
    const payload = buildEmbeddedMetaHubPayload({
      prompt: 'a quiet library',
      negativePrompt: 'noise',
      seed: 123,
      steps: 28,
      cfg_scale: 6.5,
      sampler: 'euler',
      scheduler: 'normal',
      model: 'dream-model',
      width: 1024,
      height: 768,
      loras: ['detail-slider'],
      notes: 'edited in metahub',
    });

    expect(payload.schema).toBe(EMBEDDED_METADATA_SCHEMA);

    const parsed = parseEmbeddedMetaHubMetadata({ imagemetahub_data: payload });
    expect(parsed).toMatchObject({
      prompt: 'a quiet library',
      negativePrompt: 'noise',
      seed: 123,
      steps: 28,
      cfg_scale: 6.5,
      sampler: 'euler',
      scheduler: 'normal',
      model: 'dream-model',
      width: 1024,
      height: 768,
      generator: 'Image MetaHub',
    });
    expect(parsed?.loras).toEqual(['detail-slider']);
  });

  it('formats a parseable A1111-style parameters string', () => {
    const formatted = formatEmbeddedMetaHubParameters({
      prompt: 'a portrait',
      negativePrompt: 'blur',
      steps: 20,
      sampler: 'DPM++ 2M',
      cfg_scale: 7,
      seed: 42,
      width: 512,
      height: 768,
      model: 'sdxl',
    });

    expect(formatted).toContain('a portrait');
    expect(formatted).toContain('Negative prompt: blur');
    expect(formatted).toContain('Steps: 20');
    expect(formatted).toContain('CFG scale: 7');
    expect(formatted).toContain('Size: 512x768');
  });
});
