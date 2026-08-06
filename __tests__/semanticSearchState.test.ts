import { describe, expect, it } from 'vitest';
import {
  createDiagnosticIdMapper,
  isSemanticQuerySnapshotCurrent,
  semanticSearchScopeRevision,
  summarizeScorePercentiles,
  summarizeVisibleSemanticResults,
} from '../store/semanticSearchState';

describe('semanticSearchScopeRevision', () => {
  it('is stable for the same ordered IDs and changes with scope membership', () => {
    const first = [{ id: 'a' }, { id: 'b' }];
    expect(semanticSearchScopeRevision(first)).toBe(semanticSearchScopeRevision([...first]));
    expect(semanticSearchScopeRevision(first)).not.toBe(
      semanticSearchScopeRevision([{ id: 'a' }, { id: 'c' }])
    );
  });
});

describe('summarizeScorePercentiles', () => {
  it('summarizes technical scores without image metadata', () => {
    expect(summarizeScorePercentiles([1, 2, 3, 4, 5])).toEqual({ p50: 3, p90: 5, p95: 5 });
    expect(summarizeScorePercentiles([])).toEqual({ p50: null, p90: null, p95: null });
  });
});

describe('semantic query identity', () => {
  it('requires both the latest generation and the same scope revision', () => {
    expect(isSemanticQuerySnapshotCurrent(2, 2, 'scope-a', 'scope-a')).toBe(true);
    expect(isSemanticQuerySnapshotCurrent(1, 2, 'scope-a', 'scope-a')).toBe(false);
    expect(isSemanticQuerySnapshotCurrent(2, 2, 'scope-a', 'scope-b')).toBe(false);
  });
});

describe('diagnostic aliases', () => {
  it('uses stable session aliases without exposing paths', () => {
    const mapper = createDiagnosticIdMapper();
    const path = 'K:\\private-library::secret-file.png';
    const first = mapper.get(path);

    expect(first).toBe('img-1');
    expect(mapper.get(path)).toBe(first);
    expect(first).not.toContain('K:');
    expect(first).not.toContain('secret-file');

    mapper.reset();
    expect(mapper.get('another-id')).toBe('img-1');
  });
});

describe('summarizeVisibleSemanticResults', () => {
  it('counts only cards that are actually visible, not orphaned technical hits', () => {
    const scores = new Map([
      ['visible', 0.81],
      ['orphan-a', 0.79],
      ['orphan-b', 0.77],
    ]);

    expect(summarizeVisibleSemanticResults([{ id: 'visible' }], scores)).toEqual({
      count: 1,
      topScore: 0.81,
    });
  });

  it('reflects the subset left by active grid filters', () => {
    const scores = new Map([
      ['filtered-out', 0.91],
      ['shown', 0.73],
    ]);

    expect(summarizeVisibleSemanticResults([{ id: 'shown' }], scores)).toEqual({
      count: 1,
      topScore: 0.73,
    });
  });

  it('excludes the pinned Find Similar source from count and top score', () => {
    const scores = new Map([
      ['source', Number.POSITIVE_INFINITY],
      ['neighbor', 0.93],
    ]);

    expect(
      summarizeVisibleSemanticResults(
        [{ id: 'source' }, { id: 'neighbor' }],
        scores,
        'source'
      )
    ).toEqual({ count: 1, topScore: 0.93 });
  });
});
