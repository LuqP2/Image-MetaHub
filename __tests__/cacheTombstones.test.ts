import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  applyCacheTombstones,
  getCacheTombstonesPath,
  readCacheTombstonesFile,
} from '../utils/cacheTombstones.mjs';

const SAFE_CACHE_ID = 'D__library-flat';

describe('cache tombstone sidecar', () => {
  const created: string[] = [];

  const makeCacheDir = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-tombstones-'));
    created.push(dir);
    return dir;
  };

  const writeSidecar = async (cacheDir: string, ids: string[], chunkCount = 2) => {
    await fs.writeFile(
      getCacheTombstonesPath(cacheDir, SAFE_CACHE_ID),
      JSON.stringify({ chunkCount, ids })
    );
  };

  afterEach(async () => {
    await Promise.all(created.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('writes the sidecar and reports the count the record must carry', async () => {
    const cacheDir = await makeCacheDir();

    const count = await applyCacheTombstones({
      cacheDir,
      safeCacheId: SAFE_CACHE_ID,
      tombstones: { chunkCount: 2, ids: ['dir-1::a.png', 'dir-1::b.png'] },
    });

    expect(count).toBe(2);
    expect(await readCacheTombstonesFile(cacheDir, SAFE_CACHE_ID)).toEqual({
      chunkCount: 2,
      ids: ['dir-1::a.png', 'dir-1::b.png'],
    });
  });

  it('drops the sidecar for a full rewrite', async () => {
    const cacheDir = await makeCacheDir();
    await writeSidecar(cacheDir, ['dir-1::a.png']);

    const count = await applyCacheTombstones({
      cacheDir,
      safeCacheId: SAFE_CACHE_ID,
      tombstones: undefined,
      recordTombstoneCount: 1,
    });

    expect(count).toBe(0);
    expect(await readCacheTombstonesFile(cacheDir, SAFE_CACHE_ID)).toBeNull();
  });

  it('drops the sidecar when the last tombstoned id is compacted away', async () => {
    const cacheDir = await makeCacheDir();
    await writeSidecar(cacheDir, ['dir-1::a.png']);

    const count = await applyCacheTombstones({
      cacheDir,
      safeCacheId: SAFE_CACHE_ID,
      tombstones: { chunkCount: 2, ids: [] },
    });

    expect(count).toBe(0);
    expect(await readCacheTombstonesFile(cacheDir, SAFE_CACHE_ID)).toBeNull();
  });

  it('leaves the sidecar alone on an in-place chunk edit', async () => {
    const cacheDir = await makeCacheDir();
    await writeSidecar(cacheDir, ['dir-1::a.png', 'dir-1::b.png']);

    const count = await applyCacheTombstones({
      cacheDir,
      safeCacheId: SAFE_CACHE_ID,
      tombstones: 'preserve',
      recordTombstoneCount: 2,
    });

    expect(count).toBe(2);
    expect(await readCacheTombstonesFile(cacheDir, SAFE_CACHE_ID)).toEqual({
      chunkCount: 2,
      ids: ['dir-1::a.png', 'dir-1::b.png'],
    });
  });

  // The two cases below are the whole reason 'preserve' carries the record's
  // count instead of recounting the sidecar. Recounting would make the record
  // and the sidecar agree again, and readers only force the repairing rewrite
  // while they disagree.
  it('keeps a missing sidecar visible as a mismatch instead of settling on zero', async () => {
    const cacheDir = await makeCacheDir();

    const count = await applyCacheTombstones({
      cacheDir,
      safeCacheId: SAFE_CACHE_ID,
      tombstones: 'preserve',
      recordTombstoneCount: 5,
    });

    // Zero here would declare the still-tombstoned entries live, and no later
    // delete or append would ever notice they need dropping.
    expect(count).toBe(5);
  });

  it('does not adopt the length of a half-written sidecar', async () => {
    const cacheDir = await makeCacheDir();
    await writeSidecar(cacheDir, ['dir-1::a.png', 'dir-1::b.png']);

    const count = await applyCacheTombstones({
      cacheDir,
      safeCacheId: SAFE_CACHE_ID,
      tombstones: 'preserve',
      recordTombstoneCount: 3,
    });

    // Adopting 2 would start trusting a sidecar that was rejected, which can
    // hide entries that are still on disk.
    expect(count).toBe(3);
  });

  it('reads a missing sidecar as absent and a corrupt one as an error', async () => {
    const cacheDir = await makeCacheDir();
    expect(await readCacheTombstonesFile(cacheDir, SAFE_CACHE_ID)).toBeNull();

    // Both outcomes make the renderer ignore the sidecar; the throw is what puts
    // the parse failure in the main-process log instead of hiding it.
    await fs.writeFile(getCacheTombstonesPath(cacheDir, SAFE_CACHE_ID), '{ not json');
    await expect(readCacheTombstonesFile(cacheDir, SAFE_CACHE_ID)).rejects.toThrow();

    // A well-formed file that isn't a tombstone list is treated as absent.
    await fs.writeFile(getCacheTombstonesPath(cacheDir, SAFE_CACHE_ID), '{"chunkCount":2}');
    expect(await readCacheTombstonesFile(cacheDir, SAFE_CACHE_ID)).toBeNull();
  });
});
