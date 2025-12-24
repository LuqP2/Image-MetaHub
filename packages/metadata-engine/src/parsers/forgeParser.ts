import { ForgeMetadata, isForgeMetadata, BaseMetadata } from '../core/types';

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

  // Extract basic parameters using regex patterns similar to A1111
  const steps = extractSteps(parameters);
  const sampler = extractSampler(parameters);
  const cfgScale = extractCFGScale(parameters);
  const seed = extractSeed(parameters);
  const size = extractSize(parameters);
  const modelHash = extractModelHash(parameters);
  const model = extractModel(parameters);
  const denoising = extractDenoising(parameters);
  const clipSkip = extractClipSkip(parameters);

  // Extract prompts (positive and negative)
  const { positivePrompt, negativePrompt } = extractPrompts(parameters);

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
    scheduler: sampler || '',
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

// Helper functions for parameter extraction (similar to A1111 but with Forge-specific patterns)

function extractSteps(parameters: string): number | undefined {
  const match = parameters.match(/Steps:\s*(\d+)/i);
  return match ? parseInt(match[1]) : undefined;
}

function extractSampler(parameters: string): string | undefined {
  const match = parameters.match(/Sampler:\s*([^,\n]+)/i);
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

function extractPrompts(parameters: string): { positivePrompt: string; negativePrompt: string } {
    // Split by common separators used in A1111/Forge
  const parts = parameters.split(/\n\n|\nNegative prompt:/i);

  let positivePrompt = '';
  let negativePrompt = '';

  if (parts.length >= 2) {
    positivePrompt = parts[0].trim();
    negativePrompt = parts[1].trim();
  } else {
    // Fallback: look for "Negative prompt:" within the text
    const negMatch = parameters.match(/Negative prompt:\s*(.+)$/i);
    if (negMatch) {
      positivePrompt = parameters.substring(0, negMatch.index).trim();
      negativePrompt = negMatch[1].trim();
    } else {
      positivePrompt = parameters.trim();
    }
  }  return { positivePrompt, negativePrompt };
}

function extractLoRAs(parameters: string): string[] {
  const loraMatches = parameters.matchAll(/<lora:([^:>]+):[^>]*>/gi);
  return Array.from(loraMatches, match => match[1]);
}

function extractEmbeddings(parameters: string): string[] {
  const embeddingMatches = parameters.matchAll(/\b([A-Z][a-zA-Z0-9_]*)\b/g);
  // Filter for likely embeddings (capitalized words that aren't common parameters)
  const commonWords = new Set(['Steps', 'Sampler', 'CFG', 'Seed', 'Size', 'Model', 'Hash', 'Denoising', 'Clip', 'Negative', 'Prompt', 'Forge', 'Gradio']);
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