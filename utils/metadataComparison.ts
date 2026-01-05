import { BaseMetadata } from '../types';

/**
 * Comparison utility for metadata fields
 * Handles different types: strings, numbers, arrays, objects
 */

/**
 * Compare two values for equality
 * Handles strings (case-insensitive), numbers, arrays, and objects
 */
export function compareField(field: string, valueA: any, valueB: any): boolean {
  // Handle null/undefined cases
  if (valueA === null || valueA === undefined) {
    return valueB === null || valueB === undefined;
  }
  if (valueB === null || valueB === undefined) {
    return false;
  }

  // String comparison (case-insensitive for most fields)
  if (typeof valueA === 'string' && typeof valueB === 'string') {
    // For prompts and notes, do case-sensitive comparison
    const caseSensitiveFields = ['prompt', 'negativePrompt', 'notes'];
    if (caseSensitiveFields.includes(field)) {
      return valueA === valueB;
    }
    return valueA.toLowerCase() === valueB.toLowerCase();
  }

  // Number comparison (exact match)
  if (typeof valueA === 'number' && typeof valueB === 'number') {
    return valueA === valueB;
  }

  // Array comparison (for LoRAs, etc.)
  if (Array.isArray(valueA) && Array.isArray(valueB)) {
    if (valueA.length !== valueB.length) return false;

    // Deep comparison for arrays
    return valueA.every((item, index) => {
      const itemB = valueB[index];

      // If array items are objects (like LoRA info)
      if (typeof item === 'object' && typeof itemB === 'object') {
        return JSON.stringify(item) === JSON.stringify(itemB);
      }

      // Simple comparison for primitive values
      return item === itemB;
    });
  }

  // Object comparison (deep equality via JSON)
  if (typeof valueA === 'object' && typeof valueB === 'object') {
    return JSON.stringify(valueA) === JSON.stringify(valueB);
  }

  // Default: convert to string and compare
  return String(valueA) === String(valueB);
}

/**
 * Get a set of field names that differ between two metadata objects
 * Returns a Set of field names that have different values
 */
export function getMetadataDifferences(
  metadataA: BaseMetadata | null | undefined,
  metadataB: BaseMetadata | null | undefined
): Set<string> {
  const differences = new Set<string>();

  if (!metadataA && !metadataB) return differences;
  if (!metadataA || !metadataB) {
    // If one is missing, all fields are different
    const existingMetadata = metadataA || metadataB;
    if (existingMetadata) {
      Object.keys(existingMetadata).forEach(key => differences.add(key));
    }
    return differences;
  }

  // Get all unique keys from both objects
  const allKeys = new Set([
    ...Object.keys(metadataA),
    ...Object.keys(metadataB)
  ]);

  // Compare each field
  allKeys.forEach(field => {
    const valueA = (metadataA as any)[field];
    const valueB = (metadataB as any)[field];

    if (!compareField(field, valueA, valueB)) {
      differences.add(field);
    }
  });

  return differences;
}

/**
 * Field categories for organized display
 */
export const METADATA_FIELD_CATEGORIES = {
  prompts: ['prompt', 'negativePrompt'],
  models: ['model', 'models', 'loras', 'vae'],
  parameters: ['cfg_scale', 'clip_skip', 'seed', 'steps', 'sampler', 'scheduler'],
  dimensions: ['width', 'height'],
  other: ['generator', 'version', 'module', 'notes', 'tags']
};

/**
 * Priority order for field display
 * Fields listed first will be displayed first
 */
export const FIELD_DISPLAY_ORDER = [
  // Prompts (most important)
  'prompt',
  'negativePrompt',

  // Models
  'model',
  'models',
  'loras',
  'vae',

  // Key parameters
  'cfg_scale',
  'clip_skip',
  'seed',
  'steps',
  'sampler',
  'scheduler',

  // Dimensions
  'width',
  'height',

  // Other
  'generator',
  'version',
  'notes',
  'tags'
];

/**
 * Format a field value for display
 * Handles special formatting for arrays, numbers, etc.
 */
export function formatFieldValue(field: string, value: any): string {
  if (value === null || value === undefined) {
    return 'N/A';
  }

  // Array formatting (for LoRAs)
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';

    // Format LoRA info objects
    return value.map(item => {
      if (typeof item === 'object' && item !== null) {
        // LoRAInfo object: { name, weight, ... }
        const name = item.name || item.model_name || 'Unknown';
        const weight = item.weight !== undefined ? item.weight : item.model_weight;
        if (weight !== undefined) {
          return `${name} (${weight})`;
        }
        return name;
      }
      return String(item);
    }).join(', ');
  }

  // Dimensions formatting
  if (field === 'width' || field === 'height') {
    return String(value);
  }

  // Number formatting
  if (typeof value === 'number') {
    return String(value);
  }

  // Default: convert to string
  return String(value);
}

/**
 * Get a human-readable label for a field name
 */
export function getFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    prompt: 'Prompt',
    negativePrompt: 'Negative Prompt',
    model: 'Model',
    models: 'Models',
    loras: 'LoRAs',
    vae: 'VAE',
    cfg_scale: 'CFG Scale',
    clip_skip: 'Clip Skip',
    seed: 'Seed',
    steps: 'Steps',
    sampler: 'Sampler',
    scheduler: 'Scheduler',
    width: 'Width',
    height: 'Height',
    generator: 'Generator',
    version: 'Version',
    module: 'Module',
    notes: 'Notes',
    tags: 'Tags'
  };

  return labels[field] || field.charAt(0).toUpperCase() + field.slice(1);
}

/**
 * Simple diff algorithm for text comparison
 * Returns array of tokens with their diff status
 */
export interface DiffToken {
  text: string;
  status: 'added' | 'removed' | 'unchanged';
}

export function diffText(textA: string, textB: string): { tokensA: DiffToken[]; tokensB: DiffToken[] } {
  if (!textA && !textB) {
    return { tokensA: [], tokensB: [] };
  }
  if (!textA) {
    return {
      tokensA: [],
      tokensB: textB.split(/(\s+)/).map(token => ({ text: token, status: 'added' as const }))
    };
  }
  if (!textB) {
    return {
      tokensA: textA.split(/(\s+)/).map(token => ({ text: token, status: 'removed' as const })),
      tokensB: []
    };
  }

  // Split by words and whitespace (preserve whitespace)
  const wordsA = textA.split(/(\s+)/);
  const wordsB = textB.split(/(\s+)/);

  // Simple LCS-based diff algorithm
  const lcs = longestCommonSubsequence(wordsA, wordsB);
  const lcsSet = new Set(lcs);

  const tokensA: DiffToken[] = [];
  const tokensB: DiffToken[] = [];

  let lcsIndexA = 0;
  let lcsIndexB = 0;

  // Process tokens A
  for (let i = 0; i < wordsA.length; i++) {
    const word = wordsA[i];
    const isInLCS = lcsIndexA < lcs.length && word === lcs[lcsIndexA];

    if (isInLCS) {
      tokensA.push({ text: word, status: 'unchanged' });
      lcsIndexA++;
    } else {
      tokensA.push({ text: word, status: 'removed' });
    }
  }

  // Process tokens B
  for (let i = 0; i < wordsB.length; i++) {
    const word = wordsB[i];
    const isInLCS = lcsIndexB < lcs.length && word === lcs[lcsIndexB];

    if (isInLCS) {
      tokensB.push({ text: word, status: 'unchanged' });
      lcsIndexB++;
    } else {
      tokensB.push({ text: word, status: 'added' });
    }
  }

  return { tokensA, tokensB };
}

/**
 * Longest Common Subsequence algorithm
 * Used for text diffing
 */
function longestCommonSubsequence(arr1: string[], arr2: string[]): string[] {
  const m = arr1.length;
  const n = arr2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // Build DP table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS
  const lcs: string[] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (arr1[i - 1] === arr2[j - 1]) {
      lcs.unshift(arr1[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}
