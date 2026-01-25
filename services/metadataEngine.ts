import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import exifr from 'exifr';
import { BaseMetadata, ImageMetadata, type VideoInfo, isEasyDiffusionJson } from '../types';
import { parseImageMetadata as normalizeMetadata } from './parsers/metadataParserFactory';

interface Dimensions {
  width: number;
  height: number;
}

export interface MetadataEngineResult {
  file: string;
  sha256: string;
  rawMetadata: ImageMetadata | null;
  metadata: BaseMetadata | null;
  dimensions?: Dimensions | null;
  rawSource?: 'png' | 'jpeg' | 'sidecar' | 'video' | 'unknown';
  errors?: string[];
  schema_version: string;
  _telemetry: {
    parser: string | null;
    raw_source: string | null;
    normalize_time_ms: number;
  };
}

export const SCHEMA_VERSION = '1.0.0';

function sanitizeJson(jsonString: string): string {
  return jsonString.replace(/:\s*NaN/g, ': null');
}

const execFileAsync = promisify(execFile);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi']);

const isVideoFilePath = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
};

const parseFrameRate = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.includes('/')) {
    return null;
  }
  const [num, den] = value.split('/').map((part) => Number(part));
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return null;
  }
  return num / den;
};

const buildVideoInfoFromProbe = (stream: any, format: any): VideoInfo => {
  const frameRate = parseFrameRate(stream?.r_frame_rate) ?? parseFrameRate(stream?.avg_frame_rate);
  const frameCount = typeof stream?.nb_frames === 'string' ? Number(stream.nb_frames) : stream?.nb_frames;
  const durationValue = typeof format?.duration === 'string' ? Number(format.duration) : format?.duration;

  return {
    frame_rate: Number.isFinite(frameRate) ? frameRate : null,
    frame_count: Number.isFinite(frameCount) ? frameCount : null,
    duration_seconds: Number.isFinite(durationValue) ? durationValue : null,
    width: typeof stream?.width === 'number' ? stream.width : null,
    height: typeof stream?.height === 'number' ? stream.height : null,
    codec: stream?.codec_name || null,
    format: format?.format_name || null,
  };
};

async function readVideoMetadataWithFfprobe(filePath: string): Promise<{ comment?: string; description?: string; title?: string; video?: VideoInfo } | null> {
  const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';

  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath,
    ], { encoding: 'utf8' });

    const output = typeof stdout === 'string' ? stdout : stdout.toString('utf8');
    const payload = JSON.parse(output);
    const format = payload?.format ?? {};
    const tags = format.tags ?? {};
    const streams = Array.isArray(payload?.streams) ? payload.streams : [];
    const videoStream = streams.find((stream) => stream?.codec_type === 'video') ?? {};

    return {
      comment: tags.comment,
      description: tags.description,
      title: tags.title,
      video: buildVideoInfoFromProbe(videoStream, format),
    };
  } catch (error) {
    return null;
  }
}

// Decode iTXt payloads (uncompressed or deflate-compressed)
async function decodeITXtText(
  data: Uint8Array,
  compressionFlag: number,
  decoder: TextDecoder
): Promise<string> {
  if (compressionFlag === 0) {
    return decoder.decode(data);
  }

  if (compressionFlag === 1) {
    try {
      const zlib = await import('zlib');
      const inflated = zlib.inflateSync(Buffer.from(data));
      return decoder.decode(inflated);
    } catch {
      return '';
    }
  }

  return '';
}

async function parsePNGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
  const view = new DataView(buffer);
  let offset = 8;
  const decoder = new TextDecoder();
  const chunks: Record<string, string> = {};

  let foundChunks = 0;
  const maxChunks = 5; // invokeai_metadata, parameters, workflow, prompt, Description

  while (offset < view.byteLength && foundChunks < maxChunks) {
    const length = view.getUint32(offset);
    const type = decoder.decode(buffer.slice(offset + 4, offset + 8));

    if (type === 'tEXt') {
      const chunkData = buffer.slice(offset + 8, offset + 8 + length);
      const chunkString = decoder.decode(chunkData);
      const [keyword, text] = chunkString.split('\0');

      if (['invokeai_metadata', 'parameters', 'Parameters', 'workflow', 'prompt', 'Description'].includes(keyword) && text) {
        chunks[keyword.toLowerCase()] = text;
        foundChunks++;
      }
    } else if (type === 'iTXt') {
      const chunkData = new Uint8Array(buffer.slice(offset + 8, offset + 8 + length));
      const keywordEndIndex = chunkData.indexOf(0);
      if (keywordEndIndex === -1) {
        offset += 12 + length;
        continue;
      }
      const keyword = decoder.decode(chunkData.slice(0, keywordEndIndex));

      if (['invokeai_metadata', 'parameters', 'Parameters', 'workflow', 'prompt', 'Description'].includes(keyword)) {
        const compressionFlag = chunkData[keywordEndIndex + 1];
        let currentIndex = keywordEndIndex + 3; // Skip null separator, compression flag, and method

        const langTagEndIndex = chunkData.indexOf(0, currentIndex);
        if (langTagEndIndex === -1) {
          offset += 12 + length;
          continue;
        }
        currentIndex = langTagEndIndex + 1;

        const translatedKwEndIndex = chunkData.indexOf(0, currentIndex);
        if (translatedKwEndIndex === -1) {
          offset += 12 + length;
          continue;
        }
        currentIndex = translatedKwEndIndex + 1;

        const text = await decodeITXtText(chunkData.slice(currentIndex), compressionFlag, decoder);
        if (text) {
          chunks[keyword.toLowerCase()] = text;
          foundChunks++;
        }
      }
    }

    if (type === 'IEND') break;
    offset += 12 + length;
  }

  if (chunks.workflow) {
    const comfyMetadata: Record<string, any> = {};
    comfyMetadata.workflow = chunks.workflow;
    if (chunks.prompt) comfyMetadata.prompt = chunks.prompt;
    return comfyMetadata as ImageMetadata;
  } else if (chunks.parameters || chunks.description) {
    const paramsValue = chunks.parameters || chunks.description;
    return { parameters: paramsValue } as ImageMetadata;
  } else if (chunks.invokeai_metadata) {
    try {
      return JSON.parse(chunks.invokeai_metadata) as ImageMetadata;
    } catch {
      return null;
    }
  } else if (chunks.prompt) {
    return { prompt: chunks.prompt } as ImageMetadata;
  }

  return null;
}

async function parseJPEGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
  const exifData = await exifr.parse(buffer, {
    userComment: true,
    xmp: true,
    mergeOutput: true,
    sanitize: false,
    reviveValues: true,
  }).catch(() => null);

  if (!exifData) return null;

  let metadataText: string | Uint8Array | undefined =
    exifData.UserComment ||
    exifData.userComment ||
    exifData['User Comment'] ||
    exifData.ImageDescription ||
    exifData.Parameters ||
    exifData.Description ||
    null;

  if (!metadataText) return null;

  if (metadataText instanceof Uint8Array) {
    let startOffset = 0;
    for (let i = 0; i < Math.min(20, metadataText.length); i++) {
      if (metadataText[i] === 0x7b) {
        startOffset = i;
        break;
      }
    }
    if (startOffset === 0 && metadataText.length > 8) {
      startOffset = 8;
    }
    const cleanedData = Array.from(metadataText.slice(startOffset)).filter(byte => byte !== 0x00);
    metadataText = new TextDecoder('utf-8').decode(new Uint8Array(cleanedData));
  } else if (typeof metadataText !== 'string') {
    metadataText = typeof metadataText === 'object' ? JSON.stringify(metadataText) : String(metadataText);
  }

  if (!metadataText) return null;

  if (metadataText.includes('Version: ComfyUI')) {
    return { parameters: metadataText } as ImageMetadata;
  }

  if (metadataText.includes('"lang":"x-default"') && metadataText.includes('"value":')) {
    try {
      const xmpData = JSON.parse(metadataText);
      if (xmpData.value && typeof xmpData.value === 'string') {
        const innerJson = xmpData.value;
        if (innerJson.includes('"c":') && (innerJson.includes('"model":') || innerJson.includes('"sampler":') || innerJson.includes('"scale":'))) {
          return { parameters: 'Draw Things ' + innerJson, userComment: innerJson } as ImageMetadata;
        }
      }
    } catch {
      // ignore
    }
  }

  if (metadataText.includes('Civitai resources:') && metadataText.includes('Steps:')) {
    return { parameters: metadataText } as ImageMetadata;
  }
  if (metadataText.includes('Steps:') && metadataText.includes('Sampler:') && metadataText.includes('Model hash:')) {
    return { parameters: metadataText } as ImageMetadata;
  }
  if (metadataText.includes('Prompt:') && metadataText.includes('Steps:') && metadataText.includes('Sampler:') && !metadataText.includes('Model hash:')) {
    return { parameters: metadataText } as ImageMetadata;
  }
  if (metadataText.includes('--v') || metadataText.includes('--ar') || metadataText.includes('--q') || metadataText.includes('--s') || metadataText.includes('Midjourney')) {
    return { parameters: metadataText } as ImageMetadata;
  }
  if ((metadataText.includes('Forge') || metadataText.includes('Gradio')) &&
    metadataText.includes('Steps:') && metadataText.includes('Sampler:') && metadataText.includes('Model hash:')) {
    return { parameters: metadataText } as ImageMetadata;
  }
  if (metadataText.includes('Guidance Scale:') && metadataText.includes('Steps:') && metadataText.includes('Sampler:') &&
    !metadataText.includes('Model hash:') && !metadataText.includes('Forge') && !metadataText.includes('Gradio') &&
    !metadataText.includes('DreamStudio') && !metadataText.includes('Stability AI') && !metadataText.includes('--niji')) {
    const userComment =
      typeof exifData.UserComment === 'string' && exifData.UserComment.includes('{')
        ? exifData.UserComment
        : undefined;
    return { parameters: metadataText, userComment } as ImageMetadata;
  }

  try {
    const parsedMetadata = JSON.parse(metadataText);
    return parsedMetadata as ImageMetadata;
  } catch {
    return null;
  }
}

function extractDimensionsFromBuffer(buffer: ArrayBuffer): Dimensions | null {
  const view = new DataView(buffer);

  if (view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  if (view.getUint16(0) === 0xffd8) {
    let offset = 2;
    const length = view.byteLength;
    while (offset < length) {
      if (view.getUint8(offset) !== 0xff) {
        break;
      }
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2, false);

      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        const height = view.getUint16(offset + 5, false);
        const width = view.getUint16(offset + 7, false);
        if (width > 0 && height > 0) {
          return { width, height };
        }
        break;
      }

      if (size < 2) {
        break;
      }
      offset += 2 + size;
    }
  }

  return null;
}

async function tryReadEasyDiffusionSidecarJson(imagePath: string): Promise<ImageMetadata | null> {
  const jsonPath = imagePath.replace(/\.(png|jpg|jpeg)$/i, '.json');
  const isAbsolutePath = /^[a-zA-Z]:[\\/]/.test(jsonPath) || jsonPath.startsWith('/');

  if (!isAbsolutePath || !jsonPath || jsonPath === imagePath) {
    return null;
  }

  try {
    const jsonText = await fs.readFile(jsonPath, 'utf-8');
    const parsedJson = JSON.parse(jsonText);
    if (isEasyDiffusionJson(parsedJson)) {
      return parsedJson;
    }
    return null;
  } catch {
    return null;
  }
}

async function computeSha256(buffer: ArrayBuffer): Promise<string> {
  const hash = createHash('sha256');
  hash.update(Buffer.from(buffer));
  return hash.digest('hex');
}

/**
 * Parse a single image file into normalized metadata + raw metadata + hashes.
 */
export async function parseImageFile(filePath: string): Promise<MetadataEngineResult> {
  const errors: string[] = [];
  const absolutePath = path.resolve(filePath);
  const buffer = await fs.readFile(absolutePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const startedAt = Date.now();

  let rawMetadata: ImageMetadata | null = null;
  let rawSource: MetadataEngineResult['rawSource'] = 'unknown';
  let videoInfo: VideoInfo | null = null;
  const isVideo = isVideoFilePath(absolutePath);

  if (isVideo) {
    rawSource = 'video';
    const videoMetadata = await readVideoMetadataWithFfprobe(absolutePath);
    if (videoMetadata) {
      const raw: Record<string, any> = {
        description: videoMetadata.description,
        comment: videoMetadata.comment,
        title: videoMetadata.title,
      };

      if (videoMetadata.comment) {
        try {
          raw.videometahub_data = JSON.parse(videoMetadata.comment);
        } catch (err: any) {
          errors.push(`Failed to parse video metadata JSON: ${err?.message ?? 'unknown error'}`);
        }
      }

      rawMetadata = raw as ImageMetadata;
      videoInfo = videoMetadata.video ?? null;
    } else {
      errors.push('ffprobe not available or failed to read video metadata.');
    }
  } else {
    const view = new DataView(arrayBuffer);
    if (view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
      rawMetadata = await parsePNGMetadata(arrayBuffer);
      rawSource = 'png';
    } else if (view.getUint16(0) === 0xffd8) {
      rawMetadata = await parseJPEGMetadata(arrayBuffer);
      rawSource = 'jpeg';
    }
  }

  if (!rawMetadata) {
    const sidecar = await tryReadEasyDiffusionSidecarJson(absolutePath);
    if (sidecar) {
      rawMetadata = sidecar;
      rawSource = 'sidecar';
    }
  }

  let metadata: BaseMetadata | null = null;
  if (rawMetadata) {
    try {
      // ComfyUI workflows sometimes come as stringified JSON with NaN; sanitize first
      if (typeof (rawMetadata as any).workflow === 'string') {
        (rawMetadata as any).workflow = JSON.parse(sanitizeJson((rawMetadata as any).workflow));
      }
      if (typeof (rawMetadata as any).prompt === 'string') {
        (rawMetadata as any).prompt = JSON.parse(sanitizeJson((rawMetadata as any).prompt));
      }
    } catch (err: any) {
      errors.push(`Failed to parse workflow/prompt JSON: ${err?.message ?? 'unknown error'}`);
    }

    metadata = await normalizeMetadata(rawMetadata, arrayBuffer);
  }

  let dimensions = isVideo ? null : extractDimensionsFromBuffer(arrayBuffer);
  if (metadata && dimensions) {
    metadata.width = metadata.width || dimensions.width;
    metadata.height = metadata.height || dimensions.height;
  }
  if (metadata && isVideo && videoInfo) {
    metadata.width = metadata.width || (videoInfo.width ?? 0);
    metadata.height = metadata.height || (videoInfo.height ?? 0);
    metadata.video = metadata.video ?? videoInfo;
  }
  if (!metadata && isVideo && videoInfo) {
    metadata = {
      prompt: '',
      model: '',
      width: videoInfo.width ?? 0,
      height: videoInfo.height ?? 0,
      steps: 0,
      scheduler: '',
      media_type: 'video',
      video: videoInfo,
    };
  }
  if (isVideo && metadata) {
    dimensions = {
      width: metadata.width || 0,
      height: metadata.height || 0,
    };
  }

  const sha256 = await computeSha256(arrayBuffer);
  const normalizeTime = Date.now() - startedAt;

  return {
    file: absolutePath,
    sha256,
    rawMetadata,
    metadata,
    dimensions,
    rawSource,
    errors: errors.length ? errors : undefined,
    schema_version: SCHEMA_VERSION,
    _telemetry: {
      parser: metadata?.generator ?? null,
      raw_source: rawSource ?? null,
      normalize_time_ms: normalizeTime,
    },
  };
}

/**
 * Parse many files and yield JSONL-friendly rows.
 */
export async function parseFiles(filePaths: string[]): Promise<MetadataEngineResult[]> {
  const results: MetadataEngineResult[] = [];
  for (const file of filePaths) {
    try {
      const parsed = await parseImageFile(file);
      results.push(parsed);
    } catch (err: any) {
      results.push({
        file: path.resolve(file),
        sha256: '',
        rawMetadata: null,
        metadata: null,
        rawSource: 'unknown',
        errors: [`Failed to parse file: ${err?.message ?? 'unknown error'}`],
        dimensions: null,
        schema_version: SCHEMA_VERSION,
        _telemetry: {
          parser: null,
          raw_source: null,
          normalize_time_ms: 0,
        },
      });
    }
  }
  return results;
}
