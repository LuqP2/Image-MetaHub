import { DreamStudioMetadata, isDreamStudioMetadata, BaseMetadata } from '../../types';

/**
 * DreamStudio Parser - Handles DreamStudio (Stability AI) metadata
 * DreamStudio uses A1111-like format but with Stability AI specific indicators
 * Reuses A1111 parsing logic since DreamStudio maintains compatibility
 */

/**
 * @function parseDreamStudioMetadata
 * @description Parses DreamStudio (Stability AI) metadata.
 * @param {any} metadata - The metadata to parse.
 * @returns {BaseMetadata | null} - The parsed metadata or null if not a DreamStudio image.
 */
export function parseDreamStudioMetadata(metadata: any): BaseMetadata | null {
  if (!isDreamStudioMetadata(metadata)) {
    return null;
  }

  const parameters = metadata.parameters as string;

  console.log('🎨 Parsing DreamStudio metadata...');

  // Extract basic parameters using regex patterns similar to A1111
  const steps = extractSteps(parameters);
  const sampler = extractSampler(parameters);
  const cfgScale = extractCFGScale(parameters);
  const seed = extractSeed(parameters);
  const size = extractSize(parameters);
  const model = extractModel(parameters);

  // Extract prompts (positive and negative)
  const { positivePrompt, negativePrompt } = extractPrompts(parameters);

  // Extract LoRAs and embeddings
  const loras = extractLoRAs(parameters);
  const embeddings = extractEmbeddings(parameters);

  // Extract DreamStudio-specific parameters
  const guidanceScale = extractGuidanceScale(parameters);
  const stylePreset = extractStylePreset(parameters);

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

  console.log('✅ DreamStudio parsing successful:', {
    prompt: positivePrompt?.substring(0, 50) + '...',
    model,
    steps,
    width,
    height,
    stylePreset
  });

  return {
    prompt: positivePrompt || '',
    negativePrompt,
    model: model || 'DreamStudio',
    models: model ? [model] : ['DreamStudio'],
    width: width || 512, // Default DreamStudio resolution
    height: height || 512,
    seed,
    steps: steps || 20, // Default DreamStudio steps
    cfg_scale: cfgScale || guidanceScale, // Use guidance scale if CFG not found
    scheduler: sampler || 'K_EULER',
    sampler,
    loras,
    // DreamStudio-specific fields
    stylePreset,
    guidanceScale,
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
 * @function extractGuidanceScale
 * @description Extracts the guidance scale from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {number | undefined} - The extracted guidance scale or undefined if not found.
 */
function extractGuidanceScale(parameters: string): number | undefined {
  const match = parameters.match(/Guidance scale:\s*([\d.]+)/i);
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
 * @function extractStylePreset
 * @description Extracts the style preset from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {string | undefined} - The extracted style preset or undefined if not found.
 */
function extractStylePreset(parameters: string): string | undefined {
  const match = parameters.match(/Style preset:\s*([^,\n]+)/i);
  return match ? match[1].trim() : undefined;
}

/**
 * @function extractPrompts
 * @description Extracts the positive and negative prompts from the parameters string.
 * @param {string} parameters - The parameters string to parse.
 * @returns {{ positivePrompt: string; negativePrompt: string }} - The extracted prompts.
 */
function extractPrompts(parameters: string): { positivePrompt: string; negativePrompt: string } {
  // Split by common separators used in DreamStudio (similar to A1111)
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
  }

  return { positivePrompt, negativePrompt };
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
  const commonWords = new Set(['Steps', 'Sampler', 'CFG', 'Guidance', 'Seed', 'Size', 'Model', 'Style', 'Preset', 'Negative', 'Prompt', 'DreamStudio', 'Stability']);
  return Array.from(embeddingMatches, match => match[1])
    .filter(word => !commonWords.has(word) && word.length > 2);
}