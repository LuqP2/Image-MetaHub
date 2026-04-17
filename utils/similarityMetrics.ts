/**
 * Similarity Metrics for Prompt Clustering
 *
 * Implements:
 * - Jaccard Similarity (token-based, fast)
 * - Normalized Levenshtein Distance (character-based, catches typos)
 * - Hybrid Similarity (combines both: 60% Jaccard + 40% Levenshtein)
 */

/**
 * Calculate Levenshtein distance between two strings.
 *
 * When maxDistance is provided, this uses a bounded band and may return any
 * value above maxDistance once the strings can no longer match the caller's
 * threshold. That keeps clustering fast for very long tag-heavy prompts.
 */
function levenshteinDistance(str1: string, str2: string, maxDistance = Infinity): number {
  let len1 = str1.length;
  let len2 = str2.length;

  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  let start = 0;
  while (start < len1 && start < len2 && str1[start] === str2[start]) {
    start++;
  }

  while (
    len1 > start &&
    len2 > start &&
    str1[len1 - 1] === str2[len2 - 1]
  ) {
    len1--;
    len2--;
  }

  str1 = str1.slice(start, len1);
  str2 = str2.slice(start, len2);
  len1 = str1.length;
  len2 = str2.length;

  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  if (len1 > len2) {
    [str1, str2] = [str2, str1];
    [len1, len2] = [len2, len1];
  }

  const bounded = Number.isFinite(maxDistance);
  const limit = bounded ? Math.floor(maxDistance) : len2;

  if (bounded && len2 - len1 > limit) {
    return limit + 1;
  }

  const previous = new Array<number>(len2 + 1);
  const current = new Array<number>(len2 + 1);
  for (let j = 0; j <= len2; j++) {
    previous[j] = j;
  }

  const unreachable = limit + 1;

  for (let i = 1; i <= len1; i++) {
    current[0] = i;
    let rowMin = current[0];

    const jStart = bounded ? Math.max(1, i - limit) : 1;
    const jEnd = bounded ? Math.min(len2, i + limit) : len2;

    for (let j = 1; j < jStart; j++) {
      current[j] = unreachable;
    }

    for (let j = jStart; j <= jEnd; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      const distance = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      current[j] = distance;
      if (distance < rowMin) {
        rowMin = distance;
      }
    }

    for (let j = jEnd + 1; j <= len2; j++) {
      current[j] = unreachable;
    }

    if (bounded && rowMin > limit) {
      return limit + 1;
    }

    for (let j = 0; j <= len2; j++) {
      previous[j] = current[j];
    }
  }

  return previous[len2];
}

/**
 * Normalized Levenshtein similarity (0-1 scale)
 * 1.0 = identical strings, 0.0 = completely different
 */
export function normalizedLevenshtein(
  str1: string,
  str2: string,
  minSimilarity = 0
): number {
  if (str1 === str2) return 1.0;
  if (str1.length === 0 && str2.length === 0) return 1.0;
  if (str1.length === 0 || str2.length === 0) return 0.0;

  const maxLen = Math.max(str1.length, str2.length);
  const boundedMinSimilarity = Math.max(0, Math.min(1, minSimilarity));
  const maxDistance =
    boundedMinSimilarity > 0
      ? Math.floor((1 - boundedMinSimilarity) * maxLen)
      : Infinity;

  const distance = levenshteinDistance(str1, str2, maxDistance);

  if (boundedMinSimilarity > 0 && distance > maxDistance) {
    return 0.0;
  }

  return 1 - distance / maxLen;
}

/**
 * Tokenize a string into words
 * - Splits by whitespace AND commas (Danbooru-style prompts)
 * - Preserves terms in parentheses/brackets (A1111 weights)
 * - Converts to lowercase
 * - Removes empty tokens
 * - Removes common stop words
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'should', 'could', 'may', 'might', 'must', 'can',
  // Image generation specific stop words
  'masterpiece', 'best', 'quality', 'high', 'highly', 'detailed', 'ultra',
  'photorealistic', 'realistic', 'professional', 'artwork', 'digital',
  'art', 'illustration', '4k', '8k', '16k', 'uhd', 'hd',
]);

export function tokenizeForSimilarity(text: string): Set<string> {
  // Remove A1111 weight syntax: (term:1.2) or [term:0.8]
  const cleanedText = text.replace(/(?:\(|\[)\s*([^\])]+?)\s*:\s*[\d.]+\s*(?:\)|\])/g, '$1');

  const tokens = cleanedText
    .toLowerCase()
    // Split by whitespace AND commas (Danbooru-style: "1girl, blue hair, sitting")
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    // Remove parentheses/brackets artifacts
    .map((token) => token.replace(/^(?:\(|\[)+|(?:\)|\])+$/g, ''))
    .filter((token) => token.length > 0)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token)); // Remove pure numbers

  return new Set(tokens);
}

/**
 * Jaccard Similarity (set-based similarity)
 * Compares token overlap: |A ∩ B| / |A ∪ B|
 * Fast: O(n+m) where n,m are token counts
 */
export function jaccardSimilarity(str1: string, str2: string): number {
  const tokens1 = tokenizeForSimilarity(str1);
  const tokens2 = tokenizeForSimilarity(str2);

  if (tokens1.size === 0 && tokens2.size === 0) return 1.0;
  if (tokens1.size === 0 || tokens2.size === 0) return 0.0;

  // Calculate intersection
  const intersection = new Set([...tokens1].filter((token) => tokens2.has(token)));

  // Calculate union
  const union = new Set([...tokens1, ...tokens2]);

  return intersection.size / union.size;
}

/**
 * Hybrid similarity score
 * Combines Jaccard (60%) and Levenshtein (40%) for robust matching
 *
 * Rationale:
 * - Jaccard: Fast, ignores word order, catches semantic similarity
 * - Levenshtein: Catches typos and minor character variations
 * - Weighted average provides balanced approach
 */
export function hybridSimilarity(str1: string, str2: string): number {
  const jaccard = jaccardSimilarity(str1, str2);
  const levenshtein = normalizedLevenshtein(str1, str2);

  return jaccard * 0.6 + levenshtein * 0.4;
}

/**
 * Normalize a prompt for clustering
 * - Lowercase
 * - Remove LoRA tags: <lora:name:weight>
 * - Remove seed/steps/cfg metadata
 * - Trim whitespace
 * - Remove extra spaces
 */
export function normalizePrompt(prompt: string): string {
  if (!prompt) return '';

  let normalized = prompt.toLowerCase();

  // Remove LoRA tags: <lora:name:1.0> or <lora:name>
  normalized = normalized.replace(/<lora:[^>]+>/gi, '');

  // Remove common metadata patterns
  // Examples: "Steps: 20", "Seed: 123456", "CFG scale: 7.5"
  normalized = normalized.replace(/\b(steps?|seed|cfg\s*scale|sampler|size):\s*[\d.]+/gi, '');

  // Remove model hash patterns: Model hash: abc123def
  normalized = normalized.replace(/\bmodel\s+hash:\s*[a-f0-9]+/gi, '');

  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Generate a hash for exact prompt matching (fast path)
 * Uses simple string hash (FNV-1a variant)
 */
export function generatePromptHash(prompt: string): string {
  const normalized = normalizePrompt(prompt);

  let hash = 2166136261; // FNV offset basis

  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }

  // Convert to unsigned 32-bit integer, then to hex string
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Extract significant keywords from a prompt
 * Used for token bucketing optimization
 * Returns top N most meaningful tokens (nouns, adjectives, etc.)
 */
export function extractKeywords(prompt: string, topN: number = 5): string[] {
  const normalized = normalizePrompt(prompt);
  const tokens = tokenizeForSimilarity(normalized);

  // Filter for likely meaningful words (length >= 3, not pure digits)
  const keywords = [...tokens]
    .filter((token) => token.length >= 3)
    .filter((token) => !/^\d+$/.test(token))
    .slice(0, topN);

  return keywords;
}

/**
 * Check if two prompts share enough keywords for bucketing
 * Used to reduce comparison space in clustering
 */
export function shareKeywords(
  prompt1: string,
  prompt2: string,
  minShared: number = 2
): boolean {
  const keywords1 = new Set(extractKeywords(prompt1, 10));
  const keywords2 = new Set(extractKeywords(prompt2, 10));

  const sharedCount = [...keywords1].filter((kw) => keywords2.has(kw)).length;

  return sharedCount >= minShared;
}
