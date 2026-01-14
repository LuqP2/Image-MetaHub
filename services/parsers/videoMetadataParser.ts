/**
 * Video Metadata Parser
 *
 * Parses the `videometahub_data` JSON extracted from video container metadata
 * (stored in the comment field by MetaHub Save Video Node).
 *
 * Returns a normalized BaseMetadata object for unified display alongside image metadata.
 */

import { BaseMetadata, LoRAInfo } from '../../types';

/**
 * Structure of videometahub_data from MetaHub Save Video Node
 */
export interface VideoMetahubData {
  generator?: string;           // "ComfyUI"
  media_type?: string;          // "video"
  workflow_version?: string;    // Version of the workflow

  // Core generation parameters
  prompt?: string;
  negative_prompt?: string;
  model?: string;
  models?: string[];
  seed?: number;
  steps?: number;
  cfg_scale?: number;
  scheduler?: string;
  sampler?: string;

  // LoRAs (can be strings or detailed objects)
  loras?: (string | LoRAInfo)[];

  // Dimensions
  width?: number;
  height?: number;

  // User inputs from MetaHub Save Node
  tags?: string[];
  notes?: string;

  // Analytics from WorkflowExtractor
  analytics?: {
    vram_peak_mb?: number | null;
    gpu_device?: string | null;
    generation_time_ms?: number | null;
    steps_per_second?: number | null;
    comfyui_version?: string | null;
    torch_version?: string | null;
    python_version?: string | null;
    generation_time?: number | null;  // Legacy
  };

  // Original workflow for reference
  workflow?: any;

  // Allow additional fields
  [key: string]: any;
}

/**
 * Type guard to check if data is valid VideoMetahubData
 */
export function isVideoMetahubData(data: any): data is VideoMetahubData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  // Check for our specific markers
  if (data.generator === 'ComfyUI' || data.media_type === 'video') {
    return true;
  }

  // Check for common generation metadata fields
  const hasCommonFields =
    ('prompt' in data || 'model' in data || 'seed' in data) &&
    (typeof data.prompt === 'string' || typeof data.model === 'string' || typeof data.seed === 'number');

  return hasCommonFields;
}

/**
 * Extract LoRAs from videometahub_data
 */
function extractLoras(data: VideoMetahubData): (string | LoRAInfo)[] {
  const loras: (string | LoRAInfo)[] = [];
  const seenNames = new Set<string>();

  // From explicit loras field
  if (Array.isArray(data.loras)) {
    for (const lora of data.loras) {
      if (typeof lora === 'string') {
        if (!seenNames.has(lora)) {
          seenNames.add(lora);
          loras.push(lora);
        }
      } else if (lora && typeof lora === 'object' && lora.name) {
        if (!seenNames.has(lora.name)) {
          seenNames.add(lora.name);
          loras.push(lora);
        }
      }
    }
  }

  // Extract from prompt if present (LoRA syntax: <lora:name:weight>)
  if (data.prompt) {
    const loraPattern = /<lora:([^:>]+):([^>]+)>/gi;
    let match;
    while ((match = loraPattern.exec(data.prompt)) !== null) {
      const name = match[1].trim();
      const weightStr = match[2].trim();

      if (name && !seenNames.has(name)) {
        seenNames.add(name);
        const weight = parseFloat(weightStr);
        if (!isNaN(weight)) {
          loras.push({ name, weight });
        } else {
          loras.push(name);
        }
      }
    }
  }

  return loras;
}

/**
 * Extract models from videometahub_data
 */
function extractModels(data: VideoMetahubData): string[] {
  const models: Set<string> = new Set();

  // Primary model
  if (data.model && typeof data.model === 'string') {
    models.add(data.model.trim());
  }

  // Models array
  if (Array.isArray(data.models)) {
    for (const model of data.models) {
      if (typeof model === 'string' && model.trim()) {
        models.add(model.trim());
      }
    }
  }

  return Array.from(models);
}

/**
 * Parse videometahub_data and return normalized BaseMetadata
 */
export function parseVideoMetahubData(data: VideoMetahubData): BaseMetadata {
  const result: Partial<BaseMetadata> = {};

  // Prompts
  result.prompt = data.prompt || '';
  result.negativePrompt = data.negative_prompt || '';

  // Core generation parameters
  result.seed = data.seed;
  result.steps = data.steps || 0;
  result.cfg_scale = data.cfg_scale;
  result.scheduler = data.scheduler || data.sampler || '';
  result.sampler = data.sampler;

  // Dimensions
  result.width = data.width || 0;
  result.height = data.height || 0;

  // Models and LoRAs
  result.models = extractModels(data);
  result.model = result.models.length > 0 ? result.models[0] : '';
  result.loras = extractLoras(data);

  // User inputs
  result.tags = data.tags;
  result.notes = data.notes;

  // Analytics
  if (data.analytics) {
    result.analytics = {
      vram_peak_mb: data.analytics.vram_peak_mb ?? null,
      gpu_device: data.analytics.gpu_device ?? null,
      generation_time_ms: data.analytics.generation_time_ms ?? null,
      steps_per_second: data.analytics.steps_per_second ?? null,
      comfyui_version: data.analytics.comfyui_version ?? null,
      torch_version: data.analytics.torch_version ?? null,
      python_version: data.analytics.python_version ?? null,
      generation_time: data.analytics.generation_time ?? null,
    };
  }

  // Generator info
  result.generator = data.generator || 'ComfyUI';
  result.version = data.workflow_version;

  return result as BaseMetadata;
}

/**
 * Try to parse raw metadata and return BaseMetadata if successful
 * Returns null if the data is not valid videometahub_data
 */
export function tryParseVideoMetadata(rawData: any): BaseMetadata | null {
  if (!isVideoMetahubData(rawData)) {
    return null;
  }

  try {
    return parseVideoMetahubData(rawData);
  } catch (error) {
    console.warn('[VideoMetadataParser] Failed to parse video metadata:', error);
    return null;
  }
}
