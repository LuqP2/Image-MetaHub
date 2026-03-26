import { BaseMetadata } from '../../types';
/**
 * Draw Things Parser - Handles Draw Things (iOS/Mac AI app) metadata
 * Draw Things uses XMP metadata with Description field and UserComment JSON
 * Supports Flux models and LoRA configurations
 */
export function parseDrawThingsMetadata(parameters: string, userComment?: string): BaseMetadata {
  const result: Partial<BaseMetadata> = {};
  // Parse JSON from UserComment if available (contains detailed metadata)
  let jsonData: Record<string, unknown> | null = null;
  if (userComment) {
    try {
      // UserComment may have prefix, try to find JSON start
      const jsonStart = userComment.indexOf('{');
      if (jsonStart !== -1) {
        const jsonString = userComment.substring(jsonStart);
        jsonData = JSON.parse(jsonString);
      }
    } catch {
      // Failed to parse UserComment JSON, using parameters only
    }
  }
  // Extract basic parameters from Description field
  const steps = extractSteps(parameters);
  const sampler = extractSampler(parameters);
  const cfgScale = extractCFGScale(parameters);
  const seed = extractSeed(parameters);
  const size = extractSize(parameters);
  const model = extractModel(parameters);
  // Extract prompts (positive and negative)
  const { positivePrompt, negativePrompt } = extractPrompts(parameters);
  // Extract LoRAs from both JSON and parameters
  const loras = extractLoRAs(parameters, jsonData);
  // Extract size dimensions from size string (e.g., '512x768')
  let width = 0;
  let height = 0;
  if (size) {
    const sizeMatch = size.match(/(\d+)x(\d+)/);
    if (sizeMatch) {
      width = parseInt(sizeMatch[1]);
      height = parseInt(sizeMatch[2]);
    }
  }
  // Override with JSON data if available (more accurate)
  if (jsonData) {
    if (jsonData.size && typeof jsonData.size === 'string') {
      const jsonSizeMatch = jsonData.size.match(/(\d+)x(\d+)/);
      if (jsonSizeMatch) {
        width = parseInt(jsonSizeMatch[1]);
        height = parseInt(jsonSizeMatch[2]);
      }
    }
    if (typeof jsonData.seed === 'number') result.seed = jsonData.seed;
    if (typeof jsonData.steps === 'number') result.steps = jsonData.steps;
    if (typeof jsonData.scale === 'number') result.cfg_scale = jsonData.scale;
    if (typeof jsonData.sampler === 'string') result.sampler = jsonData.sampler;
    if (typeof jsonData.model === 'string') result.model = jsonData.model;
    if (typeof jsonData.c === 'string') result.prompt = jsonData.c; // Clean prompt from JSON
    if (typeof jsonData.strength === 'number') result.denoise = jsonData.strength;
  }

  const v2 = jsonData?.v2 && typeof jsonData.v2 === 'object'
    ? jsonData.v2 as Record<string, unknown>
    : null;
  const maskBlur =
    typeof jsonData?.mask_blur === 'number'
      ? jsonData.mask_blur
      : typeof v2?.maskBlur === 'number'
        ? v2.maskBlur
        : null;
  const originalImageWidth = typeof v2?.originalImageWidth === 'number' ? v2.originalImageWidth : null;
  const originalImageHeight = typeof v2?.originalImageHeight === 'number' ? v2.originalImageHeight : null;
  const preserveOriginalAfterInpaint = v2?.preserveOriginalAfterInpaint === true;
  const denoiseStrength =
    typeof result.denoise === 'number'
      ? result.denoise
      : typeof v2?.strength === 'number'
        ? v2.strength
        : null;

  if (denoiseStrength != null) {
    result.denoise = denoiseStrength;
  }

  if (preserveOriginalAfterInpaint || maskBlur != null) {
    const isOutpaint =
      typeof width === 'number' &&
      typeof height === 'number' &&
      originalImageWidth != null &&
      originalImageHeight != null &&
      (width > originalImageWidth || height > originalImageHeight);

    result.generationType = isOutpaint ? 'outpaint' : 'inpaint';
    result.lineage = {
      detection: 'inferred',
      denoiseStrength,
      maskBlur,
      sourceImage: (originalImageWidth != null && originalImageHeight != null)
        ? {
            width: originalImageWidth,
            height: originalImageHeight,
          }
        : undefined,
    };
  } else if (originalImageWidth != null && originalImageHeight != null) {
    result.generationType = 'img2img';
    result.lineage = {
      detection: 'inferred',
      denoiseStrength,
      sourceImage: {
        width: originalImageWidth,
        height: originalImageHeight,
      },
    };
  }

  // Build normalized metadata
  const normalizedResult: BaseMetadata = {
    prompt: result.prompt || positivePrompt || '',
    negativePrompt: negativePrompt || '',
    model: result.model || model || 'Draw Things',
    models: result.model ? [result.model] : (model ? [model] : ['Draw Things']),
    width: width || 0,
    height: height || 0,
    seed: result.seed || (seed ? parseInt(seed, 10) : undefined),
    steps: result.steps || (steps ? parseInt(steps, 10) : 0),
    cfg_scale: result.cfg_scale || (cfgScale ? parseFloat(cfgScale) : undefined),
    scheduler: 'Draw Things',
    sampler: result.sampler || sampler || 'Draw Things',
    loras: loras || [],
    generator: 'Draw Things',
    denoise: result.denoise,
    generationType: result.generationType,
    lineage: result.lineage,
  };
  return normalizedResult;
}
// Extract prompts from Draw Things format (similar to A1111)
function extractPrompts(parameters: string): { positivePrompt: string; negativePrompt: string } {
  let positivePrompt = '';
  let negativePrompt = '';
  // Split by newlines and look for prompt patterns
  const lines = parameters.split('\n').map(line => line.trim());
  for (const line of lines) {
    if (line.startsWith('Prompt:') || line.startsWith('prompt:')) {
      positivePrompt = line.substring(line.indexOf(':') + 1).trim();
    } else if (line.startsWith('Negative prompt:') || line.startsWith('negative prompt:') || line.startsWith('Negative Prompt:')) {
      negativePrompt = line.substring(line.indexOf(':') + 1).trim();
    }
  }
  // Fallback: if no explicit prompts found, extract from the beginning until "Steps:" or similar parameter
  if (!positivePrompt && lines.length > 0) {
    const firstLine = lines[0];
    // Find where parameters start (look for patterns like "Steps:", "Sampler:", etc.)
    const paramStart = firstLine.search(/\b(Steps:|Sampler:|Guidance Scale:|CFG scale:|Seed:|Size:|Model:)/i);
    if (paramStart !== -1) {
      positivePrompt = firstLine.substring(0, paramStart).trim();
      // Remove trailing dots/commas
      positivePrompt = positivePrompt.replace(/[.,\s]+$/, '');
    } else {
      positivePrompt = firstLine;
    }
  }
  return { positivePrompt, negativePrompt };
}
// Extract steps
function extractSteps(parameters: string): string | null {
  const match = parameters.match(/Steps:\s*(\d+)/i);
  return match ? match[1] : null;
}
// Extract sampler
function extractSampler(parameters: string): string | null {
  const match = parameters.match(/Sampler:\s*([^,\n]+)/i);
  return match ? match[1].trim() : null;
}
// Extract CFG scale
function extractCFGScale(parameters: string): string | null {
  const match = parameters.match(/Guidance Scale:\s*([\d.]+)/i);
  return match ? match[1] : null;
}
// Extract seed
function extractSeed(parameters: string): string | null {
  const match = parameters.match(/Seed:\s*(\d+)/i);
  return match ? match[1] : null;
}
// Extract size
function extractSize(parameters: string): string | null {
  const match = parameters.match(/Size:\s*([^,\n]+)/i);
  return match ? match[1].trim() : null;
}
// Extract model
function extractModel(parameters: string): string | null {
  const match = parameters.match(/Model:\s*([^,\n]+)/i);
  return match ? match[1].trim() : null;
}
// Extract LoRAs from both parameters and JSON data
function extractLoRAs(parameters: string, jsonData?: Record<string, unknown> | null): { name: string; weight?: number }[] {
  const loras: { name: string; weight?: number }[] = [];
  // Extract from JSON data (preferred)
  const jsonLoras = jsonData?.loras || jsonData?.lora;
  if (jsonLoras && Array.isArray(jsonLoras)) {
    jsonLoras.forEach((lora: unknown) => {
      if (typeof lora === 'object' && lora !== null) {
        const loraObj = lora as Record<string, unknown>;
        const name = (loraObj.file as string) || (loraObj.model as string);
        if (typeof name === 'string') {
          const weight = typeof loraObj.weight === 'number' ? loraObj.weight : undefined;
          loras.push({ name, weight });
        }
      } else if (typeof lora === 'string') {
        loras.push({ name: lora });
      }
    });
  }
  // Fallback to parameter extraction
  if (loras.length === 0) {
    const loraMatches = parameters.matchAll(/LoRA\s+(\d+)\s+Model:\s*([^,\n]+)/gi);
    for (const match of Array.from(loraMatches)) {
      const index = match[1];
      const name = match[2].trim();
      
      let weight: number | undefined = undefined;
      const weightRegex = new RegExp(`LoRA\\s+${index}\\s+Weight:\\s*([\\d.]+)`, 'i');
      const weightMatch = parameters.match(weightRegex);
      if (weightMatch) {
        weight = parseFloat(weightMatch[1]);
      }
      
      loras.push({ name, weight });
    }
  }
  return loras;
}
