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

  // Extract model - try Hashes JSON first (especially important for ComfyUI)
  const hashesMatch = parameters.match(/Hashes:\s*(\{[^}]+\})/);
  if (hashesMatch) {
    try {
      const hashes = JSON.parse(hashesMatch[1]);
      
      // Priority order for model extraction from hashes
      result.model = hashes['model'] || 
                    hashes['Model'] || 
                    hashes['checkpoint'] || 
                    hashes['Checkpoint'] ||
                    // Look for keys containing 'model' (case insensitive)
                    Object.keys(hashes).find(key => key.toLowerCase().includes('model') && hashes[key]) ||
                    // Fallback to first string value
                    Object.values(hashes).find(val => typeof val === 'string' && val.trim());
      
    } catch {
      // JSON parse error - continue with other extraction methods
    }
  }
  
  // If no model from hashes, try the regular Model: pattern
  if (!result.model) {
    const modelMatch = parameters.match(/Model: ([^,]+)/);
    if (modelMatch) {
      result.model = modelMatch[1].trim();
    }
  }
  
  // If still no model, try Model hash: pattern
  if (!result.model) {
    const hashMatch = parameters.match(/Model hash:\s*([a-f0-9]+)/i);
    if (hashMatch && hashMatch[1]) {
      result.model = `Model hash: ${hashMatch[1]}`;
    }
  }

  result.models = result.model ? [result.model] : [];
  result.loras = extractLorasFromAutomatic1111({ parameters });
  
  // Check if this is actually ComfyUI metadata
  if (parameters.includes('Version: ComfyUI')) {
    result.generator = 'ComfyUI';
  } else {
    result.generator = 'A1111';
  }

  const finalResult = result as BaseMetadata;
  
  return finalResult;
}