import { type BaseMetadata, type ImageAdjustments, type IndexedImage, type LoRAInfo } from '../types';
import { hasImageAdjustments } from './imageEditingService';
import { type ResolvedLineageEntry } from './lineageRegistry';

export type ProvenanceEvidence = 'embedded' | 'sidecar' | 'file' | 'metadata' | 'metahub-operation' | 'inferred';

export interface ProvenanceField {
  label: string;
  value: string;
  evidence: ProvenanceEvidence;
}

export interface ProvenanceRelationship {
  label: 'Source image' | 'Derived image';
  value: string;
  detail?: string;
  evidence: ProvenanceEvidence;
}

export interface ProvenanceOperation {
  kind: 'edit' | 'export';
  tool?: string;
  sourceGenerator?: string;
  sourceImageId?: string;
  editedAt?: string;
  exportedAt?: string;
  recipeSummary?: string;
}

export interface ProvenanceViewModel {
  fileName: string;
  imageId: string;
  lastModified: number | null;
  fileSize: number | null;
  generation: ProvenanceField[];
  relationships: ProvenanceRelationship[];
  operation: ProvenanceOperation | null;
}

export interface ProvenanceViewModelInput {
  image: IndexedImage;
  metadata?: BaseMetadata;
  rawMetadata?: unknown;
  resolvedLineage?: ResolvedLineageEntry | null;
  sourceImage?: IndexedImage | null;
  derivedImages?: IndexedImage[];
}

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const nonBlank = (value: unknown): string | null => (
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
);

const formatLoRA = (lora: string | LoRAInfo): string => {
  if (typeof lora === 'string') return lora;
  const name = lora.name || lora.model_name || 'Unknown LoRA';
  const weight = lora.weight ?? lora.model_weight;
  return weight == null ? name : `${name} (${weight})`;
};

const generationTypeLabels: Record<string, string> = {
  txt2img: 'Txt2Img',
  img2img: 'Img2Img',
  inpaint: 'Inpaint',
  outpaint: 'Outpaint',
  image2model3d: 'Image to 3D',
};

const sourceReferenceLabel = (resolvedLineage: ResolvedLineageEntry): string | null => {
  const source = resolvedLineage.sourceReference;
  if (!source) return null;
  return nonBlank(source.fileName)
    || nonBlank(source.relativePath)
    || nonBlank(source.absolutePath)
    || nonBlank(source.sha256);
};

const readMetaHubOperation = (rawMetadata: unknown): ProvenanceOperation | null => {
  const raw = asRecord(rawMetadata);
  const payload = asRecord(raw?.imagemetahub_data) || asRecord(raw?.imagemetahub_extension);
  if (!payload) return null;

  const edit = asRecord(payload.edit);
  const tool = nonBlank(edit?.tool);
  const sourceGenerator = nonBlank(payload.source_generator);
  const sourceImageId = nonBlank(edit?.source_image_id);
  const editedAt = nonBlank(payload.edited_at);
  const exportedAt = nonBlank(payload.exported_at);

  if (!edit && !editedAt && !exportedAt) return null;

  const recipe = asRecord(edit?.recipe);
  const recipeParts: string[] = [];
  const adjustments = asRecord(recipe?.adjustments);
  if (adjustments && hasImageAdjustments(adjustments as Partial<ImageAdjustments>)) {
    recipeParts.push('adjustments');
  }
  const transform = asRecord(recipe?.transform);
  if (transform && (transform.rotation !== 0 || transform.flipHorizontal === true || transform.flipVertical === true)) {
    recipeParts.push('transform');
  }
  const crop = asRecord(recipe?.crop);
  if (crop?.enabled === true) recipeParts.push('crop');
  const resize = asRecord(recipe?.resize);
  if (resize?.enabled === true) recipeParts.push('resize');
  const effects = asRecord(recipe?.effects);
  if (effects && Object.values(effects).some((value) => typeof value === 'number' && value !== 0)) {
    recipeParts.push('effects');
  }

  return {
    kind: exportedAt && !edit && !editedAt ? 'export' : 'edit',
    tool: tool || undefined,
    sourceGenerator: sourceGenerator || undefined,
    sourceImageId: sourceImageId || undefined,
    editedAt: editedAt || undefined,
    exportedAt: exportedAt || undefined,
    recipeSummary: recipe ? (recipeParts.length > 0 ? recipeParts.join(', ') : 'recorded') : undefined,
  };
};

const readMetadataSource = (
  rawMetadata: unknown,
  metadata?: BaseMetadata,
): 'embedded' | 'sidecar' | null => {
  const raw = asRecord(rawMetadata);
  if (raw?._provenanceMetadataSource === 'embedded' || raw?._provenanceMetadataSource === 'sidecar') {
    return raw._provenanceMetadataSource;
  }
  if (metadata?.generator === 'Easy Diffusion') {
    const rawKeys = Array.isArray(raw?._rawMetadataKeys)
      ? raw._rawMetadataKeys.filter((key): key is string => typeof key === 'string')
      : [];
    if (typeof raw?.parameters === 'string' || rawKeys.includes('parameters')) return 'embedded';
  }
  return null;
};

const hasLegacyUnknownSource = (
  metadata: BaseMetadata | undefined,
  rawMetadata: unknown,
): boolean => !readMetadataSource(rawMetadata, metadata) && (
  metadata?.generator === 'Easy Diffusion'
  || (
    metadata?.media_type === 'model3d'
    && Boolean(
      nonBlank(metadata.generator)
      || nonBlank(metadata.prompt)
      || nonBlank(metadata.model)
      || metadata.lineage
    )
  )
);

const explicitRelationshipEvidence = (
  metadata: BaseMetadata | undefined,
  rawMetadata: unknown,
): ProvenanceEvidence => readMetadataSource(rawMetadata, metadata)
  || (hasLegacyUnknownSource(metadata, rawMetadata) ? 'metadata' : 'embedded');

export const needsProvenanceMetadataHydration = (
  metadata: BaseMetadata | undefined,
  rawMetadata: unknown,
): boolean => {
  const raw = asRecord(rawMetadata);
  if (hasLegacyUnknownSource(metadata, rawMetadata)) return true;
  if (raw?._rawMetadataCompacted !== true) return false;

  const payload = asRecord(raw.imagemetahub_data) || asRecord(raw.imagemetahub_extension);
  if (!payload) {
    const rawKeys = Array.isArray(raw._rawMetadataKeys)
      ? raw._rawMetadataKeys.filter((key): key is string => typeof key === 'string')
      : [];
    return metadata?.generator === 'Image MetaHub'
      || (!metadata?.generator && (
        rawKeys.includes('imagemetahub_data')
        || rawKeys.includes('imagemetahub_extension')
      ));
  }
  if (nonBlank(payload.generator) !== 'Image MetaHub') return false;

  return !asRecord(payload.edit)
    && !nonBlank(payload.edited_at)
    && !nonBlank(payload.exported_at);
};

export const getProvenanceEvidenceLabel = (evidence: ProvenanceEvidence): string => {
  switch (evidence) {
    case 'metahub-operation': return 'Image MetaHub operation';
    case 'inferred': return 'Inferred';
    case 'sidecar': return 'Sidecar metadata';
    case 'file': return 'File properties';
    case 'metadata': return 'Metadata source not recorded';
    case 'embedded':
    default: return 'Embedded metadata';
  }
};

export const buildProvenanceViewModel = ({
  image,
  metadata = image.metadata?.normalizedMetadata as BaseMetadata | undefined,
  rawMetadata = image.metadata,
  resolvedLineage = null,
  sourceImage = null,
  derivedImages = [],
}: ProvenanceViewModelInput): ProvenanceViewModel => {
  const generation: ProvenanceField[] = [];
  const source = readMetadataSource(rawMetadata, metadata);
  const generationEvidence: ProvenanceEvidence = source
    || (hasLegacyUnknownSource(metadata, rawMetadata) ? 'metadata' : 'embedded');
  const add = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return;
    generation.push({ label, value: String(value), evidence: generationEvidence });
  };

  if (metadata) {
    add('Generator/application', nonBlank(metadata.generator));
    if (metadata.generationType) {
      add('Generation type', generationTypeLabels[metadata.generationType] || metadata.generationType);
    }
    add('Model/checkpoint', nonBlank(metadata.model) || nonBlank(metadata.models?.[0]));
    add('Positive prompt', nonBlank(metadata.prompt));
    add('Negative prompt', nonBlank(metadata.negativePrompt));
    if (Number.isFinite(metadata.seed)) add('Seed', metadata.seed);
    add('Sampler', nonBlank(metadata.sampler));
    add('Scheduler', nonBlank(metadata.scheduler));
    if (Number.isFinite(metadata.steps) && metadata.steps > 0) add('Steps', metadata.steps);
    const cfg = metadata.cfg_scale ?? metadata.cfgScale;
    if (Number.isFinite(cfg)) add('CFG', cfg);
    if (Number.isFinite(metadata.width) && metadata.width > 0 && Number.isFinite(metadata.height) && metadata.height > 0) {
      generation.push({
        label: 'Dimensions',
        value: `${metadata.width}x${metadata.height}`,
        evidence: 'file',
      });
    }
    if (Array.isArray(metadata.loras) && metadata.loras.length > 0) {
      add('LoRAs', metadata.loras.map(formatLoRA).join(', '));
    }
  }

  const relationships: ProvenanceRelationship[] = [];
  if (resolvedLineage) {
    const reference = sourceReferenceLabel(resolvedLineage);
    if (reference) {
      const isExplicit = resolvedLineage.lineage.detection === 'explicit';
      relationships.push({
        label: 'Source image',
        value: sourceImage?.name || reference,
        detail: sourceImage
          ? `Matched in this library (${resolvedLineage.sourceStatus}).`
          : `Registry status: ${resolvedLineage.sourceStatus}.`,
        evidence: isExplicit
          ? explicitRelationshipEvidence(metadata, rawMetadata)
          : 'inferred',
      });
    }
  }

  for (const derivedImage of derivedImages) {
    const derivedMetadata = derivedImage.metadata?.normalizedMetadata as BaseMetadata | undefined;
    const isExplicit = derivedMetadata?.lineage?.detection === 'explicit';
    const evidence = isExplicit
      ? explicitRelationshipEvidence(derivedMetadata, derivedImage.metadata)
      : 'inferred';
    relationships.push({
      label: 'Derived image',
      value: derivedImage.name,
      detail: isExplicit
        ? evidence === 'sidecar'
          ? 'Linked from sidecar lineage metadata.'
          : evidence === 'metadata'
            ? 'Linked from lineage metadata whose source was not recorded.'
            : 'Linked from embedded lineage metadata.'
        : 'Matched by the Image MetaHub lineage registry.',
      evidence,
    });
  }

  return {
    fileName: image.name,
    imageId: image.id,
    lastModified: Number.isFinite(image.contentModifiedMs)
      ? image.contentModifiedMs ?? null
      : Number.isFinite(image.lastModified)
        ? image.lastModified
        : null,
    fileSize: Number.isFinite(image.fileSize) ? image.fileSize ?? null : null,
    generation,
    relationships,
    operation: readMetaHubOperation(rawMetadata),
  };
};

export const serializeProvenanceSummary = (
  model: ProvenanceViewModel,
  sha256?: string | null,
): string => {
  const lines = [
    'Image MetaHub Provenance Summary',
    `File: ${model.fileName}`,
    `Library item: ${model.imageId}`,
  ];

  if (model.lastModified) lines.push(`Last modified: ${new Date(model.lastModified).toISOString()}`);
  if (model.fileSize != null) lines.push(`File size: ${model.fileSize} bytes`);
  lines.push(`SHA-256: ${sha256 || 'Not calculated'}`);

  if (model.generation.length > 0) {
    lines.push('', 'Generation information:');
    for (const field of model.generation) {
      lines.push(`- ${field.label}: ${field.value} [${getProvenanceEvidenceLabel(field.evidence)}]`);
    }
  }

  if (model.relationships.length > 0) {
    lines.push('', 'Known relationships:');
    for (const relationship of model.relationships) {
      lines.push(`- ${relationship.label}: ${relationship.value}${relationship.detail ? ` — ${relationship.detail}` : ''} [${getProvenanceEvidenceLabel(relationship.evidence)}]`);
    }
  }

  if (model.operation) {
    lines.push('', model.operation.kind === 'export' ? 'Image MetaHub export:' : 'Image MetaHub edit:');
    if (model.operation.tool) lines.push(`- Tool: ${model.operation.tool} [${getProvenanceEvidenceLabel('metahub-operation')}]`);
    if (model.operation.sourceGenerator) lines.push(`- Original generator: ${model.operation.sourceGenerator} [${getProvenanceEvidenceLabel('metahub-operation')}]`);
    if (model.operation.sourceImageId) lines.push(`- Editor source item: ${model.operation.sourceImageId} [${getProvenanceEvidenceLabel('metahub-operation')}]`);
    if (model.operation.editedAt) lines.push(`- Edited at: ${model.operation.editedAt} [${getProvenanceEvidenceLabel('metahub-operation')}]`);
    if (model.operation.exportedAt) lines.push(`- Exported at: ${model.operation.exportedAt} [${getProvenanceEvidenceLabel('metahub-operation')}]`);
    if (model.operation.recipeSummary) lines.push(`- Edit recipe: ${model.operation.recipeSummary} [${getProvenanceEvidenceLabel('metahub-operation')}]`);
  }

  return lines.join('\n');
};
