import { describe, it, expect } from 'vitest';
import {
  buildContentKey,
  centroidFrom,
  dequantizeVector,
  dotFloatWithQuantized,
  encodeRow,
  explodeSegment,
  isManifestCompatible,
  l2Normalize,
  quantizeVector,
  rowHubnessScores,
  rowStrideBytes,
  scoreRow,
  createEmptyManifest,
  type ExplodedSegment,
} from '../services/embeddings/embeddingFormat';

const cosine = (a: Float32Array, b: Float32Array): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const randomVector = (dim: number): Float32Array => {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) v[i] = Math.random() * 2 - 1;
  return v;
};

describe('quantization roundtrip', () => {
  it('recovers a normalized vector within <1% cosine error', () => {
    const dim = 512;
    for (let trial = 0; trial < 20; trial += 1) {
      const original = l2Normalize(randomVector(dim));
      const { scale, codes } = quantizeVector(new Float32Array(original));
      const recovered = dequantizeVector(codes, scale);
      expect(1 - cosine(original, recovered)).toBeLessThan(0.01);
    }
  });

  it('handles the zero vector without producing NaN', () => {
    const { scale, codes } = quantizeVector(new Float32Array(8));
    expect(scale).toBe(0);
    expect(Array.from(codes).every((c) => c === 0)).toBe(true);
  });
});

describe('scoreRow', () => {
  it('approximates cosine similarity between two quantized vectors', () => {
    const dim = 128;
    const a = l2Normalize(randomVector(dim));
    const b = l2Normalize(randomVector(dim));
    const expected = cosine(a, b);

    const qa = quantizeVector(new Float32Array(a));
    const qb = quantizeVector(new Float32Array(b));
    const score = scoreRow(qa.codes, qa.scale, qb.codes, 0, dim, qb.scale);

    expect(Math.abs(score - expected)).toBeLessThan(0.02);
  });

  it('scores an identical vector near 1', () => {
    const dim = 64;
    const a = l2Normalize(randomVector(dim));
    const qa = quantizeVector(new Float32Array(a));
    const score = scoreRow(qa.codes, qa.scale, qa.codes, 0, dim, qa.scale);
    expect(score).toBeGreaterThan(0.99);
  });
});

describe('segment encode/explode', () => {
  it('round-trips rows through the interleaved segment format', () => {
    const dim = 32;
    const vectors = [randomVector(dim), randomVector(dim), randomVector(dim)].map((v) =>
      l2Normalize(v)
    );
    const stride = rowStrideBytes(dim);
    const buffer = new Uint8Array(stride * vectors.length);
    vectors.forEach((v, i) => {
      const q = quantizeVector(new Float32Array(v));
      buffer.set(encodeRow(dim, q), i * stride);
    });

    const exploded = explodeSegment(buffer.buffer, dim, vectors.length);
    expect(exploded.rowCount).toBe(vectors.length);

    vectors.forEach((v, i) => {
      const recovered = dequantizeVector(
        exploded.codes.subarray(i * dim, (i + 1) * dim) as Int8Array,
        exploded.scales[i]
      );
      expect(1 - cosine(v, recovered)).toBeLessThan(0.01);
    });
  });

  it('ignores trailing rows beyond the manifest count (uncommitted flush)', () => {
    const dim = 16;
    const stride = rowStrideBytes(dim);
    const buffer = new Uint8Array(stride * 3);
    const exploded = explodeSegment(buffer.buffer, dim, 2);
    expect(exploded.rowCount).toBe(2);
  });
});

describe('content key', () => {
  it('changes when size or modified time changes', () => {
    const base = buildContentKey(100, 5);
    expect(buildContentKey(100, 5)).toBe(base);
    expect(buildContentKey(101, 5)).not.toBe(base);
    expect(buildContentKey(100, 6)).not.toBe(base);
  });

  it('falls back to lastModified when contentModifiedMs is absent', () => {
    expect(buildContentKey(100, undefined, 42)).toBe('100:42');
  });
});

describe('query-conditioned mean projection', () => {
  const DIM = 8;

  const vector = (...values: number[]): Float32Array => {
    const v = new Float32Array(DIM);
    v.set(values);
    return l2Normalize(v);
  };

  const buildSegment = (vectors: Float32Array[]): ExplodedSegment => {
    const stride = rowStrideBytes(DIM);
    const buffer = new Uint8Array(stride * vectors.length);
    vectors.forEach((v, i) => {
      buffer.set(encodeRow(DIM, quantizeVector(new Float32Array(v))), i * stride);
    });
    return explodeSegment(buffer.buffer, DIM, vectors.length);
  };

  /** Mirrors the worker's `q·v - (q·mean̂)(v·mean̂)` score. */
  const scoreAll = (
    segment: ExplodedSegment,
    query: Float32Array,
    mean: Float32Array | null
  ): number[] => {
    const { scale, codes } = quantizeVector(new Float32Array(query));
    const hubness = rowHubnessScores(segment, DIM, mean);
    let queryMeanAlignment = 0;
    if (mean) {
      let meanNormSq = 0;
      for (let i = 0; i < DIM; i += 1) meanNormSq += mean[i] * mean[i];
      const meanNorm = Math.sqrt(meanNormSq);
      if (meanNorm > 0) queryMeanAlignment = dotFloatWithQuantized(mean, codes, scale) / meanNorm;
    }

    const scores: number[] = [];
    for (let row = 0; row < segment.rowCount; row += 1) {
      const raw = scoreRow(codes, scale, segment.codes, row * DIM, DIM, segment.scales[row]);
      scores.push(mean ? raw - queryMeanAlignment * hubness[row] : raw);
    }
    return scores;
  };

  it('returns zero row alignments while the library mean is unavailable', () => {
    const segment = buildSegment([vector(1, 0), vector(0, 1)]);
    expect(Array.from(rowHubnessScores(segment, DIM, null))).toEqual([0, 0]);
  });

  it('measures row alignment with the mean axis', () => {
    const segment = buildSegment([vector(1, 0), vector(0, 1)]);
    const alignments = rowHubnessScores(segment, DIM, vector(1, 0));

    expect(alignments[0]).toBeGreaterThan(0.99);
    expect(Math.abs(alignments[1])).toBeLessThan(0.01);
  });

  it('removes the shared mean component without replacing the query', () => {
    const match = vector(0.8, 0.6);
    const hub = vector(1, 0);
    const query = vector(0.95, 0.312);
    const mean = vector(1, 0);
    const segment = buildSegment([match, hub]);

    const raw = scoreAll(segment, query, null);
    const corrected = scoreAll(segment, query, mean);

    expect(raw[1]).toBeGreaterThan(raw[0]);
    expect(corrected[0]).toBeGreaterThan(corrected[1]);
    expect(corrected[0] - corrected[1]).toBeGreaterThan(0.1);
  });

  it('does not penalize the mean axis when the query is orthogonal to it', () => {
    const segment = buildSegment([vector(1, 0), vector(0, 1)]);
    const query = vector(0, 1);
    const scores = scoreAll(segment, query, vector(1, 0));

    expect(Math.abs(scores[0])).toBeLessThan(0.01);
    expect(scores[1]).toBeGreaterThan(0.99);
  });
});

describe('centroidFrom', () => {
  it('averages the running sum once there are enough rows', () => {
    const mean = centroidFrom([10, 20, 30, 40], 20, 4);
    expect(mean && Array.from(mean)).toEqual([0.5, 1, 1.5, 2]);
  });

  it('withholds a mean built from too few rows', () => {
    expect(centroidFrom([10, 20], 4, 2)).toBeNull();
  });

  it('rejects a sum whose width does not match the model', () => {
    expect(centroidFrom([1, 2, 3], 100, 4)).toBeNull();
    expect(centroidFrom(undefined, 100, 4)).toBeNull();
  });
});

describe('manifest compatibility', () => {
  it('rejects a manifest from a different model or dim', () => {
    const manifest = createEmptyManifest('model-a', 'main', 512);
    expect(isManifestCompatible(manifest, 'model-a', 512)).toBe(true);
    expect(isManifestCompatible(manifest, 'model-b', 512)).toBe(false);
    expect(isManifestCompatible(manifest, 'model-a', 768)).toBe(false);
    expect(isManifestCompatible(null, 'model-a', 512)).toBe(false);
  });
});