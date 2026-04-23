import { describe, expect, it, vi } from 'vitest';
import {
  buildEffectiveMetadata,
  buildMetadataClipboardPayload,
  buildShadowMetadata,
  getEditableMetadataFields,
  sanitizeEditableMetadataFields,
} from '../utils/editableMetadata';
import type { BaseMetadata, ShadowMetadata } from '../types';

describe('editableMetadata helpers', () => {
  it('merges normalized metadata with shadow overrides into effective metadata', () => {
    const normalizedMetadata: BaseMetadata = {
      prompt: 'sunset over mountains',
      negativePrompt: 'lowres',
      model: 'base-model.safetensors',
      width: 1024,
      height: 768,
      seed: 1234,
      steps: 28,
      cfg_scale: 6.5,
      sampler: 'Euler',
      scheduler: 'normal',
      loras: [{ name: 'cinematic-light', weight: 0.7 }],
    };

    const shadowMetadata: ShadowMetadata = {
      imageId: 'img-1',
      updatedAt: 10,
      prompt: 'edited prompt',
      model: 'edited-model.safetensors',
      resources: [
        { id: 'model', type: 'model', name: 'edited-model.safetensors' },
        { id: 'lora-1', type: 'lora', name: 'detailer', weight: 0.9 },
      ],
      cfg_scale: 8,
      tags: ['favorite', 'export'],
      notes: 'Keep this one',
    };

    const result = buildEffectiveMetadata(normalizedMetadata, shadowMetadata);

    expect(result).toMatchObject({
      prompt: 'edited prompt',
      negativePrompt: 'lowres',
      model: 'edited-model.safetensors',
      models: ['edited-model.safetensors'],
      width: 1024,
      height: 768,
      seed: 1234,
      steps: 28,
      cfg_scale: 8,
      sampler: 'Euler',
      scheduler: 'normal',
      tags: ['favorite', 'export'],
      notes: 'Keep this one',
    });
    expect(result?.loras).toEqual([{ name: 'detailer', weight: 0.9 }]);
  });

  it('returns the original metadata when showOriginal is enabled', () => {
    const normalizedMetadata: BaseMetadata = {
      prompt: 'original prompt',
      model: 'original-model.safetensors',
      width: 512,
      height: 512,
      steps: 20,
      scheduler: 'normal',
    };

    const shadowMetadata: ShadowMetadata = {
      imageId: 'img-2',
      updatedAt: 20,
      prompt: 'edited prompt',
    };

    expect(buildEffectiveMetadata(normalizedMetadata, shadowMetadata, true)).toBe(normalizedMetadata);
  });

  it('exposes editable fields using shadow metadata first and falls back to normalized values', () => {
    const normalizedMetadata: BaseMetadata = {
      prompt: 'forest trail',
      negativePrompt: 'blurry',
      model: 'model-a.safetensors',
      width: 640,
      height: 832,
      seed: 99,
      steps: 24,
      cfg_scale: 5.5,
      sampler: 'DPM++ 2M',
      scheduler: 'karras',
      loras: [{ name: 'style-a', weight: 0.6 }],
    };

    const shadowMetadata: ShadowMetadata = {
      imageId: 'img-3',
      updatedAt: 30,
      negativePrompt: 'jpeg artifacts',
      resources: [{ id: 'lora-2', type: 'lora', name: 'style-b', weight: 0.8 }],
    };

    expect(getEditableMetadataFields(normalizedMetadata, shadowMetadata)).toMatchObject({
      prompt: 'forest trail',
      negativePrompt: 'jpeg artifacts',
      model: 'model-a.safetensors',
      width: 640,
      height: 832,
      seed: 99,
      steps: 24,
      cfg_scale: 5.5,
      sampler: 'DPM++ 2M',
      scheduler: 'karras',
      resources: [{ id: 'lora-2', type: 'lora', name: 'style-b', weight: 0.8 }],
    });
  });

  it('sanitizes editable fields when building shadow metadata and clipboard payloads', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

    const fields = sanitizeEditableMetadataFields({
      model: '  model-b.safetensors  ',
      steps: '30' as unknown as number,
      cfg_scale: '7.5' as unknown as number,
      tags: [' portrait ', '', 'portrait', 'studio'],
      resources: [
        { id: 'bad', type: 'lora', name: '   ', weight: 0.5 },
        { id: 'good', type: 'lora', name: 'lighting', weight: '0.75' as unknown as number },
      ],
    });

    expect(fields).toEqual({
      model: 'model-b.safetensors',
      steps: 30,
      cfg_scale: 7.5,
      tags: ['portrait', 'portrait', 'studio'],
      resources: [{ id: 'good', type: 'lora', name: 'lighting', weight: 0.75 }],
    });

    const shadowMetadata = buildShadowMetadata('img-4', fields);
    const clipboardPayload = buildMetadataClipboardPayload('img-4', fields);

    expect(shadowMetadata).toMatchObject({
      imageId: 'img-4',
      updatedAt: Date.now(),
      ...fields,
    });
    expect(clipboardPayload).toMatchObject({
      schemaVersion: 1,
      copiedAt: Date.now(),
      sourceImageId: 'img-4',
      metadata: fields,
    });

    vi.useRealTimers();
  });
});
