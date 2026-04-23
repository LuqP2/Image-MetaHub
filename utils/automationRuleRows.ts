import type {
  AdvancedFilters,
  AutomationConditionField,
  AutomationConditionOperator,
  AutomationConditionRow,
  AutomationRule,
  AutomationRuleCriteria,
  AutomationRuleFilterCriteria,
  AutomationTextField,
  AutomationTextOperator,
  ImageRating,
  IndexedImage,
  TagInfo,
} from '../types';

export interface ConditionValueSource {
  images: IndexedImage[];
  availableModels: string[];
  availableLoras: string[];
  availableSamplers: string[];
  availableSchedulers: string[];
  availableGenerators: string[];
  availableGpuDevices: string[];
  availableDimensions: string[];
  availableTags: TagInfo[];
  availableAutoTags: TagInfo[];
}

export type CurrentRuleFiltersSnapshot = AutomationRuleFilterCriteria;

export const TEXT_CONDITION_FIELDS: AutomationConditionField[] = ['prompt', 'negativePrompt', 'filename', 'metadata', 'search'];
export const FACET_CONDITION_FIELDS: AutomationConditionField[] = [
  'model',
  'lora',
  'sampler',
  'scheduler',
  'generator',
  'gpu',
  'tag',
  'autoTag',
  'dimension',
  'generationMode',
  'mediaType',
];
export const NUMBER_CONDITION_FIELDS: AutomationConditionField[] = [
  'rating',
  'steps',
  'cfg',
  'generationTimeMs',
  'stepsPerSecond',
  'vramPeakMb',
];
export const BOOLEAN_CONDITION_FIELDS: AutomationConditionField[] = ['favorite'];
export const DATE_CONDITION_FIELDS: AutomationConditionField[] = ['date'];
const ALL_CONDITION_FIELD_VALUES: AutomationConditionField[] = [
  'search',
  'prompt',
  'negativePrompt',
  'filename',
  'metadata',
  'model',
  'lora',
  'sampler',
  'scheduler',
  'generator',
  'gpu',
  'tag',
  'autoTag',
  'dimension',
  'date',
  'generationMode',
  'mediaType',
  'favorite',
  'rating',
  'steps',
  'cfg',
  'generationTimeMs',
  'stepsPerSecond',
  'vramPeakMb',
  'telemetry',
  'verifiedTelemetry',
];
const CONDITION_FIELD_VALUES: AutomationConditionField[] = [
  'search',
  'prompt',
  'negativePrompt',
  'filename',
  'metadata',
  'model',
  'lora',
  'sampler',
  'scheduler',
  'generator',
  'gpu',
  'tag',
  'autoTag',
  'dimension',
  'date',
  'generationMode',
  'mediaType',
  'favorite',
  'rating',
  'steps',
  'cfg',
  'generationTimeMs',
  'stepsPerSecond',
  'vramPeakMb',
  'telemetry',
  'verifiedTelemetry',
];

export const CONDITION_FIELD_LABELS: Record<AutomationConditionField, string> = {
  search: 'Search',
  prompt: 'Prompt',
  negativePrompt: 'Negative Prompt',
  filename: 'Filename',
  metadata: 'Metadata',
  model: 'Checkpoint',
  lora: 'LoRA',
  sampler: 'Sampler',
  scheduler: 'Scheduler',
  generator: 'Generator',
  gpu: 'GPU',
  tag: 'Manual Tag',
  autoTag: 'Auto Tag',
  dimension: 'Dimensions',
  date: 'Date',
  generationMode: 'Generation Mode',
  mediaType: 'Media Type',
  favorite: 'Favorite',
  rating: 'Rating',
  steps: 'Steps',
  cfg: 'CFG',
  generationTimeMs: 'Generation Time (ms)',
  stepsPerSecond: 'Speed (it/s)',
  vramPeakMb: 'VRAM Peak (MB)',
  telemetry: 'Performance Data',
  verifiedTelemetry: 'Verified Performance Data',
};

export const OPERATOR_LABELS: Record<AutomationConditionOperator, string> = {
  contains: 'contains',
  not_contains: 'does not contain',
  equals: 'equals',
  not_equals: 'is not exactly',
  includes: 'includes',
  not_includes: 'does not include',
  is: 'is',
  is_not: 'is not',
  at_least: 'at least',
  at_most: 'at most',
  between: 'between',
};

const createRowId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `condition-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const normalizeList = (values: string[] | undefined, lower = false): string[] =>
  Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => lower ? value.toLowerCase() : value),
    ),
  );

const addRowsFromValues = (
  rows: AutomationConditionRow[],
  field: AutomationConditionField,
  operator: AutomationConditionOperator,
  values: string[] | undefined,
  groupMode?: AutomationConditionRow['groupMode'],
) => {
  for (const value of normalizeList(values, field === 'tag')) {
    rows.push({ id: createRowId(), field, operator, value, groupMode });
  }
};

const isTextField = (field: AutomationConditionField): field is AutomationTextField =>
  TEXT_CONDITION_FIELDS.includes(field);

const isTextOperator = (operator: AutomationConditionOperator): operator is AutomationTextOperator =>
  operator === 'contains' || operator === 'not_contains' || operator === 'equals' || operator === 'not_equals';

export function getConditionFieldOptions(): Array<{ value: AutomationConditionField; label: string }> {
  return CONDITION_FIELD_VALUES.map((field) => ({ value: field, label: CONDITION_FIELD_LABELS[field] }));
}

export function getOperatorsForField(field: AutomationConditionField): AutomationConditionOperator[] {
  if (TEXT_CONDITION_FIELDS.includes(field)) {
    return ['contains', 'not_contains'];
  }
  if (field === 'generationMode' || field === 'mediaType') {
    return ['includes'];
  }
  if (field === 'verifiedTelemetry') {
    return ['is'];
  }
  if (FACET_CONDITION_FIELDS.includes(field)) {
    return ['includes', 'not_includes'];
  }
  if (DATE_CONDITION_FIELDS.includes(field)) {
    return ['equals', 'at_least', 'at_most', 'between'];
  }
  if (NUMBER_CONDITION_FIELDS.includes(field)) {
    return ['equals', 'at_least', 'at_most', 'between'];
  }
  return ['is', 'is_not'];
}

export function getDefaultOperatorForField(field: AutomationConditionField): AutomationConditionOperator {
  return getOperatorsForField(field)[0] ?? 'contains';
}

export function createDefaultConditionRow(): AutomationConditionRow {
  return {
    id: createRowId(),
    field: 'prompt',
    operator: 'contains',
    value: '',
  };
}

const normalizeField = (field: unknown): AutomationConditionField =>
  ALL_CONDITION_FIELD_VALUES.includes(field as AutomationConditionField)
    ? field as AutomationConditionField
    : 'prompt';

export function normalizeConditionRow(row: Partial<AutomationConditionRow>): AutomationConditionRow {
  const field = normalizeField(row.field);
  const operator = getOperatorsForField(field).includes(row.operator as AutomationConditionOperator)
    ? row.operator as AutomationConditionOperator
    : getDefaultOperatorForField(field);
  return {
    id: row.id || createRowId(),
    field,
    operator,
    value: typeof row.value === 'string' ? row.value : '',
    valueEnd: typeof row.valueEnd === 'string' ? row.valueEnd : '',
    groupMode: row.groupMode === 'all' || row.groupMode === 'any' ? row.groupMode : undefined,
  };
}

export function isConditionRowComplete(row: AutomationConditionRow): boolean {
  if (row.field === 'favorite' || row.field === 'telemetry' || row.field === 'verifiedTelemetry') {
    return true;
  }
  if (!row.value.trim()) {
    return false;
  }
  if (row.operator === 'between') {
    return Boolean(row.valueEnd?.trim());
  }
  return true;
}

export function ruleToConditionRows(rule: AutomationRule): AutomationConditionRow[] {
  if (rule.criteria.conditionRows?.length) {
    return rule.criteria.conditionRows.map(normalizeConditionRow);
  }

  const rows: AutomationConditionRow[] = [];
  for (const condition of rule.criteria.textConditions ?? []) {
    rows.push(normalizeConditionRow({
      id: condition.id || createRowId(),
      field: condition.field,
      operator: condition.operator,
      value: condition.value,
    }));
  }

  rows.push(...filterCriteriaToConditionRows(rule.criteria.filters));
  return rows;
}

export function filterCriteriaToConditionRows(filters: AutomationRuleFilterCriteria): AutomationConditionRow[] {
  const rows: AutomationConditionRow[] = [];

  if (filters.searchQuery?.trim()) {
    rows.push({ id: createRowId(), field: 'search', operator: 'contains', value: filters.searchQuery.trim() });
  }

  addRowsFromValues(rows, 'model', 'includes', filters.models);
  addRowsFromValues(rows, 'model', 'not_includes', filters.excludedModels);
  addRowsFromValues(rows, 'lora', 'includes', filters.loras);
  addRowsFromValues(rows, 'lora', 'not_includes', filters.excludedLoras);
  addRowsFromValues(rows, 'sampler', 'includes', filters.samplers);
  addRowsFromValues(rows, 'sampler', 'not_includes', filters.excludedSamplers);
  addRowsFromValues(rows, 'scheduler', 'includes', filters.schedulers);
  addRowsFromValues(rows, 'scheduler', 'not_includes', filters.excludedSchedulers);
  addRowsFromValues(rows, 'generator', 'includes', filters.generators);
  addRowsFromValues(rows, 'generator', 'not_includes', filters.excludedGenerators);
  addRowsFromValues(rows, 'gpu', 'includes', filters.gpuDevices);
  addRowsFromValues(rows, 'gpu', 'not_includes', filters.excludedGpuDevices);
  addRowsFromValues(rows, 'tag', 'includes', filters.tags, filters.tagMatchMode === 'all' ? 'all' : undefined);
  addRowsFromValues(rows, 'tag', 'not_includes', filters.excludedTags);
  addRowsFromValues(rows, 'autoTag', 'includes', filters.autoTags);
  addRowsFromValues(rows, 'autoTag', 'not_includes', filters.excludedAutoTags);

  if (filters.favoriteFilterMode === 'include' || filters.favoriteFilterMode === 'exclude') {
    rows.push({
      id: createRowId(),
      field: 'favorite',
      operator: filters.favoriteFilterMode === 'include' ? 'is' : 'is_not',
      value: 'true',
    });
  }

  for (const rating of filters.ratings ?? []) {
    rows.push({ id: createRowId(), field: 'rating', operator: 'equals', value: String(rating) });
  }

  const advanced = filters.advancedFilters ?? {};
  if (advanced.dimension) {
    rows.push({ id: createRowId(), field: 'dimension', operator: 'includes', value: advanced.dimension });
  }
  if (advanced.date) rows.push(...dateRangeToRows(advanced.date));
  addRowsFromValues(rows, 'generationMode', 'includes', advanced.generationModes);
  addRowsFromValues(rows, 'mediaType', 'includes', advanced.mediaTypes);
  if (advanced.steps) rows.push(...rangeToRows('steps', advanced.steps));
  if (advanced.cfg) rows.push(...rangeToRows('cfg', advanced.cfg));
  if (advanced.telemetryState === 'present' || advanced.telemetryState === 'missing') {
    rows.push({
      id: createRowId(),
      field: 'telemetry',
      operator: advanced.telemetryState === 'present' ? 'is' : 'is_not',
      value: 'true',
    });
  }
  if (advanced.hasVerifiedTelemetry === true) {
    rows.push({ id: createRowId(), field: 'verifiedTelemetry', operator: 'is', value: 'true' });
  }
  if (advanced.generationTimeMs) rows.push(...rangeToRows('generationTimeMs', advanced.generationTimeMs));
  if (advanced.stepsPerSecond) rows.push(...rangeToRows('stepsPerSecond', advanced.stepsPerSecond));
  if (advanced.vramPeakMb) rows.push(...rangeToRows('vramPeakMb', advanced.vramPeakMb));
  return rows;
}

const rangeToRows = (
  field: 'steps' | 'cfg' | 'generationTimeMs' | 'stepsPerSecond' | 'vramPeakMb',
  range: NonNullable<AdvancedFilters['steps'] | AdvancedFilters['cfg'] | AdvancedFilters['generationTimeMs'] | AdvancedFilters['stepsPerSecond'] | AdvancedFilters['vramPeakMb']>,
): AutomationConditionRow[] => {
  const hasMin = range.min !== null && range.min !== undefined;
  const hasMax = range.max !== null && range.max !== undefined;
  if (hasMin && hasMax && range.min === range.max) {
    return [{ id: createRowId(), field, operator: 'equals', value: String(range.min) }];
  }
  if (hasMin && hasMax) {
    return [{ id: createRowId(), field, operator: 'between', value: String(range.min), valueEnd: String(range.max) }];
  }
  if (hasMin) {
    return [{ id: createRowId(), field, operator: 'at_least', value: String(range.min) }];
  }
  if (hasMax) {
    return [{ id: createRowId(), field, operator: 'at_most', value: String(range.max) }];
  }
  return [];
};

const dateRangeToRows = (range: NonNullable<AdvancedFilters['date']>): AutomationConditionRow[] => {
  const from = range.from?.trim();
  const to = range.to?.trim();
  if (from && to && from === to) {
    return [{ id: createRowId(), field: 'date', operator: 'equals', value: from }];
  }
  if (from && to) {
    return [{ id: createRowId(), field: 'date', operator: 'between', value: from, valueEnd: to }];
  }
  if (from) {
    return [{ id: createRowId(), field: 'date', operator: 'at_least', value: from }];
  }
  if (to) {
    return [{ id: createRowId(), field: 'date', operator: 'at_most', value: to }];
  }
  return [];
};

export function conditionRowsToCriteria(
  rows: AutomationConditionRow[],
  matchMode: AutomationRuleCriteria['matchMode'],
): AutomationRuleCriteria {
  const completeRows = rows.map(normalizeConditionRow).filter(isConditionRowComplete);
  const filters: AutomationRuleFilterCriteria = {
    tagMatchMode: 'any',
    favoriteFilterMode: 'neutral',
    advancedFilters: {},
  };
  const textConditions = [];

  for (const row of completeRows) {
    if (isTextField(row.field) && isTextOperator(row.operator)) {
      if (row.field === 'search') {
        if (row.operator === 'contains') {
          filters.searchQuery = row.value.trim();
        }
        continue;
      }
      textConditions.push({ id: row.id, field: row.field, operator: row.operator, value: row.value.trim() });
      continue;
    }

    applyRowToFilters(row, filters);
  }

  return {
    matchMode,
    textConditions,
    conditionRows: completeRows,
    filters,
  };
}

const pushFilterValue = (
  filters: AutomationRuleFilterCriteria,
  key: keyof AutomationRuleFilterCriteria,
  value: string,
  lower = false,
) => {
  const normalized = lower ? value.trim().toLowerCase() : value.trim();
  if (!normalized) return;
  const current = Array.isArray(filters[key]) ? filters[key] as string[] : [];
  (filters as Record<string, unknown>)[key] = Array.from(new Set([...current, normalized]));
};

const applyRowToFilters = (row: AutomationConditionRow, filters: AutomationRuleFilterCriteria) => {
  const isExclude = row.operator === 'not_includes' || row.operator === 'is_not' || row.operator === 'not_equals';
  switch (row.field) {
    case 'model': pushFilterValue(filters, isExclude ? 'excludedModels' : 'models', row.value); break;
    case 'lora': pushFilterValue(filters, isExclude ? 'excludedLoras' : 'loras', row.value); break;
    case 'sampler': pushFilterValue(filters, isExclude ? 'excludedSamplers' : 'samplers', row.value); break;
    case 'scheduler': pushFilterValue(filters, isExclude ? 'excludedSchedulers' : 'schedulers', row.value); break;
    case 'generator': pushFilterValue(filters, isExclude ? 'excludedGenerators' : 'generators', row.value); break;
    case 'gpu': pushFilterValue(filters, isExclude ? 'excludedGpuDevices' : 'gpuDevices', row.value); break;
    case 'tag':
      pushFilterValue(filters, isExclude ? 'excludedTags' : 'tags', row.value, true);
      if (!isExclude && row.groupMode === 'all') {
        filters.tagMatchMode = 'all';
      }
      break;
    case 'autoTag': pushFilterValue(filters, isExclude ? 'excludedAutoTags' : 'autoTags', row.value); break;
    case 'dimension':
      filters.advancedFilters = { ...filters.advancedFilters, dimension: row.value.trim() };
      break;
    case 'date':
      filters.advancedFilters = {
        ...filters.advancedFilters,
        date: rowToDateRange(row),
      };
      break;
    case 'generationMode':
      filters.advancedFilters = {
        ...filters.advancedFilters,
        generationModes: Array.from(new Set([
          ...(filters.advancedFilters?.generationModes ?? []),
          row.value.trim() as 'txt2img' | 'img2img',
        ])).filter((value): value is 'txt2img' | 'img2img' => value === 'txt2img' || value === 'img2img'),
      };
      break;
    case 'mediaType':
      filters.advancedFilters = {
        ...filters.advancedFilters,
        mediaTypes: Array.from(new Set([
          ...(filters.advancedFilters?.mediaTypes ?? []),
          row.value.trim() as 'image' | 'video' | 'audio',
        ])).filter((value): value is 'image' | 'video' | 'audio' =>
          value === 'image' || value === 'video' || value === 'audio'
        ),
      };
      break;
    case 'favorite':
      filters.favoriteFilterMode = row.operator === 'is_not' ? 'exclude' : 'include';
      break;
    case 'rating':
      filters.ratings = Array.from(new Set([...(filters.ratings ?? []), Number(row.value) as ImageRating]))
        .filter((rating): rating is ImageRating => [1, 2, 3, 4, 5].includes(rating));
      break;
    case 'steps':
    case 'cfg':
    case 'generationTimeMs':
    case 'stepsPerSecond':
    case 'vramPeakMb':
      filters.advancedFilters = {
        ...filters.advancedFilters,
        [row.field]: rowToRange(row),
      };
      break;
    case 'telemetry':
      filters.advancedFilters = {
        ...filters.advancedFilters,
        telemetryState: row.operator === 'is_not' ? 'missing' : 'present',
      };
      break;
    case 'verifiedTelemetry':
      if (row.operator === 'is') {
        filters.advancedFilters = { ...filters.advancedFilters, hasVerifiedTelemetry: true };
      }
      break;
  }
};

const rowToRange = (
  row: AutomationConditionRow,
): NonNullable<AdvancedFilters['steps'] | AdvancedFilters['cfg'] | AdvancedFilters['generationTimeMs'] | AdvancedFilters['stepsPerSecond'] | AdvancedFilters['vramPeakMb']> => {
  const value = Number(row.value);
  const valueEnd = Number(row.valueEnd);
  if (row.operator === 'between') {
    return { min: Number.isFinite(value) ? value : null, max: Number.isFinite(valueEnd) ? valueEnd : null };
  }
  if (row.operator === 'at_least') return { min: Number.isFinite(value) ? value : null, max: null };
  if (row.operator === 'at_most') return { min: null, max: Number.isFinite(value) ? value : null };
  return { min: Number.isFinite(value) ? value : null, max: Number.isFinite(value) ? value : null };
};

const rowToDateRange = (row: AutomationConditionRow): NonNullable<AdvancedFilters['date']> => {
  const value = row.value.trim();
  const valueEnd = row.valueEnd?.trim();
  if (row.operator === 'between') {
    return { from: value || undefined, to: valueEnd || undefined };
  }
  if (row.operator === 'at_least') {
    return { from: value || undefined, to: undefined };
  }
  if (row.operator === 'at_most') {
    return { from: undefined, to: value || undefined };
  }
  return { from: value || undefined, to: value || undefined };
};

export function getConditionValueOptions(
  field: AutomationConditionField,
  source: ConditionValueSource,
): string[] {
  switch (field) {
    case 'model': return source.availableModels;
    case 'lora': return source.availableLoras;
    case 'sampler': return source.availableSamplers;
    case 'scheduler': return source.availableSchedulers;
    case 'generator': return source.availableGenerators;
    case 'gpu': return source.availableGpuDevices;
    case 'tag': return source.availableTags.map((tag) => tag.name);
    case 'autoTag': return source.availableAutoTags.map((tag) => tag.name);
    case 'dimension': return source.availableDimensions;
    case 'generationMode': return ['txt2img', 'img2img'];
    case 'mediaType': return ['image', 'video', 'audio'];
    case 'rating': return ['1', '2', '3', '4', '5'];
    case 'favorite': return ['true'];
    case 'prompt':
    case 'negativePrompt':
    case 'filename':
    case 'metadata':
    case 'search':
      return getTextValueSuggestions(field, source.images);
    default:
      return [];
  }
}

export function getTextValueSuggestions(field: AutomationConditionField, images: IndexedImage[], limit = 80): string[] {
  const counts = new Map<string, number>();
  for (const image of images) {
    const text = getTextForField(field, image).toLowerCase();
    for (const rawToken of text.split(/[\s,]+/)) {
      const token = rawToken.replace(/^[^a-z0-9_-]+|[^a-z0-9_-]+$/gi, '').trim();
      if (token.length < 2 || /^\d+$/.test(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

const getTextForField = (field: AutomationConditionField, image: IndexedImage): string => {
  switch (field) {
    case 'search':
      return [
        image.name,
        image.prompt,
        image.negativePrompt,
        image.metadataString,
        ...(image.models ?? []),
        ...(image.loras ?? []).map((lora) => typeof lora === 'string' ? lora : lora?.name ?? lora?.model_name ?? ''),
        image.sampler,
        image.scheduler,
      ].filter(Boolean).join(' ');
    case 'negativePrompt': return image.negativePrompt ?? image.metadata?.normalizedMetadata?.negativePrompt ?? '';
    case 'filename': return image.name ?? '';
    case 'metadata': return image.metadataString ?? '';
    case 'prompt': return image.prompt ?? image.metadata?.normalizedMetadata?.prompt ?? '';
    default: return '';
  }
};
