import BoardExportDialog from './boards/BoardExportDialog';
import BoardPanelResizeHandle from './boards/BoardPanelResizeHandle';
import BoardPngExport from './boards/BoardPngExport';
import BoardTabs from './boards/BoardTabs';
import type { BoardTool } from '../services/boards/types';
import { useBoardUIStore } from '../store/useBoardUIStore';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getViewportForBounds, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './boards/board.css';
import './boards/board-ui.css';
import { useBoardStore } from '../store/useBoardStore';
import { useBoardHotkeys } from '../hooks/useBoardHotkeys';
import { exportBoardFile, importBoardFile } from '../services/boards/boardService';
import { getBoardBounds } from '../services/boards/layout';
import { updateObjects } from '../services/boards/operations';
import type { BoardAssetObject } from '../services/boards/types';
import BoardList from './boards/BoardList';
import BoardToolbar, { BoardDocumentBar } from './boards/BoardToolbar';
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
  useEffect(() => { void useBoardStore.getState().restoreTabs(); }, []);
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
  const [tool, setTool] = useState<BoardTool>('select');
  const [pngScope, setPngScope] = useState<boolean | null>(null);
  const [exportMenu, setExportMenu] = useState(false);
  const [editingObjectId, editObject] = useState<string | null>(null);
  const connecting = tool === 'connect';
  const stage = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const root = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(1280);
  const ui = useBoardUIStore();
  const selectionKey = JSON.stringify([session?.selectedObjectIds ?? [], session?.selectedConnectionIds ?? []]);
  const hasSelection = !!(session?.selectedObjectIds.length || session?.selectedConnectionIds.length);
  const [dismissedInspectorSelection, dismissInspectorSelection] = useState<string | null>(null);
  const inspectorOpen = ui.inspectorOpen || (hasSelection && dismissedInspectorSelection !== selectionKey);
  const [preferredPanel, setPreferredPanel] = useState<'library' | 'inspector'>('inspector');
  const inspectSelection = useCallback(() => { dismissInspectorSelection(null); setPreferredPanel('inspector'); }, []);
  const hideInspector = () => { ui.setInspectorOpen(false); dismissInspectorSelection(selectionKey); };
  useEffect(() => {
    if (ui.inspectorOpen || !hasSelection) return;
    const dismiss = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest('.board-inspector-panel, .react-flow__node, .react-flow__edge, [aria-label="Toggle inspector"]')) return;
      dismissInspectorSelection(selectionKey);
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('click', dismiss, true);
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('click', dismiss, true); };
  }, [ui.inspectorOpen, hasSelection, selectionKey]);
  const libraryRequested = libraryLocked || (ui.libraryOpen ?? width >= 1100);
  const crowded = width < ui.libraryWidth + ui.inspectorWidth + 480;
  const showLibrary = Boolean(libraryRequested && (!crowded || libraryLocked || !inspectorOpen || preferredPanel === 'library'));
  const showInspector = inspectorOpen && (!crowded || (!libraryLocked && (!libraryRequested || preferredPanel === 'inspector')));
  useEffect(() => { if (ui.libraryOpen) setPreferredPanel('library'); }, [ui.libraryOpen]);
  useEffect(() => { if (hasSelection) setPreferredPanel('inspector'); }, [hasSelection, selectionKey]);
  const panelBudget = Math.max(220, width - 480);
  const libraryWidth = Math.min(ui.libraryWidth, panelBudget);
  const inspectorWidth = Math.min(ui.inspectorWidth, Math.max(260, panelBudget));
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
  const actions = useMemo<BoardEditorActions>(() => ({ editable, connecting, tool, setTool, editingObjectId, editObject, inspectSelection, reportError: setError, exportPng: setPngScope, resolveAsset, openAsset: onOpenAsset, dropAssets: onDropAssets,
    begin: () => { if (boardId && editable) useBoardStore.getState().beginInteraction(boardId); },
    change: update => { if (boardId && editable) useBoardStore.getState().updateInteraction(boardId, document => updateObjects(document, [update])); },
    commit: () => { if (boardId) useBoardStore.getState().commitInteraction(boardId); },
    cancel: () => { if (boardId) useBoardStore.getState().cancelInteraction(boardId); },
  }), [boardId, editable, connecting, tool, editingObjectId, inspectSelection, resolveAsset, onOpenAsset, onDropAssets]);
  const openSelection = useCallback(() => {
    if (!boardId) return;
    const current = useBoardStore.getState().sessions[boardId];
    const selected = current.document.objects.filter(object => current.selectedObjectIds.includes(object.id));
    if (selected.length === 1 && selected[0].type === 'asset') onOpenAsset?.(selected[0]);
  }, [boardId, onOpenAsset]);
  const onKeyDownCapture = useBoardHotkeys(boardId, editable, openSelection, setError);
  const exportCurrent = () => run(async () => {
    if (!boardId) return;
    // Export remains available when saving fails, including the current local content.
    await useBoardStore.getState().flushBoard(boardId).catch(() => {});
    await exportBoardFile(useBoardStore.getState().sessions[boardId].document);
  });
  return <section ref={root} data-compact={width < 1500} data-tool-labels={width >= 1100} data-editable={editable} className="board-workspace" data-board-editor="true" data-ui-hidden={ui.uiHidden} tabIndex={0} aria-label="Canvas workspace" onKeyDownCapture={event => { if (event.key === 'Escape') setTool('select'); onKeyDownCapture(event); }} aria-busy={busy}>
    {(!session || !boardId) && <BoardTabs onError={setError} editable={editable} />}
    {error && <div role="alert" className="board-error">{error}<button className="board-button" onClick={() => setError(null)}>Dismiss</button></div>}
    {session?.saveStatus === 'error' && <div role="alert" className="board-error">{session.saveError}
      <button className="board-button" onClick={() => run(() => useBoardStore.getState().flushBoard(boardId!))}>Retry</button><button className="board-button" onClick={exportCurrent}>Export</button>
      {session.saveErrorCode === 'BOARD_REVISION_CONFLICT' && <>
        <button className="board-button" onClick={() => run(() => useBoardStore.getState().reloadBoard(boardId!))}>Reload saved version</button>
        <button className="board-button" onClick={() => run(() => useBoardStore.getState().saveAsNewBoard(boardId!))}>Save as new board</button>
      </>}
    </div>}
    {!session || !boardId ? <BoardList resolveAsset={resolveAsset} summaries={summaries} editable={editable}
      onOpen={id => run(() => useBoardStore.getState().openBoard(id))} onCreate={name => run(() => useBoardStore.getState().createBoard(name))}
      onDuplicate={id => run(() => useBoardStore.getState().duplicateBoard(id))} onDelete={id => run(() => useBoardStore.getState().deleteBoard(id))}
      onRename={(id, name) => run(async () => { await useBoardStore.getState().openBoard(id); useBoardStore.getState().renameBoard(id, name); useBoardStore.getState().showBoardList(); })}
      onImport={() => run(async () => { const document = await importBoardFile(); if (document) useBoardStore.getState().adoptBoard(document); })} />
      : <BoardEditorContext.Provider value={actions}>
        {exportMenu && <BoardExportDialog close={() => setExportMenu(false)} exportDocument={() => { setExportMenu(false); exportCurrent(); }} exportPng={() => { setExportMenu(false); useBoardStore.getState().commitInteraction(boardId); setPngScope(false); }} />}
        {pngScope !== null && <BoardPngExport boardId={boardId} selection={pngScope} close={() => setPngScope(null)} />}
        <BoardDocumentBar boardId={boardId}
          libraryOpen={showLibrary} inspectorOpen={showInspector} libraryLocked={libraryLocked} onToggleLibrary={() => { setPreferredPanel('library'); ui.setLibraryOpen(!showLibrary); }} onToggleInspector={() => { if (showInspector) hideInspector(); else { setPreferredPanel('inspector'); dismissInspectorSelection(null); ui.setInspectorOpen(true); } }}
          tabs={<BoardTabs onError={setError} editable={editable} />} onExport={() => setExportMenu(!exportMenu)} />
        <div className="board-editor-layout">{showLibrary && assetPanel && <div className="board-library-panel" style={{ width: libraryWidth }}><div className="board-panel-content">{assetPanel}</div><BoardPanelResizeHandle side="library" /></div>}<div className="board-stage-container" ref={stage}><BoardCanvas boardId={boardId} onFitAll={fitAll} /><BoardToolbar boardId={boardId} editable={editable} tool={tool} setTool={setTool} /></div>{showInspector && <div className="board-inspector-panel" style={{ width: inspectorWidth }}><BoardPanelResizeHandle side="inspector" /><BoardInspector boardId={boardId} editable={editable} onHide={hideInspector} assetActions={assetActions} assetMetadata={assetMetadata} assetStatus={assetStatus} selectionActions={selectionActions} /></div>}</div>
      </BoardEditorContext.Provider>}
  </section>;
}
