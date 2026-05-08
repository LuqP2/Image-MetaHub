import type { BaseMetadata, ImageAdjustments, LoRAInfo } from '../types';

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

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const createCrc32Table = () => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
};

const CRC32_TABLE = createCrc32Table();
const textEncoder = new TextEncoder();

const computeCrc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const concatBytes = (parts: Uint8Array[]): Uint8Array => {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

const writeUInt32BE = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value >>> 0, false);
  return bytes;
};

const createPngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = textEncoder.encode(type);
  const crcBytes = concatBytes([typeBytes, data]);
  return concatBytes([
    writeUInt32BE(data.byteLength),
    typeBytes,
    data,
    writeUInt32BE(computeCrc32(crcBytes)),
  ]);
};

const createPngTextChunk = (keyword: string, text: string): Uint8Array => (
  createPngChunk('tEXt', concatBytes([
    textEncoder.encode(keyword),
    new Uint8Array([0]),
    textEncoder.encode(text),
  ]))
);

const createPngInternationalTextChunk = (keyword: string, text: string): Uint8Array => (
  createPngChunk('iTXt', concatBytes([
    textEncoder.encode(keyword),
    new Uint8Array([0, 0, 0, 0, 0]),
    textEncoder.encode(text),
  ]))
);

const ensurePngBytes = (pngBytes: Uint8Array): void => {
  if (pngBytes.byteLength < PNG_SIGNATURE.byteLength + 12) {
    throw new Error('Invalid PNG buffer.');
  }

  for (let index = 0; index < PNG_SIGNATURE.byteLength; index += 1) {
    if (pngBytes[index] !== PNG_SIGNATURE[index]) {
      throw new Error('PNG signature missing.');
    }
  }
};

export const appendChunksToPngBytes = (pngBytes: Uint8Array, chunks: Uint8Array[]): Uint8Array => {
  ensurePngBytes(pngBytes);

  let offset = PNG_SIGNATURE.byteLength;
  while (offset + 12 <= pngBytes.byteLength) {
    const view = new DataView(pngBytes.buffer, pngBytes.byteOffset + offset, 8);
    const chunkLength = view.getUint32(0, false);
    const chunkType = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7],
    );
    const chunkTotalLength = chunkLength + 12;
    if (offset + chunkTotalLength > pngBytes.byteLength) {
      break;
    }

    if (chunkType === 'IEND') {
      return concatBytes([
        pngBytes.slice(0, offset),
        ...chunks,
        pngBytes.slice(offset),
      ]);
    }

    offset += chunkTotalLength;
  }

  throw new Error('PNG IEND chunk not found.');
};

const toLoraPayload = (loras: BaseMetadata['loras']) => {
  if (!Array.isArray(loras)) {
    return [];
  }

  return loras
    .map((entry) => {
      if (typeof entry === 'string') {
        const name = entry.trim();
        return name ? { name } : null;
      }

      const lora = entry as LoRAInfo;
      const name = typeof lora.name === 'string' && lora.name.trim()
        ? lora.name.trim()
        : (typeof lora.model_name === 'string' ? lora.model_name.trim() : '');
      if (!name) {
        return null;
      }

      const weight = Number.isFinite(lora.weight)
        ? lora.weight
        : Number.isFinite(lora.model_weight)
          ? lora.model_weight
          : undefined;

      return weight !== undefined ? { name, weight } : { name };
    })
    .filter(Boolean);
};

const formatMetadataForA1111Compat = (metadata: BaseMetadata): string => {
  const lines = [metadata.prompt?.trim() || ''];
  if (metadata.negativePrompt?.trim()) {
    lines.push(`Negative prompt: ${metadata.negativePrompt.trim()}`);
  }

  const params: string[] = [];
  if (Number.isFinite(metadata.steps)) {
    params.push(`Steps: ${metadata.steps}`);
  }
  const sampler = metadata.sampler || metadata.scheduler;
  if (sampler?.trim()) {
    params.push(`Sampler: ${sampler.trim()}`);
  }
  const cfg = metadata.cfg_scale ?? metadata.cfgScale;
  if (Number.isFinite(cfg)) {
    params.push(`CFG scale: ${cfg}`);
  }
  if (Number.isFinite(metadata.seed)) {
    params.push(`Seed: ${metadata.seed}`);
  }
  if (Number.isFinite(metadata.width) && Number.isFinite(metadata.height) && metadata.width > 0 && metadata.height > 0) {
    params.push(`Size: ${metadata.width}x${metadata.height}`);
  }
  if (metadata.model?.trim()) {
    params.push(`Model: ${metadata.model.trim()}`);
  }
  if (params.length > 0) {
    lines.push(params.join(', '));
  }

  return lines.join('\n');
};

const buildMetaHubEditPayload = (
  metadata: BaseMetadata,
  adjustments: ImageAdjustments,
) => ({
  generator: 'Image MetaHub',
  source_generator: typeof metadata.generator === 'string' ? metadata.generator : null,
  edited_at: new Date().toISOString(),
  edit: {
    tool: 'image-adjustments',
    adjustments,
  },
  prompt: metadata.prompt || '',
  negativePrompt: metadata.negativePrompt || '',
  seed: Number.isFinite(metadata.seed) ? metadata.seed : undefined,
  steps: Number.isFinite(metadata.steps) ? metadata.steps : undefined,
  cfg: Number.isFinite(metadata.cfg_scale ?? metadata.cfgScale) ? (metadata.cfg_scale ?? metadata.cfgScale) : undefined,
  sampler_name: metadata.sampler || '',
  scheduler: metadata.scheduler || '',
  model: metadata.model || metadata.models?.[0] || '',
  width: Number.isFinite(metadata.width) ? metadata.width : 0,
  height: Number.isFinite(metadata.height) ? metadata.height : 0,
  loras: toLoraPayload(metadata.loras),
  imh_pro: {
    notes: typeof metadata.notes === 'string' ? metadata.notes : '',
    user_tags: Array.isArray(metadata.tags) ? metadata.tags.join(', ') : '',
  },
});

export const embedMetaHubMetadataInPngBytes = (
  pngBytes: Uint8Array,
  metadata: BaseMetadata | undefined,
  adjustments: Partial<ImageAdjustments>,
): Uint8Array => {
  if (!metadata) {
    return pngBytes;
  }

  const normalizedAdjustments = normalizeImageAdjustments(adjustments);
  return appendChunksToPngBytes(pngBytes, [
    createPngTextChunk('parameters', formatMetadataForA1111Compat(metadata)),
    createPngInternationalTextChunk('imagemetahub_data', JSON.stringify(buildMetaHubEditPayload(metadata, normalizedAdjustments))),
  ]);
};
