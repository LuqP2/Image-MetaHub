import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  buildImageAdjustmentFilter,
  clampImageAdjustment,
  hasImageAdjustments,
  normalizeImageAdjustments,
  renderAdjustedImageToPngBytes,
} from '../services/imageEditingService';

describe('imageEditingService', () => {
  it('treats default adjustments as neutral', () => {
    expect(hasImageAdjustments(DEFAULT_IMAGE_ADJUSTMENTS)).toBe(false);
    expect(hasImageAdjustments({ brightness: 101 })).toBe(true);
  });

  it('clamps adjustment values to supported ranges', () => {
    expect(clampImageAdjustment('brightness', 250)).toBe(200);
    expect(clampImageAdjustment('contrast', -10)).toBe(0);
    expect(clampImageAdjustment('saturation', Number.NaN)).toBe(100);
    expect(clampImageAdjustment('hue', 300)).toBe(180);

    expect(normalizeImageAdjustments({ brightness: 101.4, hue: -220 })).toEqual({
      brightness: 101,
      contrast: 100,
      saturation: 100,
      hue: -180,
    });
  });

  it('builds a CSS/canvas filter string', () => {
    expect(buildImageAdjustmentFilter({ brightness: 120, contrast: 80, saturation: 150, hue: -30 }))
      .toBe('brightness(120%) contrast(80%) saturate(150%) hue-rotate(-30deg)');
  });

  it('renders adjusted image bytes as PNG', async () => {
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
    });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ filter: '', drawImage }),
          toBlob,
        } as unknown as HTMLCanvasElement;
      }

      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    const OriginalImage = globalThis.Image;
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = '';
      naturalWidth = 8;
      naturalHeight = 6;
      width = 8;
      height = 6;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;
    try {
      const bytes = await renderAdjustedImageToPngBytes('blob:test', { brightness: 120 });
      expect([...bytes]).toEqual([137, 80, 78, 71]);
      expect(drawImage).toHaveBeenCalled();
      expect(toBlob).toHaveBeenCalled();
    } finally {
      globalThis.Image = OriginalImage;
      vi.restoreAllMocks();
    }
  });
});
