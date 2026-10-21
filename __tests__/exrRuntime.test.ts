// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createExrRuntime, validateRuntimeFile } from '../electron/exrRuntime.mjs';
import { EXR_DEFAULT_SETTINGS, EXR_DEFAULT_PROFILE, resolveExrProfile } from '../electron/exrProfiles.mjs';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const hash = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-exr-test-')); roots.push(root);
  const spawn = vi.fn(() => { throw new Error('Native execution must not happen in this test'); });
  const fetch = vi.fn();
  const runtime = createExrRuntime({ userDataPath: root, cacheRoot: async () => root, isPathAllowed: (file: string) => file.startsWith(root + path.sep), spawnImpl: spawn, fetchImpl: fetch, platform: 'test', packages: {} });
  return { root, runtime, spawn, fetch };
}
describe('optional EXR runtime boundaries', () => {
  it('does not read/create component files or start/download anything before use', async () => {
    const f = await fixture();
    expect(await fs.readdir(f.root)).toEqual([]);
    expect(f.spawn).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
    expect(await f.runtime.status()).toMatchObject({ installed: false, enabled: false, available: false });
    expect(await fs.readdir(f.root)).toEqual([]);
    f.runtime.dispose();
  });
  it('keeps uninstalled EXRs out of the normal decoding path', async () => {
    const f = await fixture(); const file = path.join(f.root, 'synthetic.exr'); await fs.writeFile(file, 'synthetic header');
    await expect(f.runtime.preview({ filePath: file, requestId: 'not-installed' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(f.spawn).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled(); f.runtime.dispose();
  });
  it('rejects unauthorized paths and unapproved configurations', async () => {
    const f = await fixture();
    await expect(f.runtime.inspect(path.join(f.root, 'synthetic.png'))).rejects.toThrow('Invalid EXR path');
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-exr-outside-')); roots.push(other);
    const file = path.join(other, 'synthetic.exr'); await fs.writeFile(file, 'synthetic');
    await expect(f.runtime.inspect(file)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(f.runtime.config(path.join(other, 'config.ocio'))).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(f.spawn).not.toHaveBeenCalled(); f.runtime.dispose();
  });
  it('persists folder/global preferences separately from catalog data', async () => {
    const f = await fixture();
    const folder = path.join(f.root, 'renders'); await fs.mkdir(folder);
    const profile = { ...EXR_DEFAULT_PROFILE, input: 'ACEScg' };
    const result = await f.runtime.saveSettings({ ...EXR_DEFAULT_SETTINGS, folders: { [folder]: profile } });
    expect(result.revision).toBe(1);
    expect(resolveExrProfile(path.join(folder, 'shot', 'render.exr'), result)).toEqual(profile);
    expect(resolveExrProfile(path.join(f.root, 'renders-other', 'render.exr'), result)).toEqual(EXR_DEFAULT_PROFILE);
    expect(f.spawn).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled(); f.runtime.dispose();
  });
  it('chooses the closest folder using platform path boundaries', () => {
    const nested = { ...EXR_DEFAULT_PROFILE, input: 'ACEScg' };
    const prefs = { ...EXR_DEFAULT_SETTINGS, folders: { 'D:\\Renders': EXR_DEFAULT_PROFILE, 'D:\\Renders\\Shot': nested } };
    expect(resolveExrProfile('d:\\renders\\shot\\frame.exr', prefs, path.win32)).toEqual(nested);
    expect(resolveExrProfile('D:\\RendersOther\\frame.exr', prefs, path.win32)).toEqual(EXR_DEFAULT_PROFILE);
  });
  it('preserves unchanged removed-folder profiles across restart without allowing unauthorized edits', async () => {
    const f = await fixture();
    const folder = path.join(f.root, 'removed-renders');
    const profile = { ...EXR_DEFAULT_PROFILE, input: 'ACEScg' };
    await f.runtime.saveSettings({ ...EXR_DEFAULT_SETTINGS, folders: { [folder]: profile } });
    await f.runtime.dispose();
    const restarted = createExrRuntime({ userDataPath: f.root, cacheRoot: async () => f.root, isPathAllowed: () => false, spawnImpl: f.spawn, fetchImpl: f.fetch, platform: 'test', packages: {} });
    try {
      const saved = await restarted.settings();
      const updated = await restarted.saveSettings({ ...saved, global: { ...EXR_DEFAULT_PROFILE, view: 'new view' } });
      expect(updated.folders[folder]).toEqual(profile);
      await expect(restarted.saveSettings({ ...updated, folders: { [folder]: { ...profile, input: 'changed' } } })).rejects.toThrow('outside authorized directories');
      await expect(restarted.saveSettings({ ...updated, folders: { ...updated.folders, [path.join(f.root, 'new-root')]: profile } })).rejects.toThrow('outside authorized directories');
      await expect(restarted.saveSettings({ ...updated, enabled: false })).resolves.toMatchObject({ enabled: false });
      await expect(restarted.remove()).resolves.toBeNull();
      expect((await restarted.settings()).folders[folder]).toEqual(profile);
      await expect(restarted.saveSettings({ ...await restarted.settings(), folders: {} })).resolves.toMatchObject({ folders: {} });
      expect(f.spawn).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
    } finally { await restarted.dispose(); }
  });
  it('rejects path traversal and missing package integrity metadata', () => {
    const bytes = Buffer.from('synthetic executable'); const compressed = gzipSync(bytes);
    const good = { name: 'imh-exr', size: bytes.length, sha256: hash(bytes), downloadSize: compressed.length, downloadSha256: hash(compressed) };
    expect(validateRuntimeFile(good)).toEqual(good);
    for (const name of ['../imh-exr', '/imh-exr', '..', 'folder\\imh-exr', 'a/b']) expect(() => validateRuntimeFile({ ...good, name })).toThrow();
    expect(() => validateRuntimeFile({ ...good, sha256: '' })).toThrow();
  });
  it('rejects a corrupt download before extraction or native execution', async () => {
    const f = await fixture(); const bytes = Buffer.from('synthetic executable'); const compressed = gzipSync(bytes);
    const file = { name: 'imh-exr', size: bytes.length, sha256: hash(bytes), downloadSize: compressed.length, downloadSha256: '0'.repeat(64), url: 'https://github.com/LuqP2/Image-MetaHub/releases/download/exr-runtime-v1.0.0/imh-exr.gz' };
    const fetch = vi.fn(async () => new Response(compressed));
    const runtime = createExrRuntime({ userDataPath: f.root, cacheRoot: async () => f.root, isPathAllowed: () => true, spawnImpl: f.spawn, fetchImpl: fetch, platform: 'test', packages: { test: { executable: 'imh-exr', files: [file] } } });
    await expect(runtime.install()).rejects.toMatchObject({ code: 'INTEGRITY' });
    expect(f.spawn).not.toHaveBeenCalled();
    expect(await fs.readdir(path.join(f.root, 'components', 'exr-ocio'))).toEqual([]); runtime.dispose(); f.runtime.dispose();
  });
});
