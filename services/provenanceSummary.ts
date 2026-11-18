import { formatMessage } from '../i18n/messages.mjs';
import type { Translate } from '../i18n/useTranslation';
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
  label: string;
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
  translate?: Translate;
  image: IndexedImage;
  metadata?: BaseMetadata;
  rawMetadata?: unknown;
  resolvedLineage?: ResolvedLineageEntry | null;
  sourceImage?: IndexedImage | null;
  derivedImages?: IndexedImage[];
}

const english: Translate = (key, values) => formatMessage('en', key, values);

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const nonBlank = (value: unknown): string | null => (
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
);

const formatLoRA = (lora: string | LoRAInfo, t: Translate): string => {
  if (typeof lora === 'string') return lora;
  const name = lora.name || lora.model_name || t('imageViewer.preview.unknownLoRA');
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

const readMetaHubOperation = (rawMetadata: unknown, t: Translate): ProvenanceOperation | null => {
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
    recipeParts.push(t('imageViewer.provenance.recipeAdjustments'));
  }
  const transform = asRecord(recipe?.transform);
  if (transform && (transform.rotation !== 0 || transform.flipHorizontal === true || transform.flipVertical === true)) {
    recipeParts.push(t('imageViewer.provenance.recipeTransform'));
  }
  const crop = asRecord(recipe?.crop);
  if (crop?.enabled === true) recipeParts.push(t('imageViewer.provenance.recipeCrop'));
  const resize = asRecord(recipe?.resize);
  if (resize?.enabled === true) recipeParts.push(t('imageViewer.provenance.recipeResize'));
  const effects = asRecord(recipe?.effects);
  if (effects && Object.values(effects).some((value) => typeof value === 'number' && value !== 0)) {
    recipeParts.push(t('imageViewer.provenance.recipeEffects'));
  }

  return {
    kind: exportedAt && !edit && !editedAt ? 'export' : 'edit',
    tool: tool || undefined,
    sourceGenerator: sourceGenerator || undefined,
    sourceImageId: sourceImageId || undefined,
    editedAt: editedAt || undefined,
    exportedAt: exportedAt || undefined,
    recipeSummary: recipe ? (recipeParts.length > 0 ? recipeParts.join(', ') : t('imageViewer.provenance.recipeRecorded')) : undefined,
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

export const getProvenanceEvidenceLabel = (evidence: ProvenanceEvidence, t: Translate = english): string => {
  switch (evidence) {
    case 'metahub-operation': return t('imageViewer.provenance.evidenceOperation');
    case 'inferred': return t('imageViewer.provenance.evidenceInferred');
    case 'sidecar': return t('imageViewer.provenance.evidenceSidecar');
    case 'file': return t('imageViewer.provenance.evidenceFile');
    case 'metadata': return t('imageViewer.provenance.evidenceMetadata');
    case 'embedded':
    default: return t('imageViewer.provenance.evidenceEmbedded');
  }
};

export const buildProvenanceViewModel = ({
  image,
  metadata = image.metadata?.normalizedMetadata as BaseMetadata | undefined,
  rawMetadata = image.metadata,
  resolvedLineage = null,
  sourceImage = null,
  derivedImages = [],
  translate: t = english,
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
    add(t('imageViewer.provenance.generator'), nonBlank(metadata.generator));
    if (metadata.generationType) {
      add(t('imageViewer.provenance.type'), metadata.generationType === 'image2model3d' ? t('imageViewer.preview.imageTo3d') : generationTypeLabels[metadata.generationType] || metadata.generationType);
    }
    add(t('imageViewer.provenance.model'), nonBlank(metadata.model) || nonBlank(metadata.models?.[0]));
    add(t('imageViewer.provenance.positive'), nonBlank(metadata.prompt));
    add(t('imageViewer.provenance.negative'), nonBlank(metadata.negativePrompt));
    if (Number.isFinite(metadata.seed)) add(t('libraryGallery.seed'), metadata.seed);
    add(t('librarySearch.sampler'), nonBlank(metadata.sampler));
    add(t('librarySearch.scheduler'), nonBlank(metadata.scheduler));
    if (Number.isFinite(metadata.steps) && metadata.steps > 0) add(t('libraryGallery.steps'), metadata.steps);
    const cfg = metadata.cfg_scale ?? metadata.cfgScale;
    if (Number.isFinite(cfg)) add('CFG', cfg);
    if (Number.isFinite(metadata.width) && metadata.width > 0 && Number.isFinite(metadata.height) && metadata.height > 0) {
      generation.push({
        label: t('librarySearch.dimensions'),
        value: `${metadata.width}x${metadata.height}`,
        evidence: 'file',
      });
    }
    if (Array.isArray(metadata.loras) && metadata.loras.length > 0) {
      add(t('comparison.loras'), metadata.loras.map(lora => formatLoRA(lora, t)).join(', '));
    }
  }

  const relationships: ProvenanceRelationship[] = [];
  if (resolvedLineage) {
    const reference = sourceReferenceLabel(resolvedLineage);
    if (reference) {
      const isExplicit = resolvedLineage.lineage.detection === 'explicit';
      relationships.push({
        label: t('imageViewer.provenance.source'),
        value: sourceImage?.name || reference,
        detail: sourceImage
          ? t('imageViewer.provenance.matched', { status: resolvedLineage.sourceStatus })
          : t('imageViewer.provenance.registryStatus', { status: resolvedLineage.sourceStatus }),
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
      label: t('imageViewer.provenance.derived'),
      value: derivedImage.name,
      detail: isExplicit
        ? evidence === 'sidecar'
          ? t('imageViewer.provenance.linkedSidecar')
          : evidence === 'metadata'
            ? t('imageViewer.provenance.linkedMetadata')
            : t('imageViewer.provenance.linkedEmbedded')
        : t('imageViewer.provenance.matchedRegistry'),
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
    operation: readMetaHubOperation(rawMetadata, t),
  };
};

export const serializeProvenanceSummary = (
  model: ProvenanceViewModel,
  sha256?: string | null,
  t: Translate = english,
): string => {
  const lines = [
    t('imageViewer.provenance.summaryTitle'),
    `${t('imageViewer.provenance.fileLabel')} ${model.fileName}`,
    `${t('imageViewer.provenance.itemLabel')} ${model.imageId}`,
  ];

  if (model.lastModified) lines.push(`${t('imageViewer.provenance.modifiedLabel')} ${new Date(model.lastModified).toISOString()}`);
  if (model.fileSize != null) lines.push(`${t('imageViewer.provenance.sizeLabel')} ${t('imageViewer.provenance.fileBytes', { bytes: model.fileSize })}`);
  lines.push(`SHA-256: ${sha256 || t('imageViewer.provenance.notCalculated')}`);

  if (model.generation.length > 0) {
    lines.push('', t('imageViewer.provenance.generation') + ':');
    for (const field of model.generation) {
      lines.push(`- ${field.label}: ${field.value} [${getProvenanceEvidenceLabel(field.evidence, t)}]`);
    }
  }

  if (model.relationships.length > 0) {
    lines.push('', t('imageViewer.provenance.relationships') + ':');
    for (const relationship of model.relationships) {
      lines.push(`- ${relationship.label}: ${relationship.value}${relationship.detail ? ` — ${relationship.detail}` : ''} [${getProvenanceEvidenceLabel(relationship.evidence, t)}]`);
    }
  }

  if (model.operation) {
    lines.push('', model.operation.kind === 'export' ? t('imageViewer.provenance.export') + ':' : t('imageViewer.provenance.edit') + ':');
    if (model.operation.tool) lines.push(`- ${t('imageViewer.provenance.toolLabel')} ${model.operation.tool} [${getProvenanceEvidenceLabel('metahub-operation', t)}]`);
    if (model.operation.sourceGenerator) lines.push(`- ${t('imageViewer.provenance.generatorLabel')} ${model.operation.sourceGenerator} [${getProvenanceEvidenceLabel('metahub-operation', t)}]`);
    if (model.operation.sourceImageId) lines.push(`- ${t('imageViewer.provenance.editorSourceLabel')} ${model.operation.sourceImageId} [${getProvenanceEvidenceLabel('metahub-operation', t)}]`);
    if (model.operation.editedAt) lines.push(`- ${t('imageViewer.provenance.editedLabel')} ${model.operation.editedAt} [${getProvenanceEvidenceLabel('metahub-operation', t)}]`);
    if (model.operation.exportedAt) lines.push(`- ${t('imageViewer.provenance.exportedLabel')} ${model.operation.exportedAt} [${getProvenanceEvidenceLabel('metahub-operation', t)}]`);
    if (model.operation.recipeSummary) lines.push(`- ${t('imageViewer.provenance.recipeLabel')} ${model.operation.recipeSummary} [${getProvenanceEvidenceLabel('metahub-operation', t)}]`);
  }

  return lines.join('\n');
};
