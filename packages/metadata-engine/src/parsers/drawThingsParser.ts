import { BaseMetadata } from '../core/types';
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
    generator: 'Draw Things'
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
function extractLoRAs(parameters: string, jsonData?: Record<string, unknown> | null): string[] {
  const loras: string[] = [];
  // Extract from JSON data (preferred)
  if (jsonData?.lora && Array.isArray(jsonData.lora)) {
    jsonData.lora.forEach((lora: unknown) => {
      if (typeof lora === 'object' && lora !== null && 'model' in lora) {
        const loraObj = lora as Record<string, unknown>;
        if (typeof loraObj.model === 'string') {
          loras.push(loraObj.model);
        }
      } else if (typeof lora === 'string') {
        loras.push(lora);
      }
    });
  }
  // Fallback to parameter extraction
  if (loras.length === 0) {
    const loraMatches = parameters.matchAll(/LoRA\s+\d+\s+Model:\s*([^,\n]+)/gi);
    for (const match of Array.from(loraMatches)) {
      loras.push(match[1].trim());
    }
  }
  return loras;
}
