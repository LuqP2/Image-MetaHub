// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAtomicCacheChunkWriter } from '../electron/atomicCacheChunk.mjs';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});
async function destination() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-595-test-'));
  directories.push(directory);
  return path.join(directory, 'synthetic-chunk.json');
}

describe('atomic cache chunk replacement', () => {
  it('replaces the complete chunk and leaves no temporary file', async () => {
    const file = await destination();
    await fs.writeFile(file, '["old"]');
    await createAtomicCacheChunkWriter()(file, [{ enrichmentState: 'enriched' }]);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual([{ enrichmentState: 'enriched' }]);
    expect(await fs.readdir(path.dirname(file))).toEqual([path.basename(file)]);
  });

  it.each(['writeFile', 'rename'])('preserves the old chunk when %s fails and can retry', async method => {
    const file = await destination();
    await fs.writeFile(file, '["old"]');
    const io = { writeFile: fs.writeFile, rename: fs.rename, unlink: fs.unlink };
    const failing = vi.spyOn(io, method).mockRejectedValueOnce(new Error('simulated interruption'));
    const write = createAtomicCacheChunkWriter(io);
    await expect(write(file, ['new'])).rejects.toThrow('simulated interruption');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(['old']);
    expect(await fs.readdir(path.dirname(file))).toEqual([path.basename(file)]);
    failing.mockRestore();
    await write(file, ['retried']);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(['retried']);
  });

  it('serializes requests to the same destination while other chunks can proceed', async () => {
    const file = await destination();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const rename = vi.fn().mockImplementationOnce(async (...args: Parameters<typeof fs.rename>) => {
      await gate;
      return fs.rename(...args);
    }).mockImplementation(fs.rename);
    const write = createAtomicCacheChunkWriter({ ...fs, rename });
    const first = write(file, ['first']);
    const second = write(file, ['second']);
    await write(`${file}.other`, ['independent']);
    expect(rename).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([first, second]);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(['second']);
  });
});
