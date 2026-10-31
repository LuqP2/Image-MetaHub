import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoardAutosave } from '../services/boards/autosave';

afterEach(() => vi.useRealTimers());
describe('board autosave', () => {
  it('drains an edit arriving between an empty flight and its cleanup', async () => {
    let dirty = false;
    const persist = vi.fn(async () => { dirty = false; });
    const autosave = createBoardAutosave({ isDirty: () => dirty, persist, onError: vi.fn() });
    const first = autosave.flush('one');
    await Promise.resolve();
    dirty = true;
    const closing = autosave.flush('one');
    await Promise.all([first, closing]);
    expect(persist).toHaveBeenCalledOnce();
    expect(dirty).toBe(false);
  });
  it('debounces and saves edits made during an active write in a subsequent write', async () => {
    vi.useFakeTimers();
    let dirty = true;
    let release: () => void;
    const first = new Promise<void>(resolve => { release = resolve; });
    const persist = vi.fn().mockImplementationOnce(async () => { dirty = false; await first; }).mockImplementationOnce(async () => { dirty = false; });
    const autosave = createBoardAutosave({ isDirty: () => dirty, persist, onError: vi.fn() });
    autosave.schedule('one'); autosave.schedule('one');
    await vi.advanceTimersByTimeAsync(500);
    expect(persist).toHaveBeenCalledTimes(1);
    dirty = true;
    const flush = autosave.flush('one');
    release!();
    await flush;
    expect(persist).toHaveBeenCalledTimes(2);
  });
  it('reports failures without losing dirty state and supports explicit retry', async () => {
    let dirty = true;
    const onError = vi.fn();
    const persist = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockImplementationOnce(async () => { dirty = false; });
    const autosave = createBoardAutosave({ isDirty: () => dirty, persist, onError });
    await expect(autosave.flush('one')).rejects.toThrow('disk full');
    expect(dirty).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    await autosave.flush('one');
    expect(dirty).toBe(false);
  });
});
