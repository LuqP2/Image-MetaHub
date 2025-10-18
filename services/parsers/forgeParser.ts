import { ForgeMetadata, isForgeMetadata, BaseMetadata } from '../../types';

/**
 * Forge Parser - Handles Forge (A1111-based) metadata
 * Forge is based on Stable Diffusion WebUI (A1111) but with additional features
 * Reuses A1111 parsing logic since Forge maintains compatibility
 */

/**
 * @function parseForgeMetadata
 * @description Parses Forge (A1111-based) metadata.
 * @param {any} metadata - The metadata to parse.
 * @returns {BaseMetadata | null} - The parsed metadata or null if not a Forge image.
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

/**
 * @function extractSteps
 * @description Extracts the number of steps from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {number | undefined} - The extracted steps or undefined if not found.
 */
function extractSteps(parameters: string): number | undefined {
  const match = parameters.match(/Steps:\s*(\d+)/i);
  return match ? parseInt(match[1]) : undefined;
}

/**
 * @function extractSampler
 * @description Extracts the sampler name from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {string | undefined} - The extracted sampler name or undefined if not found.
 */
function extractSampler(parameters: string): string | undefined {
  const match = parameters.match(/Sampler:\s*([^,\n]+)/i);
  return match ? match[1].trim() : undefined;
}

/**
 * @function extractCFGScale
 * @description Extracts the CFG scale from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {number | undefined} - The extracted CFG scale or undefined if not found.
 */
function extractCFGScale(parameters: string): number | undefined {
  const match = parameters.match(/CFG scale:\s*([\d.]+)/i);
  return match ? parseFloat(match[1]) : undefined;
}

/**
 * @function extractSeed
 * @description Extracts the seed from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {number | undefined} - The extracted seed or undefined if not found.
 */
function extractSeed(parameters: string): number | undefined {
  const match = parameters.match(/Seed:\s*(\d+)/i);
  return match ? parseInt(match[1]) : undefined;
}

/**
 * @function extractSize
 * @description Extracts the image size from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {string | undefined} - The extracted size or undefined if not found.
 */
function extractSize(parameters: string): string | undefined {
  const match = parameters.match(/Size:\s*([^,\n]+)/i);
  return match ? match[1].trim() : undefined;
}

/**
 * @function extractModelHash
 * @description Extracts the model hash from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {string | undefined} - The extracted model hash or undefined if not found.
 */
function extractModelHash(parameters: string): string | undefined {
  const match = parameters.match(/Model hash:\s*([a-f0-9]+)/i);
  return match ? match[1] : undefined;
}

/**
 * @function extractModel
 * @description Extracts the model name from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {string | undefined} - The extracted model name or undefined if not found.
 */
function extractModel(parameters: string): string | undefined {
  const match = parameters.match(/Model:\s*([^,\n]+)/i);
  return match ? match[1].trim() : undefined;
}

/**
 * @function extractDenoising
 * @description Extracts the denoising strength from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {number | undefined} - The extracted denoising strength or undefined if not found.
 */
function extractDenoising(parameters: string): number | undefined {
  const match = parameters.match(/Denoising strength:\s*([\d.]+)/i);
  return match ? parseFloat(match[1]) : undefined;
}

/**
 * @function extractClipSkip
 * @description Extracts the clip skip value from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {number | undefined} - The extracted clip skip value or undefined if not found.
 */
function extractClipSkip(parameters: string): number | undefined {
  const match = parameters.match(/Clip skip:\s*(\d+)/i);
  return match ? parseInt(match[1]) : undefined;
}

/**
 * @function extractPrompts
 * @description Extracts the positive and negative prompts from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {{ positivePrompt: string; negativePrompt: string }} - The extracted prompts.
 */
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

/**
 * @function extractLoRAs
 * @description Extracts LoRAs from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {string[]} - An array of extracted LoRAs.
 */
function extractLoRAs(parameters: string): string[] {
  const loraMatches = parameters.matchAll(/<lora:([^:>]+):[^>]*>/gi);
  return Array.from(loraMatches, match => match[1]);
}

/**
 * @function extractEmbeddings
 * @description Extracts embeddings from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {string[]} - An array of extracted embeddings.
 */
function extractEmbeddings(parameters: string): string[] {
  const embeddingMatches = parameters.matchAll(/\b([A-Z][a-zA-Z0-9_]*)\b/g);
  // Filter for likely embeddings (capitalized words that aren't common parameters)
  const commonWords = new Set(['Steps', 'Sampler', 'CFG', 'Seed', 'Size', 'Model', 'Hash', 'Denoising', 'Clip', 'Negative', 'Prompt', 'Forge', 'Gradio']);
  return Array.from(embeddingMatches, match => match[1])
    .filter(word => !commonWords.has(word) && word.length > 2);
}

/**
 * @function extractHiresUpscaler
 * @description Extracts the hires upscaler from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {string | undefined} - The extracted hires upscaler or undefined if not found.
 */
function extractHiresUpscaler(parameters: string): string | undefined {
  const match = parameters.match(/Hires upscaler:\s*([^,\n]+)/i);
  return match ? match[1].trim() : undefined;
}

/**
 * @function extractHiresUpscale
 * @description Extracts the hires upscale value from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {number | undefined} - The extracted hires upscale value or undefined if not found.
 */
function extractHiresUpscale(parameters: string): number | undefined {
  const match = parameters.match(/Hires upscale:\s*([\d.]+)/i);
  return match ? parseFloat(match[1]) : undefined;
}

/**
 * @function extractHiresSteps
 * @description Extracts the hires steps from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {number | undefined} - The extracted hires steps or undefined if not found.
 */
function extractHiresSteps(parameters: string): number | undefined {
  const match = parameters.match(/Hires steps:\s*(\d+)/i);
  return match ? parseInt(match[1]) : undefined;
}

/**
 * @function extractHiresDenoising
 * @description Extracts the hires denoising strength from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {number | undefined} - The extracted hires denoising strength or undefined if not found.
 */
function extractHiresDenoising(parameters: string): number | undefined {
  const match = parameters.match(/Hires denoising:\s*([\d.]+)/i);
  return match ? parseFloat(match[1]) : undefined;
}