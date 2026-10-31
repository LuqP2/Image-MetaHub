import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConnectionMode, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useBoardStore } from '../../store/useBoardStore';
import { useBoardQueryStore } from '../../store/useBoardQueryStore';
import { boardToFlow } from '../../services/boards/reactFlowAdapter';
import { pngExportDocument, pngExportSize, serializeExportScene } from '../../services/boards/pngExport';
import { BoardEditorContext, useBoardEditor } from './BoardEditorContext';
import BoardAssetNode from './BoardAssetNode';
import BoardTextNode from './BoardTextNode';
import BoardFrameNode from './BoardFrameNode';
import BoardSmartFrameNode from './BoardSmartFrameNode';
import BoardCreativeNode from './BoardCreativeNode';
import BoardConnection from './BoardConnection';
import BoardQueryConnection from './BoardQueryConnection';

const nodeTypes = { asset: BoardAssetNode, text: BoardTextNode, frame: BoardFrameNode, 'smart-frame': BoardSmartFrameNode, sticky: BoardCreativeNode, shape: BoardCreativeNode, link: BoardCreativeNode };
const edgeTypes = { manual: BoardConnection, query: BoardQueryConnection };

export default function BoardPngExport({ boardId, selection, close }: { boardId: string; selection: boolean; close(): void }) {
  const editor = useBoardEditor();
  const session = useBoardStore(state => state.sessions[boardId]);
  const results = useBoardQueryStore(state => state.results[boardId]);
  const [scope, setScope] = useState(selection ? 'selection' : 'board');
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scene = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLSelectElement>('select')?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const snapshot = useMemo(() => pngExportDocument(session.document, scope === 'selection' ? session.selectedObjectIds : undefined), [session.document, session.selectedObjectIds, scope]);
  const dimensions = pngExportSize(snapshot, scale);
  const flow = useMemo(() => boardToFlow(snapshot, [], [], false), [snapshot]);
  const pending = snapshot.objects.some(object => object.type === 'smart-frame' && (!results?.[object.id] || ['loading', 'updating'].includes(results[object.id].status)));
  const exportPng = async () => {
    if (!scene.current || !dimensions.valid || pending) return;
    setBusy(true); setError(null);
    try {
      if (!window.electronAPI?.boardsExportPng) throw new Error('PNG export requires the updated desktop application.');
      // React Flow must measure every node before computing connectors and rendering the snapshot.
      const started = Date.now();
      while (true) {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const nodes = scene.current.querySelectorAll<HTMLElement>('.react-flow__node');
        const paths = scene.current.querySelectorAll('.react-flow__edge-path');
        if (scene.current.querySelector('[data-export-error="true"]')) throw new Error('A local thumbnail could not be loaded. Retry after the image becomes available.');
        if (nodes.length === snapshot.objects.length && [...nodes].every(node => getComputedStyle(node).visibility !== 'hidden') && paths.length >= flow.edges.length && !scene.current.querySelector('[data-export-pending="true"]')) break;
        if (Date.now() - started > 10000) throw new Error('The board is still preparing. Try exporting again.');
      }
      const html = await serializeExportScene(scene.current);
      const result = await window.electronAPI.boardsExportPng({ html, width: dimensions.width, height: dimensions.height, scale, name: snapshot.name });
      if (result.success === false) throw new Error(result.error);
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const bg = transparent ? 'transparent' : getComputedStyle(document.documentElement).getPropertyValue('--gray-950').trim() ? 'rgb(var(--gray-950))' : 'rgb(var(--gray-900))';
  return <>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Export PNG" className="board-export-backdrop" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) close(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}><div className="board-export-dialog">
      <h2>Export PNG</h2><label>Content<select className="board-input" disabled={busy} value={scope} onChange={event => setScope(event.target.value)}><option value="board">Entire board</option><option value="selection" disabled={!session.selectedObjectIds.length}>Selection</option></select></label>
      <label>Resolution<select className="board-input" disabled={busy} value={scale} onChange={event => setScale(Number(event.target.value))}>{[1, 2, 4].map(value => <option key={value} value={value} disabled={!pngExportSize(snapshot, value).valid}>{value}×</option>)}</select></label>
      <label><input type="checkbox" disabled={busy} checked={transparent} onChange={event => setTransparent(event.target.checked)} /> Transparent background</label>
      <p>{dimensions.width.toLocaleString()} × {dimensions.height.toLocaleString()} pixels</p>
      {!dimensions.valid && <p role="alert">Choose content and a lower resolution. Maximum: 64 megapixels and 16,384 pixels per side.</p>}
      {pending && <p role="status">Waiting for Smart Frames…</p>}{error && <p role="alert">{error}</p>}
      <div><button className="board-button" disabled={busy} onClick={close}>Cancel</button><button className="board-button" disabled={busy || pending || !dimensions.valid} onClick={() => void exportPng()}>{busy ? 'Exporting…' : 'Save PNG'}</button></div>
    </div></div>
    {createPortal(<div className="board-export-host" aria-hidden="true"><div ref={scene} className="board-export-scene" style={{ width: dimensions.width / scale, height: dimensions.height / scale, background: bg }}>
      <BoardEditorContext.Provider value={{ ...editor, editable: false, editingObjectId: null }}><ReactFlowProvider><ReactFlow key={`${scope}:${dimensions.bounds.x}:${dimensions.bounds.y}`} nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} defaultViewport={{ x: 32 - dimensions.bounds.x, y: 32 - dimensions.bounds.y, zoom: 1 }} minZoom={1} maxZoom={1} onlyRenderVisibleElements={false} connectionMode={ConnectionMode.Loose} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag={false} zoomOnScroll={false} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }} /></ReactFlowProvider></BoardEditorContext.Provider>
    </div></div>, document.body)}
  </>;
}
