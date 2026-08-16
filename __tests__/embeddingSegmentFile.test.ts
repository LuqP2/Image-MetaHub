import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEmbeddingSegmentAtOffset } from '../electron/embeddingSegmentFile.mjs';

describe('appendEmbeddingSegmentAtOffset', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => (
      fs.rm(directory, { recursive: true, force: true })
    )));
  });

  const createPath = async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-embedding-segment-'));
    directories.push(directory);
    return path.join(directory, 'segment.bin');
  };

  it('truncates uncommitted crash bytes and writes at the manifest offset', async () => {
    const filePath = await createPath();
    await fs.writeFile(filePath, Uint8Array.from([1, 2, 9, 9]));

    const byteLength = await appendEmbeddingSegmentAtOffset(
      filePath,
      Uint8Array.from([3, 4]),
      2,
    );

    expect(byteLength).toBe(4);
    expect(Array.from(await fs.readFile(filePath))).toEqual([1, 2, 3, 4]);
  });

  it('rejects a segment shorter than the committed manifest boundary', async () => {
    const filePath = await createPath();
    await fs.writeFile(filePath, Uint8Array.from([1, 2]));

    await expect(appendEmbeddingSegmentAtOffset(filePath, Uint8Array.from([3]), 3))
      .rejects.toThrow('shorter than its committed offset');
    expect(Array.from(await fs.readFile(filePath))).toEqual([1, 2]);
  });
});
