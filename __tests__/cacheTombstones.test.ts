import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  applyCacheTombstones,
  getCacheTombstonesPath,
  readCacheTombstonesFile,
  readRecordTombstoneCount,
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

  // The record lives next to the cache dir, not inside it, same as in the app.
  const recordPathFor = (cacheDir: string) => path.join(cacheDir, `${SAFE_CACHE_ID}.record.json`);

  const writeRecord = async (cacheDir: string, record: unknown) => {
    const recordPath = recordPathFor(cacheDir);
    await fs.writeFile(recordPath, typeof record === 'string' ? record : JSON.stringify(record));
    return recordPath;
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
      recordPath: await writeRecord(cacheDir, { imageCount: 10, tombstoneCount: 1 }),
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
      recordPath: await writeRecord(cacheDir, { imageCount: 10, tombstoneCount: 2 }),
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
      recordPath: await writeRecord(cacheDir, { imageCount: 10, tombstoneCount: 5 }),
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
      recordPath: await writeRecord(cacheDir, { imageCount: 10, tombstoneCount: 3 }),
    });

    // Adopting 2 would start trusting a sidecar that was rejected, which can
    // hide entries that are still on disk.
    expect(count).toBe(3);
  });

  // Only a missing record may answer zero. Every other failure has to abort the
  // finalize: zero is not "unknown", it is the claim that nothing is tombstoned,
  // and stamping it while the sidecar still lists ids resurrects those entries
  // and leaves imageCount permanently short.
  describe("the count 'preserve' preserves", () => {
    it('takes the count the record already carries', async () => {
      const cacheDir = await makeCacheDir();
      const recordPath = await writeRecord(cacheDir, { imageCount: 17499, tombstoneCount: 4 });

      expect(await readRecordTombstoneCount(recordPath)).toBe(4);
    });

    it('answers zero only when the record is genuinely gone', async () => {
      const cacheDir = await makeCacheDir();

      expect(await readRecordTombstoneCount(recordPathFor(cacheDir))).toBe(0);
    });

    it('answers zero for a record written before tombstones existed', async () => {
      const cacheDir = await makeCacheDir();
      const recordPath = await writeRecord(cacheDir, { imageCount: 17499 });

      expect(await readRecordTombstoneCount(recordPath)).toBe(0);
    });

    it('refuses to guess when the record cannot be read', async () => {
      const cacheDir = await makeCacheDir();
      // A directory in the record's place reproduces the shape of the errors
      // that matter on Windows (EPERM/EBUSY from AV, EMFILE under a big scan):
      // something other than ENOENT came back, so the count is unknown.
      const recordPath = path.join(cacheDir, 'record-as-directory');
      await fs.mkdir(recordPath);

      await expect(readRecordTombstoneCount(recordPath)).rejects.toThrow();
    });

    it('refuses to guess when the record is torn', async () => {
      const cacheDir = await makeCacheDir();
      const recordPath = await writeRecord(cacheDir, '{"imageCount":17499,"tombstone');

      await expect(readRecordTombstoneCount(recordPath)).rejects.toThrow();
    });

    it.each([
      ['null', null],
      ['a string', '4'],
      ['negative', -1],
      ['fractional', 1.5],
    ])('refuses to guess when the count is %s', async (_label, tombstoneCount) => {
      const cacheDir = await makeCacheDir();
      const recordPath = await writeRecord(cacheDir, { imageCount: 17499, tombstoneCount });

      await expect(readRecordTombstoneCount(recordPath)).rejects.toThrow(/Unusable tombstoneCount/);
    });

    it('aborts the whole finalize rather than stamping a guessed count', async () => {
      const cacheDir = await makeCacheDir();
      await writeSidecar(cacheDir, ['dir-1::a.png']);
      const recordPath = path.join(cacheDir, 'record-as-directory');
      await fs.mkdir(recordPath);

      await expect(applyCacheTombstones({
        cacheDir,
        safeCacheId: SAFE_CACHE_ID,
        tombstones: 'preserve',
        recordPath,
      })).rejects.toThrow();

      // The sidecar survives untouched, so the pair stays exactly as it was and
      // the next delete or append still forces the repairing rewrite.
      expect(await readCacheTombstonesFile(cacheDir, SAFE_CACHE_ID)).toEqual({
        chunkCount: 2,
        ids: ['dir-1::a.png'],
      });
    });
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
