import { BaseMetadata } from '../types';

/**
 * Formats metadata into A1111-compatible string format that can be pasted
 * into the A1111 prompt box and parsed using the "Read generation parameters" button.
 *
 * Format:
 * Line 1: Positive prompt
 * Line 2: Negative prompt: [text] (if exists)
 * Line 3: Steps: X, Sampler: Y, CFG scale: Z, Seed: N, Size: WxH, Model: name
 */
export function formatMetadataForA1111(metadata: BaseMetadata): string {
  if (!metadata) {
    throw new Error('Metadata is required');
  }

  const lines: string[] = [];

  // Line 1: Positive prompt (required)
  const prompt = metadata.prompt?.trim();
  if (!prompt) {
    throw new Error('Prompt is required');
  }
  lines.push(prompt);

  // Line 2: Negative prompt (optional)
  const negativePrompt = metadata.negativePrompt?.trim();
  if (negativePrompt) {
    lines.push(`Negative prompt: ${negativePrompt}`);
  }

  // Line 3: Parameters (comma-separated)
  const params: string[] = [];

  // Steps
  if (metadata.steps !== undefined && metadata.steps !== null) {
    params.push(`Steps: ${metadata.steps}`);
  }

  // Sampler - combine sampler and scheduler if both exist
  const sampler = metadata.sampler || metadata.scheduler;
  if (sampler) {
    params.push(`Sampler: ${sampler}`);
  }

  // CFG Scale - handle both cfg_scale and cfgScale
  const cfgScale = metadata.cfg_scale || (metadata as any).cfgScale;
  if (cfgScale !== undefined && cfgScale !== null) {
    params.push(`CFG scale: ${cfgScale}`);
  }

  // Seed
  if (metadata.seed !== undefined && metadata.seed !== null) {
    // Use -1 for random seed if not specified
    const seed = metadata.seed === -1 ? -1 : metadata.seed;
    params.push(`Seed: ${seed}`);
  }

  // Size (WIDTHxHEIGHT)
  if (metadata.width && metadata.height) {
    params.push(`Size: ${metadata.width}x${metadata.height}`);
  }

  // Model
  if (metadata.model) {
    params.push(`Model: ${metadata.model}`);
  }

  // Join parameters with ", " and add to lines
  if (params.length > 0) {
    lines.push(params.join(', '));
  }

  return lines.join('\n');
}
