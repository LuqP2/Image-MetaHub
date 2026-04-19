import type { BaseMetadata, LoRAInfo, ShadowResource } from '../types';

export const EMBEDDED_METADATA_SCHEMA = 'imagemetahub.embedded.v1';

export interface EmbeddedImageMetaHubPayload {
  schema: typeof EMBEDDED_METADATA_SCHEMA;
  generator: 'Image MetaHub';
  source: 'file_metadata_editor';
  updatedAt: string;
  metadata: {
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    steps?: number;
    cfg_scale?: number;
    sampler?: string;
    scheduler?: string;
    model?: string;
    width?: number;
    height?: number;
    loras?: Array<string | LoRAInfo>;
    notes?: string;
    resources?: ShadowResource[];
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const cleanString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

export function isEmbeddedMetaHubPayload(value: unknown): value is EmbeddedImageMetaHubPayload {
  return (
    isRecord(value) &&
    value.schema === EMBEDDED_METADATA_SCHEMA &&
    value.generator === 'Image MetaHub' &&
    isRecord(value.metadata)
  );
}

function getCfgValue(metadata: Partial<BaseMetadata> & { cfgScale?: number }): number | undefined {
  return finiteNumber(metadata.cfg_scale) ?? finiteNumber(metadata.cfgScale);
}

export function buildEmbeddedMetaHubPayload(
  metadata: Partial<BaseMetadata> & { cfgScale?: number; resources?: ShadowResource[] },
): EmbeddedImageMetaHubPayload {
  const loras = Array.isArray(metadata.loras) ? metadata.loras : undefined;
  const resources = Array.isArray(metadata.resources) ? metadata.resources : undefined;

  return {
    schema: EMBEDDED_METADATA_SCHEMA,
    generator: 'Image MetaHub',
    source: 'file_metadata_editor',
    updatedAt: new Date().toISOString(),
    metadata: {
      prompt: cleanString(metadata.prompt),
      negativePrompt: cleanString(metadata.negativePrompt),
      seed: finiteNumber(metadata.seed),
      steps: finiteNumber(metadata.steps),
      cfg_scale: getCfgValue(metadata),
      sampler: cleanString(metadata.sampler),
      scheduler: cleanString(metadata.scheduler),
      model: cleanString(metadata.model),
      width: finiteNumber(metadata.width),
      height: finiteNumber(metadata.height),
      loras,
      notes: cleanString(metadata.notes),
      resources,
    },
  };
}

export function parseEmbeddedMetaHubPayload(payload: EmbeddedImageMetaHubPayload): BaseMetadata {
  const metadata = payload.metadata;
  const cfgScale = finiteNumber(metadata.cfg_scale);

  return {
    prompt: metadata.prompt || '',
    negativePrompt: metadata.negativePrompt || '',
    model: metadata.model || '',
    models: metadata.model ? [metadata.model] : [],
    width: finiteNumber(metadata.width) ?? 0,
    height: finiteNumber(metadata.height) ?? 0,
    seed: finiteNumber(metadata.seed),
    steps: finiteNumber(metadata.steps) ?? 0,
    cfg_scale: cfgScale,
    cfgScale,
    sampler: metadata.sampler || '',
    scheduler: metadata.scheduler || '',
    loras: Array.isArray(metadata.loras) ? metadata.loras : [],
    notes: metadata.notes,
    generator: 'Image MetaHub',
    _detection_method: 'imagemetahub_embedded_v1',
  } as BaseMetadata;
}

export function parseEmbeddedMetaHubMetadata(rawMetadata: unknown): BaseMetadata | null {
  const payload = isRecord(rawMetadata) && 'imagemetahub_data' in rawMetadata
    ? rawMetadata.imagemetahub_data
    : rawMetadata;

  return isEmbeddedMetaHubPayload(payload) ? parseEmbeddedMetaHubPayload(payload) : null;
}

export function formatEmbeddedMetaHubParameters(metadata: Partial<BaseMetadata> & { cfgScale?: number }): string {
  const lines: string[] = [];
  const prompt = cleanString(metadata.prompt);
  if (prompt) {
    lines.push(prompt);
  }

  const negativePrompt = cleanString(metadata.negativePrompt);
  if (negativePrompt) {
    lines.push(`Negative prompt: ${negativePrompt}`);
  }

  const params: string[] = [];
  if (metadata.steps !== undefined && metadata.steps !== null) {
    params.push(`Steps: ${metadata.steps}`);
  }
  const sampler = cleanString(metadata.sampler) || cleanString(metadata.scheduler);
  if (sampler) {
    params.push(`Sampler: ${sampler}`);
  }
  const cfgScale = getCfgValue(metadata);
  if (cfgScale !== undefined) {
    params.push(`CFG scale: ${cfgScale}`);
  }
  if (metadata.seed !== undefined && metadata.seed !== null) {
    params.push(`Seed: ${metadata.seed}`);
  }
  if (metadata.width && metadata.height) {
    params.push(`Size: ${metadata.width}x${metadata.height}`);
  }
  const model = cleanString(metadata.model);
  if (model) {
    params.push(`Model: ${model}`);
  }

  if (params.length > 0) {
    lines.push(params.join(', '));
  }

  return lines.join('\n');
}
