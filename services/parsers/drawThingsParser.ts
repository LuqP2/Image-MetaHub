import { DrawThingsMetadata, BaseMetadata } from '../../types';

/**
 * Draw Things Parser - Handles Draw Things (iOS/Mac AI app) metadata
 * Draw Things uses SD-like format similar to A1111/DreamStudio
 * Supports PNG embedded parameters with mobile-specific fields
 */

export function parseDrawThingsMetadata(parameters: string): BaseMetadata {
  const result: Partial<BaseMetadata> = {};

  console.log('📱 Parsing Draw Things metadata...');

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

  // Extract Draw Things specific parameters
  const deviceModel = extractDeviceModel(parameters);
  const appVersion = extractAppVersion(parameters);

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

  console.log('✅ Draw Things parsing successful:', {
    prompt: positivePrompt?.substring(0, 50) + '...',
    model,
    deviceModel,
    appVersion
  });

  // Build normalized metadata
  const normalizedResult: BaseMetadata = {
    prompt: positivePrompt || '',
    negativePrompt: negativePrompt || '',
    model: model || 'Draw Things',
    models: model ? [model] : ['Draw Things'],
    width: width || 0,
    height: height || 0,
    seed: seed ? parseInt(seed, 10) : undefined,
    steps: steps ? parseInt(steps, 10) : 0,
    cfg_scale: cfgScale ? parseFloat(cfgScale) : undefined,
    scheduler: 'Draw Things',
    sampler: sampler || 'Draw Things',
    loras: loras || [],
    tags: generateTags(parameters, deviceModel),
  };

  return normalizedResult;
}

// Extract prompts from Draw Things format (similar to A1111)
function extractPrompts(parameters: string): { positivePrompt: string; negativePrompt: string } {
  let positivePrompt = '';
  let negativePrompt = '';

  // Split by newlines and look for prompt patterns
  const lines = parameters.split('\n').map(line => line.trim());

  for (const line of lines) {
    if (line.startsWith('Prompt:') || line.startsWith('prompt:')) {
      positivePrompt = line.substring(line.indexOf(':') + 1).trim();
    } else if (line.startsWith('Negative prompt:') || line.startsWith('negative prompt:') || line.startsWith('Negative Prompt:')) {
      negativePrompt = line.substring(line.indexOf(':') + 1).trim();
    }
  }

  // Fallback: if no explicit prompts found, use the first line as prompt
  if (!positivePrompt && lines.length > 0) {
    positivePrompt = lines[0];
  }

  return { positivePrompt, negativePrompt };
}

// Extract steps
function extractSteps(parameters: string): string | null {
  const match = parameters.match(/Steps:\s*(\d+)/i);
  return match ? match[1] : null;
}

// Extract sampler
function extractSampler(parameters: string): string | null {
  const match = parameters.match(/Sampler:\s*([^,\n]+)/i);
  return match ? match[1].trim() : null;
}

// Extract CFG scale
function extractCFGScale(parameters: string): string | null {
  const match = parameters.match(/CFG scale:\s*([\d.]+)/i);
  return match ? match[1] : null;
}

// Extract seed
function extractSeed(parameters: string): string | null {
  const match = parameters.match(/Seed:\s*(\d+)/i);
  return match ? match[1] : null;
}

// Extract size
function extractSize(parameters: string): string | null {
  const match = parameters.match(/Size:\s*([^,\n]+)/i);
  return match ? match[1].trim() : null;
}

// Extract model
function extractModel(parameters: string): string | null {
  const match = parameters.match(/Model:\s*([^,\n]+)/i);
  return match ? match[1].trim() : null;
}

// Extract device model (mobile-specific)
function extractDeviceModel(parameters: string): string | null {
  // Look for iPhone/iPad patterns
  const deviceMatch = parameters.match(/(iPhone|iPad|iPod)\s+[^,\n]*/i);
  if (deviceMatch) {
    return deviceMatch[0].trim();
  }

  // Look for device model in other formats
  const modelMatch = parameters.match(/Device:\s*([^,\n]+)/i);
  return modelMatch ? modelMatch[1].trim() : null;
}

// Extract app version
function extractAppVersion(parameters: string): string | null {
  const match = parameters.match(/Version:\s*([^,\n]+)/i);
  return match ? match[1].trim() : null;
}

// Extract LoRAs (if present)
function extractLoRAs(parameters: string): string[] {
  const loras: string[] = [];
  // Draw Things may support LoRAs in the future, but currently not common
  return loras;
}

// Extract embeddings (if present)
function extractEmbeddings(parameters: string): string[] {
  const embeddings: string[] = [];
  // Look for embedding patterns (e.g., <embedding:name>)
  const embeddingMatches = parameters.matchAll(/<([^>]+)>/g);
  for (const match of Array.from(embeddingMatches)) {
    embeddings.push(match[1]);
  }
  return embeddings;
}

// Generate tags for BI Pro mobile workflow analysis
function generateTags(parameters: string, deviceModel?: string | null): string[] {
  const tags: string[] = ['AI Generated', 'Draw Things', 'Mobile AI'];

  // Add device-specific tags
  if (deviceModel) {
    if (deviceModel.includes('iPhone')) {
      tags.push('iPhone', 'iOS');
    } else if (deviceModel.includes('iPad')) {
      tags.push('iPad', 'iOS');
    } else if (deviceModel.includes('iPod')) {
      tags.push('iPod', 'iOS');
    }
  }

  // Add content-based tags
  const prompt = parameters.toLowerCase();
  if (prompt.includes('photo') || prompt.includes('photograph')) {
    tags.push('Photography');
  }
  if (prompt.includes('art') || prompt.includes('painting')) {
    tags.push('Artwork');
  }
  if (prompt.includes('portrait')) {
    tags.push('Portrait');
  }
  if (prompt.includes('landscape')) {
    tags.push('Landscape');
  }

  // Add generation parameter tags
  if (parameters.includes('Steps:')) {
    const stepsMatch = parameters.match(/Steps:\s*(\d+)/i);
    if (stepsMatch) {
      const steps = parseInt(stepsMatch[1]);
      if (steps > 50) {
        tags.push('High Quality');
      } else if (steps < 20) {
        tags.push('Fast Generation');
      }
    }
  }

  return tags;
}