import { app, BrowserWindow, ipcMain, clipboard, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { registerBoardIpc } from '../electron/boardIpc.mjs';

const output = process.env.IMH_CANVAS_UI_SMOKE_ROOT;
if (!output || !path.resolve(output).includes('canvas-smoke-local')) throw new Error('An isolated Canvas smoke output is required.');
app.setPath('userData', path.join(output, `profile-${process.pid}`));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
process.stdout.write('Canvas UI runtime ready\n');
let window;
const priorClipboard = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() };
try {
  window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload: path.resolve('preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on('console-message', (_event, _level, message) => { if (message.includes('Error')) process.stderr.write(`${message}\n`); });
  const registerHandler = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => registerHandler(channel, async (event, ...args) => { if (channel === 'boards:export-png') await fs.writeFile(path.join(output, 'scene.html'), args[0].html); return handler(event, ...args); });
  const persistence = registerBoardIpc({ ipcMain, app, BrowserWindow, clipboard, getMainWindow: () => window, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(output, 'canvas.png') }) } });
  ipcMain.handle('get-settings', () => ({}));
  ipcMain.handle('copy-text-to-clipboard', (event, text) => { if (event.sender !== window.webContents) throw new Error('Denied'); clipboard.writeText(text); return { success: true }; });
  await window.loadFile(path.join(output, 'renderer/index.html'));
  const result = await window.webContents.executeJavaScript(`window.canvasSmoke.run()`);
  window.webContents.debugger.attach('1.3');
  const drag = async points => {
    const send = (type, point, buttons) => window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await send('mouseMoved', points.from, 0);
    await send('mousePressed', points.from, 1);
    await new Promise(resolve => setTimeout(resolve, 30));
    await send('mouseMoved', points.to, 1);
    await new Promise(resolve => setTimeout(resolve, 50));
    await send('mouseReleased', points.to, 0);
    await new Promise(resolve => setTimeout(resolve, 50));
  };
  const connection = await window.webContents.executeJavaScript('window.canvasSmoke.prepareConnection()');
  await drag(connection);
  result.bodyConnectAndThickness = await window.webContents.executeJavaScript(`window.canvasSmoke.verifyConnection(${connection.count})`);
  for (const side of ['library', 'inspector']) {
    const panel = await window.webContents.executeJavaScript(`window.canvasSmoke.panelPoints('${side}')`);
    await drag(panel);
    await window.webContents.executeJavaScript(`window.canvasSmoke.verifyPanel('${side}')`);
  }
  result.resizableSidebars = true;
  await drag(await window.webContents.executeJavaScript('window.canvasSmoke.marqueePoints()'));
  result.libraryMarquee = await window.webContents.executeJavaScript('window.canvasSmoke.verifyMarquee()');
  await persistence.flush();
  const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  window.webContents.reload(); await reloaded;
  result.restartRestored = await window.webContents.executeJavaScript(`window.canvasSmoke.verifyRestored(${JSON.stringify(result.a)})`);
  result.unifiedStylesAndInlineLinks = await window.webContents.executeJavaScript('window.canvasSmoke.showTextStyle()');
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  await fs.writeFile(path.join(output, 'workspace.png'), (await window.webContents.capturePage()).toPNG());
  const png = nativeImage.createFromPath(path.join(output, 'canvas.png'));
  if (png.isEmpty() || png.getSize().width < 1400) throw new Error('Export omitted off-screen content');
  result.libraryCanvas = await window.webContents.executeJavaScript('window.canvasSmoke.verifyLibraryFlowAndGrid()');
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  await fs.writeFile(path.join(output, 'library-grid.png'), (await window.webContents.capturePage()).toPNG());
  window.setContentSize(760, 900);
  await window.webContents.insertCSS(await fs.readFile(path.resolve('src/styles/themes.css'), 'utf8') + '\n[data-flow-view]{background:rgb(var(--gray-900))!important}');
  await window.webContents.executeJavaScript('document.documentElement.removeAttribute("style"); document.documentElement.dataset.theme = "light";');
  const lightPalette = await window.webContents.executeJavaScript('getComputedStyle(document.documentElement).getPropertyValue("--gray-900").trim()');
  if (lightPalette !== '243 244 246') throw new Error(`Light palette did not apply: ${lightPalette}`);
  result.libraryCanvasLightNarrow = await window.webContents.executeJavaScript('window.canvasSmoke.verifyLibraryFlowAndGrid()');
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  await fs.writeFile(path.join(output, 'library-grid-light-narrow.png'), (await window.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ ...result, pngSize: png.getSize() }, null, 2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) { if (window && !window.isDestroyed()) await fs.writeFile(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG()); console.error(error); process.exitCode = 1; }
finally { clipboard.write(priorClipboard); if (window && !window.isDestroyed()) window.destroy(); app.exit(process.exitCode ?? 0); }

}).catch(error => { console.error(error); app.exit(1); });
