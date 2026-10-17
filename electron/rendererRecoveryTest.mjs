/** Development-only bridge so the normal app console can exercise recovery. */
export function registerRendererRecoveryTest({ ipcMain, isDevelopment, getWindow, log }) {
  ipcMain.handle('test-renderer-recovery', (event) => {
    if (!isDevelopment) return { success: false, error: 'Only available in development.' };
    const window = getWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed() ||
        event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) {
      return { success: false, error: 'Only the main window can run this test.' };
    }
    log({ kind: 'main-window-recovery-test', simulated: true });
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    return { success: true, simulated: true };
  });
}
