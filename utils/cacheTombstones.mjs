import fs from 'fs/promises';
import path from 'path';

// Removed-image sidecar, stored as `${safeCacheId}_removed.json` so
// `clear-cache-data` (which removes every `${safeCacheId}_*` file) cleans it up
// automatically. Deleting an image only appends its id here instead of reading
// and rewriting the chunk that holds the entry; read paths filter the listed ids
// out, and the next full rewrite drops them for good.
//
// The record's `tombstoneCount` must always match the sidecar's length. The
// renderer treats any disagreement as "sidecar unusable" and serves the cache
// exactly as it sits on disk, so a torn write resurrects a deleted thumbnail
// until the next scan — it never hides a live image. That also means a
// disagreement must be left alone until a path that can actually repair it (a
// delete or an append, both of which force a full rewrite) comes along: nothing
// here may quietly make the two agree again.

export const getCacheTombstonesPath = (cacheDir, safeCacheId) =>
  path.join(cacheDir, `${safeCacheId}_removed.json`);

export const readCacheTombstonesFile = async (cacheDir, safeCacheId) => {
  try {
    const raw = await fs.readFile(getCacheTombstonesPath(cacheDir, safeCacheId), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.ids)) return null;
    return { chunkCount: parsed.chunkCount ?? 0, ids: parsed.ids };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const parseRecordTombstoneCount = (record) => {
  const count = record?.tombstoneCount;
  // Absent is a real answer: the record was written before tombstones existed,
  // or by a full rewrite. Anything else present but unusable is not — see below.
  if (count === undefined) return 0;
  if (typeof count === 'number' && Number.isInteger(count) && count >= 0) return count;
  throw new Error(`Unusable tombstoneCount in cache record: ${JSON.stringify(count)}`);
};

/**
 * The count the record already carries, which is what 'preserve' preserves.
 *
 * Only a missing record maps to zero. Every other failure — a locked or busy
 * file, a torn JSON, a count that isn't a count — throws, because zero is not
 * "unknown": it is the specific claim that nothing is tombstoned, and stamping
 * it while the sidecar still lists ids is the laundering this module exists to
 * prevent. Failing the finalize instead leaves both files exactly as they were.
 */
export const readRecordTombstoneCount = async (recordPath) => {
  let raw;
  try {
    raw = await fs.readFile(recordPath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  return parseRecordTombstoneCount(JSON.parse(raw));
};

/**
 * `tombstones` is part of the finalize-cache-write contract:
 *   undefined            -> full rewrite: drop the sidecar (tombstoneCount 0)
 *   'preserve'           -> chunks changed in place: touch neither file
 *   { chunkCount, ids }  -> replace the sidecar with exactly these ids
 *
 * Returns the tombstone count the record must be stamped with.
 *
 * 'preserve' reads the *record's* current count rather than counting the
 * sidecar. Deriving it would launder a broken pair into a consistent one in
 * both directions: a missing sidecar would become an honest zero, permanently
 * accepting entries that are still tombstoned in the chunks; and a half-written
 * sidecar would start being trusted, which can hide images that are still on
 * disk. Preserving the mismatch keeps the repair available to the next delete or
 * append, which force the full rewrite that fixes both files. The read lives
 * here, not in the caller, so there is one place that can get it wrong.
 */
export const applyCacheTombstones = async ({
  cacheDir,
  safeCacheId,
  tombstones,
  recordPath,
}) => {
  if (tombstones === 'preserve') {
    return readRecordTombstoneCount(recordPath);
  }

  const ids = Array.isArray(tombstones?.ids) ? tombstones.ids : [];
  if (ids.length === 0) {
    await fs.unlink(getCacheTombstonesPath(cacheDir, safeCacheId)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    return 0;
  }

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    getCacheTombstonesPath(cacheDir, safeCacheId),
    JSON.stringify({ chunkCount: tombstones.chunkCount ?? 0, ids })
  );
  return ids.length;
};
