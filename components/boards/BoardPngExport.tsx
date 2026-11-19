import { useTranslation } from '../../i18n/useTranslation';
import type { BoardBounds } from '../../services/boards/layout';
import type { BoardDocument } from '../../services/boards/types';
import BoardPromptNode from './BoardPromptNode';
import BoardStackNode from './BoardStackNode';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConnectionMode, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useBoardStore } from '../../store/useBoardStore';
import { useBoardQueryStore } from '../../store/useBoardQueryStore';
import { boardToFlow } from '../../services/boards/reactFlowAdapter';
import { pngExportDocument, pngExportSize, pngExportLabelBounds, serializeExportScene } from '../../services/boards/pngExport';
import { BoardEditorContext, useBoardEditor } from './BoardEditorContext';
import BoardAssetNode from './BoardAssetNode';
import BoardTextNode from './BoardTextNode';
import BoardFrameNode from './BoardFrameNode';
import BoardSmartFrameNode from './BoardSmartFrameNode';
import BoardCreativeNode from './BoardCreativeNode';
import BoardConnection from './BoardConnection';
import BoardQueryConnection from './BoardQueryConnection';
import { boardBackground } from '../../services/boards/background';

const nodeTypes = { prompt: BoardPromptNode, stack: BoardStackNode, asset: BoardAssetNode, text: BoardTextNode, frame: BoardFrameNode, 'smart-frame': BoardSmartFrameNode, sticky: BoardCreativeNode, shape: BoardCreativeNode, link: BoardCreativeNode };
const edgeTypes = { manual: BoardConnection, query: BoardQueryConnection };

export default function BoardPngExport({ boardId, selection, close }: { boardId: string; selection: boolean; close(): void }) {
  const { t } = useTranslation();
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
  const [labels, setLabels] = useState<{ snapshot: BoardDocument; bounds: BoardBounds[] } | null>(null);
  const labelBounds = labels?.snapshot === snapshot ? labels.bounds : [];
  const dimensions = pngExportSize(snapshot, scale, labelBounds);
  const { x: viewportX, y: viewportY } = dimensions.bounds;
  const currentDimensions = useRef(dimensions);
  currentDimensions.current = dimensions;
  useLayoutEffect(() => {
    const root = scene.current;
    if (!root) return;
    let frame = 0;
    const observed = new WeakSet<Element>();
    const resize = new ResizeObserver(() => schedule());
    const measure = () => {
      const bounds = pngExportLabelBounds(root);
      root.querySelectorAll('.board-edge-label').forEach(label => { if (!observed.has(label)) { observed.add(label); resize.observe(label); } });
      setLabels(previous => previous?.snapshot === snapshot && JSON.stringify(previous.bounds) === JSON.stringify(bounds) ? previous : { snapshot, bounds });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const mutation = new MutationObserver(schedule);
    mutation.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    resize.observe(root); schedule();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); };
  }, [snapshot]);
  const flow = useMemo(() => boardToFlow(snapshot, [], [], false), [snapshot]);
  const pending = snapshot.objects.some(object => object.type === 'smart-frame' && (!results?.[object.id] || ['loading', 'updating'].includes(results[object.id].status)));
  const exportPng = async () => {
    if (!scene.current || !dimensions.valid || pending) return;
    setBusy(true); setError(null);
    try {
      if (!window.electronAPI?.boardsExportPng) throw new Error(t('canvas.pngDesktop'));
      // React Flow must measure every node before computing connectors and rendering the snapshot.
      const started = Date.now();
      while (true) {
        const before = currentDimensions.current;
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (Date.now() - started > 10000) throw new Error(t('canvas.preparing'));
        const after = currentDimensions.current;
        if (before.width !== after.width || before.height !== after.height || before.bounds.x !== after.bounds.x || before.bounds.y !== after.bounds.y) continue;
        const nodes = scene.current.querySelectorAll<HTMLElement>('.react-flow__node');
        const paths = scene.current.querySelectorAll('.react-flow__edge-path');
        if (scene.current.querySelector('[data-export-error="true"]')) throw new Error(t('canvas.thumbnailFailed'));
        if (nodes.length === flow.nodes.length && [...nodes].every(node => getComputedStyle(node).visibility !== 'hidden') && paths.length >= flow.edges.length && !scene.current.querySelector('[data-export-pending="true"]')) break;
      }
      const finalDimensions = currentDimensions.current;
      if (!finalDimensions.valid) throw new Error('The board and labels exceed the PNG size limit. Choose a lower resolution.');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const html = await Promise.race([serializeExportScene(scene.current), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Preparing export images and fonts timed out.')), 15000); })]).finally(() => clearTimeout(timer));
      const result = await window.electronAPI.boardsExportPng({ html, width: finalDimensions.width, height: finalDimensions.height, scale, name: snapshot.name });
      if (result.success === false) throw new Error(result.error);
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const bg = boardBackground(snapshot.backgroundColor, transparent);
  return <>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('canvas.exportPng')} className="board-export-backdrop" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) close(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}><div className="board-export-dialog">
      <h2>{t('canvas.exportPng')}</h2><label>{t('imageViewer.editor.content')}<select className="board-input" disabled={busy} value={scope} onChange={event => setScope(event.target.value)}><option value="board">{t('canvas.entire')}</option><option value="selection" disabled={!session.selectedObjectIds.length}>{t('imageViewer.actions.selection')}</option></select></label>
      <label>{t('canvas.resolution')}<select className="board-input" disabled={busy} value={scale} onChange={event => setScale(Number(event.target.value))}>{[1, 2, 4].map(value => <option key={value} value={value} disabled={!pngExportSize(snapshot, value, labelBounds).valid}>{value}×</option>)}</select></label>
      <label><input type="checkbox" disabled={busy} checked={transparent} onChange={event => setTransparent(event.target.checked)} /> {t('canvas.transparent')}</label>
      <p>{t('canvas.pixels', { width: dimensions.width, height: dimensions.height })}</p>
      {!dimensions.valid && <p role="alert">{t('canvas.sizeLimit')}</p>}
      {pending && <p role="status">{t('canvas.waitingFrames')}</p>}{error && <p role="alert">{error}</p>}
      <div><button className="board-button" disabled={busy} onClick={close}>{t('libraryFolders.cancel')}</button><button className="board-button" disabled={busy || pending || !dimensions.valid} onClick={() => void exportPng()}>{busy ? t('canvas.exporting') : t('canvas.savePng')}</button></div>
    </div></div>
    {createPortal(<div className="board-export-host" aria-hidden="true"><div ref={scene} className="board-export-scene" style={{ width: dimensions.width / scale, height: dimensions.height / scale, background: bg }}>
      <BoardEditorContext.Provider value={{ ...editor, exporting: true, editable: false, editingObjectId: null }}><ReactFlowProvider><ReactFlow key={scope} nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} viewport={{ x: 32 - viewportX, y: 32 - viewportY, zoom: 1 }} minZoom={1} maxZoom={1} onlyRenderVisibleElements={false} connectionMode={ConnectionMode.Loose} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag={false} zoomOnScroll={false} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }} /></ReactFlowProvider></BoardEditorContext.Provider>
    </div></div>, document.body)}
  </>;
}
