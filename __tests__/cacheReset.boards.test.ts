// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resetUserDataContents } from '../electron/cacheReset.mjs';

describe('board document preservation', () => {
  it('preserves documents and the reference journal independently of license options', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-board-reset-'));
    try {
      await fs.mkdir(path.join(directory, 'boards'));
      await fs.writeFile(path.join(directory, 'boards', 'document.json'), 'synthetic document');
      await fs.writeFile(path.join(directory, 'boards', 'reference-remaps.json'), 'synthetic journal');
      await fs.writeFile(path.join(directory, 'discardable-cache.json'), '{}');
      await resetUserDataContents({ userDataDir: directory });
      expect(await fs.readFile(path.join(directory, 'boards', 'document.json'), 'utf8')).toBe('synthetic document');
      expect(await fs.readFile(path.join(directory, 'boards', 'reference-remaps.json'), 'utf8')).toBe('synthetic journal');
      await expect(fs.stat(path.join(directory, 'discardable-cache.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
