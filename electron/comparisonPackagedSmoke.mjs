import fs from 'node:fs/promises';
import electron from 'electron';
import path from 'node:path';
import { broadcastSettingsToWindows } from './settingsBroadcast.mjs';
import { registerComparisonIpc } from './comparisonIpc.mjs';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
export async function runComparisonPackagedSmoke({ app, BrowserWindow, ipcMain, root }) {
  const relative = path.relative(path.resolve(root), path.resolve(app.getPath('userData')));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('imh-compare-smoke-')) throw new Error('An isolated comparison smoke profile is required.');
  const library = path.join(root, 'library ç'); await fs.mkdir(library, { recursive: true });
  const stl = 'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle';
  for (const name of ['small.stl', 'large.stl']) await fs.writeFile(path.join(library, name), name === 'large.stl' ? stl.replaceAll('vertex 1', 'vertex 100').replaceAll('0 1 0', '0 100 0') : stl);
  const png = electron.nativeImage.createFromBitmap(Buffer.alloc(128 * 128 * 4, 255), { width: 128, height: 128 }).toPNG();
  assert(png.length > 0, 'Synthetic PNG creation failed.');
  for (const name of ['one.png', 'two.png']) await fs.writeFile(path.join(library, name), png);
  const main = new BrowserWindow({ show: false, webPreferences: { preload: path.join(app.getAppPath(), 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  const handlers = ['join-paths', 'resolve-media-url', 'get-theme', 'get-settings', 'save-settings', 'get-runtime-info', 'license:get-status'];
  ipcMain.handle('join-paths', (_event, ...parts) => ({ success: true, path: path.join(...parts) }));
  ipcMain.handle('resolve-media-url', async (_event, file) => {
    if (path.dirname(file) !== library) throw new Error('Smoke read outside synthetic library.');
    return { success: true, url: `data:${file.endsWith('.png') ? 'image/png' : 'application/octet-stream'};base64,${(await fs.readFile(file)).toString('base64')}` };
  });
  ipcMain.handle('license:get-status', () => ({ licenseStatus: 'free', trialAvailable: false }));
  ipcMain.handle('get-settings', () => ({}));
  ipcMain.handle('save-settings', () => ({ success: true }));
  ipcMain.handle('get-runtime-info', () => ({ isPortable: true, userDataPath: app.getPath('userData'), autoUpdateSupported: false }));
  ipcMain.handle('get-theme', () => ({ shouldUseDarkColors: true }));
  const settingsWindows = new Set();
  registerComparisonIpc({ settingsWindows, ipcMain, BrowserWindow, getMainWindow: () => main, preloadPath: path.join(app.getAppPath(), 'preload.js'), indexPath: path.join(app.getAppPath(), 'dist', 'index.html'), isDev: false, configureNavigation: window => { window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); }, presentWindow: () => {} });
  const ui = { sync3DEnabled: true, cameras3D: {}, last3DImageId: null, syncEnabled: true, sharedZoom: { zoom: 1, x: 0, y: 0 }, paneZooms: {}, isMetadataExpanded: true, viewMode: 'side-by-side', layoutMode: 'grid', metadataViewMode: 'standard', activeMetadataIndex: null, advancedSettings: { threshold: 18, opacity: 65, baseMode: 'left', flickerSpeedMs: 700, loupeSize: 220, loupeZoom: 2, showLabels: true } };
  const image = name => ({ id: `smoke::${name}`, name, directoryId: 'smoke', fileType: name.endsWith('.png') ? 'image/png' : 'model/stl', metadata: { normalizedMetadata: { prompt: 'Synthetic comparison fixture' } } });
  try {
    await main.loadURL('data:text/html,<html><body>Comparison functional smoke</body></html>');
    await main.webContents.executeJavaScript("window.smokeEvents = []; window.electronAPI.comparison.onEvent(event => window.smokeEvents.push(event)); true;");
    const canceledSnapshot = { sessionId: 'smoke-canceled-opening', images: ['one.png', 'two.png'].map(image), directories: [{ id: 'smoke', name: 'Library', path: library }], ui };
    const canceled = await main.webContents.executeJavaScript(`(async () => {
      const opening = window.electronAPI.comparison.open(${JSON.stringify(canceledSnapshot)});
      const closing = window.electronAPI.comparison.close('smoke-canceled-opening');
      return { opened: await opening, closed: await closing };
    })()`);
    assert(canceled.closed.success && canceled.opened.cancelled && !canceled.opened.success, 'Pending opening was not canceled.');
    assert(BrowserWindow.getAllWindows().length === 1, 'Canceled comparison left a native window behind.');
    for (const names of [['one.png', 'two.png'], ['one.png', 'two.png', 'small.stl', 'large.stl'], ['small.stl', 'large.stl']]) {
      const snapshot = { sessionId: `smoke-${names.length}-${names[0]}`, images: names.map(image), directories: [{ id: 'smoke', name: 'Library', path: library }], ui };
      const result = await main.webContents.executeJavaScript(`window.electronAPI.comparison.open(${JSON.stringify(snapshot)})`);
      assert(result.success, `Comparison did not open: ${result.error}`);
      const viewer = BrowserWindow.getAllWindows().find(window => window !== main);
      assert(viewer, 'Comparison native window missing.');
      await viewer.webContents.executeJavaScript('window.settingsNotifications = 0; window.electronAPI.onSettingsUpdated(() => { window.settingsNotifications++; }); true;');
      broadcastSettingsToWindows([main, ...settingsWindows], main.webContents);
      await viewer.webContents.executeJavaScript("new Promise((resolve, reject) => { const started = Date.now(); const poll = () => { if (window.settingsNotifications) resolve(true); else if (Date.now()-started>3000) reject(new Error('Settings notification missing')); else setTimeout(poll,20); }; poll(); })");
      await viewer.webContents.executeJavaScript(`new Promise((resolve, reject) => { const start = Date.now(); const tick = () => { const canvases = [...document.querySelectorAll('canvas')]; const images = [...document.querySelectorAll('img')]; if (canvases.length === ${names.filter(name => name.endsWith('.stl')).length} && images.filter(image => image.complete && image.naturalWidth > 0).length >= ${names.filter(name => name.endsWith('.png')).length} && !document.body.innerText.includes('Loading 3D model')) { resolve(true); return; } if (Date.now()-start > 25000) { reject(new Error(document.body.innerText)); return; } setTimeout(tick, 100); }; tick(); })`);
      const controls = await viewer.webContents.executeJavaScript(`(() => { const error = document.querySelector('[data-model3d-error]'); if (error) throw new Error(error.textContent); const sync = document.querySelector('[aria-label="Sync 3D cameras"]'); if (sync) { if (!sync.checked) throw new Error('3D sync did not default on'); sync.click(); if (sync.checked) throw new Error('3D sync did not toggle off'); const diff = [...document.querySelectorAll('button')].find(button => button.textContent === 'Diff Map'); if (!diff?.disabled) throw new Error('3D pixel differences enabled'); } const metadata = document.querySelector('[role="switch"]'); if (metadata?.getAttribute('aria-checked') !== 'false') throw new Error('Metadata mode was lost'); return true; })()`);
      assert(controls, 'Comparison controls failed.');
      // Wake hidden-page capture before taking the evidence frame.
      await viewer.webContents.capturePage();
      await viewer.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
      viewer.webContents.invalidate(); await new Promise(resolve => setTimeout(resolve, 250));
      await fs.writeFile(path.join(root, `compare-${names[0].endsWith('.stl') ? 'models' : names.length}.png`), (await viewer.webContents.capturePage()).toPNG());
      if (names[0].endsWith('.stl')) {
        const models = await viewer.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => resolve([...document.querySelectorAll('canvas')].map(canvas => canvas.toDataURL('image/png')))))");
        assert(models.length === 2, 'Expected two rendered WebGL canvases.');
        for (const [index, model] of models.entries()) await fs.writeFile(path.join(root, `model-${index}.png`), Buffer.from(model.split(',')[1], 'base64'));
      }
      await viewer.webContents.executeJavaScript(`window.electronAPI.comparison.close(${JSON.stringify(snapshot.sessionId)}, true)`);
      await main.webContents.executeJavaScript(`new Promise((resolve, reject) => { const start=Date.now(); const tick=()=>{ if(window.smokeEvents.some(event=>event.type==='returned' && event.sessionId === ${JSON.stringify(snapshot.sessionId)})) resolve(true); else if(Date.now()-start>3000) reject(new Error('Return event missing')); else setTimeout(tick,25); }; tick(); })`);
    }
    assert(settingsWindows.size === 0, 'Settings registry retained a closed comparison.');
    return { success: true, settingsBroadcast: true, coverage: 'packaged-main-preload-ipc-renderer-and-webgl', canceledOpening: true, images: 2, mixedPanels: 4, models3D: 2, syncToggle: true, metadataStatePreserved: true, returnedToApp: true, screenshots: [path.join(root, 'compare-2.png'), path.join(root, 'compare-4.png'), path.join(root, 'compare-models.png')] };
  } finally { for (const window of BrowserWindow.getAllWindows()) window.destroy(); for (const name of handlers) ipcMain.removeHandler(name); }
}
