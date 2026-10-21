import { createExrRuntime } from './exrRuntime.mjs';

export function registerExrIpc({ app, ipcMain, protocol, dialog, BrowserWindow, isPathAllowed, cacheRoot }) {
  const runtime = createExrRuntime({ userDataPath: app.getPath('userData'), cacheRoot, isPathAllowed, changed(status) {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('exr-changed', status);
  } });
  const handle = (name, action) => ipcMain.handle(`exr-${name}`, async (event, ...args) => {
    try {
      if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Unauthorized EXR IPC sender');
      return { success: true, value: await action(event, ...args) };
    } catch (error) { return { success: false, error: error.message, code: error.code }; }
  });
  handle('status', () => runtime.status());
  handle('settings', () => runtime.settings());
  handle('save-settings', (_, value) => runtime.saveSettings(value));
  handle('install', () => runtime.install());
  handle('cancel-install', () => runtime.cancelInstall());
  handle('remove', () => runtime.remove());
  handle('config', (_, config) => runtime.config(config));
  handle('inspect', (_, filePath) => runtime.inspect(filePath));
  handle('preview', (event, request) => runtime.preview(request, event.sender.id));
  handle('cancel', (event, requestId) => runtime.cancel(event.sender.id, requestId));
  handle('choose-config', async event => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Select OpenColorIO configuration', properties: ['openFile'], filters: [{ name: 'OpenColorIO', extensions: ['ocio'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    runtime.authorizeConfig(result.filePaths[0]); return result.filePaths[0];
  });
  protocol.registerFileProtocol('imh-exr', (request, callback) => { runtime.resolvePreview(request.url).then(file => callback({ path: file })).catch(() => callback({ error: -10 })); });
  app.on('before-quit', () => runtime.dispose());
  return runtime;
}
