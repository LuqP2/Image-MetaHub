import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './boards/board.css';
import { useBoardStore } from '../store/useBoardStore';
import { useBoardHotkeys } from '../hooks/useBoardHotkeys';
import { exportBoardFile, importBoardFile } from '../services/boards/boardService';
import { updateObjects } from '../services/boards/operations';
import type { BoardAssetObject } from '../services/boards/types';
import BoardList from './boards/BoardList';
import BoardToolbar from './boards/BoardToolbar';
import BoardCanvas from './boards/BoardCanvas';
import BoardInspector from './boards/BoardInspector';
import { BoardEditorContext, type BoardEditorActions } from './boards/BoardEditorContext';

export interface BoardWorkspaceProps {
  editable: boolean;
  resolveAsset?: BoardEditorActions['resolveAsset'];
  onOpenAsset?: (object: BoardAssetObject) => void;
  assetPanel?: ReactNode;
  assetInspector?: ReactNode;
}
export default function BoardWorkspace(props: BoardWorkspaceProps) {
  const boardId = useBoardStore(state => state.activeBoardId);
  return <ReactFlowProvider key={boardId ?? 'list'}><BoardWorkspaceContent {...props} /></ReactFlowProvider>;
}

function BoardWorkspaceContent({ editable: hasEditAccess, resolveAsset, onOpenAsset, assetPanel, assetInspector }: BoardWorkspaceProps) {
  const closing = useBoardStore(state => state.closing);
  const boardId = useBoardStore(state => state.activeBoardId);
  const summaries = useBoardStore(state => state.summaries);
  const session = useBoardStore(state => boardId ? state.sessions[boardId] : undefined);
  const editable = hasEditAccess && !closing && !session?.recovering;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const run = useCallback((action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    void action().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false));
  }, []);
  useEffect(() => { run(() => useBoardStore.getState().loadBoardList()); }, [run]);
  const actions = useMemo<BoardEditorActions>(() => ({ editable, connecting, resolveAsset, openAsset: onOpenAsset,
    begin: () => { if (boardId && editable) useBoardStore.getState().beginInteraction(boardId); },
    change: update => { if (boardId && editable) useBoardStore.getState().updateInteraction(boardId, document => updateObjects(document, [update])); },
    commit: () => { if (boardId) useBoardStore.getState().commitInteraction(boardId); },
    cancel: () => { if (boardId) useBoardStore.getState().cancelInteraction(boardId); },
  }), [boardId, editable, connecting, resolveAsset, onOpenAsset]);
  const openSelection = useCallback(() => {
    if (!boardId) return;
    const current = useBoardStore.getState().sessions[boardId];
    const selected = current.document.objects.filter(object => current.selectedObjectIds.includes(object.id));
    if (selected.length === 1 && selected[0].type === 'asset') onOpenAsset?.(selected[0]);
  }, [boardId, onOpenAsset]);
  const onKeyDownCapture = useBoardHotkeys(boardId, editable, openSelection);
  const exportCurrent = () => run(async () => {
    if (!boardId) return;
    // Export remains available when saving fails, including the current local content.
    await useBoardStore.getState().flushBoard(boardId).catch(() => {});
    await exportBoardFile(useBoardStore.getState().sessions[boardId].document);
  });
  return <section className="board-workspace" data-board-editor="true" tabIndex={0} aria-label="Canvas workspace" onKeyDownCapture={onKeyDownCapture} aria-busy={busy}>
    {error && <div role="alert" className="board-error">{error}<button onClick={() => setError(null)}>Dismiss</button></div>}
    {session?.saveStatus === 'error' && <div role="alert" className="board-error">{session.saveError}
      <button onClick={() => run(() => useBoardStore.getState().flushBoard(boardId!))}>Retry</button><button onClick={exportCurrent}>Export</button>
      {session.saveErrorCode === 'BOARD_REVISION_CONFLICT' && <>
        <button onClick={() => run(() => useBoardStore.getState().reloadBoard(boardId!))}>Reload saved version</button>
        <button onClick={() => run(() => useBoardStore.getState().saveAsNewBoard(boardId!))}>Save as new board</button>
      </>}
    </div>}
    {!session || !boardId ? <BoardList summaries={summaries} editable={editable}
      onOpen={id => run(() => useBoardStore.getState().openBoard(id))} onCreate={name => run(() => useBoardStore.getState().createBoard(name))}
      onDuplicate={id => run(() => useBoardStore.getState().duplicateBoard(id))} onDelete={id => run(() => useBoardStore.getState().deleteBoard(id))}
      onRename={(id, name) => run(async () => { await useBoardStore.getState().openBoard(id); useBoardStore.getState().renameBoard(id, name); await useBoardStore.getState().closeBoard(); })}
      onImport={() => run(async () => { const document = await importBoardFile(); if (document) useBoardStore.getState().adoptBoard(document); })} />
      : <BoardEditorContext.Provider value={actions}>
        <BoardToolbar boardId={boardId} editable={editable} connecting={connecting} setConnecting={setConnecting}
          center={() => { const bounds = stage.current?.getBoundingClientRect(); return flow.screenToFlowPosition({ x: bounds ? bounds.x + bounds.width / 2 : 0, y: bounds ? bounds.y + bounds.height / 2 : 0 }); }}
          onBack={() => run(() => useBoardStore.getState().closeBoard())} onExport={exportCurrent} />
        <div className="board-editor-layout">{assetPanel}<div className="board-stage-container" ref={stage}><BoardCanvas boardId={boardId} /></div><BoardInspector boardId={boardId} editable={editable} assetContent={assetInspector} /></div>
      </BoardEditorContext.Provider>}
  </section>;
}
