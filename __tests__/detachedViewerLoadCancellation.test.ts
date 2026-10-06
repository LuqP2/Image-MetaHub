import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createViewerOpenCoordinator, createViewerReadiness, openViewerWithRecovery } from '../utils/viewerWindowLifecycle.mjs';

// Execute the production close listener and load handling against a native
// window double. Importing electron.mjs would start the app and read user data.
const source = readFileSync(path.resolve('electron.mjs'), 'utf8').replace(/\r\n/g, '\n');
const opening = source.slice(source.indexOf('async function openDetachedImageViewer('),
  source.indexOf('async function runPackagedDetachedViewerSmokeTest('));
const closeListener = opening.slice(opening.indexOf("  viewerWindow.on('close'"),
  opening.indexOf("  viewerWindow.on('closed'"));
const loadHandling = opening.slice(opening.indexOf("  try {\n    traceViewerLifecycle(viewerWindow, 'load-start'"),
  opening.lastIndexOf('\n}'));

describe('detached viewer closing during native load', () => {
  it.each(['close', 'load failure'])('preserves %s through the production load rejection', async (cause) => {
    const coordinate = createViewerOpenCoordinator();
    let nativeWindow: EventEmitter & { __viewerReadiness: ReturnType<typeof createViewerReadiness> };
    let rejectLoad!: (reason: Error) => void;
    let started!: () => void;
    const loadStarted = new Promise<void>((resolve) => { started = resolve; });
    const attempts = vi.fn(async () => {
      if (attempts.mock.calls.length > 1) return { success: true };
      let destroyed = false;
      const readiness = createViewerReadiness({ onReady: vi.fn(), onFailure: vi.fn() });
      nativeWindow = Object.assign(new EventEmitter(), {
        __imageViewerSessionId: 'a', __viewerReadiness: readiness,
        isFocused: () => false, isDestroyed: () => destroyed,
        destroy: () => { destroyed = true; },
        loadFile: () => new Promise<void>((_resolve, reject) => { rejectLoad = reject; started(); }),
      });
      return runInNewContext(`(async () => { ${closeListener}\n${loadHandling} })()`, {
        viewerWindow: nativeWindow, coordinateViewerOpen: coordinate,
        process: { platform: 'win32' }, mainWindow: null,
        viewerLoadTarget: { method: 'file', filePath: '/synthetic/index.html', options: {} },
        isDev: true, sessionId: 'a', traceViewerLifecycle: vi.fn(),
        getViewerLoadErrorDetails: () => ({}),
        detachedImageViewerWindows: new Map([['a', nativeWindow]]),
        detachedImageViewerSnapshots: new Map(),
      });
    });
    const retry = vi.fn();
    const result = coordinate('a', (isCancelled: () => boolean) =>
      openViewerWithRecovery(attempts, { isCancelled, onRetry: retry }));
    await loadStarted;
    if (cause === 'close') nativeWindow!.emit('close', { preventDefault: vi.fn() });
    rejectLoad(new Error(cause === 'close' ? 'ERR_ABORTED (-3) loading synthetic' : 'ERR_FAILED (-2) loading synthetic'));

    if (cause === 'close') {
      expect(await result).toEqual({ success: false, cancelled: true });
      expect(attempts).toHaveBeenCalledTimes(1);
      expect(retry).not.toHaveBeenCalled();
    } else {
      expect(await result).toEqual({ success: true });
      expect(attempts).toHaveBeenCalledTimes(2);
      expect(retry).toHaveBeenCalledTimes(1);
    }
  });
});
