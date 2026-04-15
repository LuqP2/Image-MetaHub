import { describe, expect, it } from 'vitest';
import {
  getClipboardErrorMessage,
  getImageAnalytics,
  getNormalizedMetadata,
  hasPromptMetadata,
  mergeNormalizedMetadata,
} from '../utils/imageMetadata';
import { type BaseMetadata, type IndexedImage } from '../types';

const createImage = (normalizedMetadata?: Partial<BaseMetadata> & { _analytics?: BaseMetadata['analytics'] }): IndexedImage =>
  ({
    id: 'id',
    name: 'name',
    handle: {} as FileSystemFileHandle,
    metadata: normalizedMetadata
      ? ({ normalizedMetadata: normalizedMetadata as BaseMetadata } as unknown as IndexedImage['metadata'])
      : ({} as unknown as IndexedImage['metadata']),
    metadataString: '',
    lastModified: 1,
    models: [],
    loras: [],
    scheduler: '',
  }) as IndexedImage;

describe('imageMetadata helpers', () => {
  it('detects prompt metadata and merges custom fields', () => {
    const image = createImage({
      prompt: 'base prompt',
      model: 'base.safetensors',
      width: 512,
      height: 512,
      steps: 20,
      scheduler: 'normal',
    });

    const normalized = getNormalizedMetadata(image);
    expect(hasPromptMetadata(normalized)).toBe(true);

    const merged = mergeNormalizedMetadata(image, { prompt: 'updated prompt', steps: 30 });
    expect(merged?.prompt).toBe('updated prompt');
    expect(merged?.steps).toBe(30);
    expect(merged?.model).toBe('base.safetensors');
  });

  it('reads legacy analytics and formats clipboard errors consistently', () => {
    const image = createImage({
      prompt: 'base prompt',
      model: 'base.safetensors',
      width: 512,
      height: 512,
      steps: 20,
      scheduler: 'normal',
      _analytics: {
        gpu_device: 'RTX 3060',
        vram_peak_mb: 8128,
        comfyui_version: '0.1.0',
      },
    });

    expect(getImageAnalytics(image)?.gpu_device).toBe('RTX 3060');
    expect(getClipboardErrorMessage(new Error('clipboard permission denied'))).toBe('Clipboard access denied. Please use HTTPS or localhost.');
    expect(getClipboardErrorMessage(new Error('something else'))).toBe('Error: something else');
  });
});
