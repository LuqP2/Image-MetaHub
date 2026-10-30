import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { registerComparisonIpc } from '../electron/comparisonIpc.mjs';
import { buildDetachedViewerLoadTarget } from '../utils/detachedViewerUrl.mjs';
import { defaultComparisonUI } from '../store/useComparisonUIStore';
function harness() {
  const handlers = new Map<string, Function>();
  const main = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: { send: vi.fn() } });
  let viewer: any;
  class Window extends EventEmitter {
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
    loadFile = vi.fn(async () => { this.webContents.emit('did-finish-load'); this.emit('ready-to-show'); });
    loadURL = vi.fn(async () => {});
    constructor() { super(); viewer = this; }
    setMenu() {} show = vi.fn(); focus = vi.fn(); isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    close() { this.destroy(); }
  }
  registerComparisonIpc({ ipcMain: { handle: (name: string, handler: Function) => handlers.set(name, handler) }, BrowserWindow: Window, getMainWindow: () => main, preloadPath: 'preload.js', indexPath: '/Applications/Image MetaHub ç/app.asar/dist/index.html', isDev: false, configureNavigation: vi.fn() });
  const call = (name: string, sender: any, ...args: any[]) => handlers.get(name)!({ sender }, ...args);
  const snapshot = { sessionId: 'session', images: [{ id: 'a', name: 'a.png' }, { id: 'b', name: 'b.png' }], directories: [], ui: defaultComparisonUI() };
  return { call, main, snapshot, get viewer() { return viewer; } };
}
describe('comparison native session', () => {
  it('uses loadFile query parameters for packaged paths with spaces and accents', () => {
    expect(buildDetachedViewerLoadTarget('/Applications/Image MetaHub ç/app.asar/dist/index.html', 'id', false, 'comparison')).toMatchObject({ method: 'file', options: { query: { window: 'comparison', sessionId: 'id' } } });
  });
  it('rejects untrusted callers, waits for applied state, and returns without ending comparison', async () => {
    const h = harness();
    expect(await h.call('comparison-open', {}, h.snapshot)).toMatchObject({ success: false });
    const opening = h.call('comparison-open', h.main.webContents, h.snapshot);
    expect(await h.call('comparison-ready', {}, 'session')).toBeNull();
    expect(await h.call('comparison-ready', h.viewer.webContents, 'session')).toEqual(h.snapshot);
    await h.call('comparison-ready', h.viewer.webContents, 'session', true);
    expect(await opening).toEqual({ success: true });
    expect(await h.call('comparison-command', {}, 'session', { type: 'swap' })).toEqual({ success: false });
    await h.call('comparison-command', h.viewer.webContents, 'session', { type: 'swap' });
    expect(h.main.webContents.send).toHaveBeenCalledWith('comparison-event', { sessionId: 'session', type: 'command', command: { type: 'swap' } });
    await h.call('comparison-close', h.viewer.webContents, 'session', true);
    expect(h.main.webContents.send).toHaveBeenCalledWith('comparison-event', { sessionId: 'session', type: 'returned' });
  });
  it('falls back on load failure and releases the failed native session', async () => {
    const h = harness();
    const opening = h.call('comparison-open', h.main.webContents, h.snapshot);
    h.viewer.webContents.emit('did-fail-load', {}, -2, 'ERR_FAILED', '', true);
    expect(await opening).toMatchObject({ success: false });
    expect(h.viewer.destroyed).toBe(true);
    expect(h.main.webContents.send).not.toHaveBeenCalledWith('comparison-event', { sessionId: 'session', type: 'closed' });
  });
  it('native close ends the session and closing main releases the child', async () => {
    const h = harness();
    const opening = h.call('comparison-open', h.main.webContents, h.snapshot);
    await h.call('comparison-ready', h.viewer.webContents, 'session', true); await opening;
    h.main.emit('closed');
    expect(h.viewer.destroyed).toBe(true);
    expect(h.main.webContents.send).toHaveBeenCalledWith('comparison-event', { sessionId: 'session', type: 'closed' });
  });
  it('cancels readiness before closing and never presents a canceled opening', async () => {
    const h = harness();
    const opening = h.call('comparison-open', h.main.webContents, h.snapshot);
    const canceled = h.viewer;
    expect(await h.call('comparison-close', h.main.webContents, 'session')).toEqual({ success: true });
    expect(await opening).toEqual({ success: false, cancelled: true });
    expect(canceled.destroyed).toBe(true);
    expect(await h.call('comparison-ready', canceled.webContents, 'session', true)).toBeNull();
    canceled.emit('ready-to-show');
    expect(canceled.show).not.toHaveBeenCalled(); expect(canceled.focus).not.toHaveBeenCalled();
    const replacement = h.call('comparison-open', h.main.webContents, { ...h.snapshot, sessionId: 'replacement' });
    const active = h.viewer;
    expect(await h.call('comparison-ready', canceled.webContents, 'replacement', true)).toBeNull();
    await h.call('comparison-ready', active.webContents, 'replacement', true);
    expect(await replacement).toEqual({ success: true });
    expect(active.show).toHaveBeenCalledOnce(); expect(canceled.show).not.toHaveBeenCalled();
    await h.call('comparison-close', h.main.webContents, 'replacement');
    expect(h.main.webContents.send).toHaveBeenCalledWith('comparison-event', { sessionId: 'replacement', type: 'closed' });
  });

});
