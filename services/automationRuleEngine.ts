import type {
  AutomationRule,
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
    const isVideo =
      image.metadata?.normalizedMetadata?.media_type === 'video' ||
      (image.fileType ?? '').startsWith('video/');
    const resolvedGenerationMode =
      explicitGenerationType === 'txt2img' || explicitGenerationType === 'img2img'
        ? explicitGenerationType
        : isVideo
          ? null
          : 'txt2img';

    if (!resolvedGenerationMode || !advanced.generationModes.includes(resolvedGenerationMode)) {
      return false;
    }
  }

  if (Array.isArray(advanced.mediaTypes) && advanced.mediaTypes.length > 0) {
    const resolvedMediaType =
      image.metadata?.normalizedMetadata?.media_type === 'video' || (image.fileType ?? '').startsWith('video/')
        ? 'video'
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

export function imageMatchesAutomationRule(image: IndexedImage, rule: AutomationRule): boolean {
  if (!rule.enabled) {
    return false;
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
