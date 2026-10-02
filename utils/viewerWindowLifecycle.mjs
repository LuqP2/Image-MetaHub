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

/** Loading is insufficient: wait for both native paint and the applied snapshot. */
export function createViewerReadiness({ onReady, onFailure, timeoutMs = 15000 }) {
  let nativeReady = false;
  let rendererReady = false;
  let settled = false;
  let succeeded = false;
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const finish = (result) => {
    if (settled) return;
    settled = true;
    succeeded = result.success;
    clearTimeout(timer);
    resolve(result);
    if (result.success) onReady();
    else onFailure(result);
  };
  const timer = setTimeout(() => finish({ success: false, error: 'Viewer renderer did not become ready.' }), timeoutMs);
  const check = () => { if (nativeReady && rendererReady) finish({ success: true }); };
  return {
    promise,
    get ready() { return succeeded; },
    markNativeReady() { nativeReady = true; check(); },
    markRendererReady() { rendererReady = true; check(); },
    fail(error) { finish({ success: false, error }); },
    cancel() { finish({ success: false, cancelled: true }); },
  };
}
