/** Volatile main-process marker; survives renderer reloads, never changes settings. */
export function createRendererRecoveryState({ ipcMain, getWindow }) {
  let pendingContents = null;
  ipcMain.handle('consume-renderer-recovery', (event) => {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents ||
        event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame) return false;
    const recovered = pendingContents === event.sender;
    if (recovered) pendingContents = null;
    return recovered;
  });
  return {
    mark(contents) { pendingContents = contents; },
  };
}
