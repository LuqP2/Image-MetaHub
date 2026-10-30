import { buildDetachedViewerLoadTarget, buildDetachedViewerUrl } from '../utils/detachedViewerUrl.mjs';
import { createViewerReadiness, presentViewerWindow } from '../utils/viewerWindowLifecycle.mjs';
export function registerComparisonIpc({ ipcMain, BrowserWindow, getMainWindow, preloadPath, indexPath, isDev, configureNavigation }) {
  let session = null;
  const isMain = event => event.sender === getMainWindow()?.webContents;
  const isViewer = (event, id) => session && session.snapshot.sessionId === id && event.sender === session.window.webContents;
  const notify = (sessionId, event) => { const main = getMainWindow(); if (main && !main.isDestroyed()) main.webContents.send('comparison-event', { sessionId, ...event }); };
  const validSnapshot = value => value && typeof value.sessionId === 'string' && value.sessionId.length < 200 && Array.isArray(value.images) && value.images.length >= 2 && value.images.length <= 4 && value.images.every(image => image && typeof image.id === 'string' && typeof image.name === 'string') && Array.isArray(value.directories) && value.ui;
  ipcMain.handle('comparison-open', async (event, snapshot) => {
    if (!isMain(event) || !validSnapshot(snapshot)) return { success: false, error: 'Invalid comparison session.' };
    if (session) { if (session.ready.ready) session.window.focus(); return { success: false, error: 'A comparison window is already open.' }; }
    const window = new BrowserWindow({ width: 1280, height: 850, minWidth: 640, minHeight: 480, show: false, title: 'Image MetaHub — Compare', webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } });
    const current = { window, snapshot, returning: false, ready: null };
    session = current;
    const deliver = () => { if (!window.isDestroyed()) window.webContents.send('comparison-snapshot', current.snapshot); };
    current.ready = createViewerReadiness({ onReady: () => presentViewerWindow(window, { activate: true }), onFailure: () => { if (!window.isDestroyed()) window.destroy(); }, onRequestSnapshot: deliver, onNeedsNativeShow: () => { if (!window.isDestroyed()) { window.show(); current.ready.markNativeReady(); } } });
    window.setMenu(null);
    configureNavigation(window, buildDetachedViewerUrl(indexPath, snapshot.sessionId, isDev, 'comparison'));
    window.once('ready-to-show', () => current.ready.markNativeReady());
    window.webContents.on('did-finish-load', () => current.ready.markDocumentLoaded());
    window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => { if (isMainFrame !== false) current.ready.fail(`Could not load comparison (${code}): ${description}`); });
    window.webContents.on('render-process-gone', () => { if (current.ready.ready) notify(current.snapshot.sessionId, { type: 'failed', error: 'The comparison window stopped responding. Restored it in the app.' }); current.returning = true; current.ready.fail('Comparison renderer stopped.'); if (!window.isDestroyed()) window.destroy(); });
    window.once('closed', () => { current.ready.cancel(); if (session === current) session = null; if (current.ready.ready) notify(current.snapshot.sessionId, { type: current.returning ? 'returned' : 'closed' }); });
    const main = getMainWindow();
    const closeWithMain = () => { if (!window.isDestroyed()) window.destroy(); };
    main?.once('closed', closeWithMain);
    window.once('closed', () => main?.removeListener('closed', closeWithMain));
    try {
      const target = buildDetachedViewerLoadTarget(indexPath, snapshot.sessionId, isDev, 'comparison');
      const loading = target.method === 'file' ? window.loadFile(target.filePath, target.options) : window.loadURL(target.url);
      void loading.catch(error => current.ready.fail(error.message));
      return await current.ready.promise;
    } catch (error) { current.ready.fail(error.message); return { success: false, error: error.message }; }
  });
  ipcMain.handle('comparison-ready', (event, id, applied) => {
    if (!isViewer(event, id)) return null;
    if (applied) session.ready.markRendererReady();
    return session.snapshot;
  });
  ipcMain.handle('comparison-update', (event, snapshot) => {
    if (!isMain(event) || !validSnapshot(snapshot) || snapshot.sessionId !== session?.snapshot.sessionId) return { success: false };
    session.snapshot = snapshot; session.window.webContents.send('comparison-snapshot', snapshot); return { success: true };
  });
  ipcMain.handle('comparison-command', (event, id, command) => {
    if (!isViewer(event, id) || !command || !['ui', 'swap', 'remove', 'generate'].includes(command.type)) return { success: false };
    if (command.type === 'ui') { if (!command.ui || typeof command.ui.syncEnabled !== 'boolean') return { success: false }; session.snapshot.ui = command.ui; }
    if (command.type === 'generate' && (!command.request || !session.snapshot.images.some(image => image.id === command.request.imageId) || !command.request.metadata)) return { success: false };
    if (command.type === 'remove' && (!Number.isInteger(command.index) || command.index < 0 || command.index >= session.snapshot.images.length)) return { success: false };
    notify(session.snapshot.sessionId, { type: 'command', command }); return { success: true };
  });
  ipcMain.handle('comparison-close', (event, id, returning = false) => {
    if (!session || session.snapshot.sessionId !== id || (!isMain(event) && !isViewer(event, id))) return { success: false };
    const current = session;
    current.returning = returning === true;
    // Settle readiness before requesting close: an opening window must never present later.
    if (!current.ready.ready) current.ready.cancel();
    if (!current.window.isDestroyed()) current.window.close();
    return { success: true };
  });
}
