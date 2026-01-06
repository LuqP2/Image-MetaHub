import { ForgeMetadata, isForgeMetadata, BaseMetadata, LoRAInfo } from '../../types';
import { extractLoRAsWithWeights } from '../../utils/promptCleaner';

/**
 * Forge Parser - Handles Forge (A1111-based) metadata
 * Forge is based on Stable Diffusion WebUI (A1111) but with additional features
 * Reuses A1111 parsing logic since Forge maintains compatibility
 */

export function parseForgeMetadata(metadata: any): BaseMetadata | null {
  if (!isForgeMetadata(metadata)) {
    return null;
  }

  const parameters = metadata.parameters as string;

  // Extract prompts (positive and negative) - Lógica atualizada para suportar linhas únicas
  const { positivePrompt, negativePrompt } = extractPrompts(parameters);

  // Extract basic parameters
  const steps = extractSteps(parameters);
  const sampler = extractSampler(parameters);
  const scheduleType = extractScheduleType(parameters); // Novo campo adicionado
  const cfgScale = extractCFGScale(parameters);
  const seed = extractSeed(parameters);
  const size = extractSize(parameters);
  const modelHash = extractModelHash(parameters);
  const model = extractModel(parameters);
  const denoising = extractDenoising(parameters);
  const clipSkip = extractClipSkip(parameters);

  // Extract LoRAs and embeddings
  const loras = extractLoRAs(parameters);
  const embeddings = extractEmbeddings(parameters);

  // Extract additional Forge-specific parameters
  const hiresUpscaler = extractHiresUpscaler(parameters);
  const hiresUpscale = extractHiresUpscale(parameters);
  const hiresSteps = extractHiresSteps(parameters);
  const hiresDenoising = extractHiresDenoising(parameters);

  // Extract size dimensions from size string (e.g., "512x512")
  let width = 0;
  let height = 0;
  if (size) {
    const sizeMatch = size.match(/(\d+)x(\d+)/);
    if (sizeMatch) {
      width = parseInt(sizeMatch[1]);
      height = parseInt(sizeMatch[2]);
    }
  }

  return {
    prompt: positivePrompt,
    negativePrompt,
    model: model || '',
    models: model ? [model] : [],
    width,
    height,
    seed,
    steps: steps || 0,
    cfg_scale: cfgScale,
    scheduler: scheduleType || sampler || '', // Usa Schedule type se existir (correção do teste)
    sampler,
    loras,
    // Forge-specific fields
    modelHash,
    denoising,
    clipSkip,
    hiresUpscaler,
    hiresUpscale,
    hiresSteps,
    hiresDenoising,
  };
}

// Helper functions

function extractPrompts(parameters: string): { positivePrompt: string; negativePrompt: string } {
  // 1. Encontra onde começam os parâmetros técnicos (geralmente "Steps:")
  // Isso serve como um "muro" para parar de ler o prompt
  const settingsMatch = parameters.match(/\s*Steps:\s*\d+/i);
  const settingsIndex = settingsMatch ? settingsMatch.index : -1;
  
  // Isola a parte do texto (tudo antes dos Steps)
  // Usando const para evitar erro do ESLint
  const promptText = settingsIndex !== -1 
    ? parameters.substring(0, settingsIndex).trim() 
    : parameters;

  // 2. Procura pelo divisor "Negative prompt:" dentro da parte de texto
  // O regex pega "Negative prompt:" mesmo que não tenha quebra de linha antes
  const negativeMatch = promptText.match(/Negative prompt:/i);
  
  let positivePrompt = '';
  let negativePrompt = '';

  if (negativeMatch && negativeMatch.index !== undefined) {
    positivePrompt = promptText.substring(0, negativeMatch.index).trim();
    negativePrompt = promptText.substring(negativeMatch.index + negativeMatch[0].length).trim();
  } else {
    positivePrompt = promptText.trim();
  }

  return { positivePrompt, negativePrompt };
}

function extractSteps(parameters: string): number | undefined {
  const match = parameters.match(/Steps:\s*(\d+)/i);
  return match ? parseInt(match[1]) : undefined;
}

function extractSampler(parameters: string): string | undefined {
  const match = parameters.match(/Sampler:\s*([^,\n]+)/i);
  return match ? match[1].trim() : undefined;
}

// Função nova para extrair Schedule type
function extractScheduleType(parameters: string): string | undefined {
  const match = parameters.match(/Schedule type:\s*([^,\n]+)/i);
  return match ? match[1].trim() : undefined;
}

function extractCFGScale(parameters: string): number | undefined {
  const match = parameters.match(/CFG scale:\s*([\d.]+)/i);
  return match ? parseFloat(match[1]) : undefined;
}

function extractSeed(parameters: string): number | undefined {
  const match = parameters.match(/Seed:\s*(\d+)/i);
  return match ? parseInt(match[1]) : undefined;
}

function extractSize(parameters: string): string | undefined {
  const match = parameters.match(/Size:\s*([^,\n]+)/i);
  return match ? match[1].trim() : undefined;
}

function extractModelHash(parameters: string): string | undefined {
  const match = parameters.match(/Model hash:\s*([a-f0-9]+)/i);
  return match ? match[1] : undefined;
}

function extractModel(parameters: string): string | undefined {
  const match = parameters.match(/Model:\s*([^,\n]+)/i);
  return match ? match[1].trim() : undefined;
}

function extractDenoising(parameters: string): number | undefined {
  const match = parameters.match(/Denoising strength:\s*([\d.]+)/i);
  return match ? parseFloat(match[1]) : undefined;
}

function extractClipSkip(parameters: string): number | undefined {
  const match = parameters.match(/Clip skip:\s*(\d+)/i);
  return match ? parseInt(match[1]) : undefined;
}

function extractLoRAs(parameters: string): (string | LoRAInfo)[] {
  return extractLoRAsWithWeights(parameters);
}

function extractEmbeddings(parameters: string): string[] {
  const embeddingMatches = parameters.matchAll(/\b([A-Z][a-zA-Z0-9_]*)\b/g);
  const commonWords = new Set([
    'Steps', 'Sampler', 'CFG', 'Seed', 'Size', 'Model', 'Hash', 
    'Denoising', 'Clip', 'Negative', 'Prompt', 'Forge', 'Gradio', 
    'Schedule', 'Type', 'Hires', 'Upscale', 'Upscaler', 'Version'
  ]);
  return Array.from(embeddingMatches, match => match[1])
    .filter(word => !commonWords.has(word) && word.length > 2);
}

function extractHiresUpscaler(parameters: string): string | undefined {
  const match = parameters.match(/Hires upscaler:\s*([^,\n]+)/i);
  return match ? match[1].trim() : undefined;
}

function extractHiresUpscale(parameters: string): number | undefined {
  const match = parameters.match(/Hires upscale:\s*([\d.]+)/i);
  return match ? parseFloat(match[1]) : undefined;
}

function extractHiresSteps(parameters: string): number | undefined {
  const match = parameters.match(/Hires steps:\s*(\d+)/i);
  return match ? parseInt(match[1]) : undefined;
}

function extractHiresDenoising(parameters: string): number | undefined {
  const match = parameters.match(/Hires denoising:\s*([\d.]+)/i);
  return match ? parseFloat(match[1]) : undefined;
}