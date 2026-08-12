import { describe, expect, it } from 'vitest';
import { isUsableTimestamp, normalizeBirthtimeMs, resolveFileSortDate } from '../utils/fileTimestamps.js';
import { healCachedSortDate, type CacheImageMetadata } from '../services/cacheManager';

const MTIME = 1_754_900_000_000;
const BIRTHTIME = 1_754_800_000_000;

const makeEntry = (overrides: Partial<CacheImageMetadata>): CacheImageMetadata => ({
  id: 'root::a.png',
  name: 'a.png',
  metadataString: '',
  metadata: {},
  lastModified: MTIME,
  models: [],
  loras: [],
  scheduler: '',
  ...overrides,
});

describe('isUsableTimestamp', () => {
  it('rejects the zero birth time SMB/CIFS shares report', () => {
    expect(isUsableTimestamp(0)).toBe(false);
  });

  it('rejects negative, non-finite and non-numeric values', () => {
    expect(isUsableTimestamp(-1)).toBe(false);
    expect(isUsableTimestamp(NaN)).toBe(false);
    expect(isUsableTimestamp(Infinity)).toBe(false);
    expect(isUsableTimestamp(undefined)).toBe(false);
    expect(isUsableTimestamp(null)).toBe(false);
    expect(isUsableTimestamp('123')).toBe(false);
  });

  it('accepts a real timestamp', () => {
    expect(isUsableTimestamp(MTIME)).toBe(true);
  });
});

describe('normalizeBirthtimeMs', () => {
  it('turns an unavailable birth time into undefined so ?? fallbacks trigger', () => {
    expect(normalizeBirthtimeMs(0)).toBeUndefined();
    expect(normalizeBirthtimeMs(undefined)).toBeUndefined();
    expect(normalizeBirthtimeMs(0) ?? MTIME).toBe(MTIME);
  });

  it('keeps a real birth time', () => {
    expect(normalizeBirthtimeMs(BIRTHTIME)).toBe(BIRTHTIME);
  });
});

describe('resolveFileSortDate', () => {
  it('prefers the birth time when the filesystem reports one', () => {
    expect(resolveFileSortDate(BIRTHTIME, MTIME)).toBe(BIRTHTIME);
  });

  it('falls back to the modification time when the birth time is zero', () => {
    expect(resolveFileSortDate(0, MTIME)).toBe(MTIME);
  });

  it('falls back to the explicit fallback before giving up on the clock', () => {
    expect(resolveFileSortDate(0, 0, MTIME)).toBe(MTIME);
  });

  it('never returns an epoch-zero date', () => {
    const resolved = resolveFileSortDate(0, 0, 0);
    expect(resolved).toBeGreaterThan(0);
  });
});

describe('healCachedSortDate', () => {
  it('repairs entries cached with the epoch-zero birth time', () => {
    const healed = healCachedSortDate(makeEntry({ lastModified: 0, contentModifiedMs: MTIME }));
    expect(healed.lastModified).toBe(MTIME);
    expect(new Date(healed.lastModified).getUTCFullYear()).toBe(2025);
  });

  it('leaves healthy entries untouched, without reallocating them', () => {
    const entry = makeEntry({ lastModified: BIRTHTIME, contentModifiedMs: MTIME });
    expect(healCachedSortDate(entry)).toBe(entry);
  });

  it('leaves the entry alone when there is no modification time to fall back to', () => {
    const entry = makeEntry({ lastModified: 0 });
    expect(healCachedSortDate(entry)).toBe(entry);
  });
});
