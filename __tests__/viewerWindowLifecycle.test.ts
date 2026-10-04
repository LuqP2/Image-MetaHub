import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createViewerOpenCoordinator, createViewerReadiness, createViewerFocusTracker, presentViewerWindow, openViewerWithRecovery } from '../utils/viewerWindowLifecycle.mjs';

const createNativeWindow = (sessionId: string) => Object.assign(new EventEmitter(), {
  __imageViewerSessionId: sessionId,
  isDestroyed: () => false, show: vi.fn(), showInactive: vi.fn(), focus: vi.fn(), maximize: vi.fn(),
});

afterEach(() => vi.useRealTimers());

describe('viewer native readiness', () => {
  it.each(['initial', 'rebound'])('recovers a missed snapshot delivery for a %s window', async (kind) => {
    vi.useFakeTimers();
    const shown = vi.fn();
    let deliveries = 0;
    const lifecycle = createViewerReadiness({
      onReady: shown,
      onFailure: vi.fn(),
      onRequestSnapshot: () => {
        deliveries += 1;
        // The listener was unavailable for the first delivery.
        if (deliveries === 2) lifecycle.markRendererReady();
      },
    });
    if (kind === 'rebound') lifecycle.markNativeReady();
    lifecycle.markDocumentLoaded();
    lifecycle.markDocumentLoaded();
    expect(shown).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    if (kind === 'initial') lifecycle.markNativeReady();
    expect(await lifecycle.promise).toEqual({ success: true });
    expect(shown).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15000);
    expect(deliveries).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers missing hidden paint only after load and applied-image acknowledgment', async () => {
    vi.useFakeTimers();
    const focus = createViewerFocusTracker();
    const window = createNativeWindow('loading');
    focus.request('loading');
    const lifecycle = createViewerReadiness({
      onReady: () => presentViewerWindow(window, { activate: focus.shouldActivate('loading') }),
      onFailure: vi.fn(),
      onNeedsNativeShow: () => { window.showInactive(); window.emit('show'); },
    });
    window.once('show', lifecycle.markNativeReady);
    lifecycle.markRendererReady();
    vi.advanceTimersByTime(1000);
    expect(window.showInactive).not.toHaveBeenCalled();
    lifecycle.markDocumentLoaded();
    // The user returns to the library before the recovery presents the window.
    focus.focusMain({ focus: vi.fn() });
    vi.advanceTimersByTime(1000);
    expect(await lifecycle.promise).toEqual({ success: true });
    expect(window.focus).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
    expect(window.showInactive).toHaveBeenCalled();
  });

  it('does not show a loaded window that has not acknowledged its image', async () => {
    vi.useFakeTimers();
    const recover = vi.fn();
    const lifecycle = createViewerReadiness({ onReady: vi.fn(), onFailure: vi.fn(), onNeedsNativeShow: recover });
    lifecycle.markDocumentLoaded();
    vi.advanceTimersByTime(15000);
    expect(await lifecycle.promise).toMatchObject({ success: false, error: 'Viewer renderer did not acknowledge the snapshot.' });
    expect(recover).not.toHaveBeenCalled();
  });

  it('cancels snapshot retries and native-show recovery when closed during opening', async () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const recover = vi.fn();
    const lifecycle = createViewerReadiness({ onReady: vi.fn(), onFailure: vi.fn(), onRequestSnapshot: deliver, onNeedsNativeShow: recover });
    lifecycle.markDocumentLoaded();
    lifecycle.markRendererReady();
    lifecycle.cancel();
    vi.advanceTimersByTime(15000);
    expect(await lifecycle.promise).toMatchObject({ cancelled: true });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(recover).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles a failed resend and stops its timers', async () => {
    vi.useFakeTimers();
    const lifecycle = createViewerReadiness({
      onReady: vi.fn(), onFailure: vi.fn(),
      onRequestSnapshot: () => { throw new Error('webContents unavailable'); },
    });
    lifecycle.markDocumentLoaded();
    expect(await lifecycle.promise).toMatchObject({ success: false, error: 'Viewer snapshot delivery failed.' });
    expect(vi.getTimerCount()).toBe(0);
  });

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
  it.each(['initial load failed', 'parked renderer failed'])('retries %s once with a fresh renderer before failing', async (error) => {
    const open = vi.fn().mockResolvedValueOnce({ success: false, error }).mockResolvedValueOnce({ success: true });
    const retry = vi.fn();
    expect(await openViewerWithRecovery(open, { isCancelled: () => false, onRetry: retry })).toEqual({ success: true });
    expect(open.mock.calls).toEqual([[true], [false]]);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('ends recovery after the fresh renderer also fails', async () => {
    const open = vi.fn().mockResolvedValue({ success: false, error: 'load failed' });
    expect(await openViewerWithRecovery(open, { isCancelled: () => false, onRetry: vi.fn() })).toMatchObject({ success: false });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('does not reopen a viewer closed during the first attempt', async () => {
    const open = vi.fn().mockResolvedValue({ success: false, cancelled: true });
    const retry = vi.fn();
    expect(await openViewerWithRecovery(open, { isCancelled: () => false, onRetry: retry })).toMatchObject({ cancelled: true });
    expect(open).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('honors a cancellation arriving between failed opening and recovery', async () => {
    let cancelled = false;
    const open = vi.fn(async () => { cancelled = true; return { success: false, error: 'failed' }; });
    expect(await openViewerWithRecovery(open, { isCancelled: () => cancelled, onRetry: vi.fn() })).toMatchObject({ cancelled: true });
    expect(open).toHaveBeenCalledTimes(1);
  });

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
