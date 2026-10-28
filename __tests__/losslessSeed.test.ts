import { describe, expect, it } from 'vitest';
import { readLosslessSeed } from '../utils/losslessSeed';
import { compactCacheMetadataEntry } from '../services/cacheManager';
import { boardImage } from './helpers/boardIntegrationFixtures';

describe('lossless seed projection', () => {
  it('recovers original seeds from legacy raw parameters and preserves them during cache compaction', () => {
    const seed = '18446744073709551615';
    const parameters = `${'prompt '.repeat(100000)}\nSteps: 20, Seed: ${seed}, Size: 512x512`;
    const metadata = { parameters, normalizedMetadata: { seed: Number(seed) } };
    const image = boardImage('seed.png', { metadata, metadataString: JSON.stringify(metadata), seed: Number(seed) });
    const compacted = compactCacheMetadataEntry(image);
    expect(compacted.metadata).toHaveProperty('_rawMetadataCompacted', true);
    expect(readLosslessSeed(compacted.metadata, compacted.seed)).toBe(seed);
  });
  it('accepts safe integers and string seeds, including zero, and refuses unrecoverable rounded numbers', () => {
    expect(readLosslessSeed({}, 0)).toBe('0');
    expect(readLosslessSeed({}, 123)).toBe('123');
    expect(readLosslessSeed({ normalizedMetadata: { seed: '0018446744073709551615' } })).toBe('18446744073709551615');
    expect(readLosslessSeed({}, Number('18446744073709551615'))).toBeNull();
  });
  it('recovers safe normalized numbers only when the indexed seed is absent', () => {
    expect(readLosslessSeed({ normalizedMetadata: { seed: 0 } }, null)).toBe('0');
    expect(readLosslessSeed({ normalizedMetadata: { seed: 123 } })).toBe('123');
    expect(readLosslessSeed({ normalizedMetadata: { seed: 0 } }, 42)).toBe('42');
    for (const seed of [Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, 1.5]) {
      expect(readLosslessSeed({ normalizedMetadata: { seed } }, null)).toBeNull();
    }
    expect(readLosslessSeed({ normalizedMetadata: {} }, null)).toBeNull();
  });
  it('does not use stale seed text after editing the numeric seed', () => {
    expect(readLosslessSeed({ normalizedMetadata: { seedExact: '18446744073709551615' } }, 42)).toBe('42');
  });
});
