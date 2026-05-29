export interface VisualDifferenceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

export interface VisualComparisonMetrics {
  width: number;
  height: number;
  changedPixels: number;
  totalPixels: number;
  changedPercent: number;
  averageDelta: number;
  strongestRegion: VisualDifferenceRegion | null;
}

export interface VisualComparisonResult {
  width: number;
  height: number;
  left: ImageData;
  right: ImageData;
  heatmap: ImageData;
  edgeMap: ImageData;
  metrics: VisualComparisonMetrics;
}

export const DEFAULT_VISUAL_COMPARE_MAX_EDGE = 1280;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const luminance = (data: Uint8ClampedArray, index: number): number =>
  data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;

export const calculatePixelDelta = (
  left: Uint8ClampedArray,
  right: Uint8ClampedArray,
  index: number,
): number => {
  const red = Math.abs(left[index] - right[index]);
  const green = Math.abs(left[index + 1] - right[index + 1]);
  const blue = Math.abs(left[index + 2] - right[index + 2]);
  const alpha = Math.abs(left[index + 3] - right[index + 3]);
  const luma = Math.abs(luminance(left, index) - luminance(right, index));
  const colorDelta = (red + green + blue) / 3 * 0.65 + luma * 0.35;
  return clamp(colorDelta * 0.8 + alpha * 0.2, 0, 255);
};

export const createHeatmapImageData = (
  left: ImageData,
  right: ImageData,
  threshold: number,
): { imageData: ImageData; metrics: VisualComparisonMetrics } => {
  const { width, height } = left;
  const heatmap = new ImageData(width, height);
  const heat = heatmap.data;
  const leftData = left.data;
  const rightData = right.data;
  const safeThreshold = clamp(threshold, 0, 255);
  const bucketCount = 8;
  const bucketWidth = Math.max(1, Math.ceil(width / bucketCount));
  const bucketHeight = Math.max(1, Math.ceil(height / bucketCount));
  const buckets = Array.from({ length: bucketCount * bucketCount }, () => ({ score: 0, count: 0 }));
  let changedPixels = 0;
  let totalDelta = 0;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    const delta = calculatePixelDelta(leftData, rightData, index);
    totalDelta += delta;

    if (delta > 0 && delta >= safeThreshold) {
      changedPixels += 1;
      const intensity = clamp((delta - safeThreshold) / Math.max(1, 255 - safeThreshold), 0, 1);
      heat[index] = 255;
      heat[index + 1] = Math.round(210 * (1 - intensity) + 40 * intensity);
      heat[index + 2] = Math.round(40 * (1 - intensity) + 120 * intensity);
      heat[index + 3] = Math.round(105 + intensity * 150);

      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const bucketX = Math.min(bucketCount - 1, Math.floor(x / bucketWidth));
      const bucketY = Math.min(bucketCount - 1, Math.floor(y / bucketHeight));
      const bucket = buckets[bucketY * bucketCount + bucketX];
      bucket.score += delta;
      bucket.count += 1;
    } else {
      heat[index] = 0;
      heat[index + 1] = 0;
      heat[index + 2] = 0;
      heat[index + 3] = 0;
    }
  }

  let strongestRegion: VisualDifferenceRegion | null = null;
  buckets.forEach((bucket, bucketIndex) => {
    if (!bucket.count) return;
    const score = bucket.score / bucket.count;
    if (strongestRegion && score <= strongestRegion.score) return;
    const bucketX = bucketIndex % bucketCount;
    const bucketY = Math.floor(bucketIndex / bucketCount);
    strongestRegion = {
      x: bucketX * bucketWidth,
      y: bucketY * bucketHeight,
      width: Math.min(bucketWidth, width - bucketX * bucketWidth),
      height: Math.min(bucketHeight, height - bucketY * bucketHeight),
      score,
    };
  });

  return {
    imageData: heatmap,
    metrics: {
      width,
      height,
      changedPixels,
      totalPixels: width * height,
      changedPercent: width * height > 0 ? (changedPixels / (width * height)) * 100 : 0,
      averageDelta: width * height > 0 ? totalDelta / (width * height) : 0,
      strongestRegion,
    },
  };
};

const sobelAt = (data: Uint8ClampedArray, width: number, height: number, x: number, y: number): number => {
  const sample = (offsetX: number, offsetY: number) => {
    const sx = clamp(x + offsetX, 0, width - 1);
    const sy = clamp(y + offsetY, 0, height - 1);
    return luminance(data, (sy * width + sx) * 4);
  };

  const gx =
    -sample(-1, -1) + sample(1, -1) -
    2 * sample(-1, 0) + 2 * sample(1, 0) -
    sample(-1, 1) + sample(1, 1);
  const gy =
    -sample(-1, -1) - 2 * sample(0, -1) - sample(1, -1) +
    sample(-1, 1) + 2 * sample(0, 1) + sample(1, 1);

  return clamp(Math.sqrt(gx * gx + gy * gy), 0, 255);
};

export const createEdgeDifferenceImageData = (left: ImageData, right: ImageData, threshold = 40): ImageData => {
  const { width, height } = left;
  const output = new ImageData(width, height);
  const outputData = output.data;
  const safeThreshold = clamp(threshold, 0, 255);
  const minimumVisibleEdge = 0.5;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const leftEdge = sobelAt(left.data, width, height, x, y);
      const rightEdge = sobelAt(right.data, width, height, x, y);
      const leftVisible = leftEdge > minimumVisibleEdge && leftEdge >= safeThreshold;
      const rightVisible = rightEdge > minimumVisibleEdge && rightEdge >= safeThreshold;

      outputData[index] = rightVisible ? 255 : 0;
      outputData[index + 1] = leftVisible ? 220 : 0;
      outputData[index + 2] = leftVisible ? 255 : rightVisible ? 220 : 0;
      outputData[index + 3] = leftVisible || rightVisible ? 235 : 0;
    }
  }

  return output;
};

export const buildVisualComparisonFromImageData = (
  left: ImageData,
  right: ImageData,
  threshold = 18,
  edgeThreshold = threshold,
): VisualComparisonResult => {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error('ImageData dimensions must match for visual comparison');
  }

  const heatmap = createHeatmapImageData(left, right, threshold);
  return {
    width: left.width,
    height: left.height,
    left,
    right,
    heatmap: heatmap.imageData,
    edgeMap: createEdgeDifferenceImageData(left, right, edgeThreshold),
    metrics: heatmap.metrics,
  };
};

const loadImageElement = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to decode image for visual comparison'));
    image.src = url;
  });

const drawContainedImage = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) => {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = (width - drawWidth) / 2;
  const drawY = (height - drawHeight) / 2;
  context.clearRect(0, 0, width, height);
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
};

export const buildVisualComparisonFromUrls = async (
  leftUrl: string,
  rightUrl: string,
  threshold = 18,
  maxEdge = DEFAULT_VISUAL_COMPARE_MAX_EDGE,
): Promise<VisualComparisonResult> => {
  const [leftImage, rightImage] = await Promise.all([loadImageElement(leftUrl), loadImageElement(rightUrl)]);
  const sourceWidth = Math.max(leftImage.naturalWidth, rightImage.naturalWidth);
  const sourceHeight = Math.max(leftImage.naturalHeight, rightImage.naturalHeight);
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Canvas is not available for visual comparison');
  }

  drawContainedImage(context, leftImage, width, height);
  const left = context.getImageData(0, 0, width, height);
  drawContainedImage(context, rightImage, width, height);
  const right = context.getImageData(0, 0, width, height);
  return buildVisualComparisonFromImageData(left, right, threshold, threshold);
};

export const imageDataToDataUrl = (imageData: ImageData): string => {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};
