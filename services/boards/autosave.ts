/** Debounced single-flight saves. flush waits for edits made during an active save. */
export function createBoardAutosave({
  isDirty, persist, onError, delay = 500,
}: {
  isDirty: (id: string) => boolean;
  persist: (id: string) => Promise<void>;
  onError: (id: string, error: unknown) => void;
  delay?: number;
}) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Map<string, Promise<void>>();
  const clear = (id: string) => { clearTimeout(timers.get(id)); timers.delete(id); };
  const flush = (id: string): Promise<void> => {
    clear(id);
    const existing = running.get(id);
    if (existing) return existing;
    const task = Promise.resolve().then(async () => {
      while (isDirty(id)) await persist(id);
    }).catch(error => { onError(id, error); throw error; }).finally(() => running.delete(id));
    running.set(id, task);
    return task;
  };
  return {
    schedule(id: string) {
      clear(id);
      timers.set(id, setTimeout(() => { void flush(id).catch(() => {}); }, delay));
    },
    flush,
    cancel: clear,
    async settle(id: string) { await running.get(id)?.catch(() => {}); },
    async flushAll(ids: string[]) {
      const results = await Promise.allSettled(ids.map(flush));
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    },
  };
}
