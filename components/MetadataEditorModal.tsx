import { useTranslation, type MessageKey } from '../i18n/useTranslation';
import React, { useEffect, useId, useState } from 'react';
import { X, Plus, Trash2, Save, Copy, Clipboard, RefreshCw } from 'lucide-react';
import { ShadowMetadata, ShadowResource } from '../types';
import { applyShadowMetadataUpdates } from '../utils/editableMetadata';
import { copyTextToClipboard } from '../utils/imageUtils';

const EDITABLE_METADATA_SCHEMA = 'imagemetahub/editable-metadata';
const EDITABLE_METADATA_VERSION = 1;

type StatusTone = 'success' | 'error' | 'info';

type EditorStatus = {
  tone: StatusTone;
  key: MessageKey;
  values?: Record<string, number>;
  detail?: unknown;
};

class MetadataInputError extends Error {
  constructor(readonly key: MessageKey) {
    super(key);
  }
}

const STATUS_STYLES: Record<StatusTone, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  error: 'border-red-500/30 bg-red-500/10 text-red-200',
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
};

export interface MetadataEditorDraft extends ShadowMetadata {
  model?: string;
  steps?: number;
  cfg_scale?: number;
  clip_skip?: number;
  sampler?: string;
  scheduler?: string;
  generator?: string;
  version?: string;
  module?: string;
  tags?: string[];
}

interface MetadataEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMetadata: MetadataEditorDraft | null;
  onSave: (metadata: MetadataEditorDraft) => Promise<void>;
  imageId: string;
  onExportEditedCopy?: (() => void) | null;
  onApplyToSelected?: ((metadata: MetadataEditorDraft) => Promise<void> | void) | null;
  selectedImageCount?: number;
  onCopyEditableMetadata?: (
    metadata: MetadataEditorDraft,
    serialized: string
  ) => Promise<void> | void;
  onPasteEditableMetadata?: () =>
    | Promise<MetadataEditorDraft | string | null | undefined>
    | MetadataEditorDraft
    | string
    | null
    | undefined;
}

interface EditableMetadataClipboardPayload {
  schema: typeof EDITABLE_METADATA_SCHEMA;
  version: typeof EDITABLE_METADATA_VERSION;
  metadata: Partial<MetadataEditorDraft>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeOptionalMultilineText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return value.trim().length > 0 ? value : undefined;
};

const normalizeOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const sanitizeResource = (value: unknown, index: number): ShadowResource | null => {
  if (!isRecord(value)) return null;

  const type =
    value.type === 'model' || value.type === 'lora' || value.type === 'embedding'
      ? value.type
      : 'model';

  return {
    id:
      typeof value.id === 'string' && value.id.trim().length > 0
        ? value.id
        : `resource-${index}-${crypto.randomUUID()}`,
    type,
    name: typeof value.name === 'string' ? value.name : '',
    weight: normalizeOptionalNumber(value.weight),
  };
};

const sanitizeResources = (value: unknown): ShadowResource[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((resource, index) => sanitizeResource(resource, index))
    .filter((resource): resource is ShadowResource => resource !== null);
};

const normalizeTags = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    const normalized = value
      .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
      .filter(Boolean);

    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
  }

  if (typeof value !== 'string') return undefined;

  const normalized = value
    .split(/[\n,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
};

const formatTags = (tags?: string[]): string => (tags && tags.length > 0 ? tags.join(', ') : '');

const EDITABLE_METADATA_KEYS: Array<keyof MetadataEditorDraft> = [
  'prompt',
  'negativePrompt',
  'seed',
  'width',
  'height',
  'duration',
  'model',
  'steps',
  'cfg_scale',
  'clip_skip',
  'sampler',
  'scheduler',
  'generator',
  'version',
  'module',
  'tags',
  'notes',
  'resources',
];

const syncPrimaryModelResource = (
  resources: ShadowResource[],
  modelName?: string
): ShadowResource[] => {
  const trimmedModelName = modelName?.trim();
  const nextResources = [...resources];
  const primaryModelIndex = nextResources.findIndex((resource) => resource.type === 'model');

  if (!trimmedModelName) {
    if (primaryModelIndex >= 0) {
      nextResources.splice(primaryModelIndex, 1);
    }

    return nextResources;
  }

  if (primaryModelIndex >= 0) {
    nextResources[primaryModelIndex] = {
      ...nextResources[primaryModelIndex],
      name: trimmedModelName,
    };
    return nextResources;
  }

  return [
    {
      id: crypto.randomUUID(),
      type: 'model',
      name: trimmedModelName,
      weight: 1,
    },
    ...nextResources,
  ];
};

const coerceMetadataDraft = (
  value: MetadataEditorDraft | Partial<MetadataEditorDraft> | null | undefined,
  imageId: string
): MetadataEditorDraft => {
  const record = isRecord(value) ? value : {};

  return {
    ...record,
    imageId,
    prompt: typeof record.prompt === 'string' ? record.prompt : '',
    negativePrompt: typeof record.negativePrompt === 'string' ? record.negativePrompt : '',
    seed: normalizeOptionalNumber(record.seed),
    width: normalizeOptionalNumber(record.width),
    height: normalizeOptionalNumber(record.height),
    duration: normalizeOptionalNumber(record.duration),
    model: typeof record.model === 'string' ? record.model : '',
    steps: normalizeOptionalNumber(record.steps),
    cfg_scale: normalizeOptionalNumber(record.cfg_scale),
    clip_skip: normalizeOptionalNumber(record.clip_skip),
    sampler: typeof record.sampler === 'string' ? record.sampler : '',
    scheduler: typeof record.scheduler === 'string' ? record.scheduler : '',
    generator: typeof record.generator === 'string' ? record.generator : '',
    version: typeof record.version === 'string' ? record.version : '',
    module: typeof record.module === 'string' ? record.module : '',
    tags: normalizeTags(record.tags) ?? [],
    notes: typeof record.notes === 'string' ? record.notes : '',
    resources: sanitizeResources(record.resources),
    updatedAt: normalizeOptionalNumber(record.updatedAt) ?? Date.now(),
  };
};

const createPortableMetadata = (
  draft: MetadataEditorDraft,
  tagsText: string,
  options?: { preserveCleared?: boolean }
): MetadataEditorDraft => {
  const preserveCleared = options?.preserveCleared === true;
  const portableResources = syncPrimaryModelResource(
    sanitizeResources(draft.resources),
    normalizeOptionalText(draft.model)
  );

  const normalizedDraft: MetadataEditorDraft = {
    ...draft,
    imageId: draft.imageId,
    prompt: normalizeOptionalMultilineText(draft.prompt),
    negativePrompt: normalizeOptionalMultilineText(draft.negativePrompt),
    seed: normalizeOptionalNumber(draft.seed),
    width: normalizeOptionalNumber(draft.width),
    height: normalizeOptionalNumber(draft.height),
    duration: normalizeOptionalNumber(draft.duration),
    model: normalizeOptionalText(draft.model),
    steps: normalizeOptionalNumber(draft.steps),
    cfg_scale: normalizeOptionalNumber(draft.cfg_scale),
    clip_skip: normalizeOptionalNumber(draft.clip_skip),
    sampler: normalizeOptionalText(draft.sampler),
    scheduler: normalizeOptionalText(draft.scheduler),
    generator: normalizeOptionalText(draft.generator),
    version: normalizeOptionalText(draft.version),
    module: normalizeOptionalText(draft.module),
    tags: normalizeTags(tagsText),
    notes: normalizeOptionalMultilineText(draft.notes),
    resources: portableResources.length > 0 ? portableResources : undefined,
    updatedAt: Date.now(),
  };

  if (!preserveCleared) {
    if (!normalizedDraft.prompt) delete normalizedDraft.prompt;
    if (!normalizedDraft.negativePrompt) delete normalizedDraft.negativePrompt;
    if (normalizedDraft.seed === undefined) delete normalizedDraft.seed;
    if (normalizedDraft.width === undefined) delete normalizedDraft.width;
    if (normalizedDraft.height === undefined) delete normalizedDraft.height;
    if (normalizedDraft.duration === undefined) delete normalizedDraft.duration;
    if (!normalizedDraft.model) delete normalizedDraft.model;
    if (normalizedDraft.steps === undefined) delete normalizedDraft.steps;
    if (normalizedDraft.cfg_scale === undefined) delete normalizedDraft.cfg_scale;
    if (normalizedDraft.clip_skip === undefined) delete normalizedDraft.clip_skip;
    if (!normalizedDraft.sampler) delete normalizedDraft.sampler;
    if (!normalizedDraft.scheduler) delete normalizedDraft.scheduler;
    if (!normalizedDraft.generator) delete normalizedDraft.generator;
    if (!normalizedDraft.version) delete normalizedDraft.version;
    if (!normalizedDraft.module) delete normalizedDraft.module;
    if (!normalizedDraft.tags || normalizedDraft.tags.length === 0) delete normalizedDraft.tags;
    if (!normalizedDraft.notes) delete normalizedDraft.notes;
  }

  return normalizedDraft;
};

const buildShadowMetadataReplacement = (
  initialMetadata: MetadataEditorDraft | null,
  draft: MetadataEditorDraft,
  tagsText: string,
): MetadataEditorDraft => {
  const normalizedDraft = createPortableMetadata(draft, tagsText, { preserveCleared: true });
  const initialDraft = coerceMetadataDraft(initialMetadata, draft.imageId);
  const replacement: Record<string, unknown> = {
    ...normalizedDraft,
    imageId: draft.imageId,
    updatedAt: Date.now(),
  };

  for (const key of EDITABLE_METADATA_KEYS) {
    const currentValue = normalizedDraft[key];
    const initialValue = initialDraft[key];
    const hadInitialValue =
      Array.isArray(initialValue)
        ? initialValue.length > 0
        : typeof initialValue === 'string'
          ? initialValue.trim().length > 0
          : typeof initialValue === 'number'
            ? Number.isFinite(initialValue)
            : Boolean(initialValue);

    if (currentValue === undefined && hadInitialValue) {
      replacement[key] = null;
    }
  }

  return replacement as unknown as MetadataEditorDraft;
};

const serializeEditableMetadata = (draft: MetadataEditorDraft, tagsText: string): string => {
  const portableMetadata = createPortableMetadata(draft, tagsText);
  const payload: EditableMetadataClipboardPayload = {
    schema: EDITABLE_METADATA_SCHEMA,
    version: EDITABLE_METADATA_VERSION,
    metadata: Object.fromEntries(
      Object.entries(portableMetadata).filter(([key]) => key !== 'imageId' && key !== 'updatedAt')
    ),
  };

  return JSON.stringify(payload, null, 2);
};

const parseEditableMetadataInput = (
  rawValue: unknown,
  imageId: string
): { draft: MetadataEditorDraft; source: 'wrapped' | 'plain' } => {
  const value =
    typeof rawValue === 'string'
      ? JSON.parse(rawValue)
      : rawValue;

  if (!isRecord(value)) {
    throw new MetadataInputError('metadataEditor.expectedObject');
  }

  if (value.schema === EDITABLE_METADATA_SCHEMA && isRecord(value.metadata)) {
    return {
      draft: coerceMetadataDraft(value.metadata as Partial<MetadataEditorDraft>, imageId),
      source: 'wrapped',
    };
  }

  return {
    draft: coerceMetadataDraft(value as Partial<MetadataEditorDraft>, imageId),
    source: 'plain',
  };
};

export const MetadataEditorModal: React.FC<MetadataEditorModalProps> = ({
  isOpen,
  onClose,
  initialMetadata,
  onSave,
  imageId,
  onExportEditedCopy,
  onApplyToSelected,
  selectedImageCount = 0,
  onCopyEditableMetadata,
  onPasteEditableMetadata,
}) => {
  const { t } = useTranslation();
  const fieldId = useId();
  const [draft, setDraft] = useState<MetadataEditorDraft>(() => coerceMetadataDraft(null, imageId));
  const [tagsText, setTagsText] = useState('');
  const [jsonEditorText, setJsonEditorText] = useState('');
  const [status, setStatus] = useState<EditorStatus | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isPasting, setIsPasting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const nextDraft = coerceMetadataDraft(initialMetadata, imageId);
    setDraft(nextDraft);
    setTagsText(formatTags(nextDraft.tags));
    setJsonEditorText(serializeEditableMetadata(nextDraft, formatTags(nextDraft.tags)));
    setStatus(null);
  }, [imageId, initialMetadata, isOpen]);

  if (!isOpen) return null;

  const updateField = <K extends keyof MetadataEditorDraft>(
    key: K,
    value: MetadataEditorDraft[K]
  ) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [key]: value,
    }));
  };

  const updateNumericField = (key: keyof MetadataEditorDraft, value: string) => {
    updateField(key, normalizeOptionalNumber(value) as MetadataEditorDraft[keyof MetadataEditorDraft]);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setStatus(null);

    try {
      const nextMetadata = buildShadowMetadataReplacement(initialMetadata, draft, tagsText);

      await onSave(nextMetadata);
      onClose();
    } catch (error) {
      console.error('Failed to save metadata:', error);
      setStatus({
        tone: 'error',
        key: 'metadataEditor.saveFailed',
        detail: error,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const addResource = () => {
    const newResource: ShadowResource = {
      id: crypto.randomUUID(),
      type: 'model',
      name: '',
      weight: 1,
    };

    updateField('resources', [...sanitizeResources(draft.resources), newResource]);
  };

  const removeResource = (id: string) => {
    const nextResources = sanitizeResources(draft.resources).filter((resource) => resource.id !== id);
    updateField('resources', nextResources);
  };

  const updateResource = <K extends keyof ShadowResource>(
    id: string,
    field: K,
    value: ShadowResource[K]
  ) => {
    const nextResources = sanitizeResources(draft.resources).map((resource) =>
      resource.id === id ? { ...resource, [field]: value } : resource
    );

    updateField('resources', nextResources);
  };

  const handleSyncJsonFromForm = () => {
    const serialized = serializeEditableMetadata(draft, tagsText);
    setJsonEditorText(serialized);
    setStatus({
      tone: 'info',
      key: 'metadataEditor.refreshed',
    });
  };

  const handleApplyJsonText = () => {
    try {
      const { draft: nextDraft } = parseEditableMetadataInput(jsonEditorText, imageId);
      setDraft(nextDraft);
      setTagsText(formatTags(nextDraft.tags));
      setJsonEditorText(serializeEditableMetadata(nextDraft, formatTags(nextDraft.tags)));
      setStatus({
        tone: 'success',
        key: 'metadataEditor.jsonApplied',
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        key: 'metadataEditor.applyFailed',
        detail: error,
      });
    }
  };

  const handleCopyEditableMetadata = async () => {
    const serialized = serializeEditableMetadata(draft, tagsText);
    const portableMetadata = createPortableMetadata(draft, tagsText);

    setIsCopying(true);
    setStatus(null);

    try {
      if (onCopyEditableMetadata) {
        await onCopyEditableMetadata(portableMetadata, serialized);
      } else if (navigator.clipboard && window.isSecureContext) {
        const result = await copyTextToClipboard(serialized);
        if (!result.success) {
          throw result.error ? new Error(result.error) : new MetadataInputError('metadataEditor.unknownError');
        }
      } else {
        throw new MetadataInputError('metadataEditor.clipboardUnavailable');
      }

      setJsonEditorText(serialized);
      setStatus({
        tone: 'success',
        key: 'metadataEditor.copied',
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        key: 'metadataEditor.copyFailed',
        detail: error,
      });
    } finally {
      setIsCopying(false);
    }
  };

  const handlePasteEditableMetadata = async () => {
    setIsPasting(true);
    setStatus(null);

    try {
      const rawPastedValue = onPasteEditableMetadata
        ? await onPasteEditableMetadata()
        : navigator.clipboard && window.isSecureContext
          ? await navigator.clipboard.readText()
          : null;

      if (!rawPastedValue) {
        throw new MetadataInputError('metadataEditor.clipboardEmpty');
      }

      const { draft: pastedDraft, source } = parseEditableMetadataInput(rawPastedValue, imageId);
      setDraft(pastedDraft);
      setTagsText(formatTags(pastedDraft.tags));
      setJsonEditorText(serializeEditableMetadata(pastedDraft, formatTags(pastedDraft.tags)));
      setStatus({
        tone: 'success',
        key: source === 'wrapped' ? 'metadataEditor.pastedPortable' : 'metadataEditor.pastedJson',
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        key: 'metadataEditor.pasteFailed',
        detail: error,
      });
    } finally {
      setIsPasting(false);
    }
  };

  const handleApplyToSelected = async () => {
    if (!onApplyToSelected) {
      return;
    }

    setIsSaving(true);
    setStatus(null);

    try {
      const nextMetadata = buildShadowMetadataReplacement(initialMetadata, draft, tagsText);
      await onApplyToSelected(nextMetadata);
      setStatus({
        tone: 'success',
        key: 'metadataEditor.selectionApplied',
        values: { count: selectedImageCount },
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        key: 'metadataEditor.selectionFailed',
        detail: error,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const statusDetail = status?.detail instanceof MetadataInputError
    ? t(status.detail.key)
    : status?.detail instanceof Error ? status.detail.message : undefined;
  const statusMessage = status ? t(status.key, status.values) : undefined;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="text-blue-400">{t('metadataEditor.title')}</span>
              <span className="text-xs font-normal text-gray-500 bg-gray-800 px-2 py-1 rounded">
                {t('metadataEditor.overrides')}
              </span>
            </h2>
            <p className="text-xs text-gray-500">{t('metadataEditor.help')}</p>
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label={t('metadataEditor.close')}
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-300 border-b border-gray-800 pb-2">
              {t('metadataEditor.prompts')}
            </h3>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <label htmlFor={fieldId + '-prompt'} className="text-sm font-medium text-gray-400">{t('libraryGallery.prompt')}</label>
                <textarea
                  id={fieldId + '-prompt'}
                  value={typeof draft.prompt === 'string' ? draft.prompt : ''}
                  onChange={(event) => updateField('prompt', event.target.value)}
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none text-sm min-h-[120px]"
                  placeholder={t('metadataEditor.positivePlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-negativePrompt'} className="text-sm font-medium text-gray-400">{t('libraryGallery.negativePrompt')}</label>
                <textarea
                  id={fieldId + '-negativePrompt'}
                  value={typeof draft.negativePrompt === 'string' ? draft.negativePrompt : ''}
                  onChange={(event) => updateField('negativePrompt', event.target.value)}
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-red-200/80 focus:ring-2 focus:ring-red-500/50 focus:border-red-500 outline-none text-sm min-h-[100px]"
                  placeholder={t('metadataEditor.negativePlaceholder')}
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-300 border-b border-gray-800 pb-2">
              {t('librarySearch.generation')}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <div className="space-y-2 xl:col-span-2">
                <label htmlFor={fieldId + '-model'} className="text-sm font-medium text-gray-400">{t('metadataEditor.primaryModel')}</label>
                <input
                  id={fieldId + '-model'}
                  type="text"
                  value={typeof draft.model === 'string' ? draft.model : ''}
                  onChange={(event) => updateField('model', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder={t('metadataEditor.modelExample', { model: 'juggernautXL_v9' })}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-seed'} className="text-sm font-medium text-gray-400">{t('libraryGallery.seed')}</label>
                <input
                  id={fieldId + '-seed'}
                  type="number"
                  value={draft.seed ?? ''}
                  onChange={(event) => updateNumericField('seed', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="123456789"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-steps'} className="text-sm font-medium text-gray-400">{t('libraryGallery.steps')}</label>
                <input
                  id={fieldId + '-steps'}
                  type="number"
                  value={draft.steps ?? ''}
                  onChange={(event) => updateNumericField('steps', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="28"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-cfgScale'} className="text-sm font-medium text-gray-400">{t('comparison.cfgScale')}</label>
                <input
                  id={fieldId + '-cfgScale'}
                  type="number"
                  value={draft.cfg_scale ?? ''}
                  onChange={(event) => updateNumericField('cfg_scale', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="7"
                  step="0.1"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-clipSkip'} className="text-sm font-medium text-gray-400">{t('comparison.clipSkip')}</label>
                <input
                  id={fieldId + '-clipSkip'}
                  type="number"
                  value={draft.clip_skip ?? ''}
                  onChange={(event) => updateNumericField('clip_skip', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="2"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-sampler'} className="text-sm font-medium text-gray-400">{t('librarySearch.sampler')}</label>
                <input
                  id={fieldId + '-sampler'}
                  type="text"
                  value={typeof draft.sampler === 'string' ? draft.sampler : ''}
                  onChange={(event) => updateField('sampler', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Euler a"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-scheduler'} className="text-sm font-medium text-gray-400">{t('librarySearch.scheduler')}</label>
                <input
                  id={fieldId + '-scheduler'}
                  type="text"
                  value={typeof draft.scheduler === 'string' ? draft.scheduler : ''}
                  onChange={(event) => updateField('scheduler', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="normal"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-generator'} className="text-sm font-medium text-gray-400">{t('comparison.generator')}</label>
                <input
                  id={fieldId + '-generator'}
                  type="text"
                  value={typeof draft.generator === 'string' ? draft.generator : ''}
                  onChange={(event) => updateField('generator', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="ComfyUI / A1111 / InvokeAI..."
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-version'} className="text-sm font-medium text-gray-400">{t('comparison.version')}</label>
                <input
                  id={fieldId + '-version'}
                  type="text"
                  value={typeof draft.version === 'string' ? draft.version : ''}
                  onChange={(event) => updateField('version', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder={t('metadataEditor.versionPlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-module'} className="text-sm font-medium text-gray-400">{t('comparison.module')}</label>
                <input
                  id={fieldId + '-module'}
                  type="text"
                  value={typeof draft.module === 'string' ? draft.module : ''}
                  onChange={(event) => updateField('module', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder={t('metadataEditor.modulePlaceholder')}
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-300 border-b border-gray-800 pb-2">
              {t('metadataEditor.dimensionsMedia')}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label htmlFor={fieldId + '-width'} className="text-sm font-medium text-gray-400">{t('comparison.width')}</label>
                <input
                  id={fieldId + '-width'}
                  type="number"
                  value={draft.width ?? ''}
                  onChange={(event) => updateNumericField('width', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="1024"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-height'} className="text-sm font-medium text-gray-400">{t('comparison.height')}</label>
                <input
                  id={fieldId + '-height'}
                  type="number"
                  value={draft.height ?? ''}
                  onChange={(event) => updateNumericField('height', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="1024"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-duration'} className="text-sm font-medium text-gray-400">{t('metadataEditor.duration')}</label>
                <input
                  id={fieldId + '-duration'}
                  type="number"
                  value={draft.duration ?? ''}
                  onChange={(event) => updateNumericField('duration', event.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder={t('metadataEditor.durationPlaceholder')}
                  step="0.1"
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <div>
                <h3 className="text-lg font-semibold text-gray-300">{t('metadataEditor.resources')}</h3>
                <p className="text-xs text-gray-500 mt-1">
                  {t('metadataEditor.fallbackModel')}
                </p>
              </div>

              <button
                onClick={addResource}
                className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-500 text-white hover:text-gray-950 px-3 py-1.5 rounded transition-colors"
              >
                <Plus size={14} />{' '}{t('metadataEditor.addResource')}
              </button>
            </div>

            <div className="space-y-3">
              {sanitizeResources(draft.resources).length === 0 && (
                <div className="text-center py-6 text-gray-500 text-sm italic">
                  {t('metadataEditor.noResources')}
                </div>
              )}

              {sanitizeResources(draft.resources).map((resource) => (
                <div
                  key={resource.id}
                  className="flex items-start gap-3 bg-gray-800/30 p-3 rounded-lg border border-gray-700/50 group"
                >
                  <div className="w-32 flex-shrink-0">
                    <select
                      aria-label={t('metadataEditor.resourceType')}
                      value={resource.type}
                      onChange={(event) =>
                        updateResource(resource.id, 'type', event.target.value as ShadowResource['type'])
                      }
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300 outline-none focus:border-blue-500"
                    >
                      <option value="model">{t('libraryGallery.model')}</option>
                      <option value="lora">LoRA</option>
                      <option value="embedding">{t('metadataEditor.embedding')}</option>
                    </select>
                  </div>

                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      value={resource.name}
                      onChange={(event) => updateResource(resource.id, 'name', event.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500"
                      placeholder={t('metadataEditor.resourceName')}
                    />
                  </div>

                  <div className="w-24 flex-shrink-0">
                    <input
                      type="number"
                      value={resource.weight ?? ''}
                      onChange={(event) => updateResource(resource.id, 'weight', normalizeOptionalNumber(event.target.value))}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500 text-center"
                      step="0.1"
                      placeholder={t('metadataEditor.weight')}
                    />
                  </div>

                  <button
                    onClick={() => removeResource(resource.id)}
                    className="text-gray-500 hover:text-red-400 p-1.5 transition-colors opacity-0 group-hover:opacity-100"
                    title={t('metadataEditor.removeResource')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-300 border-b border-gray-800 pb-2">
              {t('metadataEditor.tagsNotes')}
            </h3>

            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor={fieldId + '-tags'} className="text-sm font-medium text-gray-400">{t('comparison.tags')}</label>
                <textarea
                  id={fieldId + '-tags'}
                  value={tagsText}
                  onChange={(event) => setTagsText(event.target.value)}
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none text-sm min-h-[72px]"
                  placeholder={t('metadataEditor.tagsPlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={fieldId + '-notes'} className="text-sm font-medium text-gray-400">{t('comparison.notes')}</label>
                <textarea
                  id={fieldId + '-notes'}
                  value={typeof draft.notes === 'string' ? draft.notes : ''}
                  onChange={(event) => updateField('notes', event.target.value)}
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none text-sm min-h-[140px] font-mono"
                  placeholder={t('metadataEditor.notesPlaceholder')}
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <div>
                <h3 className="text-lg font-semibold text-gray-300">{t('metadataEditor.jsonTitle')}</h3>
                <p className="text-xs text-gray-500 mt-1">
                  {t('metadataEditor.jsonHelp')}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleSyncJsonFromForm}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-200 bg-gray-800 hover:bg-gray-700 transition-colors"
                >
                  <RefreshCw size={14} />{' '}{t('metadataEditor.refreshJson')}
                </button>

                <button
                  onClick={handleCopyEditableMetadata}
                  disabled={isCopying}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 hover:text-gray-950 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Copy size={14} /> {isCopying ? t('metadataEditor.copying') : t('metadataEditor.copyJson')}
                </button>

                <button
                  onClick={handlePasteEditableMetadata}
                  disabled={isPasting}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-200 bg-gray-800 hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Clipboard size={14} /> {isPasting ? t('metadataEditor.pasting') : t('metadataEditor.pasteJson')}
                </button>
              </div>
            </div>

            <textarea
              aria-label={t('metadataEditor.jsonTitle')}
              value={jsonEditorText}
              onChange={(event) => setJsonEditorText(event.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none text-sm min-h-[280px] font-mono"
              spellCheck={false}
            />

            <div className="flex justify-end">
              <button
                onClick={handleApplyJsonText}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
              >
                <Clipboard size={15} />{' '}{t('metadataEditor.applyJson')}
              </button>
            </div>
          </section>
        </div>

        <div className="p-4 border-t border-gray-800 bg-gray-900 rounded-b-xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-h-[40px]">
              {status && (
                <div role="status" className={`inline-flex items-start gap-2 px-3 py-2 rounded-lg border text-sm ${STATUS_STYLES[status.tone]}`}>
                  <span>{statusMessage && statusDetail ? t('metadataEditor.errorDetails', { summary: statusMessage, detail: statusDetail }) : statusMessage}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              {onExportEditedCopy && (
                <button
                  onClick={onExportEditedCopy}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-blue-200 hover:text-white hover:bg-blue-600/20 transition-colors"
                >
                  {t('metadataEditor.exportCopy')}
                </button>
              )}

              {onApplyToSelected && selectedImageCount > 1 && (
                <button
                  onClick={handleApplyToSelected}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-200 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('metadataEditor.applySelection', { count: selectedImageCount })}
                </button>
              )}

              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
              >
                {t('batchExport.cancel')}
              </button>

              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white hover:text-gray-950 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  t('metadataEditor.saving')
                ) : (
                  <>
                    <Save size={16} />{' '}{t('metadataEditor.save')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
