import { describe, expect, it } from 'vitest';
import { applyCorroboratedVisualExpansion } from '../services/embeddings/semanticSearchExpansion';

const hit = (imageId: string, score: number) => ({ imageId, score });

describe('applyCorroboratedVisualExpansion', () => {
  const textHits = [hit('seed', 0.053), hit('isolated-tv', 0.043), hit('confirmed', 0.038)];
  const neighbors = [hit('missed-a', 0.90), hit('confirmed', 0.82), hit('missed-b', 0.80)];

  it('expands Broad and Balanced when another text hit corroborates the seed neighborhood', () => {
    for (const precision of ['broad', 'balanced'] as const) {
      const result = applyCorroboratedVisualExpansion(textHits, neighbors, precision, 300);
      expect(result.applied).toBe(true);
      expect(result.corroboratingImageIds).toEqual(['confirmed']);
      expect(result.expandedImageIds).toEqual(['missed-a', 'missed-b']);
      expect(result.hits.map((candidate) => candidate.imageId)).toEqual([
        'seed',
        'missed-a',
        'confirmed',
        'isolated-tv',
        'missed-b',
      ]);
      expect(result.hits.find((candidate) => candidate.imageId === 'missed-a')?.score)
        .toBeCloseTo(0.053 * 0.90);
    }
  });

  it('keeps Strict purely textual', () => {
    const result = applyCorroboratedVisualExpansion(textHits, neighbors, 'strict', 300);
    expect(result.applied).toBe(false);
    expect(result.expandedImageIds).toEqual([]);
    expect(result.hits.map((candidate) => candidate.imageId)).toEqual(textHits.map((candidate) => candidate.imageId));
  });

  it('does not expand an isolated top result without independent text corroboration', () => {
    const result = applyCorroboratedVisualExpansion(
      [hit('tv', 0.053), hit('unrelated', 0.04)],
      [hit('tv-neighbor', 0.91)],
      'balanced',
      300
    );
    expect(result.applied).toBe(false);
    expect(result.hits.map((candidate) => candidate.imageId)).toEqual(['tv', 'unrelated']);
  });

  it('is non-transitive and includes only the supplied first-hop neighbors', () => {
    const result = applyCorroboratedVisualExpansion(
      [hit('seed', 0.06), hit('confirmed', 0.05)],
      [hit('confirmed', 0.90), hit('first-hop', 0.85)],
      'balanced',
      300
    );
    expect(result.hits.some((candidate) => candidate.imageId === 'first-hop')).toBe(true);
    expect(result.hits.some((candidate) => candidate.imageId === 'second-hop')).toBe(false);
  });

  it('respects the final result limit', () => {
    const manyNeighbors = [
      hit('confirmed', 0.99),
      ...Array.from({ length: 20 }, (_, index) => hit(`neighbor-${index}`, 0.98 - index * 0.01)),
    ];
    const result = applyCorroboratedVisualExpansion(
      [hit('seed', 0.06), hit('confirmed', 0.05)],
      manyNeighbors,
      'balanced',
      5
    );
    expect(result.hits).toHaveLength(5);
  });

  it('does not let quantization noise promote a neighbor above the text seed', () => {
    const result = applyCorroboratedVisualExpansion(
      [hit('seed', 0.06), hit('confirmed', 0.05)],
      [hit('confirmed', 1.001), hit('duplicate', 1.001)],
      'balanced',
      300
    );
    expect(result.hits[0].imageId).toBe('seed');
    expect(result.hits.find((candidate) => candidate.imageId === 'duplicate')?.score).toBe(0.06);
  });
});
