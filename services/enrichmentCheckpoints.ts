/** Checkpoints own persistence only; renderer batches have an independent cadence. */
export function createEnrichmentCheckpoints(options: {
  write?: (chunkIndex: number) => Promise<void>;
  total: number;
  now?: () => number;
  onSaved?: (processed: number, chunks: number) => void;
}) {
  const now = options.now ?? (() => performance.now());
  const dirty = new Map<number, number>();
  let processed = 0;
  let saved = 0;
  let lastSave = now();
  let revision = 0;
  let queue = Promise.resolve();
  let failure: unknown;
  const due = () => dirty.size > 0 && (
    processed - saved >= 1000 || now() - lastSave >= 60_000 ||
    (options.total < 5000 && dirty.size >= 12)
  );

  return {
    mark(chunkIndex?: number) {
      if (failure) throw failure;
      processed += 1;
      if (options.write && chunkIndex !== undefined) dirty.set(chunkIndex, ++revision);
    },
    due,
    flush(force = false): Promise<void> {
      queue = queue.then(async () => {
        if (!options.write || (!force && !due()) || dirty.size === 0) return;
        const target = processed;
        const snapshot = [...dirty];
        for (const [chunkIndex, version] of snapshot) {
          await options.write(chunkIndex);
          // A concurrent result may have dirtied the same chunk during the write.
          if (dirty.get(chunkIndex) === version) dirty.delete(chunkIndex);
        }
        saved = target;
        lastSave = now();
        options.onSaved?.(saved, snapshot.length);
      }).catch(error => {
        failure = error;
        throw error;
      });
      return queue;
    },
  };
}
