/**
 * ComfyUI Formatter
 * Converts BaseMetadata to ComfyUI workflow JSON format for clipboard copying
 */

import { BaseMetadata } from '../types';
import { ComfyUIApiClient } from '../services/comfyUIApiClient';

/**
 * Format metadata as ComfyUI workflow JSON
 * User can copy this and use "Load" in ComfyUI to import it
 */
export function formatMetadataForComfyUI(metadata: BaseMetadata): string {
  // Create a temporary client to use the workflow builder
  const client = new ComfyUIApiClient({ serverUrl: 'http://localhost:8188' });
  const workflow = client.buildWorkflowFromMetadata(metadata);

  // Return formatted JSON for clipboard
  return JSON.stringify(workflow, null, 2);
}

/**
 * Format metadata as human-readable text (alternative clipboard format)
 * Similar to A1111 three-line format but for ComfyUI
 */
export function formatMetadataAsText(metadata: BaseMetadata): string {
  const lines: string[] = [];

  // Positive prompt
  if (metadata.prompt) {
    lines.push(metadata.prompt);
  }

  // Negative prompt
  if (metadata.negativePrompt) {
    lines.push(`Negative prompt: ${metadata.negativePrompt}`);
  }

  // Parameters line
  const params: string[] = [];

  if (metadata.steps) {
    params.push(`Steps: ${metadata.steps}`);
  }

  if (metadata.sampler) {
    params.push(`Sampler: ${metadata.sampler}`);
  }

  if (metadata.scheduler) {
    params.push(`Scheduler: ${metadata.scheduler}`);
  }

  const cfgScale = (metadata as any).cfgScale || metadata.cfg_scale;
  if (cfgScale) {
    params.push(`CFG scale: ${cfgScale}`);
  }

  if (metadata.seed !== undefined) {
    params.push(`Seed: ${metadata.seed}`);
  }

  if (metadata.width && metadata.height) {
    params.push(`Size: ${metadata.width}x${metadata.height}`);
  }

  if (metadata.model) {
    params.push(`Model: ${metadata.model}`);
  }

  if (params.length > 0) {
    lines.push(params.join(', '));
  }

  return lines.join('\n');
}
