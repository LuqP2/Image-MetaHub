import { describe, it, expect } from 'vitest';
import {
  buildContentKey,
  dequantizeVector,
  encodeRow,
  explodeSegment,
  isManifestCompatible,
  l2Normalize,
  quantizeVector,
  rowStrideBytes,
  scoreRow,
  createEmptyManifest,
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
    // Three rows on disk, but the manifest only vouches for two.
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

describe('manifest compatibility', () => {
  it('rejects a manifest from a different model or dim', () => {
    const manifest = createEmptyManifest('model-a', 'main', 512);
    expect(isManifestCompatible(manifest, 'model-a', 512)).toBe(true);
    expect(isManifestCompatible(manifest, 'model-b', 512)).toBe(false);
    expect(isManifestCompatible(manifest, 'model-a', 768)).toBe(false);
    expect(isManifestCompatible(null, 'model-a', 512)).toBe(false);
  });
});
