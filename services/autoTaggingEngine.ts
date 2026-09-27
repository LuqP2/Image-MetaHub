import type { AutoTag, ImageMetadata, LoRAInfo, TFIDFModel } from '../types';
import { resolveWorkflowFactsFromGraph } from './parsers/comfyUIParser';
import type { WorkflowFacts } from './parsers/comfyui/types';

export interface TaggingImage {
  id: string;
  prompt?: string;
  models?: string[];
  loras?: Array<string | LoRAInfo>;
  metadata?: ImageMetadata;
}

export interface AutoTaggingOptions {
  topN?: number;
  minScore?: number;
  excludeTags?: string[];
}

const DEFAULT_TOP_N = 6;
const DEFAULT_MIN_SCORE = 0.03;
const MAX_FRAGMENT_WORDS = 8;

const LORA_TAG_REGEX = /<lora:[^>]*>/gi;
const WEIGHT_BEFORE_CLOSING_REGEX = /:\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?=\s*[)\]}])/g;
const TRAILING_WEIGHT_REGEX = /:\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/;

const BOILERPLATE_FRAGMENTS = new Set([
  'masterpiece',
  'quality',
  'best',
  'detailed',
  'best quality',
  'high quality',
  'ultra detailed',
  'highly detailed',
  'extremely detailed',
  'very detailed',
  'award winning',
  'raw photo',
  'raw photograph',
  'high resolution',
  'highres',
  'lowres',
  'absurdres',
  'hdr',
  'uhd',
  '4k',
  '8k',
  '16k',
]);

// Comma-delimited prompts can also contain unfinished prose. Keep a fragment
// only when it can stand on its own as a descriptive tag.
// An imperative before an internal comma ("Visualize a long, ...") is prose,
// not a standalone descriptive fragment.
const CLAUSE_START = /^(?:and|or|but|while|which|that|who|whose|where|when|with|without|his|her|their|its|featuring|showing|depicting|including|visualize|imagine|create|generate|describe|depict|draw|render)\b/u;
const LIST_CLAUSE_START = /^(?:featuring|showing|depicting|including)\s+(.+)$/u;
const PRONOUN_ONLY = /^(?:i|you|he|she|it|we|they|this|that|these|those)$/u;
const INCOMPLETE_END = /\b(?:a|an|the|and|or|but|of|in|on|at|to|for|from|with|without|against|between|beneath|under|over|through|as|very|single|oversized|harsh)$/u;
const SENTENCE_VERB = /\b(?:is|are|was|were|has|have|had)\b|\b(?:casts|shows|depicts|features|contrasts|fills|illuminates|surrounds)\s+(?:a|an|the|this|that|his|her|their|its)\b/u;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractPromptFragments(prompt: string): string[] {
  if (!prompt) return [];

  let cleaned = prompt;
  cleaned = cleaned.replace(LORA_TAG_REGEX, ' ');
  cleaned = cleaned.replace(WEIGHT_BEFORE_CLOSING_REGEX, '');
  const fragments: string[] = [];

  for (const raw of cleaned.split(',')) {
    const normalized = normalizeWhitespace(raw
      .replace(TRAILING_WEIGHT_REGEX, '')
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
    const listClause = normalized.match(LIST_CLAUSE_START);
    const sentenceVerb = normalized.match(SENTENCE_VERB);
    let candidates = [normalized];
    if (listClause) {
      const listed = listClause[1];
      const parts = listed.split(/\s+and\s+/u);
      candidates = parts.length === 2 && parts.every(part => part.split(' ').length >= 2)
        ? parts
        : [listed];
    } else if (sentenceVerb && sentenceVerb.index > 0) {
      candidates = [normalized.slice(0, sentenceVerb.index).trim()];
    }

    for (const candidate of candidates) {
      const concept = normalizeWhitespace(candidate.replace(/^(?:a|an|the)\s+/u, ''));
      if (concept.length < 2 || /^\d+$/.test(concept)) continue;
      if (PRONOUN_ONLY.test(concept)) continue;
      if (concept.split(' ').length > MAX_FRAGMENT_WORDS) continue;
      if (BOILERPLATE_FRAGMENTS.has(concept)) continue;
      if (/^score(?:\s*\d+)?(?:\s*up)?$/.test(concept)) continue;
      if (CLAUSE_START.test(concept) || INCOMPLETE_END.test(concept) || SENTENCE_VERB.test(concept)) continue;
      fragments.push(concept);
    }
  }

  return fragments;
}

function collectDocumentTerms(image: TaggingImage): Set<string> {
  return new Set(extractPromptFragments(image.prompt ?? ''));
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function getIdfScore(term: string, model: TFIDFModel): number {
  const existing = model.idfScores.get(term);
  if (existing !== undefined) {
    return existing;
  }
  return Math.log((model.documentCount + 1) / 1) + 1;
}

function addTagScore(
  tagScores: Map<string, { score: number; frequency: number; sourceType: AutoTag['sourceType'] }>,
  tag: string,
  score: number,
  frequency: number,
  sourceType: AutoTag['sourceType']
) {
  const existing = tagScores.get(tag);
  if (existing) {
    existing.score += score;
    existing.frequency = Math.max(existing.frequency, frequency);
    if (existing.sourceType !== 'metadata' && sourceType === 'metadata') {
      existing.sourceType = 'metadata';
    }
    return;
  }
  tagScores.set(tag, { score, frequency, sourceType });
}

export function buildTFIDFModel(images: TaggingImage[]): TFIDFModel {
  const documentFrequency = new Map<string, number>();
  let documentCount = 0;

  for (const image of images) {
    const terms = collectDocumentTerms(image);
    if (terms.size === 0) {
      continue;
    }
    documentCount += 1;
    for (const term of terms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const idfScores = new Map<string, number>();
  for (const [term, df] of documentFrequency.entries()) {
    const idf = Math.log((documentCount + 1) / (df + 1)) + 1;
    idfScores.set(term, idf);
  }

  return {
    vocabulary: Array.from(documentFrequency.keys()),
    idfScores,
    documentCount,
  };
}

function extractAutoTagsInternal(
  image: TaggingImage,
  model: TFIDFModel,
  options?: AutoTaggingOptions,
  _facts?: WorkflowFacts | null
): AutoTag[] {
  const topN = options?.topN ?? DEFAULT_TOP_N;
  const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
  const excludedTags = new Set(options?.excludeTags ?? []);

  const promptFragments = extractPromptFragments(image.prompt ?? '');
  const fragmentCounts = countTokens(promptFragments);
  const totalFragments = promptFragments.length || 1;

  const tagScores = new Map<string, { score: number; frequency: number; sourceType: AutoTag['sourceType'] }>();

  for (const [term, count] of fragmentCounts.entries()) {
    const idf = getIdfScore(term, model);
    const tf = count / totalFragments;
    const score = tf * idf;
    addTagScore(tagScores, term, score, count, 'prompt');
  }

  const tags = Array.from(tagScores.entries())
    .filter(([tag, value]) => value.score >= minScore && !excludedTags.has(tag))
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, topN)
    .map(([tag, value]) => ({
      tag,
      tfidfScore: Number(value.score.toFixed(4)),
      frequency: value.frequency,
      sourceType: value.sourceType,
    }));

  return tags;
}

export function extractWorkflowFactsForImage(image: TaggingImage): WorkflowFacts | null {
  const metadata = image.metadata as any;
  if (!metadata) {
    return null;
  }

  const workflow = metadata.workflow ?? metadata.imagemetahub_data?.workflow ?? metadata.videometahub_data?.workflow;
  const prompt = metadata.prompt ?? metadata.imagemetahub_data?.prompt ?? metadata.videometahub_data?.prompt;

  if (!workflow && !prompt) {
    return null;
  }

  const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
  if (!workflow && !promptText?.includes('class_type')) {
    return null;
  }

  return resolveWorkflowFactsFromGraph(workflow, prompt);
}

export function extractAutoTags(
  image: TaggingImage,
  model: TFIDFModel,
  options?: AutoTaggingOptions
): AutoTag[] {
  return extractAutoTagsInternal(image, model, options, null);
}

export function extractAutoTagsWithFacts(
  image: TaggingImage,
  model: TFIDFModel,
  options?: AutoTaggingOptions,
  facts?: WorkflowFacts | null
): AutoTag[] {
  const resolvedFacts = facts ?? extractWorkflowFactsForImage(image);
  return extractAutoTagsInternal(image, model, options, resolvedFacts);
}

export function updateTFIDFModel(
  model: TFIDFModel,
  newImages: TaggingImage[]
): TFIDFModel {
  const documentFrequency = new Map<string, number>();
  for (const [term, idf] of model.idfScores.entries()) {
    const dfEstimate = Math.max(
      1,
      Math.round((model.documentCount + 1) / Math.exp(idf - 1) - 1)
    );
    documentFrequency.set(term, dfEstimate);
  }

  let documentCount = model.documentCount;

  for (const image of newImages) {
    const terms = collectDocumentTerms(image);
    if (terms.size === 0) {
      continue;
    }
    documentCount += 1;
    for (const term of terms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const idfScores = new Map<string, number>();
  for (const [term, df] of documentFrequency.entries()) {
    const idf = Math.log((documentCount + 1) / (df + 1)) + 1;
    idfScores.set(term, idf);
  }

  return {
    vocabulary: Array.from(documentFrequency.keys()),
    idfScores,
    documentCount,
  };
}
