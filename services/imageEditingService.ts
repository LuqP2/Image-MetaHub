import type { ImageAdjustments } from '../types';

export const DEFAULT_IMAGE_ADJUSTMENTS: ImageAdjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
};

const ADJUSTMENT_RANGES: Record<keyof ImageAdjustments, { min: number; max: number }> = {
  brightness: { min: 0, max: 200 },
  contrast: { min: 0, max: 200 },
  saturation: { min: 0, max: 200 },
  hue: { min: -180, max: 180 },
};

export const clampImageAdjustment = (
  key: keyof ImageAdjustments,
  value: number,
): number => {
  const range = ADJUSTMENT_RANGES[key];
  if (!Number.isFinite(value)) {
    return DEFAULT_IMAGE_ADJUSTMENTS[key];
  }

  return Math.min(range.max, Math.max(range.min, Math.round(value)));
};

export const normalizeImageAdjustments = (
  adjustments: Partial<ImageAdjustments>,
): ImageAdjustments => ({
  brightness: clampImageAdjustment('brightness', adjustments.brightness ?? DEFAULT_IMAGE_ADJUSTMENTS.brightness),
  contrast: clampImageAdjustment('contrast', adjustments.contrast ?? DEFAULT_IMAGE_ADJUSTMENTS.contrast),
  saturation: clampImageAdjustment('saturation', adjustments.saturation ?? DEFAULT_IMAGE_ADJUSTMENTS.saturation),
  hue: clampImageAdjustment('hue', adjustments.hue ?? DEFAULT_IMAGE_ADJUSTMENTS.hue),
});

export const hasImageAdjustments = (adjustments: Partial<ImageAdjustments>): boolean => {
  const normalized = normalizeImageAdjustments(adjustments);
  return (
    normalized.brightness !== DEFAULT_IMAGE_ADJUSTMENTS.brightness ||
    normalized.contrast !== DEFAULT_IMAGE_ADJUSTMENTS.contrast ||
    normalized.saturation !== DEFAULT_IMAGE_ADJUSTMENTS.saturation ||
    normalized.hue !== DEFAULT_IMAGE_ADJUSTMENTS.hue
  );
};

export const buildImageAdjustmentFilter = (adjustments: Partial<ImageAdjustments>): string => {
  const normalized = normalizeImageAdjustments(adjustments);
  return [
    `brightness(${normalized.brightness}%)`,
    `contrast(${normalized.contrast}%)`,
    `saturate(${normalized.saturation}%)`,
    `hue-rotate(${normalized.hue}deg)`,
  ].join(' ');
};

const loadImageElement = (sourceUrl: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Failed to load image for editing.'));
  image.decoding = 'async';
  image.src = sourceUrl;
});

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) {
      resolve(blob);
    } else {
      reject(new Error('Failed to encode edited image as PNG.'));
    }
  }, 'image/png');
});

export async function renderAdjustedImageToPngBlob(
  sourceUrl: string,
  adjustments: Partial<ImageAdjustments>,
): Promise<Blob> {
  const image = await loadImageElement(sourceUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  if (!width || !height) {
    throw new Error('Edited image has invalid dimensions.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas rendering is not available in this browser.');
  }

  context.filter = buildImageAdjustmentFilter(adjustments);
  context.drawImage(image, 0, 0, width, height);
  return canvasToBlob(canvas);
}

export async function renderAdjustedImageToPngBytes(
  sourceUrl: string,
  adjustments: Partial<ImageAdjustments>,
): Promise<Uint8Array> {
  const blob = await renderAdjustedImageToPngBlob(sourceUrl, adjustments);
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }

  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read edited PNG bytes.'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read edited PNG bytes.'));
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
}
