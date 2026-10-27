/** Close/quit handshake; no Electron dependency so failure and timeout paths are testable. */
export function createBoardCloseCoordinator({ requestFlush, flushRepository, confirmFailure, timeoutMs = 10000 }) {
  let dirty = false;
  let approved = false;
  let attempt = null;
  let requestNumber = 0;
  let wait = null;
  const askRenderer = () => new Promise((resolve, reject) => {
    const requestId = `board-close-${++requestNumber}`;
    const timer = setTimeout(() => { wait = null; reject(new Error('Canvas did not confirm that its changes were saved.')); }, timeoutMs);
    wait = { requestId, resolve, reject, timer };
    try { requestFlush(requestId); }
    catch (error) { clearTimeout(timer); wait = null; reject(error); }
  });
  const coordinator = {
    markDirty(value) { dirty = value === true; },
    acknowledge(requestId, result) {
      if (!wait || wait.requestId !== requestId) return;
      const pending = wait;
      wait = null;
      clearTimeout(pending.timer);
      if (result?.success) pending.resolve();
      else pending.reject(new Error(result?.error || 'Canvas could not save its changes.'));
    },
    beforeClose(event, resume) {
      if (approved) return false;
      if (!dirty && !attempt) return false;
      event.preventDefault();
      if (attempt) return true;
      attempt = (async () => {
        for (;;) {
          try {
            await askRenderer();
            await flushRepository();
            dirty = false;
            return true;
          } catch (error) {
            const choice = await confirmFailure(error);
            if (choice === 'retry') continue;
            if (choice === 'discard') { dirty = false; return true; }
            return false;
          }
        }
      })().then(allowed => { attempt = null; if (allowed) { approved = true; resume(); } }).catch(() => { attempt = null; });
      return true;
    },
    dispose() {
      if (wait) { clearTimeout(wait.timer); wait.reject(new Error('Application window closed.')); wait = null; }
      dirty = false;
    },
    reset() { approved = false; dirty = false; },
  };
  return coordinator;
}
