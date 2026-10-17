/** Lives in the main process; reloads never reset the crash history. */
export function attachMainWindowRecovery(window, {
  isCurrent, isQuitting, showDialog, quit, log,
  onBeforeReload = () => {},
  now = Date.now, schedule = setTimeout, cancel = clearTimeout,
}) {
  const contents = window.webContents;
  const attempts = [];
  let timer = null;
  let closed = false;
  let prompting = false;
  let loading = false;
  let lastReason = null;
  const valid = () => !closed && !isQuitting() && isCurrent() &&
    !window.isDestroyed() && !contents.isDestroyed();
  const record = (event, details = {}) => log({ kind: 'main-window-recovery', event, reason: lastReason, ...details });
  const reload = () => {
    loading = true;
    onBeforeReload();
    contents.reload();
    record('reload-started', { attempt: attempts.length });
  };
  const prompt = async (reason) => {
    if (!valid() || prompting) return;
    prompting = true;
    try {
      while (valid()) {
        const { response } = await showDialog(window, {
          type: 'error', title: 'Image MetaHub',
          message: 'Image MetaHub could not recover the window automatically.',
          detail: 'Saved indexing progress will be resumed when the window reloads.',
          buttons: ['Reload', 'Close application'], defaultId: 0, cancelId: 1,
        });
        if (!valid()) return;
        record('dialog-choice', { reason, response });
        if (response === 0) {
          try { reload(); return; } catch (error) {
            loading = false;
            record('reload-failed', { message: String(error) });
            // Another attempt requires another explicit dialog choice.
          }
        } else { quit(); return; }
      }
    } catch (error) {
      record('dialog-failed', { message: String(error) });
    } finally {
      prompting = false;
    }
  };
  const gone = (_event, details) => {
    loading = false;
    if (!['oom', 'crashed'].includes(details?.reason) || !valid() || timer !== null || prompting) return;
    lastReason = details.reason;
    const cutoff = now() - 10 * 60_000;
    while (attempts.length && attempts[0] <= cutoff) attempts.shift();
    if (attempts.length >= 3) {
      record('limit-reached', { reason: details.reason, attempts: attempts.length });
      void prompt(details.reason);
      return;
    }
    record('scheduled', { reason: details.reason, attempt: attempts.length + 1 });
    timer = schedule(() => {
      timer = null;
      if (!valid()) return;
      attempts.push(now());
      try { reload(); } catch (error) {
        loading = false;
        record('reload-failed', { message: String(error) });
        void prompt(details.reason);
      }
    }, 2000);
  };
  const loaded = () => {
    if (loading) record('reload-complete');
    loading = false;
  };
  const failed = (_event, code, _description, _url, isMainFrame = true) => {
    if (!loading || code === -3 || !isMainFrame) return;
    loading = false;
    record('load-failed', { code });
    void prompt('load-failed');
  };
  const dispose = () => {
    closed = true;
    if (timer !== null) cancel(timer);
    timer = null;
    contents.removeListener('render-process-gone', gone);
    contents.removeListener('did-finish-load', loaded);
    contents.removeListener('did-fail-load', failed);
  };
  contents.on('render-process-gone', gone);
  contents.on('did-finish-load', loaded);
  contents.on('did-fail-load', failed);
  window.once('close', dispose);
  return dispose;
}
