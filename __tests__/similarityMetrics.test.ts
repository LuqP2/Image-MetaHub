import { describe, expect, it } from 'vitest';
import { normalizedLevenshtein } from '../utils/similarityMetrics';

describe('similarity metrics', () => {
  it('returns the exact Levenshtein similarity when a bounded comparison can still pass', () => {
    const promptA = 'portrait, blue hair, cinematic light, sharp focus';
    const promptB = 'portrait, blue hair, cinematic lighting, sharp focus';
    const exact = normalizedLevenshtein(promptA, promptB);

    expect(normalizedLevenshtein(promptA, promptB, exact - 0.01)).toBeCloseTo(exact);
  });

  it('short-circuits bounded Levenshtein comparisons that cannot meet the minimum similarity', () => {
    const promptA = 'portrait, blue hair, cinematic light, sharp focus';
    const promptB = 'landscape, red forest, foggy morning, wide angle';

    expect(normalizedLevenshtein(promptA, promptB, 0.95)).toBe(0);
  });
});
