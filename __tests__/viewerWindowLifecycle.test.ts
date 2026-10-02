import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createViewerOpenCoordinator, createViewerReadiness, createViewerFocusTracker, presentViewerWindow } from '../utils/viewerWindowLifecycle.mjs';

const createNativeWindow = (sessionId: string) => Object.assign(new EventEmitter(), {
  __imageViewerSessionId: sessionId,
  isDestroyed: () => false, show: vi.fn(), showInactive: vi.fn(), focus: vi.fn(), maximize: vi.fn(),
});

afterEach(() => vi.useRealTimers());

describe('viewer native readiness', () => {
  it('shows a late previous opening without stealing focus from the latest window', async () => {
    const focus = createViewerFocusTracker();
    const aWindow = createNativeWindow('a');
    const bWindow = createNativeWindow('b');
    focus.request('a');
    const a = createViewerReadiness({ onReady: () => presentViewerWindow(aWindow, { activate: focus.shouldActivate('a') }), onFailure: vi.fn() });
    focus.request('b');
    const b = createViewerReadiness({ onReady: () => presentViewerWindow(bWindow, { activate: focus.shouldActivate('b') }), onFailure: vi.fn() });
    b.markNativeReady();
    b.markRendererReady();
    a.markNativeReady();
    a.markRendererReady();
    await Promise.all([a.promise, b.promise]);
    expect(bWindow.focus).toHaveBeenCalledTimes(1);
    expect(bWindow.show).toHaveBeenCalledTimes(1);
    expect(aWindow.focus).not.toHaveBeenCalled();
    expect(aWindow.show).not.toHaveBeenCalled();
    expect(aWindow.showInactive).toHaveBeenCalledTimes(1);
  });

  it('respects native focus on A while B is still loading, before forwarding the event', async () => {
    const focus = createViewerFocusTracker();
    const aWindow = createNativeWindow('a');
    const bWindow = createNativeWindow('b');
    const notified = vi.fn((sessionId: string) => {
      expect(focus.shouldActivate(sessionId)).toBe(true);
    });
    focus.trackWindow(aWindow, notified);
    focus.request('b');
    const b = createViewerReadiness({ onReady: () => presentViewerWindow(bWindow, { activate: focus.shouldActivate('b') }), onFailure: vi.fn() });
    b.markNativeReady();
    aWindow.emit('focus');
    expect(notified).toHaveBeenCalledExactlyOnceWith('a');
    b.markRendererReady();
    await b.promise;
    expect(bWindow.showInactive).toHaveBeenCalledTimes(1);
    expect(bWindow.show).not.toHaveBeenCalled();
    expect(bWindow.focus).not.toHaveBeenCalled();
  });

  it('clears pending viewer activation when explicitly returning focus to the main window', async () => {
    const focus = createViewerFocusTracker();
    const bWindow = createNativeWindow('b');
    const mainWindow = { focus: vi.fn() };
    focus.request('b');
    const b = createViewerReadiness({ onReady: () => presentViewerWindow(bWindow, { activate: focus.shouldActivate('b') }), onFailure: vi.fn() });
    b.markNativeReady();
    focus.focusMain(mainWindow);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
    b.markRendererReady();
    await b.promise;
    expect(bWindow.showInactive).toHaveBeenCalledTimes(1);
    expect(bWindow.focus).not.toHaveBeenCalled();
    // A later explicit request may activate the viewer again.
    focus.request('b');
    expect(focus.shouldActivate('b')).toBe(true);
  });

  it('records the current session when a reused native window receives focus', () => {
    const focus = createViewerFocusTracker();
    const window = createNativeWindow('original');
    const notified = vi.fn();
    focus.trackWindow(window, notified);
    window.__imageViewerSessionId = 'rebound';
    focus.request('loading');
    window.emit('focus');
    expect(focus.shouldActivate('rebound')).toBe(true);
    expect(focus.shouldActivate('original')).toBe(false);
    expect(focus.shouldActivate('loading')).toBe(false);
    expect(notified).toHaveBeenCalledExactlyOnceWith('rebound');
  });

  it.each(['native-first', 'renderer-first'])('requires paint and applied snapshot: %s', async (order) => {
    const window = { show: vi.fn(), destroy: vi.fn() };
    const lifecycle = createViewerReadiness({ onReady: window.show, onFailure: window.destroy });
    const first = order === 'native-first' ? lifecycle.markNativeReady : lifecycle.markRendererReady;
    const second = order === 'native-first' ? lifecycle.markRendererReady : lifecycle.markNativeReady;
    first();
    expect(lifecycle.ready).toBe(false);
    expect(window.show).not.toHaveBeenCalled();
    second();
    expect(await lifecycle.promise).toEqual({ success: true });
    second();
    first();
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.destroy).not.toHaveBeenCalled();
  });

  it('times out only the failed session and ignores late readiness', async () => {
    vi.useFakeTimers();
    const failed = { show: vi.fn(), destroy: vi.fn() };
    const healthy = { show: vi.fn(), destroy: vi.fn() };
    const a = createViewerReadiness({ onReady: failed.show, onFailure: failed.destroy });
    const b = createViewerReadiness({ onReady: healthy.show, onFailure: healthy.destroy });
    a.markNativeReady();
    b.markNativeReady();
    b.markRendererReady();
    vi.advanceTimersByTime(15000);
    expect(await a.promise).toMatchObject({ success: false });
    a.markRendererReady();
    expect(a.ready).toBe(false);
    expect(failed.show).not.toHaveBeenCalled();
    expect(failed.destroy).toHaveBeenCalledTimes(1);
    expect(healthy.show).toHaveBeenCalledTimes(1);
    expect(healthy.destroy).not.toHaveBeenCalled();
  });

  it('does not resurrect a window closed while loading', async () => {
    const show = vi.fn();
    const onFailure = vi.fn();
    const lifecycle = createViewerReadiness({ onReady: show, onFailure });
    lifecycle.markNativeReady();
    lifecycle.cancel();
    lifecycle.markRendererReady();
    expect(await lifecycle.promise).toEqual({ success: false, cancelled: true });
    expect(lifecycle.ready).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('settles a loading error once, even if the window then closes', async () => {
    const onFailure = vi.fn();
    const lifecycle = createViewerReadiness({ onReady: vi.fn(), onFailure });
    lifecycle.fail('load error');
    lifecycle.cancel();
    expect(await lifecycle.promise).toEqual({ success: false, error: 'load error' });
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});

describe('viewer opening coordinator', () => {
  it('shares in-flight requests for one session while opening another independently', async () => {
    const coordinate = createViewerOpenCoordinator();
    let complete!: (value: { success: boolean }) => void;
    const openA = vi.fn(() => new Promise<{ success: boolean }>((resolve) => { complete = resolve; }));
    const a = coordinate('a', openA);
    const duplicate = coordinate('a', openA);
    const b = coordinate('b', async () => ({ success: true }));
    expect(duplicate).toBe(a);
    expect(await b).toEqual({ success: true });
    expect(openA).toHaveBeenCalledTimes(1);
    complete({ success: true });
    await a;
    await coordinate('a', async () => ({ success: true, existing: true }));
    expect(openA).toHaveBeenCalledTimes(1);
  });

  it('releases a rejected IPC/open operation so a later request can retry', async () => {
    const coordinate = createViewerOpenCoordinator();
    await expect(coordinate('a', () => Promise.reject(new Error('IPC rejected')))).rejects.toThrow('IPC rejected');
    expect(await coordinate('a', async () => ({ success: true }))).toEqual({ success: true });
  });

  it('cancels an opening before a native window has been registered', async () => {
    const coordinate = createViewerOpenCoordinator();
    const createWindow = vi.fn();
    const opening = coordinate('a', async (isCancelled: () => boolean) => {
      await Promise.resolve();
      if (isCancelled()) return { success: false, cancelled: true };
      createWindow();
      return { success: true };
    });
    coordinate.cancel('a');
    expect(await opening).toEqual({ success: false, cancelled: true });
    expect(createWindow).not.toHaveBeenCalled();
  });
});
