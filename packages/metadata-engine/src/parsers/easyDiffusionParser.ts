import { EasyDiffusionMetadata, EasyDiffusionJson, BaseMetadata } from '../core/types';

// --- Extraction Functions ---

export function extractModelsFromEasyDiffusion(metadata: EasyDiffusionMetadata): string[] {
  const params = metadata.parameters;
  const modelMatch = params.match(/Model:\s*([^,\n]+)/i);
  if (modelMatch && modelMatch[1]) {
    return [modelMatch[1].trim()];
  }
  return [];
}

export function extractLorasFromEasyDiffusion(metadata: EasyDiffusionMetadata): string[] {
  const loras: Set<string> = new Set();
  const params = metadata.parameters;
  // Easy Diffusion might use similar LoRA syntax as A1111
  const loraPatterns = /<lora:([^:>]+):[^>]*>/gi;
  let match;
  while ((match = loraPatterns.exec(params)) !== null) {
    if (match[1]) loras.add(match[1].trim());
  }
  return Array.from(loras);
}

// --- Main Parser Function ---

export function parseEasyDiffusionMetadata(parameters: string): BaseMetadata {
  const result: Partial<BaseMetadata> = {};

  // Parse prompt and negative prompt
  const negativePromptIndex = parameters.indexOf('\nNegative prompt:');
  if (negativePromptIndex !== -1) {
    result.prompt = parameters.substring(0, negativePromptIndex).trim();
    const rest = parameters.substring(negativePromptIndex + 1);
    const negativePromptEnd = rest.indexOf('\n');
    result.negativePrompt = rest.substring('Negative prompt:'.length, negativePromptEnd).trim();
  } else {
    const firstParamIndex = parameters.search(/\n[A-Z][a-z]+:/);
    result.prompt = firstParamIndex !== -1 ? parameters.substring(0, firstParamIndex).trim() : parameters;
  }

  // Parse numeric parameters
  const stepsMatch = parameters.match(/Steps: (\d+)/);
  if (stepsMatch) result.steps = parseInt(stepsMatch[1], 10);

  const cfgScaleMatch = parameters.match(/CFG scale: ([\d.]+)/);
  if (cfgScaleMatch) result.cfg_scale = parseFloat(cfgScaleMatch[1]);

  const seedMatch = parameters.match(/Seed: (\d+)/);
  if (seedMatch) result.seed = parseInt(seedMatch[1], 10);

  // Parse sampler/scheduler
  const samplerMatch = parameters.match(/Sampler: ([^,\n]+)/);
  if (samplerMatch) result.sampler = samplerMatch[1].trim();

  // Parse size
  const sizeMatch = parameters.match(/Size: (\d+)x(\d+)/);
  if (sizeMatch) {
    result.width = parseInt(sizeMatch[1], 10);
    result.height = parseInt(sizeMatch[2], 10);
  }

  // Parse model
  const modelMatch = parameters.match(/Model: ([^,\n]+)/);
  if (modelMatch) result.model = modelMatch[1].trim();

  // Extract arrays
  result.models = result.model ? [result.model] : [];
  result.loras = extractLorasFromEasyDiffusion({ parameters });

  return result as BaseMetadata;
}

export function parseEasyDiffusionJson(metadata: EasyDiffusionJson): BaseMetadata {
  const result: Partial<BaseMetadata> = {};

  // Map JSON fields to BaseMetadata
  result.prompt = metadata.prompt || '';
  result.negativePrompt = metadata.negative_prompt || '';
  result.model = metadata.model || '';
  result.width = metadata.width || 0;
  result.height = metadata.height || 0;
  result.seed = metadata.seed;
  result.steps = metadata.steps || 0;
  result.cfg_scale = metadata.cfg_scale;
  result.sampler = metadata.sampler || '';

  // Extract arrays
  result.models = result.model ? [result.model] : [];
  result.loras = []; // JSON format might not include LoRAs in the same way

  return result as BaseMetadata;
}