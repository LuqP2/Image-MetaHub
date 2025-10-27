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

  // Extract model - prioritize actual model name over hash
  // Try Model: field first (can appear anywhere in the line)
  const modelMatch = parameters.match(/Model:\s*([^,\n]+)/);
  if (modelMatch && modelMatch[1]) {
    const modelName = modelMatch[1].trim();
    // Only use it if it's not a hash (hashes are typically 10+ hex chars)
    if (!/^[a-f0-9]{10,}$/i.test(modelName)) {
      result.model = modelName;
    }
  }
  
  // If no model name found, try Model hash: pattern as fallback
  if (!result.model) {
    const hashMatch = parameters.match(/Model hash:\s*([a-f0-9]+)/i);
    if (hashMatch && hashMatch[1]) {
      result.model = hashMatch[1];
    }
  }
  
  // Last resort: try to extract from Hashes JSON (for ComfyUI/other)
  if (!result.model) {
    const hashesMatch = parameters.match(/Hashes:\s*(\{[^}]+\})/);
    if (hashesMatch) {
      try {
        const hashes = JSON.parse(hashesMatch[1]);
        
        // Try to find actual model name first, avoid hash values
        result.model = hashes['checkpoint'] || 
                      hashes['Checkpoint'] ||
                      // Look for keys containing 'model' but not the hash itself
                      Object.keys(hashes)
                        .filter(key => key.toLowerCase().includes('model') && 
                                      !key.toLowerCase().includes('hash'))
                        .map(key => hashes[key])
                        .find(val => typeof val === 'string' && val.trim() && 
                                    !/^[a-f0-9]{10,}$/i.test(val)); // Avoid hash-like strings
        
      } catch {
        // JSON parse error - continue without model info
      }
    }
  }

  result.models = result.model ? [result.model] : [];
  result.loras = extractLorasFromAutomatic1111({ parameters });
  
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