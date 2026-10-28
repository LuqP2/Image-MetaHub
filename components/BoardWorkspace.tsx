import { useBoardUIStore } from '../store/useBoardUIStore';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getViewportForBounds, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './boards/board.css';
import { useBoardStore } from '../store/useBoardStore';
import { useBoardHotkeys } from '../hooks/useBoardHotkeys';
import { exportBoardFile, importBoardFile } from '../services/boards/boardService';
import { getBoardBounds } from '../services/boards/layout';
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
  assetActions?: ReactNode; assetMetadata?: ReactNode; assetStatus?: ReactNode; selectionActions?: ReactNode; libraryLocked?: boolean;
  onDropAssets?: BoardEditorActions['dropAssets'];

}
export default function BoardWorkspace(props: BoardWorkspaceProps) {
  const boardId = useBoardStore(state => state.activeBoardId);
  return <ReactFlowProvider key={boardId ?? 'list'}><BoardWorkspaceContent {...props} /></ReactFlowProvider>;
}

function BoardWorkspaceContent({ editable: hasEditAccess, resolveAsset, onOpenAsset, assetPanel, assetActions, assetMetadata, assetStatus, selectionActions, libraryLocked, onDropAssets }: BoardWorkspaceProps) {
  const closing = useBoardStore(state => state.closing);
  const boardId = useBoardStore(state => state.activeBoardId);
  const summaries = useBoardStore(state => state.summaries);
  const session = useBoardStore(state => boardId ? state.sessions[boardId] : undefined);
  const editable = hasEditAccess && !closing && !session?.recovering;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<'select' | 'text' | 'frame' | 'connect'>('select');
  const connecting = tool === 'connect';
  const stage = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const root = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(1280);
  const ui = useBoardUIStore();
  const libraryOpen = libraryLocked || (ui.libraryOpen ?? width >= 1100);
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => { if(entries[0]) setWidth(entries[0].contentRect.width); });
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const fitAll = () => {
    const bounds = stage.current?.getBoundingClientRect();
    if (!boardId) return;
    const objects = useBoardStore.getState().sessions[boardId].document.objects;
    if (bounds && bounds.width > 0 && bounds.height > 0 && objects.length) void flow.setViewport(getViewportForBounds(getBoardBounds(objects), bounds.width, bounds.height, 0.1, 1, 0.12));
  };
  const run = useCallback((action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    void action().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false));
  }, []);
  useEffect(() => { run(() => useBoardStore.getState().loadBoardList()); }, [run]);
  const actions = useMemo<BoardEditorActions>(() => ({ editable, connecting, tool, setTool, resolveAsset, openAsset: onOpenAsset, dropAssets: onDropAssets,
    begin: () => { if (boardId && editable) useBoardStore.getState().beginInteraction(boardId); },
    change: update => { if (boardId && editable) useBoardStore.getState().updateInteraction(boardId, document => updateObjects(document, [update])); },
    commit: () => { if (boardId) useBoardStore.getState().commitInteraction(boardId); },
    cancel: () => { if (boardId) useBoardStore.getState().cancelInteraction(boardId); },
  }), [boardId, editable, connecting, tool, resolveAsset, onOpenAsset, onDropAssets]);
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
  return <section ref={root} data-compact={width < 1280} data-editable={editable} className="board-workspace" data-board-editor="true" tabIndex={0} aria-label="Canvas workspace" onKeyDownCapture={event => { if (event.key === 'Escape') setTool('select'); onKeyDownCapture(event); }} aria-busy={busy}>
    {error && <div role="alert" className="board-error">{error}<button className="board-button" onClick={() => setError(null)}>Dismiss</button></div>}
    {session?.saveStatus === 'error' && <div role="alert" className="board-error">{session.saveError}
      <button className="board-button" onClick={() => run(() => useBoardStore.getState().flushBoard(boardId!))}>Retry</button><button className="board-button" onClick={exportCurrent}>Export</button>
      {session.saveErrorCode === 'BOARD_REVISION_CONFLICT' && <>
        <button className="board-button" onClick={() => run(() => useBoardStore.getState().reloadBoard(boardId!))}>Reload saved version</button>
        <button className="board-button" onClick={() => run(() => useBoardStore.getState().saveAsNewBoard(boardId!))}>Save as new board</button>
      </>}
    </div>}
    {!session || !boardId ? <BoardList summaries={summaries} editable={editable}
      onOpen={id => run(() => useBoardStore.getState().openBoard(id))} onCreate={name => run(() => useBoardStore.getState().createBoard(name))}
      onDuplicate={id => run(() => useBoardStore.getState().duplicateBoard(id))} onDelete={id => run(() => useBoardStore.getState().deleteBoard(id))}
      onRename={(id, name) => run(async () => { await useBoardStore.getState().openBoard(id); useBoardStore.getState().renameBoard(id, name); await useBoardStore.getState().closeBoard(); })}
      onImport={() => run(async () => { const document = await importBoardFile(); if (document) useBoardStore.getState().adoptBoard(document); })} />
      : <BoardEditorContext.Provider value={actions}>
        <BoardToolbar boardId={boardId} editable={editable} tool={tool} setTool={setTool}
          libraryOpen={Boolean(libraryOpen)} inspectorOpen={ui.inspectorOpen} libraryLocked={libraryLocked} onToggleLibrary={() => ui.setLibraryOpen(!libraryOpen)} onToggleInspector={() => ui.setInspectorOpen(!ui.inspectorOpen)}
          onBack={() => run(() => useBoardStore.getState().closeBoard())} onExport={exportCurrent} />
        <div className="board-editor-layout">{libraryOpen && assetPanel}<div className="board-stage-container" ref={stage}><BoardCanvas boardId={boardId} onFitAll={fitAll} /></div>{ui.inspectorOpen && <BoardInspector boardId={boardId} editable={editable} assetActions={assetActions} assetMetadata={assetMetadata} assetStatus={assetStatus} selectionActions={selectionActions} />}</div>
      </BoardEditorContext.Provider>}
  </section>;
}
