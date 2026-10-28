import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBoardPersistenceLifecycle } from '../hooks/useBoardPersistenceLifecycle';
import { useBoardStore } from '../store/useBoardStore';

const originalApi = window.electronAPI;
afterEach(() => { cleanup(); useBoardStore.setState({ closing: false }); Object.defineProperty(window, 'electronAPI', { configurable: true, value: originalApi }); vi.restoreAllMocks(); });
function Harness() { useBoardPersistenceLifecycle(); return null; }
describe('board persistence lifecycle', () => {
  it('freezes edits during close flush, acknowledges errors and unlocks after cancellation', async () => {
    let flush: (id: string) => void;
    let cancel: () => void;
    const acknowledge = vi.fn();
    const unsubscribe = vi.fn();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
      boardsSetDirty: vi.fn(), boardsFlushAcknowledged: acknowledge,
      onBoardsFlushRequested: (callback) => { flush = callback; return unsubscribe; },
      onBoardsCloseCancelled: (callback) => { cancel = callback; return unsubscribe; },
    } });
    vi.spyOn(useBoardStore.getState(), 'flushAll').mockRejectedValue(new Error('disk full'));
    const view = render(<Harness />);
    await act(async () => { flush!('request'); });
    expect(useBoardStore.getState().closing).toBe(true);
    expect(acknowledge).toHaveBeenCalledWith('request', { success: false, error: 'disk full' });
    act(() => cancel!());
    expect(useBoardStore.getState().closing).toBe(false);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
