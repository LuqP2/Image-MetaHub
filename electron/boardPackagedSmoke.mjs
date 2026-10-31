import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { registerBoardIpc } from './boardIpc.mjs';
import { BoardRepository } from './boardRepository.mjs';
import { resetUserDataContents } from './cacheReset.mjs';
import { createBoardDocument } from '../services/boards/document.mjs';
import { clipboard, nativeImage } from 'electron';

/** Functional smoke only: hidden synthetic profile, no visual acceptance or real library. */
export async function runBoardPackagedSmoke({ app, BrowserWindow, ipcMain, root, appPath = app.getAppPath() }) {
  const relativeProfile = path.relative(path.resolve(root), path.resolve(app.getPath('userData')));
  if (!relativeProfile || relativeProfile.startsWith('..') || path.isAbsolute(relativeProfile) || !path.basename(root).startsWith('imh-canvas-smoke-')) {
    throw new Error('Canvas smoke requires an isolated synthetic profile inside its temporary root.');
  }
  const window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(appPath, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  const exportedPath = path.join(root, 'synthetic.imhboard.json');
  const pngPath = path.join(root, 'synthetic.png');
  const persistence = registerBoardIpc({ ipcMain, app, BrowserWindow, clipboard, getMainWindow: () => window, dialog: {
    showSaveDialog: async (_window, options) => ({ canceled: false, filePath: options.filters[0].extensions[0] === 'png' ? pngPath : exportedPath }),
    showOpenDialog: async () => ({ canceled: false, filePaths: [exportedPath] }),
  } });
  await window.loadURL('data:text/html,<html><body>Canvas functional smoke</body></html>');
  const document = createBoardDocument('Packaged synthetic board');
  const directoryPath = path.join(root, 'synthetic-library');
  const locator = name => ({ imageId: `synthetic::${name}`, directoryPath, relativePath: name });
  document.objects.push({ id: 'asset', type: 'asset', x: 10, y: 20, width: 280, height: 242, zIndex: 1, frameId: null,
    reference: { kind: 'path', locator: locator('b.png') }, name: 'b.png', mediaType: 'image', visibleFields: [] });
  document.objects.push({ id: 'sticky', type: 'sticky', x: 350, y: 20, width: 240, height: 180, zIndex: 2, frameId: null, text: 'Packaged note', fontSize: 24, color: '#fde68a' },
    { id: 'shape', type: 'shape', shape: 'diamond', x: 650, y: 20, width: 240, height: 180, zIndex: 3, frameId: null, text: 'Decision', fontSize: 24, color: '#bfdbfe', borderColor: '#112233', borderWidth: 2 },
    { id: 'link', type: 'link', x: 950, y: 20, width: 240, height: 180, zIndex: 4, frameId: null, title: 'Example', url: 'https://example.com/', color: '#93c5fd' });
  const remaps = [['a.png', 'temp.png'], ['b.png', 'a.png'], ['temp.png', 'b.png']].map(([from, to]) => ({ operationId: crypto.randomUUID(), oldLocator: locator(from), newLocator: locator(to) }));
  const result = await window.webContents.executeJavaScript(`(async () => {
    const api = window.electronAPI;
    const unwrap = result => { if (!result.success) throw new Error(result.error); return result.data; };
    let saved = unwrap(await api.boardsSave({ document: ${JSON.stringify(document)}, expectedRevision: 0 }));
    unwrap(await api.boardsRemapReferences(${JSON.stringify(remaps)}));
    for (let index = 0; index < 3; index++) {
      saved = unwrap(await api.boardsLoad(saved.id));
      if (saved.objects[0].reference.locator.relativePath !== 'a.png') throw new Error('Reference changed during repeated load/save');
      saved = unwrap(await api.boardsSave({ document: saved, expectedRevision: saved.revision }));
    }
    const conflict = await api.boardsSave({ document: saved, expectedRevision: 0 });
    if (conflict.success || conflict.code !== 'BOARD_REVISION_CONFLICT') throw new Error('Revision conflict was not enforced');
    unwrap(await api.boardsExport(saved));
    const imported = unwrap(await api.boardsImport());
    if (imported.id === saved.id || imported.objects.length !== 4 || imported.schemaVersion !== 3) throw new Error('Import did not preserve independent v3 objects');
    const baseline = unwrap(await api.boardsReferenceBaseline());
    if (baseline.length !== 3) throw new Error('Reference baseline is missing');
    unwrap(await api.boardsFlush());
    return { boardId: saved.id, importedId: imported.id, revision: saved.revision };
  })()`);
  // Exercise the native bridge without changing the operator's clipboard.
  const clipboardText = await window.webContents.executeJavaScript('window.electronAPI.boardsReadClipboard()');
  if (!clipboardText.success || clipboardText.data !== clipboard.readText()) throw new Error('System clipboard bridge failed');
  const pngResult = await window.webContents.executeJavaScript(`window.electronAPI.boardsExportPng(${JSON.stringify({ name: 'Packaged PNG', width: 2304, height: 256, scale: 1,
    html: '<div style="position:relative;width:2304px;height:256px"><div style="position:absolute;left:2090px;top:20px;width:100px;height:100px;background:#ff0000"></div></div>' })})`);
  if (!pngResult.success) throw new Error(pngResult.error);
  const png = nativeImage.createFromPath(pngPath);
  const pixels = png.toBitmap();
  const red = (32 * 2304 + 2100) * 4;
  if (png.getSize().width !== 2304 || png.getSize().height !== 256 || pixels[3] !== 0 || pixels[red + 2] !== 255 || pixels[red + 3] !== 255) throw new Error('PNG dimensions, transparency or tile composition failed');
  await persistence.flush();
  const reopened = new BoardRepository({ directory: path.join(app.getPath('userData'), 'boards') });
  if ((await reopened.load(result.boardId)).objects[0].reference.locator.relativePath !== 'a.png') throw new Error('Board did not survive repository reopen');
  const resetRoot = path.join(root, 'reset-fixture');
  await fs.mkdir(resetRoot, { recursive: true });
  await fs.cp(path.join(app.getPath('userData'), 'boards'), path.join(resetRoot, 'boards'), { recursive: true });
  await fs.writeFile(path.join(resetRoot, 'discardable-cache.json'), '{}');
  await resetUserDataContents({ userDataDir: resetRoot });
  await new BoardRepository({ directory: path.join(resetRoot, 'boards') }).load(result.boardId);
  const other = new BrowserWindow({ show: false, webPreferences: { preload: path.join(appPath, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  await other.loadURL('data:text/html,<html><body>Unauthorized smoke caller</body></html>');
  const denied = await other.webContents.executeJavaScript('window.electronAPI.boardsList()');
  other.destroy();
  if (denied.success || denied.code !== 'BOARD_ACCESS_DENIED') throw new Error('Non-main window could access board documents');
  return { success: true, coverage: 'packaged-main-preload-ipc-and-board-persistence', repeatedSaves: 3, nativeImportExport: true, schemaV3: true, systemClipboardRead: true, pngTransparencyAndTiles: true, resetPreserved: true, unauthorizedWindowRejected: true };
}
