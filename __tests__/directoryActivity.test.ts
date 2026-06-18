import { afterEach, describe, expect, it } from 'vitest';
import { useImageStore } from '../store/useImageStore';
import { waitForDirectoryActivityToSettle } from '../utils/directoryActivity';

describe('waitForDirectoryActivityToSettle', () => {
  afterEach(() => {
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
});
