/** @typedef {import('./types').HuggingFaceWatchRecord} Watch */
/** @typedef {import('./types').HuggingFaceRemoteSnapshot} Snapshot */
/** @typedef {{ format: 'hf-watch-state-v1', watches: Record<string, Omit<Watch, 'snapshot'> & { snapshotRef?: string }>, snapshots: Record<string, Snapshot> }} PackedHuggingFaceWatches */

/** @param {Record<string, Watch>} watches @returns {PackedHuggingFaceWatches} */
export function packHuggingFaceWatches(watches) {
  /** @type {PackedHuggingFaceWatches} */
  const packed = { format: 'hf-watch-state-v1', watches: {}, snapshots: {} };
  const references = new Map();
  for (const [id, watch] of Object.entries(watches)) {
    const { snapshot, ...record } = watch;
    if (snapshot) {
      let ref = references.get(snapshot);
      if (ref === undefined) {
        ref = String(references.size);
        references.set(snapshot, ref);
        packed.snapshots[ref] = snapshot;
      }
      packed.watches[id] = { ...record, snapshotRef: ref };
    } else packed.watches[id] = record;
  }
  return packed;
}

/** @param {PackedHuggingFaceWatches} packed @returns {Record<string, Watch>} */
export function unpackHuggingFaceWatches(packed) {
  if (packed.format !== 'hf-watch-state-v1') throw new Error('Unsupported Hugging Face watch preferences.');
  return Object.fromEntries(Object.entries(packed.watches).map(([id, record]) => {
    const { snapshotRef, ...watch } = record;
    if (snapshotRef === undefined) return [id, watch];
    const snapshot = packed.snapshots[snapshotRef];
    if (!snapshot) throw new Error('Missing Hugging Face watch baseline.');
    return [id, { ...watch, snapshot }];
  }));
}
