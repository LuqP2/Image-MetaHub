import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushReferenceRemaps, getBoardReferenceBaseline, queueBoardReferenceRemaps, useBoardReferenceSync } from '../services/boards/referenceSync';
import { boardRemap } from './helpers/boardFixtures';
const mocks = vi.hoisted(() => ({ persist: vi.fn(), apply: vi.fn() }));
vi.mock('../services/boards/boardService', () => ({ boardService: { remapReferences: mocks.persist } }));
vi.mock('../store/useBoardStore', () => ({ useBoardStore: { getState: () => ({ applyReferenceRemaps: mocks.apply }) } }));
const originalApi = window.electronAPI;
beforeEach(() => {
  mocks.persist.mockReset().mockResolvedValue(undefined); mocks.apply.mockClear();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { boardsRemapReferences: vi.fn(), boardsReferenceBaseline: vi.fn().mockResolvedValue({ success: true, data: ['past'] }) } });
});
afterEach(async () => { mocks.persist.mockResolvedValue(undefined); await flushReferenceRemaps(); Object.defineProperty(window, 'electronAPI', { configurable: true, value: originalApi }); });
describe('board reference synchronization', () => {
  it('updates open sessions immediately and retains failed operations for retry with identical IDs', async () => {
    mocks.persist.mockRejectedValueOnce(new Error('disk full'));
    const remap = boardRemap('a.png', 'b.png');
    queueBoardReferenceRemaps([remap]);
    expect(mocks.apply).toHaveBeenCalledWith([remap]);
    await expect(flushReferenceRemaps()).rejects.toThrow('disk full');
    expect(useBoardReferenceSync.getState()).toMatchObject({ pendingCount: 1, error: expect.stringContaining('file operation completed') });
    await flushReferenceRemaps();
    expect(mocks.persist.mock.calls[0][0]).toEqual(mocks.persist.mock.calls[1][0]);
    expect(useBoardReferenceSync.getState()).toEqual({ pendingCount: 0, error: null });
    expect(await getBoardReferenceBaseline()).toEqual(['past']);
  });
});
