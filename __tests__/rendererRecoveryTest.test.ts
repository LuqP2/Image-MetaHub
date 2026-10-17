// @vitest-environment node
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRendererRecoveryTest } from '../electron/rendererRecoveryTest.mjs';
import { attachMainWindowRecovery } from '../electron/mainWindowRecovery.mjs';

afterEach(() => vi.useRealTimers());

async function fixture(isDevelopment = true) {
  const mainFrame = {};
  const contents = Object.assign(new EventEmitter(), { mainFrame, isDestroyed: () => false, reload: vi.fn() });
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
  let handler: (event: any) => unknown;
  const event = { sender: contents, senderFrame: mainFrame };
  const invoke = vi.fn(async () => handler(event));
  registerRendererRecoveryTest({
    ipcMain: { handle: (_channel, callback) => { handler = callback; } },
    isDevelopment, getWindow: () => window, log: vi.fn(),
  });
  attachMainWindowRecovery(window, {
    isCurrent: () => true, isQuitting: () => false,
    showDialog: vi.fn(), quit: vi.fn(), log: vi.fn(),
  });
  let api: { testRendererRecovery: () => Promise<unknown> };
  vm.runInNewContext(await readFile(new URL('../preload.js', import.meta.url), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer: { on: vi.fn(), invoke }, webUtils: {},
    }),
    process: { env: {} },
  });
  return { api: api!, contents, invoke, event, handler: handler! };
}

describe('recovery test from the normal renderer console', () => {
  it('connects the actual preload method to the controller and reloads after 2 seconds', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    expect(await f.api.testRendererRecovery()).toEqual({ success: true, simulated: true });
    expect(f.invoke).toHaveBeenCalledWith('test-renderer-recovery');
    await vi.advanceTimersByTimeAsync(1999);
    expect(f.contents.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.contents.reload).toHaveBeenCalledTimes(1);
  });

  it('rejects packaged/production execution without scheduling recovery', async () => {
    const f = await fixture(false);
    expect(await f.api.testRendererRecovery()).toEqual(expect.objectContaining({ success: false }));
    expect(f.contents.reload).not.toHaveBeenCalled();
  });

  it('rejects requests from secondary windows or subframes', async () => {
    const f = await fixture();
    expect(f.handler({ sender: {}, senderFrame: {} })).toEqual(expect.objectContaining({ success: false }));
    expect(f.handler({ sender: f.contents, senderFrame: {} })).toEqual(expect.objectContaining({ success: false }));
    expect(f.contents.reload).not.toHaveBeenCalled();
  });
});
