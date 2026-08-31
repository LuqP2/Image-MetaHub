import { type BaseMetadata, type IndexedImage, type LoRAInfo } from '../types';
import { type ResolvedLineageEntry } from './lineageRegistry';

export type ProvenanceEvidence = 'embedded' | 'metahub-operation' | 'inferred';

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
  tool?: string;
  sourceGenerator?: string;
  sourceImageId?: string;
  editedAt?: string;
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
  const generator = nonBlank(payload.generator);
  const tool = nonBlank(edit?.tool);
  const sourceGenerator = nonBlank(payload.source_generator);
  const sourceImageId = nonBlank(edit?.source_image_id);
  const editedAt = nonBlank(payload.edited_at);

  if (generator !== 'Image MetaHub' && !edit && !editedAt) return null;

  const recipe = asRecord(edit?.recipe);
  const recipeParts: string[] = [];
  const adjustments = asRecord(recipe?.adjustments);
  if (adjustments && Object.values(adjustments).some((value) => typeof value === 'number' && value !== 0)) {
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
    tool: tool || undefined,
    sourceGenerator: sourceGenerator || undefined,
    sourceImageId: sourceImageId || undefined,
    editedAt: editedAt || undefined,
    recipeSummary: recipe ? (recipeParts.length > 0 ? recipeParts.join(', ') : 'recorded') : undefined,
  };
};

export const getProvenanceEvidenceLabel = (evidence: ProvenanceEvidence): string => {
  switch (evidence) {
    case 'metahub-operation': return 'Image MetaHub operation';
    case 'inferred': return 'Inferred';
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
  const add = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return;
    generation.push({ label, value: String(value), evidence: 'embedded' });
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
      add('Dimensions', `${metadata.width}x${metadata.height}`);
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
        evidence: isExplicit ? 'embedded' : 'inferred',
      });
    }
  }

  for (const derivedImage of derivedImages) {
    relationships.push({
      label: 'Derived image',
      value: derivedImage.name,
      detail: 'Matched by the Image MetaHub lineage registry.',
      evidence: 'inferred',
    });
  }

  return {
    fileName: image.name,
    imageId: image.id,
    lastModified: Number.isFinite(image.lastModified) ? image.lastModified : null,
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
    lines.push('', 'Image MetaHub operation:');
    if (model.operation.tool) lines.push(`- Tool: ${model.operation.tool} [${getProvenanceEvidenceLabel('metahub-operation')}]`);
    if (model.operation.sourceGenerator) lines.push(`- Original generator: ${model.operation.sourceGenerator} [${getProvenanceEvidenceLabel('metahub-operation')}]`);
    if (model.operation.sourceImageId) lines.push(`- Editor source item: ${model.operation.sourceImageId} [${getProvenanceEvidenceLabel('metahub-operation')}]`);
    if (model.operation.editedAt) lines.push(`- Edited at: ${model.operation.editedAt} [${getProvenanceEvidenceLabel('metahub-operation')}]`);
    if (model.operation.recipeSummary) lines.push(`- Edit recipe: ${model.operation.recipeSummary} [${getProvenanceEvidenceLabel('metahub-operation')}]`);
  }

  return lines.join('\n');
};
