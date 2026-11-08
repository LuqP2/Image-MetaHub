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
  if (process.argv.includes('--connections-only')) {
    const prepare = await window.webContents.executeJavaScript('window.canvasSmoke.prepareCurvedConnections()');
    window.webContents.debugger.attach('1.3');
    const send = async (type, point, buttons, modifiers = 0) => {
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', buttons, modifiers, clickCount: type === 'mouseMoved' ? 0 : 1 });
      await new Promise(resolve => setTimeout(resolve, 60));
    };
    await send('mousePressed', prepare.from, 1);
    await send('mouseMoved', prepare.to, 1);
    const dragPath = await window.webContents.executeJavaScript('window.canvasSmoke.readCurvedPreview()');
    window.webContents.invalidate();
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    await fs.writeFile(path.join(output, 'curved-connection-preview.png'), (await window.webContents.capturePage()).toPNG());
    await send('mouseReleased', prepare.to, 0);
    await window.webContents.executeJavaScript(`window.canvasSmoke.verifyCurvedConnection(${JSON.stringify(prepare.id)}, ${JSON.stringify(dragPath)}, 1)`);
    await window.webContents.executeJavaScript(`window.canvasSmoke.resetCurvedConnection(${JSON.stringify(prepare.id)})`);
    await send('mousePressed', prepare.from, 1); await send('mouseReleased', prepare.from, 0);
    await send('mouseMoved', prepare.to, 0);
    const clickPath = await window.webContents.executeJavaScript('window.canvasSmoke.readCurvedPreview()');
    await send('mousePressed', prepare.to, 1); await send('mouseReleased', prepare.to, 0);
    await window.webContents.executeJavaScript(`window.canvasSmoke.verifyCurvedConnection(${JSON.stringify(prepare.id)}, ${JSON.stringify(clickPath)}, 1)`);
    await window.webContents.executeJavaScript(`window.canvasSmoke.resetCurvedConnection(${JSON.stringify(prepare.id)})`);
    await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Select"]').click()`);
    process.stdout.write('Testing connection dot in Select mode\n');
    await send('mousePressed', prepare.dot, 1); await send('mouseReleased', prepare.dot, 0);
    await send('mouseMoved', prepare.to, 0);
    const dotPath = await window.webContents.executeJavaScript('window.canvasSmoke.readCurvedPreview()');
    await send('mousePressed', prepare.to, 1); await send('mouseReleased', prepare.to, 0);
    await window.webContents.executeJavaScript(`window.canvasSmoke.verifyCurvedConnection(${JSON.stringify(prepare.id)}, ${JSON.stringify(dotPath)}, 1)`);
    const marquee = await window.webContents.executeJavaScript('window.canvasSmoke.edgeMarqueePoints()');
    await send('mousePressed', marquee.from, 1);
    await send('mouseMoved', marquee.to, 1);
    await send('mouseReleased', marquee.to, 0);
    const edgeMarquee = await window.webContents.executeJavaScript(`window.canvasSmoke.verifyEdgeMarquee(${JSON.stringify(prepare.id)})`);
    await send('mousePressed', prepare.to, 1, 2);
    await send('mouseMoved', prepare.from, 1, 2);
    await send('mouseReleased', prepare.from, 0, 2);
    const ctrlConnect = await window.webContents.executeJavaScript(`window.canvasSmoke.verifyCtrlConnect(${JSON.stringify(prepare.id)})`);
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 0 });
    await window.webContents.executeJavaScript('window.canvasSmoke.verifyCtrlReleased()');
    const result = { curvedDrag: true, previewMatchesCommittedCurve: true, twoClicks: true, dotInSelectMode: true, automaticSelect: true, edgeMarquee, ctrlConnect };
    await fs.writeFile(path.join(output, 'connections-result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (process.argv.includes('--interaction-only')) {
    const prepare = await window.webContents.executeJavaScript('window.canvasSmoke.prepareInteractionPolish()');
    window.webContents.debugger.attach('1.3');
    const send = (type, point, buttons) => window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await send('mousePressed', prepare.from, 1);
    await send('mouseMoved', prepare.to, 1);
    await send('mouseReleased', prepare.to, 0);
    await window.webContents.executeJavaScript(`window.canvasSmoke.verifyShapeFocus(${JSON.stringify(prepare.id)})`);
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    const result = await window.webContents.executeJavaScript(`window.canvasSmoke.verifyInteractionPolish(${JSON.stringify(prepare.id)})`);
    for (const [theme, width] of [['dark', 1440], ['light', 1000]]) {
      window.setContentSize(width, 900);
      await window.webContents.insertCSS(await fs.readFile(path.resolve('src/styles/themes.css'), 'utf8'));
      await window.webContents.executeJavaScript(`document.documentElement.removeAttribute('style'); document.documentElement.dataset.theme = '${theme}';`);
      window.webContents.invalidate();
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
      await fs.writeFile(path.join(output, `interaction-${theme}.png`), (await window.webContents.capturePage()).toPNG());
    }
    await fs.writeFile(path.join(output, 'interaction-result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
  const result = await window.webContents.executeJavaScript(`window.canvasSmoke.run()`);
  result.contextMenu = await window.webContents.executeJavaScript('window.canvasSmoke.verifyMenuPlacement()');
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
  }
} catch (error) { if (window && !window.isDestroyed()) await fs.writeFile(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG()); console.error(error); process.exitCode = 1; }
finally { clipboard.write(priorClipboard); if (window && !window.isDestroyed()) window.destroy(); app.exit(process.exitCode ?? 0); }

}).catch(error => { console.error(error); app.exit(1); });
