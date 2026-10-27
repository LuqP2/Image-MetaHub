import { create } from 'zustand';
import { boardService } from './boardService';
import { normalizeReferenceRemap } from './document.mjs';
import { useBoardStore } from '../../store/useBoardStore';
import type { BoardReferenceRemap } from './types';

const pending = new Map<string, BoardReferenceRemap>();
const observed = new Map<string, BoardReferenceRemap>();
let running: Promise<void> | null = null;
let reconciling = false;
export const useBoardReferenceSync = create<{ pendingCount: number; error: string | null }>(() => ({ pendingCount: 0, error: null }));

/** Enqueue only after the physical file operation has succeeded. Retry keeps operation IDs. */
export function queueBoardReferenceRemaps(remaps: BoardReferenceRemap[]): void {
  if (typeof window === 'undefined' || !window.electronAPI?.boardsRemapReferences || !remaps.length) return;
  const valid = remaps.map(normalizeReferenceRemap);
  for (const remap of valid) { pending.set(remap.operationId, remap); observed.set(remap.operationId, remap); }
  applyRemapsToSessions(valid);
  useBoardReferenceSync.setState({ pendingCount: pending.size });
  void flushReferenceRemaps().catch(() => {});
}

// A recovery/import may adopt a snapshot that was saved just before a file move.
// Reconcile newly loaded clean sessions with operations already observed here.
useBoardStore.subscribe?.(state => {
  if (reconciling || !observed.size) return;
  const operations = [...observed.keys()];
  const stale = Object.values(state.sessions).some(session => session.changeSequence === session.savedSequence
    && session.document.objects.some(object => object.type === 'asset' && operations.some(id => !object.reference.appliedRemapIds?.includes(id))));
  if (stale) applyRemapsToSessions([...observed.values()]);
});

function applyRemapsToSessions(remaps: BoardReferenceRemap[]) {
  reconciling = true;
  try { useBoardStore.getState().applyReferenceRemaps(remaps); }
  finally { reconciling = false; }
}

export function flushReferenceRemaps(): Promise<void> {
  if (running) return running;
  const task = Promise.resolve().then(async () => {
    while (pending.size) {
      const batch = [...pending.values()];
      await boardService.remapReferences(batch);
      batch.forEach(remap => pending.delete(remap.operationId));
      useBoardReferenceSync.setState({ pendingCount: pending.size, error: null });
    }
  }).catch(error => {
    useBoardReferenceSync.setState({ pendingCount: pending.size, error: `The file operation completed, but Canvas references still need to be saved: ${error instanceof Error ? error.message : String(error)}` });
    throw error;
  }).finally(() => { running = null; });
  running = task;
  return task;
}

export async function getBoardReferenceBaseline(): Promise<string[]> {
  await flushReferenceRemaps();
  const result = await window.electronAPI?.boardsReferenceBaseline?.();
  if (!result) throw new Error('Canvas reference storage is unavailable.');
  if (result.success === false) throw new Error(result.error);
  return result.data;
}
