import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildVisualComparisonFromImageData,
  createEdgeDifferenceImageData,
  createHeatmapImageData,
} from '../utils/visualComparison';

class TestImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
      return;
    }

    this.data = dataOrWidth;
    this.width = widthOrHeight;
    this.height = height ?? 0;
  }
}

const imageData = (width: number, height: number, pixels: Array<[number, number, number, number]>): ImageData =>
  new ImageData(new Uint8ClampedArray(pixels.flat()), width, height);

describe('visualComparison utilities', () => {
  beforeAll(() => {
    if (typeof ImageData === 'undefined') {
      (globalThis as unknown as { ImageData: typeof ImageData }).ImageData = TestImageData as unknown as typeof ImageData;
    }
  });

  it('returns zero visual delta for identical images', () => {
    const left = imageData(1, 1, [[20, 40, 60, 255]]);
    const result = buildVisualComparisonFromImageData(left, imageData(1, 1, [[20, 40, 60, 255]]), 18);

    expect(result.metrics.changedPixels).toBe(0);
    expect(result.metrics.changedPercent).toBe(0);
    expect(result.metrics.averageDelta).toBe(0);
    expect(result.metrics.strongestRegion).toBeNull();
  });

  it('respects the heatmap threshold', () => {
    const left = imageData(1, 1, [[100, 100, 100, 255]]);
    const right = imageData(1, 1, [[110, 110, 110, 255]]);

    expect(createHeatmapImageData(left, right, 20).metrics.changedPixels).toBe(0);
    expect(createHeatmapImageData(left, right, 5).metrics.changedPixels).toBe(1);
  });

  it('does not count identical pixels as changed at zero threshold', () => {
    const left = imageData(1, 1, [[80, 90, 100, 255]]);
    const right = imageData(1, 1, [[80, 90, 100, 255]]);

    const result = createHeatmapImageData(left, right, 0);

    expect(result.metrics.changedPixels).toBe(0);
    expect(result.metrics.changedPercent).toBe(0);
    expect(result.imageData.data[3]).toBe(0);
  });

  it('detects the strongest changed region', () => {
    const left = imageData(2, 2, [
      [0, 0, 0, 255], [0, 0, 0, 255],
      [0, 0, 0, 255], [0, 0, 0, 255],
    ]);
    const right = imageData(2, 2, [
      [0, 0, 0, 255], [0, 0, 0, 255],
      [0, 0, 0, 255], [255, 255, 255, 255],
    ]);
    const result = buildVisualComparisonFromImageData(left, right, 18);

    expect(result.metrics.changedPixels).toBe(1);
    expect(result.metrics.strongestRegion).toMatchObject({ x: 1, y: 1 });
  });

  it('creates visible Sobel edge differences for simple shapes', () => {
    const left = imageData(3, 3, [
      [0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255],
      [0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255],
      [0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255],
    ]);
    const right = imageData(3, 3, [
      [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255],
      [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255],
      [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255],
    ]);

    const edgeMap = createEdgeDifferenceImageData(left, right, 20);
    const visibleAlphaValues = Array.from(edgeMap.data).filter((_, index) => index % 4 === 3 && edgeMap.data[index] > 0);

    expect(visibleAlphaValues.length).toBeGreaterThan(0);
  });
});
