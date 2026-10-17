/** Opt-in diagnostics only; never reads library contents. Electron memory is in KB. */
export function attachEnrichmentMemoryDiagnostics({ enabled, ipcMain, app, getWindow, log, now = Date.now }) {
  if (!enabled) return;
  let lastSample = -Infinity;
  ipcMain.on('enrichment-memory-sample', (event, sample = {}) => {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.sender.isDestroyed()) return;
    if (!['start', 'checkpoint', 'complete', 'cancelled', 'sample'].includes(sample?.event)) return;
    const timestamp = now();
    // Throttle periodic samples only: a fast checkpoint/completion is still useful.
    if (sample.event === 'sample' && timestamp - lastSample < 1000) return;
    lastSample = timestamp;
    try {
      const pid = event.sender.getOSProcessId();
      const metrics = app.getAppMetrics().find(metric => metric.pid === pid);
      const numeric = (value) => Number.isFinite(value) && value >= 0 ? value : null;
      log({
        kind: 'enrichment-renderer-memory', event: sample.event, rendererPid: pid,
        rendererMemoryKB: metrics?.memory ?? null,
        heapUsedBytes: numeric(sample.heapUsedBytes),
        processed: numeric(sample.processed), total: numeric(sample.total), chunks: numeric(sample.chunks),
        minimized: window.isMinimized(), gpuFeatureStatus: app.getGPUFeatureStatus(),
      });
    } catch {
      // Diagnostics must not interfere with indexing or a renderer that is exiting.
    }
  });
}
