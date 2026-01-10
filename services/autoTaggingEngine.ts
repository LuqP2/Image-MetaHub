import type { AutoTag, ImageMetadata, LoRAInfo, TFIDFModel } from '../types';
import { resolveWorkflowFactsFromGraph } from './parsers/comfyUIParser';
import type { WorkflowFacts } from './parsers/comfyui/nodeRegistry';

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
}

const DEFAULT_TOP_N = 6;
const DEFAULT_MIN_SCORE = 0.03;
const MODEL_WEIGHT = 1.8;
const LORA_WEIGHT = 2.0;
const PROMPT_WEIGHT = 1.0;

const LORA_TAG_REGEX = /<lora:([^:>]+)(?::[^>]+)?>/gi;
const WEIGHT_SYNTAX_REGEX = /[(\[]\s*([^)\]]+?)\s*:\s*[\d.]+\s*[)\]]/g;

const STOP_PHRASES = [
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
];

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'should', 'could', 'may', 'might', 'must', 'can',
  'masterpiece', 'best', 'quality', 'high', 'highly', 'detailed', 'detail',
  'ultra', 'photorealistic', 'realistic', 'professional', 'art', 'artwork',
  'digital', 'illustration', 'render', 'photo', 'photograph', 'photography',
  'cinematic', 'sharp', 'sharpness', 'hdr', 'uhd', '4k', '8k', '16k',
  'highres', 'lowres', 'absurdres',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeTag(value: string): string {
  if (!value) return '';
  let normalized = value.trim().toLowerCase();
  normalized = normalized.split(/[\\/]/).pop() ?? normalized;
  normalized = normalized.replace(/\.(safetensors|ckpt|pt)$/i, '');
  normalized = normalized.replace(/:[\d.]+$/g, '');
  normalized = normalized.replace(/_/g, ' ');
  normalized = normalized.replace(/^[^a-z0-9-]+|[^a-z0-9-]+$/g, '');
  normalized = normalizeWhitespace(normalized);
  return normalized;
}

function isValidTag(value: string): boolean {
  if (!value) return false;
  if (value.length < 2) return false;
  if (/^\d+$/.test(value)) return false;
  if (STOP_WORDS.has(value)) return false;
  return true;
}

function removeStopPhrases(text: string): string {
  let cleaned = text;
  for (const phrase of STOP_PHRASES) {
    const regex = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
    cleaned = cleaned.replace(regex, ' ');
  }
  return cleaned;
}

function extractLorasFromPrompt(prompt: string): string[] {
  if (!prompt) return [];
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = LORA_TAG_REGEX.exec(prompt)) !== null) {
    const name = normalizeTag(match[1] || '');
    if (isValidTag(name)) {
      results.push(name);
    }
  }
  return results;
}

function tokenizePrompt(prompt: string): string[] {
  if (!prompt) return [];

  let cleaned = prompt.toLowerCase();
  cleaned = cleaned.replace(LORA_TAG_REGEX, ' ');
  cleaned = cleaned.replace(WEIGHT_SYNTAX_REGEX, '$1');
  cleaned = cleaned.replace(/_/g, ' ');
  cleaned = removeStopPhrases(cleaned);

  const rawTokens = cleaned.split(/[\s,]+/);
  const tokens: string[] = [];

  for (const raw of rawTokens) {
    const normalized = normalizeTag(raw);
    if (!isValidTag(normalized)) {
      continue;
    }
    tokens.push(normalized);
  }

  return tokens;
}

function normalizeModelTerm(term: string): string | null {
  const normalized = normalizeTag(term);
  if (!isValidTag(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeLoraTerm(term: string): string | null {
  const normalized = normalizeTag(term);
  if (!isValidTag(normalized)) {
    return null;
  }
  return normalized;
}

function extractModelTerms(image: TaggingImage, facts?: WorkflowFacts | null): string[] {
  const candidates = new Set<string>();
  if (facts?.model?.base) {
    candidates.add(facts.model.base);
  }
  image.models?.forEach(model => candidates.add(model));
  const normalizedModel = image.metadata?.normalizedMetadata?.model;
  if (normalizedModel) {
    candidates.add(normalizedModel);
  }
  image.metadata?.normalizedMetadata?.models?.forEach(model => candidates.add(model));

  const normalized: string[] = [];
  for (const candidate of candidates) {
    const term = normalizeModelTerm(candidate);
    if (term) {
      normalized.push(term);
    }
  }
  return Array.from(new Set(normalized));
}

function extractLoraTerms(image: TaggingImage, facts?: WorkflowFacts | null): string[] {
  const candidates = new Set<string>();
  if (facts?.loras?.length) {
    facts.loras.forEach(lora => {
      if (lora?.name) {
        candidates.add(lora.name);
      }
    });
  }
  image.loras?.forEach(lora => {
    if (typeof lora === 'string') {
      candidates.add(lora);
    } else if (lora?.name) {
      candidates.add(lora.name);
    } else if (lora?.model_name) {
      candidates.add(lora.model_name);
    }
  });

  const normalizedMetaLoras = image.metadata?.normalizedMetadata?.loras;
  if (Array.isArray(normalizedMetaLoras)) {
    normalizedMetaLoras.forEach(lora => {
      if (typeof lora === 'string') {
        candidates.add(lora);
      } else if (lora?.name) {
        candidates.add(lora.name);
      } else if (lora?.model_name) {
        candidates.add(lora.model_name);
      }
    });
  }

  const promptLoras = extractLorasFromPrompt(image.prompt ?? '');
  promptLoras.forEach(lora => candidates.add(lora));

  const normalized: string[] = [];
  for (const candidate of candidates) {
    const term = normalizeLoraTerm(candidate);
    if (term) {
      normalized.push(term);
    }
  }
  return Array.from(new Set(normalized));
}

function collectDocumentTerms(image: TaggingImage): Set<string> {
  const terms = new Set<string>();
  tokenizePrompt(image.prompt ?? '').forEach(token => terms.add(token));
  extractModelTerms(image).forEach(term => terms.add(term));
  extractLoraTerms(image).forEach(term => terms.add(term));
  return terms;
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

function collectMetadataTermsWithWeights(
  image: TaggingImage,
  facts?: WorkflowFacts | null
): Array<{ term: string; weight: number }> {
  const weighted: Array<{ term: string; weight: number }> = [];
  extractModelTerms(image, facts).forEach(term => weighted.push({ term, weight: MODEL_WEIGHT }));
  extractLoraTerms(image, facts).forEach(term => weighted.push({ term, weight: LORA_WEIGHT }));
  return weighted;
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
  facts?: WorkflowFacts | null
): AutoTag[] {
  const topN = options?.topN ?? DEFAULT_TOP_N;
  const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;

  const promptTokens = tokenizePrompt(image.prompt ?? '');
  const tokenCounts = countTokens(promptTokens);
  const totalTokens = promptTokens.length || 1;

  const tagScores = new Map<string, { score: number; frequency: number; sourceType: AutoTag['sourceType'] }>();

  for (const [term, count] of tokenCounts.entries()) {
    const idf = getIdfScore(term, model);
    const tf = count / totalTokens;
    const score = tf * idf * PROMPT_WEIGHT;
    addTagScore(tagScores, term, score, count, 'prompt');
  }

  const metadataTerms = collectMetadataTermsWithWeights(image, facts);
  const metadataTf = 1 / totalTokens;
  for (const { term, weight } of metadataTerms) {
    const idf = getIdfScore(term, model);
    const score = metadataTf * idf * weight;
    addTagScore(tagScores, term, score, 1, 'metadata');
  }

  const tags = Array.from(tagScores.entries())
    .filter(([, value]) => value.score >= minScore)
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

  const workflow = metadata.workflow ?? metadata.imagemetahub_data?.workflow;
  const prompt = metadata.prompt ?? metadata.imagemetahub_data?.prompt;

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
