/** Notify live renderers other than the renderer that persisted the settings. */
export function broadcastSettingsToWindows(windows, senderWebContents) {
  for (const window of new Set(windows)) {
    if (!window || window.isDestroyed() || window.webContents === senderWebContents) continue;
    window.webContents.send('settings-updated');
  }
}
