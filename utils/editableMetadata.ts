import type {
  BaseMetadata,
  EditableMetadataFields,
  LoRAInfo,
  MetadataClipboardPayload,
  ShadowMetadata,
  ShadowResource,
} from '../types';

type BaseMetadataWithNotes = BaseMetadata & {
  notes?: string;
  tags?: string[];
  clip_skip?: number;
  _metahub_pro?: {
    notes?: string;
  } | null;
};

const DEFAULT_BASE_METADATA: BaseMetadata = {
  prompt: '',
  model: '',
  width: 0,
  height: 0,
  steps: 0,
  scheduler: '',
};

const coerceFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
};

const toResourceName = (lora: string | LoRAInfo): string => {
  if (typeof lora === 'string') {
    return lora;
  }

  return lora.name || lora.model_name || 'Unknown resource';
};

const toResourceWeight = (lora: string | LoRAInfo): number | undefined => {
  if (typeof lora === 'string') {
    return undefined;
  }

  return coerceFiniteNumber(lora.weight ?? lora.model_weight ?? lora.clip_weight);
};

export const buildResourcesFromMetadata = (metadata?: BaseMetadata | null): ShadowResource[] => {
  if (!metadata) {
    return [];
  }

  const resources: ShadowResource[] = [];

  if (metadata.model) {
    resources.push({
      id: crypto.randomUUID(),
      type: 'model',
      name: metadata.model,
    });
  }

  for (const lora of metadata.loras ?? []) {
    resources.push({
      id: crypto.randomUUID(),
      type: 'lora',
      name: toResourceName(lora),
      weight: toResourceWeight(lora),
    });
  }

  return resources;
};

export const sanitizeEditableMetadataFields = (
  fields?: Partial<EditableMetadataFields> | null,
): EditableMetadataFields => {
  if (!fields) {
    return {};
  }

  const resources = Array.isArray(fields.resources)
    ? fields.resources
        .map((resource) => {
          const name = typeof resource?.name === 'string' ? resource.name.trim() : '';
          if (!name) {
            return null;
          }

          const type = resource.type === 'embedding' || resource.type === 'model' ? resource.type : 'lora';
          const weight = coerceFiniteNumber(resource.weight);

          return {
            id: resource.id || crypto.randomUUID(),
            type,
            name,
            ...(weight !== undefined ? { weight } : {}),
          } satisfies ShadowResource;
        })
        .filter((resource): resource is ShadowResource => Boolean(resource))
    : undefined;

  const prompt = typeof fields.prompt === 'string' ? fields.prompt : undefined;
  const negativePrompt = typeof fields.negativePrompt === 'string' ? fields.negativePrompt : undefined;
  const model = typeof fields.model === 'string' && fields.model.trim() ? fields.model.trim() : undefined;
  const sampler = typeof fields.sampler === 'string' && fields.sampler.trim() ? fields.sampler.trim() : undefined;
  const scheduler = typeof fields.scheduler === 'string' && fields.scheduler.trim() ? fields.scheduler.trim() : undefined;
  const notes = typeof fields.notes === 'string' ? fields.notes : undefined;
  const generator = typeof fields.generator === 'string' && fields.generator.trim() ? fields.generator.trim() : undefined;
  const version = typeof fields.version === 'string' && fields.version.trim() ? fields.version.trim() : undefined;
  const module = typeof fields.module === 'string' && fields.module.trim() ? fields.module.trim() : undefined;
  const tags = Array.isArray(fields.tags)
    ? fields.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : undefined;

  return {
    ...(prompt !== undefined ? { prompt } : {}),
    ...(negativePrompt !== undefined ? { negativePrompt } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(coerceFiniteNumber(fields.seed) !== undefined ? { seed: coerceFiniteNumber(fields.seed) } : {}),
    ...(coerceFiniteNumber(fields.steps) !== undefined ? { steps: coerceFiniteNumber(fields.steps) } : {}),
    ...(coerceFiniteNumber(fields.cfg_scale) !== undefined ? { cfg_scale: coerceFiniteNumber(fields.cfg_scale) } : {}),
    ...(coerceFiniteNumber(fields.clip_skip) !== undefined ? { clip_skip: coerceFiniteNumber(fields.clip_skip) } : {}),
    ...(sampler !== undefined ? { sampler } : {}),
    ...(scheduler !== undefined ? { scheduler } : {}),
    ...(generator !== undefined ? { generator } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(module !== undefined ? { module } : {}),
    ...(coerceFiniteNumber(fields.width) !== undefined ? { width: coerceFiniteNumber(fields.width) } : {}),
    ...(coerceFiniteNumber(fields.height) !== undefined ? { height: coerceFiniteNumber(fields.height) } : {}),
    ...(coerceFiniteNumber(fields.duration) !== undefined ? { duration: coerceFiniteNumber(fields.duration) } : {}),
    ...(resources && resources.length > 0 ? { resources } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
};

const getMetadataNotes = (metadata?: BaseMetadata | null): string | undefined => {
  if (!metadata) {
    return undefined;
  }

  const meta = metadata as BaseMetadataWithNotes;
  return meta.notes ?? meta._metahub_pro?.notes;
};

const getShadowModel = (shadow?: ShadowMetadata | null): string | undefined =>
  shadow?.model ?? shadow?.resources?.find((resource) => resource.type === 'model')?.name;

const getShadowLoraResources = (shadow?: ShadowMetadata | null): ShadowResource[] | undefined => {
  if (!shadow?.resources?.length) {
    return undefined;
  }

  return shadow.resources.filter((resource) => resource.type !== 'model');
};

export const getEditableMetadataFields = (
  metadata?: BaseMetadata | null,
  shadowMetadata?: ShadowMetadata | null,
): EditableMetadataFields => {
  const shadowResources = shadowMetadata?.resources;
  const baseResources = buildResourcesFromMetadata(metadata);

  return sanitizeEditableMetadataFields({
    prompt: shadowMetadata?.prompt ?? metadata?.prompt,
    negativePrompt: shadowMetadata?.negativePrompt ?? metadata?.negativePrompt,
    model: getShadowModel(shadowMetadata) ?? metadata?.model,
    seed: shadowMetadata?.seed ?? metadata?.seed,
    steps: shadowMetadata?.steps ?? metadata?.steps,
    cfg_scale: shadowMetadata?.cfg_scale ?? metadata?.cfg_scale,
    clip_skip: shadowMetadata?.clip_skip ?? (metadata as BaseMetadataWithNotes | undefined)?.clip_skip,
    sampler: shadowMetadata?.sampler ?? metadata?.sampler,
    scheduler: shadowMetadata?.scheduler ?? metadata?.scheduler,
    generator: shadowMetadata?.generator ?? metadata?.generator,
    version: shadowMetadata?.version ?? metadata?.version,
    module: shadowMetadata?.module ?? metadata?.module,
    width: shadowMetadata?.width ?? metadata?.width,
    height: shadowMetadata?.height ?? metadata?.height,
    duration: shadowMetadata?.duration,
    resources: shadowResources && shadowResources.length > 0 ? shadowResources : baseResources,
    tags: shadowMetadata?.tags ?? (metadata as BaseMetadataWithNotes | undefined)?.tags,
    notes: shadowMetadata?.notes ?? getMetadataNotes(metadata),
  });
};

const mapResourcesToLoras = (resources?: ShadowResource[]): Array<string | LoRAInfo> | undefined => {
  if (!resources?.length) {
    return undefined;
  }

  const loras = resources
    .filter((resource) => resource.type !== 'model')
    .map((resource) => (
      resource.weight !== undefined
        ? { name: resource.name, weight: resource.weight }
        : resource.name
    ));

  return loras.length > 0 ? loras : [];
};

export const buildEffectiveMetadata = (
  metadata?: BaseMetadata | null,
  shadowMetadata?: ShadowMetadata | null,
  showOriginal = false,
): BaseMetadata | undefined => {
  if (showOriginal) {
    return metadata ?? undefined;
  }

  if (!metadata && !shadowMetadata) {
    return undefined;
  }

  const editable = getEditableMetadataFields(metadata, shadowMetadata);
  const base: BaseMetadata = metadata ? { ...metadata } : { ...DEFAULT_BASE_METADATA };
  const shadowModel = getShadowModel(shadowMetadata);
  const shadowLoras = getShadowLoraResources(shadowMetadata);

  const nextMetadata: BaseMetadataWithNotes = {
    ...base,
    prompt: editable.prompt ?? base.prompt,
    negativePrompt: editable.negativePrompt ?? base.negativePrompt,
    model: shadowModel ?? editable.model ?? base.model,
    width: editable.width ?? base.width,
    height: editable.height ?? base.height,
    seed: editable.seed ?? base.seed,
    steps: editable.steps ?? base.steps,
    cfg_scale: editable.cfg_scale ?? base.cfg_scale,
    clip_skip: editable.clip_skip ?? (base as BaseMetadataWithNotes).clip_skip,
    sampler: editable.sampler ?? base.sampler,
    scheduler: editable.scheduler ?? base.scheduler,
    generator: editable.generator ?? base.generator,
    version: editable.version ?? base.version,
    module: editable.module ?? base.module,
    tags: editable.tags ?? (base as BaseMetadataWithNotes).tags,
    notes: editable.notes ?? getMetadataNotes(base),
  };

  if (nextMetadata.model) {
    nextMetadata.models = [nextMetadata.model];
  }

  if (shadowMetadata?.resources) {
    nextMetadata.loras = mapResourcesToLoras(shadowLoras);
  }

  return nextMetadata;
};

export const buildShadowMetadata = (
  imageId: string,
  fields: Partial<EditableMetadataFields>,
): ShadowMetadata => ({
  imageId,
  ...sanitizeEditableMetadataFields(fields),
  updatedAt: Date.now(),
});

export const buildMetadataClipboardPayload = (
  imageId: string | null | undefined,
  fields: Partial<EditableMetadataFields>,
): MetadataClipboardPayload => ({
  schemaVersion: 1,
  copiedAt: Date.now(),
  sourceImageId: imageId ?? null,
  metadata: sanitizeEditableMetadataFields(fields),
});
