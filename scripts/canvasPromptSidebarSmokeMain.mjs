import { app, BrowserWindow, ipcMain, clipboard, nativeImage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerBoardIpc } from '../electron/boardIpc.mjs';

const output = path.resolve('build/canvas-smoke-local/prompt-sidebar');
app.setPath('userData', path.join(output, `profile-${process.pid}`));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
process.stdout.write('Canvas sidebar runtime ready\n');
try {
  await fs.mkdir(output, { recursive: true });
  const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload: path.resolve('preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const persistence = registerBoardIpc({ ipcMain, app, BrowserWindow, clipboard, getMainWindow: () => window, dialog: {} });
  ipcMain.handle('get-settings', () => ({}));
  ipcMain.handle('save-settings', () => ({ success: true }));
  const thumbnail = nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4, 180), { width: 32, height: 32 }).toPNG();
  ipcMain.handle('prompt-library:resolve-preview', () => ({ success: true, data: { status: 'available', absolutePath: path.join(output, 'synthetic.png') } }));
  ipcMain.handle('generate-thumbnail-from-path', () => ({ success: true, data: thumbnail, mimeType: 'image/png' }));
  await window.loadFile(path.resolve('dist/canvas-prompt-smoke/index.html'));
  await window.webContents.executeJavaScript('window.canvasPromptSmoke.run()');
  const result = await window.webContents.executeJavaScript('window.canvasPromptSmoke.verifySidebars()');
  const screenshot = async name => {
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    await fs.writeFile(path.join(output, name), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  };
  await screenshot('prompts.png');
  await window.webContents.executeJavaScript('window.canvasPromptSmoke.showImageSidebar()');
  await screenshot('images.png');
  await persistence.flush();
  process.stdout.write(JSON.stringify(result) + '\n');
  app.exit(0);
} catch (error) { console.error(error); app.exit(1); }
});
