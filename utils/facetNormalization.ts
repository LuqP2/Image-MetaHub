import { type IndexedImage, type LoRAInfo } from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const normalizeFacetValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (isRecord(value)) {
    const nestedName = normalizeFacetValue(value.name);
    if (nestedName) {
      return nestedName;
    }

    const modelName = normalizeFacetValue(value.model_name);
    if (modelName) {
      return modelName;
    }
  }

  return null;
};

const normalizeSearchText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  return '';
};

const normalizeModels = (models: unknown): string[] => {
  if (!Array.isArray(models)) {
    return [];
  }

  return models
    .map(normalizeFacetValue)
    .filter((value): value is string => Boolean(value));
};

const normalizeLoras = (loras: unknown): Array<string | LoRAInfo> => {
  if (!Array.isArray(loras)) {
    return [];
  }

  const normalized: Array<string | LoRAInfo> = [];

  for (const lora of loras) {
    if (typeof lora === 'string' || typeof lora === 'number') {
      const value = normalizeFacetValue(lora);
      if (value) {
        normalized.push(value);
      }
      continue;
    }

    if (!isRecord(lora)) {
      continue;
    }

    const name = normalizeFacetValue(lora.name ?? lora.model_name);
    if (!name) {
      continue;
    }

    const normalizedLora: LoRAInfo = {
      name,
    };
    if (typeof lora.model_name === 'string') {
      normalizedLora.model_name = lora.model_name;
    }
    if (typeof lora.weight === 'number') {
      normalizedLora.weight = lora.weight;
    }
    if (typeof lora.model_weight === 'number') {
      normalizedLora.model_weight = lora.model_weight;
    }
    if (typeof lora.clip_weight === 'number') {
      normalizedLora.clip_weight = lora.clip_weight;
    }

    normalized.push({
      ...normalizedLora,
    });
  }

  return normalized;
};

export const sanitizeIndexedImageFacets = (image: IndexedImage): IndexedImage => {
  const models = normalizeModels(image.models);
  const loras = normalizeLoras(image.loras);
  const sampler = normalizeFacetValue(image.sampler) ?? '';
  const scheduler = normalizeFacetValue(image.scheduler) ?? '';
  const dimensions = normalizeFacetValue(image.dimensions) ?? '';
  const board = normalizeSearchText(image.board);
  const prompt = normalizeSearchText(image.prompt);
  const negativePrompt = normalizeSearchText(image.negativePrompt);
  const metadataString = normalizeSearchText(image.metadataString);

  const modelsChanged =
    !Array.isArray(image.models) ||
    models.length !== image.models.length ||
    models.some((value, index) => value !== image.models[index]);

  const lorasChanged =
    !Array.isArray(image.loras) ||
    loras.length !== image.loras.length ||
    loras.some((value, index) => {
      const original = image.loras[index];
      if (typeof value === 'string' || typeof original === 'string') {
        return value !== original;
      }

      return !isRecord(original) || original.name !== value.name;
    });

  if (
    !modelsChanged &&
    !lorasChanged &&
    sampler === (image.sampler ?? '') &&
    scheduler === (image.scheduler ?? '') &&
    dimensions === (image.dimensions ?? '') &&
    board === (image.board ?? '') &&
    prompt === (image.prompt ?? '') &&
    negativePrompt === (image.negativePrompt ?? '') &&
    metadataString === image.metadataString
  ) {
    return image;
  }

  return {
    ...image,
    models,
    loras,
    sampler,
    scheduler,
    dimensions,
    board,
    prompt,
    negativePrompt,
    metadataString,
  };
};
