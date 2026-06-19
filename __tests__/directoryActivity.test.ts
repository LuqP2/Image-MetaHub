import { afterEach, describe, expect, it, vi } from 'vitest';
import { useImageStore } from '../store/useImageStore';
import { waitForDirectoryActivityToSettle } from '../utils/directoryActivity';

describe('waitForDirectoryActivityToSettle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useImageStore.setState({
      directoryProgress: {},
      refreshingDirectories: new Set(),
    });
  });

  it('resolves immediately when the directory is idle', async () => {
    await expect(waitForDirectoryActivityToSettle('dir-1')).resolves.toBeUndefined();
  });

  it('waits until indexing progress for the directory is cleared', async () => {
    useImageStore.getState().setDirectoryProgress('dir-1', { current: 1, total: 2 });
    let settled = false;
    const waiting = waitForDirectoryActivityToSettle('dir-1').then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    useImageStore.getState().setDirectoryProgress('dir-1', null);
    await waiting;
    expect(settled).toBe(true);
  });

  it('rejects and unsubscribes when directory activity does not settle before the timeout', async () => {
    vi.useFakeTimers();
    useImageStore.getState().setDirectoryProgress('dir-1', { current: 1, total: 2 });

    const originalSubscribe = useImageStore.subscribe;
    const unsubscribe = vi.fn();
    vi.spyOn(useImageStore, 'subscribe').mockImplementation(((listener: any) => {
      const originalUnsubscribe = originalSubscribe(listener);
      return () => {
        unsubscribe();
        originalUnsubscribe();
      };
    }) as typeof useImageStore.subscribe);

    const waiting = waitForDirectoryActivityToSettle('dir-1', 1_000);
    const rejection = expect(waiting).rejects.toThrow(
      'Timed out waiting for directory activity to finish: dir-1'
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
