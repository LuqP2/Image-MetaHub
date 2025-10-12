import { MidjourneyMetadata, BaseMetadata } from '../../types';

// --- Extraction Functions ---

export function extractModelsFromMidjourney(metadata: MidjourneyMetadata): string[] {
  // Midjourney doesn't typically specify model names in metadata
  // But we can extract version info
  const params = metadata.parameters;
  const versionMatch = params.match(/--v\s+(\d+)/);
  if (versionMatch) {
    return [`Midjourney v${versionMatch[1]}`];
  }
  if (params.includes('Midjourney')) {
    return ['Midjourney'];
  }
  return [];
}

export function extractLorasFromMidjourney(metadata: MidjourneyMetadata): string[] {
  // Midjourney doesn't use LoRAs in the traditional sense
  return [];
}

// --- Main Parser Function ---

export function parseMidjourneyMetadata(parameters: string): BaseMetadata {
  const result: Partial<BaseMetadata> = {};

  // Extract prompt - everything before the first parameter flag
  const promptMatch = parameters.match(/^(.+?)(?:\s+--|\s*$)/);
  if (promptMatch) {
    let prompt = promptMatch[1].trim();
    // Remove "Prompt:" prefix if present
    prompt = prompt.replace(/^Prompt:\s*/i, '');
    result.prompt = prompt;
  }

  // Extract version (model indicator)
  const versionMatch = parameters.match(/--v\s+(\d+)/);
  if (versionMatch) {
    result.model = `Midjourney v${versionMatch[1]}`;
  } else if (parameters.includes('Midjourney')) {
    result.model = 'Midjourney';
  }

  // Extract aspect ratio and calculate dimensions
  const aspectRatioMatch = parameters.match(/--ar\s+(\d+):(\d+)/);
  if (aspectRatioMatch) {
    const widthRatio = parseInt(aspectRatioMatch[1]);
    const heightRatio = parseInt(aspectRatioMatch[2]);
    // Midjourney default base size is 1024, but we'll use ratios
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const divisor = gcd(widthRatio, heightRatio);
    const normalizedWidth = widthRatio / divisor;
    const normalizedHeight = heightRatio / divisor;

    // Scale to reasonable dimensions (Midjourney uses various sizes)
    const scale = Math.min(1024 / Math.max(normalizedWidth, normalizedHeight), 1);
    result.width = Math.round(normalizedWidth * scale);
    result.height = Math.round(normalizedHeight * scale);
  }

  // Extract seed if present
  const seedMatch = parameters.match(/--seed\s+(\d+)/);
  if (seedMatch) {
    result.seed = parseInt(seedMatch[1], 10);
  }

  // Extract quality (can be used as CFG scale approximation)
  const qualityMatch = parameters.match(/--q\s+([\d.]+)/);
  if (qualityMatch) {
    result.cfg_scale = parseFloat(qualityMatch[1]);
  }

  // Extract stylize (can be used as steps approximation)
  const stylizeMatch = parameters.match(/--s\s+(\d+)/);
  if (stylizeMatch) {
    result.steps = parseInt(stylizeMatch[1], 10);
  }

  // Midjourney uses different samplers, but we can set a default
  result.sampler = 'Midjourney';

  // Extract arrays
  result.models = result.model ? [result.model] : [];
  result.loras = extractLorasFromMidjourney({ parameters });

  return result as BaseMetadata;
}