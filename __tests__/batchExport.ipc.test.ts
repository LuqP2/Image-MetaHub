import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertDistinctExportFile, resolveExportDestination, validateExportExtension } from '../electron/exportDestination.mjs';

const source = fsSync.readFileSync(path.resolve('electron.mjs'), 'utf8');
const exportHandler = source.slice(source.indexOf('  const confirmExportReplacement ='), source.indexOf("  ipcMain.handle('export-images-zip'"));
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-export-test-'));
  roots.push(root);
  await fs.writeFile(path.join(root, 'original.png'), 'synthetic-image');
  let handler: (event: unknown, request: object) => Promise<{ success: boolean; failedCount: number }>;
  const showMessageBox = vi.fn().mockResolvedValue({ response: 0 });
  const event = { sender: { isDestroyed: () => false, send: vi.fn() } };
  const dependencies = {
    ipcMain: { handle: (_: string, callback: typeof handler) => { handler = callback; } },
    fs, fsSync, path, crypto, assertDistinctExportFile, resolveExportDestination, validateExportExtension,
    BrowserWindow: { fromWebContents: () => null }, mainWindow: null, dialog: { showMessageBox },
    appLanguage: 'en', formatMessage: (_: string, key: string) => key,
    isExternalResourceModel3DFileName: () => false, isModel3DFileName: () => false,
    isPathAllowed: (filePath: string) => filePath.startsWith(root + path.sep),
    activeCanceledExportIds: new Set(),
    getUniqueName: (name: string) => name,
    createExportArtifact: async ({ sourcePath, relativePath }: { sourcePath: string; relativePath: string }) => ({ buffer: await fs.readFile(sourcePath), fileName: path.basename(relativePath) }),
    executeWithStableIdentity: async ({ perform }: { perform: () => Promise<void> }) => perform(),
  };
  new Function(...Object.keys(dependencies), exportHandler)(...Object.values(dependencies));
  const files = [{ directoryPath: root, relativePath: 'original.png' }];
  return { root, files, showMessageBox, export: (request: object) => handler(event, { files, ...request }) };
}

describe('single-file export IPC', () => {
  it('writes the exact requested filename with preserved bytes', async () => {
    const app = await fixture();
    const destFilePath = path.join(app.root, 'output', 'custom name.png');
    expect(await app.export({ destFilePath })).toMatchObject({ success: true, exportedCount: 1 });
    expect(await fs.readFile(destFilePath, 'utf8')).toBe('synthetic-image');
  });
  it('keeps folder export naming for multiple files', async () => {
    const app = await fixture();
    await fs.writeFile(path.join(app.root, 'second.png'), 'second-image');
    const destDir = path.join(app.root, 'output');
    expect(await app.export({ files: [...app.files, { directoryPath: app.root, relativePath: 'second.png' }], destDir }))
      .toMatchObject({ success: true, exportedCount: 2 });
    expect((await fs.readdir(destDir)).sort()).toEqual(['original.png', 'second.png']);
  });
  it('keeps an existing destination when replacement is declined', async () => {
    const app = await fixture();
    const destFilePath = path.join(app.root, 'existing.png');
    await fs.writeFile(destFilePath, 'existing-content');
    expect(await app.export({ destFilePath })).toMatchObject({ success: false, exportedCount: 0 });
    expect(await fs.readFile(destFilePath, 'utf8')).toBe('existing-content');
    expect(app.showMessageBox).toHaveBeenCalledOnce();
  });
  it('does not prompt again after the native Save dialog confirmed replacement', async () => {
    const app = await fixture();
    const destFilePath = path.join(app.root, 'existing.png');
    await fs.writeFile(destFilePath, 'existing-content');
    expect(await app.export({ destFilePath, overwriteConfirmed: true })).toMatchObject({ success: true });
    expect(await fs.readFile(destFilePath, 'utf8')).toBe('synthetic-image');
    expect(app.showMessageBox).not.toHaveBeenCalled();
  });
  it('rejects the source file as an export target', async () => {
    const app = await fixture();
    expect(await app.export({ destFilePath: path.join(app.root, 'original.png') })).toMatchObject({ success: false });
    expect(await fs.readFile(path.join(app.root, 'original.png'), 'utf8')).toBe('synthetic-image');
  });

  it('rejects the original through a linked library directory before rewriting metadata', async () => {
    const app = await fixture();
    const linkedDirectory = path.join(app.root, 'linked-library');
    await fs.symlink(app.root, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await app.export({
      files: [{ directoryPath: linkedDirectory, relativePath: 'original.png' }],
      destFilePath: path.join(app.root, 'original.png'),
      metadataPolicy: 'strip', overwriteConfirmed: true,
    })).toMatchObject({ success: false, exportedCount: 0 });
    expect(await fs.readFile(path.join(app.root, 'original.png'), 'utf8')).toBe('synthetic-image');
    expect(app.showMessageBox).not.toHaveBeenCalled();
  });

  it('rejects a hard link to the original even after overwrite confirmation', async () => {
    const app = await fixture();
    const destFilePath = path.join(app.root, 'hard-link.png');
    await fs.link(path.join(app.root, 'original.png'), destFilePath);
    expect(await app.export({ destFilePath, metadataPolicy: 'metahub_standard', overwriteConfirmed: true }))
      .toMatchObject({ success: false, exportedCount: 0 });
    expect(await fs.readFile(path.join(app.root, 'original.png'), 'utf8')).toBe('synthetic-image');
  });

  it.runIf(process.platform === 'win32')('rejects case aliases by filesystem identity', async () => {
    const app = await fixture();
    await expect(assertDistinctExportFile(path.join(app.root, 'original.png'), path.join(app.root, 'ORIGINAL.PNG')))
      .rejects.toThrow('original');
  });
});
