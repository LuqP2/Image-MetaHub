// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoardCloseCoordinator } from '../electron/boardCloseCoordinator.mjs';

afterEach(() => vi.useRealTimers());
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
describe('board close handshake', () => {
  it('intercepts dirty close, ignores stale acknowledgements and waits for repository flush', async () => {
    const request = vi.fn(); const resume = vi.fn(); const preventDefault = vi.fn();
    let finish: () => void;
    const persisted = new Promise<void>(resolve => { finish = resolve; });
    const coordinator = createBoardCloseCoordinator({ requestFlush: request, flushRepository: () => persisted, confirmFailure: vi.fn() });
    coordinator.markDirty(true);
    expect(coordinator.beforeClose({ preventDefault }, resume)).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    coordinator.acknowledge('stale', { success: true });
    expect(resume).not.toHaveBeenCalled();
    coordinator.acknowledge(request.mock.calls[0][0], { success: true });
    await drain(); expect(resume).not.toHaveBeenCalled();
    finish!(); await drain(); expect(resume).toHaveBeenCalledOnce();
    expect(coordinator.beforeClose({ preventDefault }, resume)).toBe(false);
  });
  it('supports retry then cancel without closing or dropping dirty state', async () => {
    const request = vi.fn(); const resume = vi.fn();
    const choice = vi.fn().mockResolvedValueOnce('retry').mockResolvedValueOnce('cancel');
    const coordinator = createBoardCloseCoordinator({ requestFlush: request, flushRepository: async () => {}, confirmFailure: choice });
    coordinator.markDirty(true);
    coordinator.beforeClose({ preventDefault: vi.fn() }, resume);
    coordinator.acknowledge(request.mock.calls[0][0], { success: false, error: 'disk full' });
    await drain(); expect(request).toHaveBeenCalledTimes(2);
    coordinator.acknowledge(request.mock.calls[1][0], { success: false });
    await drain(); expect(resume).not.toHaveBeenCalled();
    coordinator.beforeClose({ preventDefault: vi.fn() }, resume);
    expect(request).toHaveBeenCalledTimes(3);
    coordinator.dispose(); await drain();
  });
  it('offers an explicit discard after timeout and handles repeated close requests once', async () => {
    vi.useFakeTimers(); const request = vi.fn(); const resume = vi.fn();
    const choice = vi.fn().mockResolvedValue('discard');
    const coordinator = createBoardCloseCoordinator({ requestFlush: request, flushRepository: async () => {}, confirmFailure: choice });
    coordinator.markDirty(true);
    coordinator.beforeClose({ preventDefault: vi.fn() }, resume);
    coordinator.beforeClose({ preventDefault: vi.fn() }, resume);
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10000);
    expect(choice).toHaveBeenCalledOnce(); expect(resume).toHaveBeenCalledOnce();
    coordinator.markDirty(true); // A pending main-process write cannot cancel explicit discard.
    expect(coordinator.beforeClose({ preventDefault: vi.fn() }, resume)).toBe(false);
    coordinator.dispose();
    coordinator.reset();
    expect(coordinator.beforeClose({ preventDefault: vi.fn() }, resume)).toBe(false);
  });
});
