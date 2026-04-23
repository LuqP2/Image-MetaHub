import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearEditableMetadataClipboard,
  copyEditableMetadata,
  readEditableMetadataClipboard,
} from '../services/metadataClipboard';

describe('metadataClipboard', () => {
  beforeEach(() => {
    clearEditableMetadataClipboard();
    window.localStorage.clear();
  });

  it('copies editable metadata into memory and localStorage', () => {
    const payload = copyEditableMetadata(
      {
        prompt: 'edited prompt',
        steps: 32,
        resources: [{ id: 'lora-1', type: 'lora', name: 'detailer', weight: 0.65 }],
      },
      'source-image',
    );

    expect(payload.schemaVersion).toBe(1);
    expect(payload.sourceImageId).toBe('source-image');
    expect(readEditableMetadataClipboard()).toMatchObject({
      sourceImageId: 'source-image',
      metadata: {
        prompt: 'edited prompt',
        steps: 32,
        resources: [{ id: 'lora-1', type: 'lora', name: 'detailer', weight: 0.65 }],
      },
    });
    expect(window.localStorage.getItem('image-metahub-editable-metadata-clipboard')).toContain('edited prompt');
  });

  it('rehydrates and sanitizes clipboard metadata from localStorage when memory is empty', () => {
    window.localStorage.setItem(
      'image-metahub-editable-metadata-clipboard',
      JSON.stringify({
        schemaVersion: 1,
        copiedAt: 123,
        sourceImageId: 'stored-image',
        metadata: {
          model: '  model-c.safetensors  ',
          tags: [' keep ', '', 'keep'],
          resources: [
            { id: 'bad', type: 'lora', name: '   ' },
            { id: 'good', type: 'lora', name: 'cinematic', weight: '0.8' },
          ],
        },
      }),
    );

    expect(readEditableMetadataClipboard()).toEqual({
      schemaVersion: 1,
      copiedAt: 123,
      sourceImageId: 'stored-image',
      metadata: {
        model: 'model-c.safetensors',
        tags: ['keep', 'keep'],
        resources: [{ id: 'good', type: 'lora', name: 'cinematic', weight: 0.8 }],
      },
    });
  });
});
