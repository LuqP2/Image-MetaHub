// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BoardRepository } from '../electron/boardRepository.mjs';
import { boardWithAsset, boardRemap } from './helpers/boardFixtures';

const directories: string[] = [];
async function repository() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-board-test-'));
  directories.push(directory);
  return { directory, repo: new BoardRepository({ directory }) };
}
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });

describe('desktop board repository', () => {
  it('serializes competing writes and preserves the committed revision', async () => {
    const { repo } = await repository();
    const board = boardWithAsset();
    const outcomes = await Promise.allSettled([repo.save(board, 0), repo.save({ ...board, name: 'stale' }, 0)]);
    expect(outcomes[0].status).toBe('fulfilled');
    expect(outcomes[1].status).toBe('rejected');
    expect(await repo.load(board.id)).toMatchObject({ revision: 1, name: board.name });
    await expect(repo.remove(board.id, 0)).rejects.toMatchObject({ code: 'BOARD_REVISION_CONFLICT' });
    await repo.remove(board.id, 1);
    expect(await repo.list()).toEqual([]);
  });
  it('persists remaps across repository restart and canonicalizes stale snapshots', async () => {
    const { repo, directory } = await repository();
    const saved = await repo.save(boardWithAsset(), 0);
    await repo.remapReferences([boardRemap('a.png', 'b.png'), boardRemap('b.png', 'c.png')]);
    const restarted = new BoardRepository({ directory });
    expect((await restarted.load(saved.id)).objects[0].reference.locator.relativePath).toBe('c.png');
    const next = await restarted.save({ ...saved, name: 'stale locator' }, 1);
    expect(next.objects[0].reference.locator.relativePath).toBe('c.png');
    await restarted.remapReferences([boardRemap('a.png', 'b.png')]);
    expect(JSON.parse(await fs.readFile(path.join(directory, 'reference-remaps.json'), 'utf8'))).toHaveLength(2);
  });
  it('does not replace a corrupted document or journal and lists other documents', async () => {
    const { repo, directory } = await repository();
    const board = boardWithAsset();
    await repo.save(board, 0);
    const broken = boardWithAsset();
    await fs.writeFile(path.join(directory, `${broken.id}.json`), '{broken');
    expect(await repo.list()).toEqual(expect.arrayContaining([expect.objectContaining({ id: board.id }), expect.objectContaining({ id: broken.id, error: expect.any(String) })]));
    await expect(repo.save(broken, 0)).rejects.toThrow();
    await fs.writeFile(path.join(directory, 'reference-remaps.json'), '{broken');
    await expect(repo.remapReferences([boardRemap('a.png', 'b.png')])).rejects.toThrow();
    await expect(repo.load(board.id)).rejects.toThrow();
  });
  it('keeps the previous file when atomic replacement fails and cleans the temporary file', async () => {
    const { repo, directory } = await repository();
    const saved = await repo.save(boardWithAsset(), 0);
    const failing = new BoardRepository({ directory, fileSystem: { ...fs, rename: async () => { throw new Error('disk failure'); } } });
    await expect(failing.save({ ...saved, name: 'lost write' }, 1)).rejects.toThrow('disk failure');
    expect((await repo.load(saved.id)).name).toBe(saved.name);
    expect((await fs.readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false);
  });
  it('rejects paths as IDs before touching the filesystem', async () => {
    const { repo } = await repository();
    await expect(repo.load('../outside')).rejects.toThrow('UUID');
  });
});
