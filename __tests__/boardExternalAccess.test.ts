// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoardExternalAccess } from '../electron/boardExternalAccess.mjs';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe('Canvas external file reads', () => {
  it('grants only the dropped file and sidecars, rather than its entire folder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imh-659-acl-')); roots.push(root);
    for (const file of ['a.png', 'a.json', 'other.png', 'model.obj', 'texture.png', 'private.txt']) fs.writeFileSync(path.join(root, file), 'synthetic');
    const access = createBoardExternalAccess();
    expect(access.allows(path.join(root, 'a.png'))).toBe(false);
    access.authorize(path.join(root, 'a.png'));
    expect(access.allows(path.join(root, 'a.json'))).toBe(true);
    expect(access.allows(path.join(root, 'other.png'))).toBe(false);
    access.authorize(path.join(root, 'model.obj'));
    expect(access.allows(path.join(root, 'texture.png'))).toBe(true);
    expect(access.allows(path.join(root, 'private.txt'))).toBe(false);
    expect(() => access.authorize(root)).toThrow();
  });
});

it.each(['clip.mp4', 'sound.mp3'])('resolves a streaming URL only after authorizing external %s', async name => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imh-659-media-')); roots.push(root);
  const file = path.join(root, name); fs.writeFileSync(file, 'synthetic');
  const access = createBoardExternalAccess();
  let resolveMedia!: (_event: unknown, file: string) => Promise<{ success: boolean; url?: string; errorType?: string }>;
  const main = fs.readFileSync(new URL('../electron.mjs', import.meta.url), 'utf8');
  const start = main.indexOf("  ipcMain.handle('resolve-media-url'");
  const end = main.indexOf("  ipcMain.handle('read-file'", start);
  // Exercise the actual IPC callback without starting Electron or a real profile.
  const install = new Function('ipcMain', 'path', 'getSafeFileDetails', 'isReadPathAllowed', 'isPathAllowed', 'fs', 'logProcessEvent', 'buildMediaProtocolUrl', 'allowedDirectoryPaths', 'redactDiagnosticText', 'console', main.slice(start, end));
  const readFile = vi.fn(() => { throw new Error('Streaming must not read the whole file'); });
  const url = (file: string) => `imh-media://local/?path=${encodeURIComponent(file)}`;
  install({ handle: (_name: string, handler: typeof resolveMedia) => { resolveMedia = handler; } }, path, async () => ({}), (file: string) => access.allows(file), () => false, { access: fs.promises.access, readFile }, () => {}, url, new Set(), String, { error: vi.fn() });
  expect(await resolveMedia({}, file)).toMatchObject({ success: false, errorType: 'PERMISSION_DENIED' });
  access.authorize(file);
  expect(await resolveMedia({}, file)).toEqual({ success: true, url: url(file) });
  expect(readFile).not.toHaveBeenCalled();
});
