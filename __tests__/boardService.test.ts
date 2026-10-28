import { afterEach, describe, expect, it, vi } from 'vitest';
import { boardService, exportBoardFile, importBoardFile } from '../services/boards/boardService';
import { boardWithAsset } from './helpers/boardFixtures';

const originalApi = window.electronAPI;
afterEach(() => { Object.defineProperty(window, 'electronAPI', { configurable: true, value: originalApi }); });
function bridge(patch = {}) {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
    boardsList: vi.fn().mockResolvedValue({ success: true, data: [] }),
    boardsLoad: vi.fn(), boardsSave: vi.fn(), boardsRemove: vi.fn(), boardsRemapReferences: vi.fn(), ...patch,
  } });
}

describe('board desktop service boundary', () => {
  it('requires a complete desktop bridge', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} });
    await expect(boardService.list()).rejects.toMatchObject({ code: 'BOARD_BRIDGE_UNAVAILABLE' });
  });
  it('reports unavailable storage outside Electron', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
    await expect(boardService.list()).rejects.toMatchObject({ code: 'BOARD_BRIDGE_UNAVAILABLE' });
  });
  it('preserves repository error codes and dialog cancellation', async () => {
    bridge({ boardsLoad: vi.fn().mockResolvedValue({ success: false, code: 'BOARD_NOT_FOUND', error: 'missing' }), boardsImport: vi.fn().mockResolvedValue({ success: true, data: null }), boardsExport: vi.fn().mockResolvedValue({ success: true, data: null }) });
    await expect(boardService.load(crypto.randomUUID())).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
    expect(await importBoardFile()).toBeNull();
    await expect(exportBoardFile(boardWithAsset())).resolves.toBeUndefined();
  });
});
