// @vitest-environment node
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { attachEnrichmentMemoryDiagnostics } from '../electron/enrichmentMemoryDiagnostics.mjs';

function fixture(enabled = true) {
  const ipcMain = new EventEmitter();
  const contents = { isDestroyed: () => false, getOSProcessId: () => 42 };
  const window = { webContents: contents, isDestroyed: () => false, isMinimized: () => true };
  const app = {
    getAppMetrics: vi.fn(() => [
      { pid: 1, memory: { workingSetSize: 9999 } },
      { pid: 42, memory: { workingSetSize: 1234 } },
    ]),
    getGPUFeatureStatus: () => ({ gpu_compositing: 'disabled_software' }),
  };
  const log = vi.fn();
  attachEnrichmentMemoryDiagnostics({ enabled, ipcMain, app, getWindow: () => window, log, now: () => 1000 });
  return { ipcMain, contents, app, log };
}

describe('opt-in enrichment memory diagnostics', () => {
  it('does not register a handler or collect metrics while disabled', () => {
    const f = fixture(false);
    expect(f.ipcMain.listenerCount('enrichment-memory-sample')).toBe(0);
    expect(f.app.getAppMetrics).not.toHaveBeenCalled();
  });

  it('correlates heap and progress with the main window renderer PID', () => {
    const f = fixture();
    f.ipcMain.emit('enrichment-memory-sample', { sender: f.contents }, {
      event: 'checkpoint', processed: 1000, total: 99000, chunks: 2, heapUsedBytes: 2048,
    });
    expect(f.log).toHaveBeenCalledWith(expect.objectContaining({
      rendererPid: 42, rendererMemoryKB: { workingSetSize: 1234 },
      heapUsedBytes: 2048, processed: 1000, total: 99000, chunks: 2, minimized: true,
    }));
  });

  it('ignores unrelated renderers and invalid events', () => {
    const f = fixture();
    f.ipcMain.emit('enrichment-memory-sample', { sender: {} }, { event: 'start' });
    f.ipcMain.emit('enrichment-memory-sample', { sender: f.contents }, null);
    expect(f.app.getAppMetrics).not.toHaveBeenCalled();
  });

  it.each([false, true])('preload gates periodic sampling and IPC behind opt-in=%s', async enabled => {
    const send = vi.fn();
    const interval = vi.fn();
    let exposed: any;
    vm.runInNewContext(await readFile(new URL('../preload.js', import.meta.url), 'utf8'), {
      require: () => ({
        contextBridge: { exposeInMainWorld: (_name: string, api: unknown) => { exposed = api; } },
        ipcRenderer: { on: vi.fn(), send, invoke: vi.fn() }, webUtils: {},
      }),
      process: { env: { IMH_ENRICHMENT_MEMORY_DIAGNOSTICS: enabled ? '1' : undefined } },
      setInterval: interval, performance: { memory: { usedJSHeapSize: 50 } },
    });
    exposed.reportEnrichmentMemory({ event: 'complete', processed: 10, total: 10 });
    expect(send).toHaveBeenCalledTimes(enabled ? 1 : 0);
    expect(interval).toHaveBeenCalledTimes(enabled ? 1 : 0);
    if (enabled) {
      interval.mock.calls[0][0]();
      expect(send).toHaveBeenLastCalledWith('enrichment-memory-sample', {
        event: 'sample', processed: 10, total: 10, heapUsedBytes: 50,
      });
    }
  });
});
