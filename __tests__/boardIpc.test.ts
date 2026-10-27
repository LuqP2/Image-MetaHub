// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { registerBoardIpc } from '../electron/boardIpc.mjs';

describe('board IPC authorization', () => {
  it('rejects detached windows and subframes before initializing persistence', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const getPath = vi.fn();
    const mainFrame = {};
    const webContents = { mainFrame };
    registerBoardIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, app: { getPath }, dialog: {}, getMainWindow: () => ({ isDestroyed: () => false, webContents }) });
    for (const event of [{ sender: {}, senderFrame: mainFrame }, { sender: webContents, senderFrame: {} }]) {
      expect(await handlers.get('boards:list')!(event)).toMatchObject({ success: false, code: 'BOARD_ACCESS_DENIED' });
    }
    expect(getPath).not.toHaveBeenCalled();
  });
});
