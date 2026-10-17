// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachMainWindowRecovery } from '../electron/mainWindowRecovery.mjs';

function fixture() {
  const contents = Object.assign(new EventEmitter(), { reload: vi.fn(), isDestroyed: vi.fn(() => false) });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents, isDestroyed: vi.fn(() => false),
    show: vi.fn(), restore: vi.fn(), focus: vi.fn(),
  });
  const options = {
    isCurrent: vi.fn(() => true), isQuitting: vi.fn(() => false),
    showDialog: vi.fn().mockResolvedValue({ response: 1 }), quit: vi.fn(), log: vi.fn(),
  };
  const dispose = attachMainWindowRecovery(window, options);
  const crash = (reason = 'oom') => contents.emit('render-process-gone', {}, { reason });
  return { contents, window, options, dispose, crash };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('main window renderer recovery', () => {
  it.each(['oom', 'crashed'])('reloads %s after 2 seconds without showing or focusing the window', async reason => {
    const f = fixture();
    f.crash(reason);
    f.crash(reason);
    await vi.advanceTimersByTimeAsync(1999);
    expect(f.contents.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.contents.reload).toHaveBeenCalledTimes(1);
    expect(f.window.show).not.toHaveBeenCalled();
    expect(f.window.restore).not.toHaveBeenCalled();
    expect(f.window.focus).not.toHaveBeenCalled();
    f.contents.emit('did-finish-load');
    expect(f.options.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'reload-complete' }));
  });

  it.each(['clean-exit', 'killed', 'launch-failed', 'integrity-failure'])('ignores %s', async reason => {
    const f = fixture();
    f.crash(reason);
    await vi.runAllTimersAsync();
    expect(f.contents.reload).not.toHaveBeenCalled();
    expect(f.options.showDialog).not.toHaveBeenCalled();
  });

  it.each(['closed', 'replaced', 'quitting', 'destroyed'])('does not reload a window that is %s', async state => {
    const f = fixture();
    f.crash();
    if (state === 'closed') f.window.emit('close');
    if (state === 'replaced') f.options.isCurrent.mockReturnValue(false);
    if (state === 'quitting') { f.options.isQuitting.mockReturnValue(true); f.dispose(); }
    if (state === 'destroyed') f.contents.isDestroyed.mockReturnValue(true);
    await vi.runAllTimersAsync();
    expect(f.contents.reload).not.toHaveBeenCalled();
  });

  it.each([0, 1])('limits automatic recovery to 3 attempts and handles dialog choice %i', async response => {
    const f = fixture();
    f.options.showDialog.mockResolvedValue({ response });
    for (let i = 0; i < 3; i++) {
      f.crash();
      await vi.advanceTimersByTimeAsync(2000);
      f.contents.emit('did-finish-load');
    }
    f.crash();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.options.showDialog).toHaveBeenCalledTimes(1);
    expect(f.contents.reload).toHaveBeenCalledTimes(response === 0 ? 4 : 3);
    expect(f.options.quit).toHaveBeenCalledTimes(response === 1 ? 1 : 0);
  });

  it('allows automatic recovery again after the rolling window expires', async () => {
    const f = fixture();
    for (let i = 0; i < 3; i++) { f.crash(); await vi.advanceTimersByTimeAsync(2000); }
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    f.crash();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.contents.reload).toHaveBeenCalledTimes(4);
    expect(f.options.showDialog).not.toHaveBeenCalled();
  });

  it('offers a native dialog when reload throws or main-frame loading fails', async () => {
    const f = fixture();
    f.contents.reload.mockImplementationOnce(() => { throw new Error('reload failed'); });
    f.crash();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.options.showDialog).toHaveBeenCalledTimes(1);
    f.options.showDialog.mockClear();
    f.crash();
    await vi.advanceTimersByTimeAsync(2000);
    f.contents.emit('did-fail-load', {}, -2);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.options.showDialog).toHaveBeenCalledTimes(1);
  });

  it('ignores subframe/aborted load failures', async () => {
    const f = fixture();
    f.crash();
    await vi.advanceTimersByTimeAsync(2000);
    f.contents.emit('did-fail-load', {}, -2, '', '', false);
    f.contents.emit('did-fail-load', {}, -3, '', '', true);
    expect(f.options.showDialog).not.toHaveBeenCalled();
  });

  it('requires a fresh dialog choice when a manual reload also throws', async () => {
    const f = fixture();
    f.contents.reload.mockImplementation(() => { throw new Error('still failing'); });
    f.options.showDialog.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 });
    f.crash();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.options.showDialog).toHaveBeenCalledTimes(2);
    expect(f.contents.reload).toHaveBeenCalledTimes(2);
    expect(f.options.quit).toHaveBeenCalledTimes(1);
  });

  it('does not act on a dialog answer after the window has closed', async () => {
    const f = fixture();
    let answer!: (value: { response: number }) => void;
    f.options.showDialog.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    f.contents.reload.mockImplementationOnce(() => { throw new Error('failed'); });
    f.crash();
    await vi.advanceTimersByTimeAsync(2000);
    f.window.emit('close');
    answer({ response: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.contents.reload).toHaveBeenCalledTimes(1);
    expect(f.options.quit).not.toHaveBeenCalled();
  });
});
