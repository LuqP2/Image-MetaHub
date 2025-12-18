import { Automatic1111Metadata, BaseMetadata } from '../core/types';

// --- Extraction Functions ---

export function extractModelsFromAutomatic1111(metadata: Automatic1111Metadata): string[] {
  const params = metadata.parameters;

  // Try to extract model from Civitai resources JSON first
  const civitaiMatch = params.match(/Civitai resources:\s*(\[[\s\S]*?\])/);
  if (civitaiMatch) {
    try {
      const resources = JSON.parse(civitaiMatch[1]);
      if (Array.isArray(resources)) {
        for (const resource of resources) {
          if (resource.type === 'checkpoint' && resource.modelName) {
            return [resource.modelName];
          }
        }
      }
    } catch (e) {
      // If JSON parsing fails, fall back to regex pattern
    }
  }

  // Fall back to standard Model: pattern
  const modelMatch = params.match(/Model:\s*([^,]+)/i);
  if (modelMatch && modelMatch[1]) {
    return [modelMatch[1].trim()];
  }

  // Last resort: try Model hash
  const hashMatch = params.match(/Model hash:\s*([a-f0-9]+)/i);
  if (hashMatch && hashMatch[1]) {
    return [`Model hash: ${hashMatch[1]}`];
  }

  return [];
}

export function extractLorasFromAutomatic1111(metadata: Automatic1111Metadata): string[] {
  const loras: Set<string> = new Set();
  const params = metadata.parameters;

  // Try to extract LoRAs from Civitai resources JSON first
  const civitaiMatch = params.match(/Civitai resources:\s*(\[[\s\S]*?\])/);
  if (civitaiMatch) {
    try {
      const resources = JSON.parse(civitaiMatch[1]);
      if (Array.isArray(resources)) {
        resources.forEach((resource: any) => {
          if (resource.type === 'lora' && resource.modelName) {
            loras.add(resource.modelName);
          }
        });
      }
    } catch (e) {
      // If JSON parsing fails, fall back to regex pattern
    }
  }

  // Fall back to standard <lora:...> pattern if no Civitai resources found
  if (loras.size === 0) {
    const loraPatterns = /<lora:([^:>]+):[^>]*>/gi;
    let match;
    while ((match = loraPatterns.exec(params)) !== null) {
      if (match[1]) loras.add(match[1].trim());
    }
  }

  return Array.from(loras);
}

// --- Detector de variantes ---

function detectGenerator(parameters: string): string {
  // Detecta ComfyUI explícito
  if (parameters.includes('Version: ComfyUI')) {
    return 'ComfyUI';
  }
  
  // Detecta Forge/Reforge
  if (parameters.includes('Version: f') || 
      parameters.includes('Version: forge') ||
      parameters.includes('Version: reforge')) {
    return 'Forge';
  }
  
  // Detecta Fooocus
  if (parameters.includes('Version: Fooocus') ||
      parameters.includes('Sharpness:')) {
    return 'Fooocus';
  }
  
  // Detecta módulos (indica ComfyUI/Forge com backend modular)
  if (parameters.includes('Module 1:') || 
      parameters.includes('Module 2:') ||
      parameters.includes('Module 3:')) {
    return 'ComfyUI/Forge';
  }
  
  // Detecta parâmetros específicos do Flux via ComfyUI
  if (parameters.includes('Distilled CFG Scale:') ||
      parameters.includes('Diffusion in Low Bits:')) {
    return 'ComfyUI (Flux)';
  }
  
  // Fallback para A1111
  return 'A1111';
}

// --- Main Parser Function ---

export function parseA1111Metadata(parameters: string): BaseMetadata {

  const result: Partial<BaseMetadata> = {};

  // Extrai prompt e negative prompt
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

  // Extrai parâmetros numéricos
  const stepsMatch = parameters.match(/Steps: (\d+)/);
  if (stepsMatch) result.steps = parseInt(stepsMatch[1], 10);

  const samplerMatch = parameters.match(/Sampler: ([^,]+)/);
  if (samplerMatch) result.scheduler = samplerMatch[1].trim();

  // Suporte para "Schedule type:" (usado em builds modernas)
  const scheduleTypeMatch = parameters.match(/Schedule type: ([^,]+)/);
  if (scheduleTypeMatch && !result.scheduler) {
    result.scheduler = scheduleTypeMatch[1].trim();
  }

  const cfgScaleMatch = parameters.match(/CFG scale: ([\d.]+)/);
  if (cfgScaleMatch) result.cfg_scale = parseFloat(cfgScaleMatch[1]);
  
  // Suporte para "Distilled CFG Scale" (Flux)
  const distilledCfgMatch = parameters.match(/Distilled CFG Scale: ([\d.]+)/);
  if (distilledCfgMatch) {
    result.cfg_scale = parseFloat(distilledCfgMatch[1]);
  }

  const seedMatch = parameters.match(/Seed: (\d+)/);
  if (seedMatch) result.seed = parseInt(seedMatch[1], 10);

  const sizeMatch = parameters.match(/Size: (\d+)x(\d+)/);
  if (sizeMatch) {
    result.width = parseInt(sizeMatch[1], 10);
    result.height = parseInt(sizeMatch[2], 10);
  }

  // Extract Clip skip
  const clipSkipMatch = parameters.match(/Clip skip: (\d+)/i);
  if (clipSkipMatch) {
    result.clip_skip = parseInt(clipSkipMatch[1], 10);
  }

  // Extract models and LoRAs using dedicated extraction functions
  // These functions handle Civitai resources JSON, Model: patterns, and fallback extraction
  result.models = extractModelsFromAutomatic1111({ parameters });
  result.loras = extractLorasFromAutomatic1111({ parameters });

  // Set model to first one from models array
  if (result.models.length > 0) {
    result.model = result.models[0];
  }
  
  // Detecta o gerador usando a função melhorada
  result.generator = detectGenerator(parameters);
  
  // Extrai informação de versão se disponível
  const versionMatch = parameters.match(/Version: ([^,]+)/);
  if (versionMatch) {
    result.version = versionMatch[1].trim();
  }
  
  // Extrai informações de módulos (para builds modulares)
  const moduleMatches = parameters.match(/Module \d+: ([^,\n]+)/g);
  if (moduleMatches && moduleMatches.length > 0) {
    result.module = moduleMatches.join(', ');
  }

  const finalResult = result as BaseMetadata;
  
  return finalResult;
}