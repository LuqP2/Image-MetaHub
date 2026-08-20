import type {
  ModelInspectorItem,
  ModelLocalMetadata,
  ModelLocation,
  ModelSourceKind,
} from './types';

export type ModelMetadataSource = 'local' | 'civitai' | 'safetensors' | 'file';

export interface EffectiveModelPresentation {
  name: string;
  nameSource: ModelMetadataSource;
  baseModel?: string;
  baseModelSource?: ModelMetadataSource;
  triggerWords: string[];
  triggerWordsSource?: ModelMetadataSource;
  preview?: string;
  previewSource?: Exclude<ModelMetadataSource, 'file'>;
  description?: string;
  descriptionSource?: Exclude<ModelMetadataSource, 'file'>;
  kind: ModelSourceKind;
}

const withoutSafetensorsExtension = (fileName: string): string =>
  fileName.replace(/\.safetensors$/i, '');

const cleanWords = (values: string[] | undefined): string[] =>
  Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));

const isSafeStoredPreview = (value: string | undefined): value is string =>
  Boolean(value && /^data:image\/(png|jpe?g|webp);base64,/i.test(value));

const toPlainText = (value: string | undefined): string | undefined => {
  const text = value
    ?.replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
};

export function getModelLocalMetadataId(location: Pick<ModelLocation, 'id' | 'sha256'>): string {
  return location.sha256 ? `sha256:${location.sha256.toLowerCase()}` : `location:${location.id}`;
}

export function getModelLocalMetadata(
  entries: Record<string, ModelLocalMetadata>,
  location: Pick<ModelLocation, 'id' | 'sha256'>,
): ModelLocalMetadata | undefined {
  const hashId = location.sha256 ? `sha256:${location.sha256.toLowerCase()}` : undefined;
  return (hashId ? entries[hashId] : undefined) ?? entries[`location:${location.id}`];
}

export function getEffectiveModelPresentation(
  location: ModelLocation,
  local?: ModelLocalMetadata,
): EffectiveModelPresentation {
  const civitai = location.civitai && 'modelId' in location.civitai ? location.civitai : undefined;
  const file = location.fileMetadata;
  const localTriggers = cleanWords(local?.triggerWords);
  const civitaiTriggers = cleanWords(civitai?.trainedWords);
  const fileTriggers = cleanWords(file?.triggerWords);

  let name = withoutSafetensorsExtension(location.fileName);
  let nameSource: ModelMetadataSource = 'file';
  if (file?.modelName?.trim()) {
    name = file.modelName.trim();
    nameSource = 'safetensors';
  }
  if (civitai?.versionName?.trim() || civitai?.modelName?.trim()) {
    name = civitai.modelName?.trim() || civitai.versionName.trim();
    nameSource = 'civitai';
  }
  if (local?.displayName?.trim()) {
    name = local.displayName.trim();
    nameSource = 'local';
  }

  const baseModel = civitai?.baseModel?.trim() || file?.baseModel?.trim() || file?.architecture?.trim() || undefined;
  const baseModelSource = civitai?.baseModel?.trim()
    ? 'civitai' as const
    : (file?.baseModel?.trim() || file?.architecture?.trim() ? 'safetensors' as const : undefined);

  const triggerWords = localTriggers.length ? localTriggers : civitaiTriggers.length ? civitaiTriggers : fileTriggers;
  const triggerWordsSource = localTriggers.length
    ? 'local' as const
    : civitaiTriggers.length
      ? 'civitai' as const
      : fileTriggers.length ? 'safetensors' as const : undefined;

  const localPreview = (local as ModelLocalMetadata & { previewImage?: string } | undefined)?.previewImage;
  const preview = isSafeStoredPreview(localPreview)
    ? localPreview
    : isSafeStoredPreview(file?.embeddedPreview)
      ? file.embeddedPreview
      : isSafeStoredPreview(civitai?.coverImage) ? civitai.coverImage : undefined;
  const previewSource = isSafeStoredPreview(localPreview)
    ? 'local' as const
    : isSafeStoredPreview(file?.embeddedPreview)
      ? 'safetensors' as const
      : isSafeStoredPreview(civitai?.coverImage) ? 'civitai' as const : undefined;

  const description = toPlainText(civitai?.description) || toPlainText(file?.description);
  const descriptionSource = civitai?.description?.trim()
    ? 'civitai' as const
    : file?.description?.trim() ? 'safetensors' as const : undefined;

  return {
    name,
    nameSource,
    baseModel,
    baseModelSource,
    triggerWords,
    triggerWordsSource,
    preview,
    previewSource,
    description,
    descriptionSource,
    kind: location.sourceKind,
  };
}

export function getDefaultLoraSyntax(location: ModelLocation, local?: ModelLocalMetadata): string {
  const modelName = withoutSafetensorsExtension(location.fileName);
  const strength = Number.isFinite(local?.defaultStrength) ? Number(local?.defaultStrength) : 1;
  return `<lora:${modelName}:${strength.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}>`;
}

export function modelInspectorSearchText(item: ModelInspectorItem): string {
  const presentation = getEffectiveModelPresentation(item.location, item.localMetadata);
  return [
    presentation.name,
    item.location.fileName,
    item.location.relativePath,
    item.location.sourceName,
    presentation.baseModel,
    ...presentation.triggerWords,
    ...(item.localMetadata?.tags ?? []),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}
