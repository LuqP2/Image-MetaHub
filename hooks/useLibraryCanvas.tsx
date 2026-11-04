import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore';
import { useImageStore } from '../store/useImageStore';
import { useSemanticStore } from '../store/useSemanticStore';
import { captureLibraryForCanvas, insertLibrarySmartFrame, type LibraryCanvasCapture } from '../services/boards/libraryCapture';
import LibraryCanvasDestination from '../components/boards/LibraryCanvasDestination';

export function useLibraryCanvas({ view, navigate, blocked, canEdit, upgrade }: {
  view: string; navigate(view: 'library' | 'canvas'): void; blocked: boolean; canEdit: boolean; upgrade(): void;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [capture, setCapture] = useState<LibraryCanvasCapture | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshot = useImageStore(state => Boolean(state.semanticResult || state.activeImageScope || state.selectedNodes.length));
  const queryPending = useImageStore(state => state.isLibraryQueryPending);
  const visualQueryPending = useSemanticStore(state => state.queryRunning);
  blocked = blocked || queryPending || visualQueryPending;
  const targetName = useBoardStore(state => target ? state.sessions[target]?.document.name ?? state.summaries.find(item => item.id === target)?.name : undefined);
  const lock = useRef(false);
  const receipt = useRef<{ boardId: string; frameId: string } | null>(null);
  const access = useRef(canEdit); access.current = canEdit;
  useEffect(() => { if (view === 'canvas') { setTarget(null); setCapture(null); setChoosing(false); setError(null); receipt.current = null; } }, [view]);
  const cancel = () => { if (lock.current) return; setTarget(null); setCapture(null); setChoosing(false); setError(null); receipt.current = null; };
  const explore = (boardId: string) => {
    if (!canEdit) { upgrade(); return; }
    setTarget(boardId); setCapture(null); setError(null); receipt.current = null; navigate('library');
  };
  const add = async (destination?: string, name?: string) => {
    if (lock.current || blocked) return;
    if (!access.current) { upgrade(); return; }
    lock.current = true; setBusy(true); setError(null);
    try {
      const frozen = capture ?? await captureLibraryForCanvas();
      setCapture(frozen);
      let boardId = receipt.current?.boardId ?? destination ?? (name === undefined ? target : null);
      if (!boardId && name === undefined) { setChoosing(true); return; }
      if (!boardId) boardId = await useBoardStore.getState().createBoard(name?.trim() || 'Untitled board');
      await useBoardStore.getState().openBoard(boardId);
      if (!access.current) throw new Error('Canvas editing is no longer available.');
      const frameId = receipt.current?.frameId ?? crypto.randomUUID();
      insertLibrarySmartFrame(boardId, frozen, frameId);
      receipt.current = { boardId, frameId };
      await useBoardStore.getState().flushBoard(boardId);
      setTarget(null); setCapture(null); setChoosing(false); receipt.current = null;
      navigate('canvas');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      // A completed insertion is retried as a save; unavailable destinations can be replaced.
      setChoosing(true);
    } finally { lock.current = false; setBusy(false); }
  };
  const action = <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 text-xs">
    <button className="inline-flex min-w-0 max-w-full items-center gap-1 rounded border border-gray-600 px-2 py-1 text-gray-300 hover:bg-gray-700 disabled:opacity-50" disabled={blocked || busy}
      title={blocked ? 'Wait for Library results to finish updating' : snapshot ? 'Snapshot · saves the current scoped results as a fixed file set' : 'Dynamic · creates a Smart Frame that updates with matching images'} onClick={() => { void add(); }}>
      <Plus className="shrink-0" size={14}/><span className="max-w-[16rem] truncate">{busy ? 'Adding…' : target ? `Add to “${targetName ?? 'board'}”` : 'Add to Canvas'}</span>
    </button>
    {snapshot && <span className="text-gray-400">Snapshot · fixed results</span>}
    {target && <button className="text-gray-400 hover:text-gray-200" disabled={busy} onClick={cancel}>Cancel</button>}
    {blocked && <span role="status" className="text-gray-400">Updating Library…</span>}
  </div>;
  const dialog = choosing ? <LibraryCanvasDestination capture={capture} error={error} busy={busy} blocked={blocked}
    retrySave={Boolean(receipt.current)} close={cancel} add={(id, name) => { void add(id, name); }} /> : null;
  return { action, dialog, explore };
}
