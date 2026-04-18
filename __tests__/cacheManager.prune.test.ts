import { describe, expect, it } from 'vitest';
import { pruneCacheMetadata, type CacheImageMetadata } from '../services/cacheManager';

const makeEntry = (id: string, name: string): CacheImageMetadata => ({
  id,
  name,
  metadataString: '',
  metadata: {},
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
});

describe('pruneCacheMetadata', () => {
  it('removes watched files by id and normalized relative name', () => {
    const metadata = [
      makeEntry('root::a.png', 'a.png'),
      makeEntry('root::nested/b.png', 'nested/b.png'),
      makeEntry('root::nested/c.png', 'nested\\c.png'),
    ];

    expect(
      pruneCacheMetadata(metadata, {
        ids: ['root::a.png'],
        names: ['nested/c.png'],
      }).map((entry) => entry.id),
    ).toEqual(['root::nested/b.png']);
  });

  it('removes watched folder contents by normalized relative prefix', () => {
    const metadata = [
      makeEntry('root::nested/a.png', 'nested/a.png'),
      makeEntry('root::nested/deeper/b.png', 'nested\\deeper\\b.png'),
      makeEntry('root::nested-like/c.png', 'nested-like/c.png'),
      makeEntry('root::other.png', 'other.png'),
    ];

    expect(
      pruneCacheMetadata(metadata, {
        names: ['nested'],
      }).map((entry) => entry.id),
    ).toEqual(['root::nested-like/c.png', 'root::other.png']);
  });
});
