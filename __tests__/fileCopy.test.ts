import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFilePreservingTimestamps } from '../utils/fileCopy.mjs';

describe('copyFilePreservingTimestamps', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => (
      fs.rm(directory, { recursive: true, force: true })
    )));
  });

  it('keeps the source modified time on the destination copy', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-copy-time-'));
    directories.push(directory);
    const sourcePath = path.join(directory, 'source.png');
    const destinationPath = path.join(directory, 'destination.png');
    const sourceTime = new Date('2020-01-02T03:04:05.000Z');
    await fs.writeFile(sourcePath, Uint8Array.from([1, 2, 3]));
    await fs.utimes(sourcePath, sourceTime, sourceTime);

    await copyFilePreservingTimestamps(fs, sourcePath, destinationPath);

    const destinationStats = await fs.stat(destinationPath);
    expect(destinationStats.mtimeMs).toBe(sourceTime.getTime());
    expect(Array.from(await fs.readFile(destinationPath))).toEqual([1, 2, 3]);
  });

  it('removes the destination if its timestamp cannot be restored', async () => {
    const timestampError = new Error('timestamp denied');
    const fsApi = {
      stat: vi.fn().mockResolvedValue({ atime: new Date(1), mtime: new Date(2) }),
      copyFile: vi.fn().mockResolvedValue(undefined),
      utimes: vi.fn().mockRejectedValue(timestampError),
      unlink: vi.fn().mockResolvedValue(undefined),
    };

    await expect(copyFilePreservingTimestamps(fsApi, 'source', 'destination'))
      .rejects.toBe(timestampError);
    expect(fsApi.unlink).toHaveBeenCalledWith('destination');
  });
});
