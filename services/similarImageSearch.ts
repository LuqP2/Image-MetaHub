import type {
  CheckpointMatchMode,
  IndexedImage,
  SimilarSearchCriteria,
  SimilarSearchResult,
  SimilarSearchScope,
} from '../types';
import { normalizeFacetValue } from '../utils/facetNormalization';
import { normalizePrompt, normalizedLevenshtein, tokenizeForSimilarity } from '../utils/similarityMetrics';

const DEFAULT_SCOPE: SimilarSearchScope = 'current-view';
export const DEFAULT_SIMILAR_PROMPT_THRESHOLD = 0.87;
export const MAX_SIMILAR_SEARCH_RESULTS = 250;

type NormalizedLoraEntry = {
  name: string;
  weight: number | null;
};

export type SimilarSearchAvailability = {
  prompt: boolean;
  lora: boolean;
  seed: boolean;
  checkpoint: boolean;
};

export type SimilarSearchSourceDetails = {
  normalizedPrompt: string | null;
  normalizedSimilarityPrompt: string | null;
  loras: NormalizedLoraEntry[];
  seed: number | null;
  checkpoints: string[];
  primaryCheckpoint: string | null;
  folderKey: string;
};

export type SimilarSearchExecution = {
  results: SimilarSearchResult[];
  availability: SimilarSearchAvailability;
  effectiveCriteria: SimilarSearchCriteria;
  source: SimilarSearchSourceDetails;
  hasActiveCriterion: boolean;
  candidates: IndexedImage[];
};

export type ModelPromptOverlapGroup = {
  normalizedPrompt: string;
  promptPreview: string;
  sourceCount: number;
  alternateCheckpointCount: number;
  sourceImage: IndexedImage;
};

const LO_RA_WEIGHT_EPSILON = 1e-9;

export const DEFAULT_SIMILAR_SEARCH_CRITERIA: SimilarSearchCriteria = {
  prompt: true,
  promptThreshold: DEFAULT_SIMILAR_PROMPT_THRESHOLD,
  lora: false,
  matchLoraWeight: false,
  seed: false,
  checkpointMode: 'ignore',
  scope: DEFAULT_SCOPE,
};

const getRelativeImagePath = (image: IndexedImage): string => {
  const [, relativePath = ''] = image.id.split('::');
  return relativePath || image.name || '';
};

const getRelativeFolderPath = (image: IndexedImage): string => {
  const normalizedPath = getRelativeImagePath(image).replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return '';
  }

  return segments.slice(0, -1).join('/');
};

const toLowerCaseKey = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : null;
};

const normalizePromptLineEndings = (value: string) => value.replace(/\r\n?/g, '\n');

const getImagePromptForSimilarSearch = (image: IndexedImage): string =>
  image.prompt || image.metadata?.normalizedMetadata?.prompt || '';

export const normalizePromptForSimilarSearch = (prompt?: string | null): string => {
  if (!prompt) {
    return '';
  }

  return normalizePromptLineEndings(prompt)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

export const promptsExactlyMatchNormalized = (
  left?: string | null,
  right?: string | null,
): boolean => {
  const normalizedLeft = normalizePromptForSimilarSearch(left);
  const normalizedRight = normalizePromptForSimilarSearch(right);
  return Boolean(normalizedLeft) && normalizedLeft === normalizedRight;
};

const normalizeNumericWeight = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return null;
};

const normalizeLoraEntries = (image: IndexedImage): NormalizedLoraEntry[] => {
  const normalized = (image.loras || []).flatMap((lora) => {
    if (typeof lora === 'string') {
      const normalizedName = toLowerCaseKey(normalizeFacetValue(lora));
      return normalizedName ? [{ name: normalizedName, weight: null }] : [];
    }

    const normalizedName = toLowerCaseKey(normalizeFacetValue(lora));
    if (!normalizedName) {
      return [];
    }

    const weight = normalizeNumericWeight(lora.weight ?? lora.model_weight);
    return [{ name: normalizedName, weight }];
  });

  const deduped = new Map<string, NormalizedLoraEntry>();
  for (const entry of normalized) {
    const existing = deduped.get(entry.name);
    if (!existing) {
      deduped.set(entry.name, entry);
      continue;
    }

    if (existing.weight == null && entry.weight != null) {
      deduped.set(entry.name, entry);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => left.name.localeCompare(right.name));
};

const normalizeCheckpointList = (image: IndexedImage): string[] => {
  const normalized = (image.models || [])
    .map((model) => toLowerCaseKey(normalizeFacetValue(model)))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(normalized));
};

const haveSameLoraNames = (left: NormalizedLoraEntry[], right: NormalizedLoraEntry[]) => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry.name === right[index]?.name);
};

const haveSameLoraWeights = (left: NormalizedLoraEntry[], right: NormalizedLoraEntry[]) => {
  if (!haveSameLoraNames(left, right)) {
    return false;
  }

  return left.every((entry, index) => {
    const other = right[index];
    if (!other) {
      return false;
    }

    if (entry.weight == null || other.weight == null) {
      return entry.weight == null && other.weight == null;
    }

    return Math.abs(entry.weight - other.weight) <= LO_RA_WEIGHT_EPSILON;
  });
};

export const getSimilarSearchAvailability = (image: IndexedImage): SimilarSearchAvailability => {
  const normalizedPrompt = normalizePromptForSimilarSearch(getImagePromptForSimilarSearch(image));
  const loras = normalizeLoraEntries(image);
  const checkpoints = normalizeCheckpointList(image);

  return {
    prompt: normalizedPrompt.length > 0,
    lora: loras.length > 0,
    seed: typeof image.seed === 'number' && Number.isFinite(image.seed),
    checkpoint: checkpoints.length > 0,
  };
};

export const getSimilarSearchSourceDetails = (image: IndexedImage): SimilarSearchSourceDetails => {
  const prompt = getImagePromptForSimilarSearch(image);
  const normalizedPrompt = normalizePromptForSimilarSearch(prompt);
  const normalizedSimilarityPrompt = normalizePrompt(prompt);
  const checkpoints = normalizeCheckpointList(image);

  return {
    normalizedPrompt: normalizedPrompt || null,
    normalizedSimilarityPrompt: normalizedSimilarityPrompt || null,
    loras: normalizeLoraEntries(image),
    seed: typeof image.seed === 'number' && Number.isFinite(image.seed) ? image.seed : null,
    checkpoints,
    primaryCheckpoint: checkpoints[0] ?? null,
    folderKey: `${image.directoryId || ''}::${getRelativeFolderPath(image)}`,
  };
};

const getEffectiveCriteria = (
  source: SimilarSearchSourceDetails,
  criteria: SimilarSearchCriteria,
): SimilarSearchCriteria => ({
  ...criteria,
  prompt: criteria.prompt && Boolean(source.normalizedPrompt),
  lora: criteria.lora && source.loras.length > 0,
  matchLoraWeight: criteria.lora && criteria.matchLoraWeight && source.loras.length > 0,
  seed: criteria.seed && source.seed != null,
  checkpointMode:
    criteria.checkpointMode !== 'ignore' && source.checkpoints.length === 0
      ? 'ignore'
      : criteria.checkpointMode,
});

const hasAnyActiveCriterion = (criteria: SimilarSearchCriteria) =>
  criteria.prompt || criteria.lora || criteria.seed || criteria.checkpointMode !== 'ignore';

export const resolveSimilarSearchCandidates = ({
  sourceImage,
  allImages,
  currentViewImages,
  scope,
}: {
  sourceImage: IndexedImage;
  allImages: IndexedImage[];
  currentViewImages?: IndexedImage[];
  scope: SimilarSearchScope;
}): IndexedImage[] => {
  if (scope === 'all-images') {
    return allImages;
  }

  if (scope === 'same-folder') {
    const sourceFolderKey = getSimilarSearchSourceDetails(sourceImage).folderKey;
    return allImages.filter((image) => getSimilarSearchSourceDetails(image).folderKey === sourceFolderKey);
  }

  return currentViewImages && currentViewImages.length > 0 ? currentViewImages : allImages;
};

const buildMatchedFields = ({
  criteria,
  sharesCheckpoint,
}: {
  criteria: SimilarSearchCriteria;
  sharesCheckpoint: boolean;
}): SimilarSearchResult['matchedFields'] => {
  const matchedFields: SimilarSearchResult['matchedFields'] = [];

  if (criteria.prompt) {
    matchedFields.push('prompt');
  }
  if (criteria.lora) {
    matchedFields.push('lora');
  }
  if (criteria.lora && criteria.matchLoraWeight) {
    matchedFields.push('loraWeight');
  }
  if (criteria.seed) {
    matchedFields.push('seed');
  }
  if (criteria.checkpointMode !== 'ignore') {
    matchedFields.push('checkpoint');
  }
  if (criteria.checkpointMode === 'ignore' && sharesCheckpoint) {
    matchedFields.push('checkpoint');
  }

  return matchedFields;
};

const choosePreselectedIds = (results: Omit<SimilarSearchResult, 'preselected'>[], maxSelections = 3) => {
  const preselected = new Set<string>();
  const usedCheckpoints = new Set<string>();

  for (const result of results) {
    if (preselected.size >= maxSelections) {
      break;
    }

    const checkpointKey = result.primaryCheckpoint || '__missing__';
    if (usedCheckpoints.has(checkpointKey)) {
      continue;
    }

    usedCheckpoints.add(checkpointKey);
    preselected.add(result.image.id);
  }

  if (preselected.size >= maxSelections) {
    return preselected;
  }

  for (const result of results) {
    if (preselected.size >= maxSelections) {
      break;
    }

    preselected.add(result.image.id);
  }

  return preselected;
};

const compareNewestFirst = (left: IndexedImage, right: IndexedImage) => right.lastModified - left.lastModified;

const jaccardFromTokens = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }

  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

const calculatePromptSimilarity = ({
  sourcePrompt,
  sourceTokens,
  candidatePrompt,
  threshold,
}: {
  sourcePrompt: string;
  sourceTokens: Set<string>;
  candidatePrompt: string;
  threshold: number;
}): number | null => {
  if (sourcePrompt === candidatePrompt) {
    return 1;
  }

  const candidateTokens = tokenizeForSimilarity(candidatePrompt);
  const jaccard = jaccardFromTokens(sourceTokens, candidateTokens);
  const minJaccard = Math.max(0, (threshold - 0.4) / 0.6);
  if (jaccard < minJaccard) {
    return null;
  }

  const requiredLevenshtein = Math.max(0, Math.min(1, (threshold - jaccard * 0.6) / 0.4));
  const levenshtein = normalizedLevenshtein(sourcePrompt, candidatePrompt, requiredLevenshtein);
  const similarity = jaccard * 0.6 + levenshtein * 0.4;

  return similarity >= threshold ? similarity : null;
};

export const findSimilarImages = ({
  sourceImage,
  allImages,
  currentViewImages,
  criteria,
}: {
  sourceImage: IndexedImage;
  allImages: IndexedImage[];
  currentViewImages?: IndexedImage[];
  criteria: SimilarSearchCriteria;
}): SimilarSearchExecution => {
  const source = getSimilarSearchSourceDetails(sourceImage);
  const availability = getSimilarSearchAvailability(sourceImage);
  const effectiveCriteria = getEffectiveCriteria(source, criteria);
  const candidates = resolveSimilarSearchCandidates({
    sourceImage,
    allImages,
    currentViewImages,
    scope: effectiveCriteria.scope,
  });

  if (!hasAnyActiveCriterion(effectiveCriteria)) {
    return {
      results: [],
      availability,
      effectiveCriteria,
      source,
      hasActiveCriterion: false,
      candidates,
    };
  }

  const sourceSimilarityPrompt = source.normalizedSimilarityPrompt;
  const sourceSimilarityTokens = sourceSimilarityPrompt ? tokenizeForSimilarity(sourceSimilarityPrompt) : null;

  const rawResults = candidates
    .filter((image) => image.id !== sourceImage.id)
    .map((image) => {
      const candidateSource = getSimilarSearchSourceDetails(image);
      const candidateCheckpointSet = new Set(candidateSource.checkpoints);
      const sharesCheckpoint = source.checkpoints.some((checkpoint) => candidateCheckpointSet.has(checkpoint));

      let promptSimilarity: number | null = null;
      if (effectiveCriteria.prompt) {
        if (!sourceSimilarityPrompt || !sourceSimilarityTokens || !candidateSource.normalizedSimilarityPrompt) {
          return null;
        }

        promptSimilarity = calculatePromptSimilarity({
          sourcePrompt: sourceSimilarityPrompt,
          sourceTokens: sourceSimilarityTokens,
          candidatePrompt: candidateSource.normalizedSimilarityPrompt,
          threshold: effectiveCriteria.promptThreshold,
        });
        if (promptSimilarity == null) {
          return null;
        }
      }

      if (effectiveCriteria.lora && !haveSameLoraNames(candidateSource.loras, source.loras)) {
        return null;
      }

      if (effectiveCriteria.lora && effectiveCriteria.matchLoraWeight && !haveSameLoraWeights(candidateSource.loras, source.loras)) {
        return null;
      }

      if (effectiveCriteria.seed && candidateSource.seed !== source.seed) {
        return null;
      }

      if (effectiveCriteria.checkpointMode === 'same' && !sharesCheckpoint) {
        return null;
      }

      if (effectiveCriteria.checkpointMode === 'different') {
        if (candidateSource.checkpoints.length === 0) {
          return null;
        }

        if (sharesCheckpoint) {
          return null;
        }
      }

      return {
        image,
        matchedFields: buildMatchedFields({
          criteria: effectiveCriteria,
          sharesCheckpoint,
        }),
        primaryCheckpoint: candidateSource.primaryCheckpoint,
        sharesCheckpoint,
        promptSimilarity,
      } satisfies Omit<SimilarSearchResult, 'preselected'>;
    })
    .filter((result): result is Omit<SimilarSearchResult, 'preselected'> => Boolean(result))
    .sort((left, right) => {
      if (left.promptSimilarity !== right.promptSimilarity) {
        return (right.promptSimilarity ?? -1) - (left.promptSimilarity ?? -1);
      }

      return compareNewestFirst(left.image, right.image);
    });

  const preselectedIds = choosePreselectedIds(rawResults);
  const results = rawResults
    .slice(0, MAX_SIMILAR_SEARCH_RESULTS)
    .map((result) => ({
      ...result,
      preselected: preselectedIds.has(result.image.id),
    }));

  return {
    results,
    availability,
    effectiveCriteria,
    source,
    hasActiveCriterion: true,
    candidates,
  };
};

const getPrimaryCheckpointKey = (image: IndexedImage) =>
  getSimilarSearchSourceDetails(image).primaryCheckpoint;

const buildPromptPreview = (prompt: string) => {
  const normalized = normalizePromptLineEndings(prompt).trim().replace(/\s+/g, ' ');
  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 117)}...`;
};

export const getModelPromptOverlapGroups = (
  modelName: string,
  allImages: IndexedImage[],
): ModelPromptOverlapGroup[] => {
  const normalizedModel = toLowerCaseKey(modelName);
  if (!normalizedModel) {
    return [];
  }

  const imagesByPrompt = new Map<string, IndexedImage[]>();
  for (const image of allImages) {
    const normalizedPrompt = normalizePromptForSimilarSearch(getImagePromptForSimilarSearch(image));
    if (!normalizedPrompt) {
      continue;
    }

    const checkpoints = normalizeCheckpointList(image);
    if (!checkpoints.includes(normalizedModel)) {
      continue;
    }

    const group = imagesByPrompt.get(normalizedPrompt) || [];
    group.push(image);
    imagesByPrompt.set(normalizedPrompt, group);
  }

  const globalImagesByPrompt = new Map<string, IndexedImage[]>();
  for (const image of allImages) {
    const normalizedPrompt = normalizePromptForSimilarSearch(getImagePromptForSimilarSearch(image));
    if (!normalizedPrompt) {
      continue;
    }

    const group = globalImagesByPrompt.get(normalizedPrompt) || [];
    group.push(image);
    globalImagesByPrompt.set(normalizedPrompt, group);
  }

  return Array.from(imagesByPrompt.entries())
    .map(([normalizedPrompt, sourceImages]) => {
      const promptImages = globalImagesByPrompt.get(normalizedPrompt) || [];
      const sourceImageIds = new Set<string>();
      for (let i = 0; i < sourceImages.length; i++) {
        sourceImageIds.add(sourceImages[i].id);
      }
      const alternateCheckpoints = new Set<string>();

      for (const image of promptImages) {
        if (sourceImageIds.has(image.id)) {
          continue;
        }

        const primaryCheckpoint = getPrimaryCheckpointKey(image);
        if (primaryCheckpoint && primaryCheckpoint !== normalizedModel) {
          alternateCheckpoints.add(primaryCheckpoint);
        }
      }

      if (alternateCheckpoints.size === 0) {
        return null;
      }

      const sourceImage = [...sourceImages].sort(compareNewestFirst)[0];
      return {
        normalizedPrompt,
        promptPreview: buildPromptPreview(getImagePromptForSimilarSearch(sourceImage)),
        sourceCount: sourceImages.length,
        alternateCheckpointCount: alternateCheckpoints.size,
        sourceImage,
      } satisfies ModelPromptOverlapGroup;
    })
    .filter((group): group is ModelPromptOverlapGroup => Boolean(group))
    .sort((left, right) => {
      if (right.alternateCheckpointCount !== left.alternateCheckpointCount) {
        return right.alternateCheckpointCount - left.alternateCheckpointCount;
      }

      if (right.sourceCount !== left.sourceCount) {
        return right.sourceCount - left.sourceCount;
      }

      return compareNewestFirst(left.sourceImage, right.sourceImage);
    });
};
