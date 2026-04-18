import type {
  AutomationRule,
  AutomationConditionRow,
  AutomationRuleFilterCriteria,
  AutomationTextCondition,
  ImageAnnotations,
  ImageRating,
  IndexedImage,
  LoRAInfo,
  SmartCollection,
} from '../types';
import { getImageGenerator, getImageGpuDevice, hasTelemetryData } from '../utils/analyticsUtils';
import { parseLocalDateFilterEndExclusive, parseLocalDateFilterStart } from '../utils/dateFilterUtils';
import { resolveMediaType } from '../utils/mediaTypes.js';
import { hasVerifiedTelemetry } from '../utils/telemetryDetection';
import { resolveSmartCollectionImageIds } from './imageAnnotationsStorage';

export interface AutomationRulePreview {
  matchedImageIds: string[];
  matchCount: number;
  changeCount: number;
  tagChangeCount: number;
  collectionChangeCount: number;
}

export interface AutomationRuleApplyResult extends AutomationRulePreview {
  updatedAnnotations: ImageAnnotations[];
  collectionImageAdds: Map<string, string[]>;
}

const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const stripDimension = (value: string): string => value.replace(/\s+/g, '').toLowerCase();

const normalizeList = (values: string[] | undefined): string[] =>
  Array.isArray(values)
    ? values.map(normalize).filter(Boolean)
    : [];

const hasValues = (values: string[] | undefined): boolean =>
  Array.isArray(values) && values.some((value) => normalize(value));

const getLoraName = (lora: string | LoRAInfo): string => {
  if (typeof lora === 'string') {
    return lora;
  }
  return lora?.name || lora?.model_name || '';
};

const makeValueSet = (values: Array<string | undefined | null>): Set<string> =>
  new Set(values.map(normalize).filter(Boolean));

const getImageModelSet = (image: IndexedImage): Set<string> =>
  makeValueSet([
    ...(image.models ?? []),
    image.metadata?.normalizedMetadata?.model,
    ...(image.metadata?.normalizedMetadata?.models ?? []),
  ]);

const getImageLoraSet = (image: IndexedImage): Set<string> => {
  const values: string[] = [];
  image.loras?.forEach((lora) => values.push(getLoraName(lora)));
  const metadataLoras = image.metadata?.normalizedMetadata?.loras;
  if (Array.isArray(metadataLoras)) {
    metadataLoras.forEach((lora) => values.push(typeof lora === 'string' ? lora : lora?.name || lora?.model_name || ''));
  }
  return makeValueSet(values);
};

const getTextFieldValue = (image: IndexedImage, condition: AutomationTextCondition): string => {
  switch (condition.field) {
    case 'search':
      return getSearchText(image);
    case 'negativePrompt':
      return image.negativePrompt ?? image.metadata?.normalizedMetadata?.negativePrompt ?? '';
    case 'filename':
      return image.name ?? '';
    case 'metadata':
      return image.metadataString ?? '';
    case 'prompt':
    default:
      return image.prompt ?? image.metadata?.normalizedMetadata?.prompt ?? '';
  }
};

const matchesTextCondition = (image: IndexedImage, condition: AutomationTextCondition): boolean => {
  const haystack = normalize(getTextFieldValue(image, condition));
  const needle = normalize(condition.value);
  if (!needle) {
    return true;
  }

  switch (condition.operator) {
    case 'not_contains':
      return !haystack.includes(needle);
    case 'equals':
      return haystack === needle;
    case 'not_equals':
      return haystack !== needle;
    case 'contains':
    default:
      return haystack.includes(needle);
  }
};

const matchesTextOperator = (sourceValue: string, operator: string, targetValue: string): boolean => {
  const haystack = normalize(sourceValue);
  const needle = normalize(targetValue);
  if (!needle) return true;
  switch (operator) {
    case 'not_contains':
      return !haystack.includes(needle);
    case 'equals':
      return haystack === needle;
    case 'not_equals':
      return haystack !== needle;
    case 'contains':
    default:
      return haystack.includes(needle);
  }
};

const intersects = (imageValues: Set<string>, requiredValues: string[] | undefined): boolean => {
  const normalizedRequired = normalizeList(requiredValues);
  return normalizedRequired.some((value) => imageValues.has(value));
};

const excludesAll = (imageValues: Set<string>, excludedValues: string[] | undefined): boolean => {
  const normalizedExcluded = normalizeList(excludedValues);
  return !normalizedExcluded.some((value) => imageValues.has(value));
};

const matchesRange = (
  value: number | null | undefined,
  range: { min?: number | null; max?: number | null; maxExclusive?: boolean } | undefined,
): boolean => {
  if (!range) {
    return true;
  }
  if (value === null || value === undefined || Number.isNaN(value)) {
    return false;
  }

  if (range.min !== null && range.min !== undefined && value < range.min) {
    return false;
  }
  if (range.max !== null && range.max !== undefined) {
    return range.maxExclusive === true ? value < range.max : value <= range.max;
  }

  return true;
};

const matchesAdvancedFilters = (image: IndexedImage, filters: AutomationRuleFilterCriteria): boolean => {
  const advanced = filters.advancedFilters;
  if (!advanced || Object.keys(advanced).length === 0) {
    return true;
  }

  if (advanced.dimension) {
    const imageDim = image.dimensions?.replace(/\s+/g, '');
    const filterDim = advanced.dimension.replace(/\s+/g, '');
    if (!imageDim || imageDim !== filterDim) {
      return false;
    }
  }

  if (!matchesRange(image.steps, advanced.steps)) {
    return false;
  }
  if (!matchesRange(image.cfgScale, advanced.cfg)) {
    return false;
  }

  if (advanced.date?.from || advanced.date?.to) {
    if (advanced.date.from && image.lastModified < parseLocalDateFilterStart(advanced.date.from)) {
      return false;
    }
    if (advanced.date.to && image.lastModified >= parseLocalDateFilterEndExclusive(advanced.date.to)) {
      return false;
    }
  }

  if (Array.isArray(advanced.generationModes) && advanced.generationModes.length > 0) {
    const explicitGenerationType = image.metadata?.normalizedMetadata?.generationType;
    const mediaType = image.metadata?.normalizedMetadata?.media_type ?? resolveMediaType(image.name, image.fileType);
    const resolvedGenerationMode =
      explicitGenerationType === 'txt2img' || explicitGenerationType === 'img2img'
        ? explicitGenerationType
        : mediaType === 'video' || mediaType === 'audio'
          ? null
          : 'txt2img';

    if (!resolvedGenerationMode || !advanced.generationModes.includes(resolvedGenerationMode)) {
      return false;
    }
  }

  if (Array.isArray(advanced.mediaTypes) && advanced.mediaTypes.length > 0) {
    const metadataMediaType = image.metadata?.normalizedMetadata?.media_type;
    const inferredMediaType = resolveMediaType(image.name, image.fileType);
    const resolvedMediaType =
      metadataMediaType === 'video' || metadataMediaType === 'audio' || metadataMediaType === 'image'
        ? metadataMediaType
        : inferredMediaType === 'video' || inferredMediaType === 'audio'
          ? inferredMediaType
          : 'image';
    if (!advanced.mediaTypes.includes(resolvedMediaType)) {
      return false;
    }
  }

  if (advanced.telemetryState === 'present' && !hasTelemetryData(image)) {
    return false;
  }
  if (advanced.telemetryState === 'missing' && hasTelemetryData(image)) {
    return false;
  }
  if (advanced.hasVerifiedTelemetry === true && !hasVerifiedTelemetry(image)) {
    return false;
  }

  const analytics =
    image.metadata?.normalizedMetadata?.analytics ||
    (image.metadata?.normalizedMetadata as { _analytics?: Record<string, number> } | undefined)?._analytics;

  return (
    matchesRange(analytics?.generation_time_ms, advanced.generationTimeMs) &&
    matchesRange(analytics?.steps_per_second, advanced.stepsPerSecond) &&
    matchesRange(analytics?.vram_peak_mb, advanced.vramPeakMb)
  );
};

const getSearchText = (image: IndexedImage): string =>
  normalize([
    image.name,
    image.prompt,
    image.negativePrompt,
    image.metadataString,
    ...(image.models ?? []),
    ...(image.loras ?? []).map(getLoraName),
    image.sampler,
    image.scheduler,
  ].filter(Boolean).join(' '));

const hasActiveFilters = (filters: AutomationRuleFilterCriteria): boolean =>
  Boolean(
    normalize(filters.searchQuery) ||
    hasValues(filters.models) ||
    hasValues(filters.excludedModels) ||
    hasValues(filters.loras) ||
    hasValues(filters.excludedLoras) ||
    hasValues(filters.samplers) ||
    hasValues(filters.excludedSamplers) ||
    hasValues(filters.schedulers) ||
    hasValues(filters.excludedSchedulers) ||
    hasValues(filters.generators) ||
    hasValues(filters.excludedGenerators) ||
    hasValues(filters.gpuDevices) ||
    hasValues(filters.excludedGpuDevices) ||
    hasValues(filters.tags) ||
    hasValues(filters.excludedTags) ||
    hasValues(filters.autoTags) ||
    hasValues(filters.excludedAutoTags) ||
    filters.favoriteFilterMode === 'include' ||
    filters.favoriteFilterMode === 'exclude' ||
    (Array.isArray(filters.ratings) && filters.ratings.length > 0) ||
    (filters.advancedFilters && Object.keys(filters.advancedFilters).length > 0),
  );

const matchesFilterCriteria = (image: IndexedImage, filters: AutomationRuleFilterCriteria): boolean => {
  const modelSet = getImageModelSet(image);
  const loraSet = getImageLoraSet(image);
  const tagSet = makeValueSet(image.tags ?? []);
  const autoTagSet = makeValueSet(image.autoTags ?? []);
  const samplerSet = makeValueSet([image.sampler]);
  const schedulerSet = makeValueSet([image.scheduler]);
  const generatorSet = makeValueSet([getImageGenerator(image)]);
  const gpuDevice = getImageGpuDevice(image);
  const gpuSet = makeValueSet([gpuDevice ?? undefined]);

  if (normalize(filters.searchQuery)) {
    const terms = normalize(filters.searchQuery).split(/\s+/).filter(Boolean);
    const text = getSearchText(image);
    if (!terms.every((term) => text.includes(term))) {
      return false;
    }
  }

  if (hasValues(filters.models) && !intersects(modelSet, filters.models)) return false;
  if (hasValues(filters.excludedModels) && !excludesAll(modelSet, filters.excludedModels)) return false;
  if (hasValues(filters.loras) && !intersects(loraSet, filters.loras)) return false;
  if (hasValues(filters.excludedLoras) && !excludesAll(loraSet, filters.excludedLoras)) return false;
  if (hasValues(filters.samplers) && !intersects(samplerSet, filters.samplers)) return false;
  if (hasValues(filters.excludedSamplers) && !excludesAll(samplerSet, filters.excludedSamplers)) return false;
  if (hasValues(filters.schedulers) && !intersects(schedulerSet, filters.schedulers)) return false;
  if (hasValues(filters.excludedSchedulers) && !excludesAll(schedulerSet, filters.excludedSchedulers)) return false;
  if (hasValues(filters.generators) && !intersects(generatorSet, filters.generators)) return false;
  if (hasValues(filters.excludedGenerators) && !excludesAll(generatorSet, filters.excludedGenerators)) return false;
  if (hasValues(filters.gpuDevices) && !intersects(gpuSet, filters.gpuDevices)) return false;
  if (hasValues(filters.excludedGpuDevices) && !excludesAll(gpuSet, filters.excludedGpuDevices)) return false;

  if (hasValues(filters.tags)) {
    const requiredTags = normalizeList(filters.tags);
    const tagMatched =
      filters.tagMatchMode === 'all'
        ? requiredTags.every((tag) => tagSet.has(tag))
        : requiredTags.some((tag) => tagSet.has(tag));
    if (!tagMatched) {
      return false;
    }
  }
  if (hasValues(filters.excludedTags) && !excludesAll(tagSet, filters.excludedTags)) return false;
  if (hasValues(filters.autoTags) && !intersects(autoTagSet, filters.autoTags)) return false;
  if (hasValues(filters.excludedAutoTags) && !excludesAll(autoTagSet, filters.excludedAutoTags)) return false;

  if (filters.favoriteFilterMode === 'include' && image.isFavorite !== true) return false;
  if (filters.favoriteFilterMode === 'exclude' && image.isFavorite === true) return false;

  if (Array.isArray(filters.ratings) && filters.ratings.length > 0) {
    const ratings = new Set<ImageRating>(filters.ratings);
    if (image.rating === undefined || !ratings.has(image.rating)) {
      return false;
    }
  }

  return matchesAdvancedFilters(image, filters);
};

const getRowTextValue = (image: IndexedImage, field: AutomationConditionRow['field']): string => {
  switch (field) {
    case 'search':
      return getSearchText(image);
    case 'negativePrompt':
      return image.negativePrompt ?? image.metadata?.normalizedMetadata?.negativePrompt ?? '';
    case 'filename':
      return image.name ?? '';
    case 'metadata':
      return image.metadataString ?? '';
    case 'prompt':
      return image.prompt ?? image.metadata?.normalizedMetadata?.prompt ?? '';
    default:
      return '';
  }
};

const matchesNumberRow = (value: number | undefined, row: AutomationConditionRow): boolean => {
  if (value === undefined || Number.isNaN(value)) return false;
  const target = Number(row.value);
  const targetEnd = Number(row.valueEnd);
  if (!Number.isFinite(target)) return false;
  switch (row.operator) {
    case 'at_least':
      return value >= target;
    case 'at_most':
      return value <= target;
    case 'between':
      return Number.isFinite(targetEnd) && value >= target && value <= targetEnd;
    case 'not_equals':
      return value !== target;
    case 'equals':
    default:
      return value === target;
  }
};

const matchesFacetRow = (values: Set<string>, row: AutomationConditionRow): boolean => {
  const target = normalize(row.value);
  if (!target) return true;
  const hasValue = values.has(target);
  return row.operator === 'not_includes' || row.operator === 'not_equals' ? !hasValue : hasValue;
};

const GROUPABLE_ROW_FIELDS = new Set<AutomationConditionRow['field']>([
  'model',
  'lora',
  'sampler',
  'scheduler',
  'generator',
  'gpu',
  'tag',
  'autoTag',
  'dimension',
]);

const getConditionRowGroupKey = (row: AutomationConditionRow): string | null => {
  if (GROUPABLE_ROW_FIELDS.has(row.field)) {
    return `${row.field}:${row.operator}`;
  }
  if (row.field === 'rating' && row.operator === 'equals') {
    return `${row.field}:${row.operator}`;
  }
  return null;
};

const combineGroupedRowResults = (row: AutomationConditionRow, results: boolean[]): boolean => {
  const exclusionOperator =
    row.operator === 'not_includes' ||
    row.operator === 'is_not' ||
    row.operator === 'not_equals';
  if (row.groupMode === 'all') {
    return results.every(Boolean);
  }
  return exclusionOperator ? results.every(Boolean) : results.some(Boolean);
};

const matchesConditionRow = (image: IndexedImage, row: AutomationConditionRow): boolean => {
  switch (row.field) {
    case 'prompt':
    case 'search':
    case 'negativePrompt':
    case 'filename':
    case 'metadata':
      return matchesTextOperator(getRowTextValue(image, row.field), row.operator, row.value);
    case 'model':
      return matchesFacetRow(getImageModelSet(image), row);
    case 'lora':
      return matchesFacetRow(getImageLoraSet(image), row);
    case 'sampler':
      return matchesFacetRow(makeValueSet([image.sampler]), row);
    case 'scheduler':
      return matchesFacetRow(makeValueSet([image.scheduler]), row);
    case 'generator':
      return matchesFacetRow(makeValueSet([getImageGenerator(image)]), row);
    case 'gpu':
      return matchesFacetRow(makeValueSet([getImageGpuDevice(image) ?? undefined]), row);
    case 'tag':
      return matchesFacetRow(makeValueSet(image.tags ?? []), row);
    case 'autoTag':
      return matchesFacetRow(makeValueSet(image.autoTags ?? []), row);
    case 'dimension': {
      const imageDimension = stripDimension(image.dimensions ?? '');
      const target = stripDimension(row.value);
      const hasDimension = Boolean(target) && imageDimension === target;
      return row.operator === 'not_includes' || row.operator === 'not_equals' ? !hasDimension : hasDimension;
    }
    case 'favorite': {
      const isFavorite = image.isFavorite === true;
      return row.operator === 'is_not' ? !isFavorite : isFavorite;
    }
    case 'rating':
      return matchesNumberRow(image.rating, row);
    case 'steps':
      return matchesNumberRow(image.steps, row);
    case 'cfg':
      return matchesNumberRow(image.cfgScale, row);
    case 'telemetry': {
      const hasTelemetry = hasTelemetryData(image);
      return row.operator === 'is_not' ? !hasTelemetry : hasTelemetry;
    }
    case 'verifiedTelemetry': {
      const hasVerified = hasVerifiedTelemetry(image);
      return row.operator === 'is_not' ? !hasVerified : hasVerified;
    }
    default:
      return false;
  }
};

export function imageMatchesAutomationRule(image: IndexedImage, rule: AutomationRule): boolean {
  if (!rule.enabled) {
    return false;
  }

  if (rule.criteria.conditionRows?.length) {
    const rowChecks: boolean[] = [];
    const groupedChecks = new Map<string, { row: AutomationConditionRow; results: boolean[] }>();
    const rows = rule.criteria.conditionRows.filter((row) =>
      row.value.trim() ||
      row.field === 'favorite' ||
      row.field === 'telemetry' ||
      row.field === 'verifiedTelemetry',
    );

    for (const row of rows) {
      const groupKey = getConditionRowGroupKey(row);
      const result = matchesConditionRow(image, row);
      if (!groupKey) {
        rowChecks.push(result);
        continue;
      }
      const group = groupedChecks.get(groupKey) ?? { row, results: [] };
      group.results.push(result);
      groupedChecks.set(groupKey, group);
    }

    for (const group of groupedChecks.values()) {
      rowChecks.push(combineGroupedRowResults(group.row, group.results));
    }

    if (rowChecks.length === 0) return false;
    return rule.criteria.matchMode === 'any'
      ? rowChecks.some(Boolean)
      : rowChecks.every(Boolean);
  }

  const filters = rule.criteria.filters ?? {};
  const checks: boolean[] = [
    ...(rule.criteria.textConditions ?? []).map((condition) => matchesTextCondition(image, condition)),
  ];

  if (hasActiveFilters(filters)) {
    checks.push(matchesFilterCriteria(image, filters));
  }

  if (checks.length === 0) {
    return false;
  }

  return rule.criteria.matchMode === 'any'
    ? checks.some(Boolean)
    : checks.every(Boolean);
}

const buildAnnotation = (
  imageId: string,
  currentAnnotation: ImageAnnotations | undefined,
  tags: string[],
): ImageAnnotations => ({
  imageId,
  isFavorite: currentAnnotation?.isFavorite ?? false,
  tags,
  rating: currentAnnotation?.rating,
  addedAt: currentAnnotation?.addedAt ?? Date.now(),
  updatedAt: Date.now(),
});

export function applyAutomationRuleToImages(
  rule: AutomationRule,
  images: IndexedImage[],
  annotations: Map<string, ImageAnnotations>,
  collections: SmartCollection[],
): AutomationRuleApplyResult {
  const matchedImageIds: string[] = [];
  const updatedAnnotations: ImageAnnotations[] = [];
  const collectionImageAdds = new Map<string, string[]>();
  const normalizedActionTags = normalizeList(rule.actions.addTags).map((tag) => tag.toLowerCase());
  const collectionIds = normalizeList(rule.actions.addToCollectionIds);
  const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
  const resolvedCollectionIds = new Map<string, Set<string>>();
  for (const collectionId of collectionIds) {
    const collection = collectionById.get(collectionId);
    if (collection) {
      resolvedCollectionIds.set(collectionId, new Set(resolveSmartCollectionImageIds(collection, images)));
    }
  }
  let tagChangeCount = 0;
  let collectionChangeCount = 0;

  for (const image of images) {
    if (!imageMatchesAutomationRule(image, rule)) {
      continue;
    }

    matchedImageIds.push(image.id);
    const currentAnnotation = annotations.get(image.id);
    const existingTags = new Set((currentAnnotation?.tags ?? image.tags ?? []).map((tag) => tag.toLowerCase()));
    const nextTags = [...existingTags];

    for (const tag of normalizedActionTags) {
      if (!existingTags.has(tag)) {
        existingTags.add(tag);
        nextTags.push(tag);
        tagChangeCount += 1;
      }
    }

    if (nextTags.length !== (currentAnnotation?.tags ?? image.tags ?? []).length) {
      updatedAnnotations.push(buildAnnotation(image.id, currentAnnotation, nextTags));
    }

    for (const collectionId of collectionIds) {
      const collection = collectionById.get(collectionId);
      const resolvedIds = collection ? resolvedCollectionIds.get(collectionId) : undefined;
      if (!collection || !resolvedIds || resolvedIds.has(image.id)) {
        continue;
      }

      const existingAdds = collectionImageAdds.get(collectionId) ?? [];
      existingAdds.push(image.id);
      collectionImageAdds.set(collectionId, existingAdds);
      resolvedIds.add(image.id);
      collectionChangeCount += 1;
    }
  }

  return {
    matchedImageIds,
    matchCount: matchedImageIds.length,
    changeCount: tagChangeCount + collectionChangeCount,
    tagChangeCount,
    collectionChangeCount,
    updatedAnnotations,
    collectionImageAdds,
  };
}

export function previewAutomationRule(
  rule: AutomationRule,
  images: IndexedImage[],
  annotations: Map<string, ImageAnnotations>,
  collections: SmartCollection[],
): AutomationRulePreview {
  const result = applyAutomationRuleToImages(rule, images, annotations, collections);
  return {
    matchedImageIds: result.matchedImageIds,
    matchCount: result.matchCount,
    changeCount: result.changeCount,
    tagChangeCount: result.tagChangeCount,
    collectionChangeCount: result.collectionChangeCount,
  };
}
