import { SDNextMetadata, BaseMetadata } from '../core/types';

// --- Extraction Functions ---

export function extractModelsFromSDNext(metadata: SDNextMetadata): string[] {
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

export function extractLorasFromSDNext(metadata: SDNextMetadata): string[] {
  const loras: Set<string> = new Set();
  const params = metadata.parameters;

  // Extract from <lora:name:weight> format
  const loraPatterns = /<lora:([^:>]+):[^>]*>/gi;
  let match;
  while ((match = loraPatterns.exec(params)) !== null) {
    if (match[1]) loras.add(match[1].trim());
  }

  // Also extract from "LoRA networks" field if present (clean version)
  const loraNetworksMatch = params.match(/LoRA networks:\s*"([^"]+)"/i);
  if (loraNetworksMatch) {
    const networks = loraNetworksMatch[1].split(',').map(l => l.trim());
    networks.forEach(network => {
      // Remove version suffix if present (e.g., "name-000005" -> "name")
      const cleanName = network.replace(/-\d+$/, '');
      loras.add(cleanName);
    });
  }

  return Array.from(loras);
}

// --- Main Parser Function ---

export function parseSDNextMetadata(parameters: string): BaseMetadata {
  const result: Partial<BaseMetadata> = {};

  // Extract prompts - SD.Next format is different from A1111
  // Prompt is everything before the first parameter line
  const promptEndIndex = parameters.indexOf('\nNegative prompt:');
  if (promptEndIndex !== -1) {
    result.prompt = parameters.substring(0, promptEndIndex).trim();
  } else {
    // Fallback: find first parameter line
    const firstParamIndex = parameters.search(/\n[A-Z][a-z]+:/);
    if (firstParamIndex !== -1) {
      result.prompt = parameters.substring(0, firstParamIndex).trim();
    } else {
      result.prompt = parameters.split('\n')[0].trim();
    }
  }

  // Extract negative prompt - SD.Next format has it on the same line as "Negative prompt:"
  const negPromptStart = parameters.indexOf('Negative prompt:');
  if (negPromptStart !== -1) {
    const lineEnd = parameters.indexOf('\n', negPromptStart);
    const negPromptLine = lineEnd !== -1 ?
      parameters.substring(negPromptStart, lineEnd) :
      parameters.substring(negPromptStart);
    // Extract just the content after "Negative prompt:"
    const content = negPromptLine.replace(/^Negative prompt:\s*/, '').trim();
    result.negativePrompt = content;
  }

  // Extract generation parameters
  const stepsMatch = parameters.match(/Steps:\s*(\d+)/i);
  if (stepsMatch) {
    result.steps = parseInt(stepsMatch[1], 10);
  }

  const sizeMatch = parameters.match(/Size:\s*(\d+)x(\d+)/i);
  if (sizeMatch) {
    result.width = parseInt(sizeMatch[1], 10);
    result.height = parseInt(sizeMatch[2], 10);
  }

  const samplerMatch = parameters.match(/Sampler:\s*([^,]+)/i);
  if (samplerMatch) {
    result.sampler = samplerMatch[1].trim();
    result.scheduler = samplerMatch[1].trim(); // SD.Next uses sampler field
  }

  const seedMatch = parameters.match(/Seed:\s*(\d+)/i);
  if (seedMatch) {
    result.seed = parseInt(seedMatch[1], 10);
  }

  const cfgScaleMatch = parameters.match(/CFG scale:\s*([\d.]+)/i);
  if (cfgScaleMatch) {
    result.cfg_scale = parseFloat(cfgScaleMatch[1]);
  }

  const cfgRescaleMatch = parameters.match(/CFG rescale:\s*([\d.]+)/i);
  if (cfgRescaleMatch) {
    result.cfg_rescale_multiplier = parseFloat(cfgRescaleMatch[1]);
  }

  // Extract model information
  const modelMatch = parameters.match(/Model:\s*([^,]+)/i);
  if (modelMatch) {
    result.model = modelMatch[1].trim();
  }

  // Extract version information
  const versionMatch = parameters.match(/Version:\s*([a-f0-9]+)/i);
  if (versionMatch) {
    result.version = versionMatch[1];
  }

  // Extract backend information
  const backendMatch = parameters.match(/Backend:\s*([^,]+)/i);
  if (backendMatch) {
    result.backend = backendMatch[1].trim();
  }

  // Extract pipeline information
  const pipelineMatch = parameters.match(/Pipeline:\s*([^,]+)/i);
  if (pipelineMatch) {
    result.pipeline = pipelineMatch[1].trim();
  }

  // Extract operations
  const operationsMatch = parameters.match(/Operations:\s*([^,]+)/i);
  if (operationsMatch) {
    result.operations = operationsMatch[1].trim().split(';').map(op => op.trim());
  }

  // Extract hires information
  const hiresStepsMatch = parameters.match(/Hires steps:\s*(\d+)/i);
  if (hiresStepsMatch) {
    result.hires_steps = parseInt(hiresStepsMatch[1], 10);
  }

  const hiresUpscalerMatch = parameters.match(/Hires upscaler:\s*([^,]+)/i);
  if (hiresUpscalerMatch) {
    result.hires_upscaler = hiresUpscalerMatch[1].trim();
  }

  const hiresScaleMatch = parameters.match(/Hires scale:\s*([\d.]+)/i);
  if (hiresScaleMatch) {
    result.hires_scale = parseFloat(hiresScaleMatch[1]);
  }

  const hiresStrengthMatch = parameters.match(/Hires strength:\s*([\d.]+)/i);
  if (hiresStrengthMatch) {
    result.denoising_strength = parseFloat(hiresStrengthMatch[1]);
  }

  // Set generator
  result.generator = 'SD.Next';

  // Extract arrays
  result.models = extractModelsFromSDNext({ parameters });
  result.loras = extractLorasFromSDNext({ parameters });

  return result as BaseMetadata;
}