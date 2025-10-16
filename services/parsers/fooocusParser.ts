import { FooocusMetadata, BaseMetadata } from '../../types';

/**
 * Fooocus Parser - Handles Fooocus metadata (SDXL or Flux backend)
 * Fooocus uses SD-like parameter format with some unique fields
 */

export function parseFooocusMetadata(metadata: FooocusMetadata): BaseMetadata | null {
  if (!metadata.parameters) {
    return null;
  }

  const params = metadata.parameters;

  // Check if this is actually Fooocus metadata
  if (!isFooocusMetadata(params)) {
    return null;
  }

  try {
    // Extract prompt (everything before "Negative prompt:" or first parameter)
    const promptMatch = params.match(/^([\s\S]*?)(?=Negative prompt:|Steps:|Sampler:|$)/i);
    const prompt = promptMatch ? promptMatch[1].trim() : '';

    // Extract negative prompt
    const negativePromptMatch = params.match(/Negative prompt:\s*([\s\S]*?)(?=Steps:|Sampler:|$)/i);
    const negativePrompt = negativePromptMatch ? negativePromptMatch[1].trim() : '';

    // Extract parameters using regex
    const steps = parseInt(params.match(/Steps:\s*(\d+)/i)?.[1] || '0');
    const sampler = params.match(/Sampler:\s*([A-Za-z0-9+ -]+)/i)?.[1] || '';
    const scheduler = params.match(/Scheduler:\s*([A-Za-z0-9+ -]+)/i)?.[1] ||
                     params.match(/Schedule type:\s*([A-Za-z0-9+ -]+)/i)?.[1] || '';
    const cfgScale = parseFloat(params.match(/CFG scale:\s*([\d.]+)/i)?.[1] ||
                              params.match(/Guidance scale:\s*([\d.]+)/i)?.[1] || '0');
    const seed = parseInt(params.match(/Seed:\s*(\d+)/i)?.[1] || '0');

    // Extract model
    const model = params.match(/Model:\s*([A-Za-z0-9_.-]+)/i)?.[1] || '';

    // Extract dimensions
    const sizeMatch = params.match(/Size:\s*(\d+)x(\d+)/i);
    const width = sizeMatch ? parseInt(sizeMatch[1]) : 0;
    const height = sizeMatch ? parseInt(sizeMatch[2]) : 0;

    // Extract LoRAs
    const loras: string[] = [];
    const loraMatches = [...params.matchAll(/<lora:([^:>]+):?([\d.]*)>/gi)];
    for (const match of loraMatches) {
      loras.push(match[2] ? `${match[1]}:${match[2]}` : match[1]);
    }

    // Extract LoRA hashes if present
    const loraHashBlock = params.match(/Lora hashes:\s*"([^"]+)"/i)?.[1];
    if (loraHashBlock) {
      const pairs = loraHashBlock.split(',');
      for (const pair of pairs) {
        const [name] = pair.split(':').map(s => s.trim());
        if (name && !loras.includes(name)) {
          loras.push(name);
        }
      }
    }

    const result = {
      prompt,
      negativePrompt,
      model: model || 'Fooocus',
      models: model ? [model] : ['Fooocus'],
      width,
      height,
      seed: seed || undefined,
      steps,
      cfg_scale: cfgScale || undefined,
      scheduler,
      sampler: sampler + (scheduler ? ` (${scheduler})` : ''),
      loras,
      generator: 'Fooocus',
    };
    
    return result;

  } catch {
    return null;
  }
}

function isFooocusMetadata(params: string): boolean {
  if (!params) return false;

  // Heuristics to detect Fooocus format
  return (
    /Fooocus/i.test(params) ||
    /Version:\s*f2\./i.test(params) ||
    /Model:\s*flux/i.test(params) ||
    /Distilled CFG Scale/i.test(params) ||
    /Module\s*1:\s*ae/i.test(params) ||
    (/Sampler:\s*[A-Za-z0-9+]/i.test(params) && /Steps:\s*\d+/i.test(params))
  );
}
