/**
 * Similarity Metrics for Prompt Clustering
 *
 * Implements:
 * - Jaccard Similarity (token-based, fast)
 * - Normalized Levenshtein Distance (character-based, catches typos)
 * - Hybrid Similarity (combines both: 60% Jaccard + 40% Levenshtein)
 */

/**
 * Calculate Levenshtein distance between two strings
 * Classic dynamic programming algorithm O(n*m)
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  // Create a 2D array for memoization
  const matrix: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= len1; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Normalized Levenshtein similarity (0-1 scale)
 * 1.0 = identical strings, 0.0 = completely different
 */
export function normalizedLevenshtein(str1: string, str2: string): number {
  if (str1 === str2) return 1.0;
  if (str1.length === 0 && str2.length === 0) return 1.0;
  if (str1.length === 0 || str2.length === 0) return 0.0;

  const distance = levenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);

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

function tokenize(text: string): Set<string> {
  // Remove A1111 weight syntax: (term:1.2) or [term:0.8]
  const cleanedText = text.replace(/[(\[]\s*([^)\]]+?)\s*:\s*[\d.]+\s*[)\]]/g, '$1');

  const tokens = cleanedText
    .toLowerCase()
    // Split by whitespace AND commas (Danbooru-style: "1girl, blue hair, sitting")
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    // Remove parentheses/brackets artifacts
    .map((token) => token.replace(/^[(\[]+|[)\]]+$/g, ''))
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
  const tokens1 = tokenize(str1);
  const tokens2 = tokenize(str2);

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
  const tokens = tokenize(normalized);

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
