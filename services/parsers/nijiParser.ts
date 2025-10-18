import { NijiMetadata, BaseMetadata } from '../../types';

// --- Extraction Functions ---

export function extractModelsFromNiji(metadata: NijiMetadata): string[] {
  // Niji Journey version extraction
  const params = metadata.parameters;
  const nijiVersionMatch = params.match(/--niji\s+(\d+)/);
  if (nijiVersionMatch) {
    return [`Niji Journey v${nijiVersionMatch[1]}`];
  }
  if (params.includes('--niji')) {
    return ['Niji Journey'];
  }
  return [];
}

export function extractLorasFromNiji(metadata: NijiMetadata): string[] {
  // Niji Journey doesn't use LoRAs in the traditional sense
  return [];
}

// --- Main Parser Function ---

export function parseNijiMetadata(parameters: string): BaseMetadata {
  const result: Partial<BaseMetadata> = {};

  // Extract prompt - everything before the first parameter flag
  const promptMatch = parameters.match(/^(.+?)(?:\s+--|\s*$)/);
  if (promptMatch) {
    let prompt = promptMatch[1].trim();
    // Remove "Prompt:" prefix if present
    prompt = prompt.replace(/^Prompt:\s*/i, '');
    result.prompt = prompt;
  }

  // Extract Niji version (model indicator)
  const nijiVersionMatch = parameters.match(/--niji\s+(\d+)/);
  if (nijiVersionMatch) {
    result.model = `Niji Journey v${nijiVersionMatch[1]}`;
  } else if (parameters.includes('--niji')) {
    result.model = 'Niji Journey';
  }

  // Note: Aspect ratio is available in parameters but actual dimensions come from image file

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

  // Niji Journey uses different samplers, but we can set a default
  result.sampler = 'Niji Journey';

  // Add anime tag for filtering
  result.tags = ['Anime'];

  // Extract arrays
  result.models = result.model ? [result.model] : [];
  result.loras = extractLorasFromNiji({ parameters });

  return result as BaseMetadata;
}