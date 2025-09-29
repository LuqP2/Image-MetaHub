import { Automatic1111Metadata, BaseMetadata } from '../../types';

// --- Extraction Functions ---

export function extractModelsFromAutomatic1111(metadata: Automatic1111Metadata): string[] {
  const params = metadata.parameters;
  const modelMatch = params.match(/Model:\s*([^,]+)/i);
  if (modelMatch && modelMatch[1]) {
    return [modelMatch[1].trim()];
  }
  const hashMatch = params.match(/Model hash:\s*([a-f0-9]+)/i);
  if (hashMatch && hashMatch[1]) {
    return [`Model hash: ${hashMatch[1]}`];
  }
  return [];
}

export function extractLorasFromAutomatic1111(metadata: Automatic1111Metadata): string[] {
  const loras: Set<string> = new Set();
  const params = metadata.parameters;
  const loraPatterns = /<lora:([^:>]+):[^>]*>/gi;
  let match;
  while ((match = loraPatterns.exec(params)) !== null) {
    if (match[1]) loras.add(match[1].trim());
  }
  return Array.from(loras);
}

// --- Main Parser Function ---

export function parseA1111Metadata(parameters: string): BaseMetadata {
  const result: Partial<BaseMetadata> = {};

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

  const stepsMatch = parameters.match(/Steps: (\d+)/);
  if (stepsMatch) result.steps = parseInt(stepsMatch[1], 10);

  const samplerMatch = parameters.match(/Sampler: ([^,]+)/);
  if (samplerMatch) result.scheduler = samplerMatch[1].trim();

  const cfgScaleMatch = parameters.match(/CFG scale: ([\d.]+)/);
  if (cfgScaleMatch) result.cfg_scale = parseFloat(cfgScaleMatch[1]);

  const seedMatch = parameters.match(/Seed: (\d+)/);
  if (seedMatch) result.seed = parseInt(seedMatch[1], 10);

  const sizeMatch = parameters.match(/Size: (\d+)x(\d+)/);
  if (sizeMatch) {
    result.width = parseInt(sizeMatch[1], 10);
    result.height = parseInt(sizeMatch[2], 10);
  }

  const modelMatch = parameters.match(/Model: ([^,]+)/);
  if (modelMatch) result.model = modelMatch[1].trim();

  result.models = result.model ? [result.model] : [];
  result.loras = extractLorasFromAutomatic1111({ parameters });

  return result as BaseMetadata;
}