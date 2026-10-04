/** Opening requests and actual native focus share one current priority. */
export function createViewerFocusTracker() {
  let latestSessionId = null;
  return {
    request(sessionId) { latestSessionId = sessionId; },
    shouldActivate(sessionId) { return latestSessionId === sessionId; },
    focusMain(window) {
      latestSessionId = null;
      window.focus();
    },
    trackWindow(window, onFocus) {
      window.on('focus', () => {
        latestSessionId = window.__imageViewerSessionId;
        onFocus(latestSessionId);
      });
    },
  };
}

/** A late opening may become visible, but must not steal the latest requested focus. */
export function presentViewerWindow(window, { activate, maximized = false }) {
  if (window.isDestroyed()) return;
  if (maximized) window.maximize();
  if (activate) {
    window.show();
    window.focus();
  } else window.showInactive();
}

/** Share an in-flight open without conflating independent viewer sessions. */
export function createViewerOpenCoordinator() {
  const pending = new Map();
  const coordinate = (sessionId, open) => {
    if (pending.has(sessionId)) return pending.get(sessionId).promise;
    const entry = { cancelled: false, promise: null };
    const promise = Promise.resolve().then(() => open(() => entry.cancelled));
    entry.promise = promise;
    pending.set(sessionId, entry);
    const release = () => { if (pending.get(sessionId) === entry) pending.delete(sessionId); };
    void promise.then(release, release);
    return promise;
  };
  coordinate.cancel = (sessionId) => {
    const entry = pending.get(sessionId);
    if (!entry) return false;
    entry.cancelled = true;
    return true;
  };
  coordinate.isPending = (sessionId) => pending.has(sessionId);
  return coordinate;
}

/** Recover one failed opening with a fresh renderer; never retry a cancellation. */
export async function openViewerWithRecovery(open, { isCancelled, onRetry }) {
  if (isCancelled()) return { success: false, cancelled: true };
  const first = await open(true);
  if (first.success || first.cancelled) return first;
  if (isCancelled()) return { success: false, cancelled: true };
  onRetry(first);
  return open(false);
}

/** Loading is insufficient: wait for both native paint and the applied snapshot. */
export function createViewerReadiness({ onReady, onFailure, onRequestSnapshot, onNeedsNativeShow, timeoutMs = 15000, retryMs = 500, nativeShowDelayMs = 1000 }) {
  let nativeReady = false;
  let rendererReady = false;
  let documentLoaded = false;
  let settled = false;
  let succeeded = false;
  let snapshotRetry;
  let nativeShowTimer;
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const finish = (result) => {
    if (settled) return;
    settled = true;
    succeeded = result.success;
    clearTimeout(timer);
    clearInterval(snapshotRetry);
    clearTimeout(nativeShowTimer);
    resolve(result);
    if (result.success) onReady();
    else onFailure(result);
  };
  const timer = setTimeout(() => finish({ success: false, error: rendererReady
    ? 'Viewer native window did not become ready.'
    : 'Viewer renderer did not acknowledge the snapshot.' }), timeoutMs);
  const check = () => { if (nativeReady && rendererReady) finish({ success: true }); };
  const requestSnapshot = () => {
    if (settled || rendererReady || !onRequestSnapshot) return;
    try { onRequestSnapshot(); }
    catch { finish({ success: false, error: 'Viewer snapshot delivery failed.' }); }
  };
  const scheduleNativeShow = () => {
    if (settled || nativeReady || !rendererReady || !documentLoaded || !onNeedsNativeShow || nativeShowTimer) return;
    // The document and requested image are mounted. If hidden painting does not
    // emit ready-to-show, actual native visibility provides the second signal.
    nativeShowTimer = setTimeout(() => {
      if (settled || nativeReady) return;
      try { onNeedsNativeShow(); }
      catch { finish({ success: false, error: 'Viewer native presentation failed.' }); }
    }, nativeShowDelayMs);
  };
  return {
    promise,
    get ready() { return succeeded; },
    markNativeReady() { nativeReady = true; check(); },
    markDocumentLoaded() {
      if (settled || documentLoaded) return;
      documentLoaded = true;
      if (!rendererReady && onRequestSnapshot) {
        snapshotRetry = setInterval(requestSnapshot, retryMs);
        requestSnapshot();
      }
      scheduleNativeShow();
    },
    markRendererReady() {
      rendererReady = true;
      clearInterval(snapshotRetry);
      check();
      scheduleNativeShow();
    },
    fail(error) { finish({ success: false, error }); },
    cancel() { finish({ success: false, cancelled: true }); },
  };
}
