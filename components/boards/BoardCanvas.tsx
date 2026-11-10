import { useSettingsStore } from '../../store/useSettingsStore';
import BoardVisualGroupingDialog from './BoardVisualGroupingDialog';
import BoardStackNode from './BoardStackNode';
import { hasStackCardDrag, getStackCardDrag, clearStackCardDrag } from '../../services/boards/stackDrag';
import { extractStackMember } from '../../services/boards/stackOperations';
import { useBoardSnapping } from '../../hooks/useBoardSnapping';
import { useBoardConnections } from '../../hooks/useBoardConnections';
import { connectionPathIntersectsRect } from '../../services/boards/connectionSelection';
import { useBoardConnectionStyleStore } from '../../store/useBoardConnectionStyleStore';
import type { PointerEvent as ReactPointerEvent } from 'react';
import BoardCreativeNode from './BoardCreativeNode';
import BoardContextMenu, { type BoardMenuPosition } from './BoardContextMenu';
import { setBoardPointer } from '../../services/boards/commands';
import type { BoardTool } from '../../services/boards/types';
import { useBoardUIStore } from '../../store/useBoardUIStore';
import { useBoardQueryActions } from './BoardQueryContext';
import { boardVisibleArea, boardMotionDuration, revealBoardBounds } from '../../services/boards/viewport';
import { getBoardBounds } from '../../services/boards/layout';
import BoardQueryConnection from './BoardQueryConnection';
import BoardSmartFrameNode from './BoardSmartFrameNode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearInternalImageDragData, getInternalImageDragIds, hasInternalImageDragType } from '../../utils/internalImageDrag';
import { applyNodeChanges, Background, ConnectionMode, Panel, ReactFlow, SelectionMode, useReactFlow, useViewport, type NodeChange } from '@xyflow/react';
import { useBoardStore } from '../../store/useBoardStore';
import { applyBoardNodeRuntimeChanges, boardToFlow, flowGeometryUpdates, type BoardFlowNode, type BoardNodeRuntime } from '../../services/boards/reactFlowAdapter';
import { drawBoardObject, updateObjects } from '../../services/boards/operations';
import { findContainingFrame, type BoardPoint } from '../../services/boards/layout';
import BoardAssetNode from './BoardAssetNode';
import BoardSmartFrameFilterPopover from './BoardSmartFrameFilterPopover';
import BoardSelectionResizer from './BoardSelectionResizer';
import BoardTextNode from './BoardTextNode';
import BoardFrameNode from './BoardFrameNode';
import BoardConnection from './BoardConnection';
import BoardViewportControls from './BoardViewportControls';
import BoardCanvasHelp from './BoardCanvasHelp';
import { boardBackground, boardGridColor } from '../../services/boards/background';
import { useBoardEditor } from './BoardEditorContext';

const nodeTypes = { stack: BoardStackNode, sticky: BoardCreativeNode, shape: BoardCreativeNode, link: BoardCreativeNode, 'smart-frame': BoardSmartFrameNode, asset: BoardAssetNode, text: BoardTextNode, frame: BoardFrameNode };
const edgeTypes = { manual: BoardConnection, query: BoardQueryConnection };

export default function BoardCanvas({ boardId, onFitAll = () => {} }: { boardId: string; onFitAll?: () => void }) {
  const exists = useBoardStore(state => !!state.sessions[boardId]);
  return exists ? <BoardCanvasContent key={boardId} boardId={boardId} onFitAll={onFitAll} /> : null;
}

function BoardCanvasContent({ boardId, onFitAll }: { boardId: string; onFitAll: () => void }) {
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [nodeRuntime, setNodeRuntime] = useState<ReadonlyMap<string, BoardNodeRuntime>>(() => new Map());
  const session = useBoardStore(state => state.sessions[boardId]);
  const queryActions = useBoardQueryActions();
  const editor = useBoardEditor();
  const flow = useReactFlow<BoardFlowNode>();
  const { x: viewportX, y: viewportY, zoom } = useViewport();
  const snapping = useBoardSnapping(boardId);
  const showGrid = useSettingsStore(state => state.canvasShowGrid);
  const stageRef = useRef<HTMLDivElement>(null);
  const connections = useBoardConnections(boardId, stageRef);
  const connectionStyle = useBoardConnectionStyleStore(state => state.style);
  const marquee = useRef<{ start: BoardPoint; active: boolean; additive: boolean; edges: string[] } | null>(null);
  useEffect(() => {
    const request = session.revealRequest;
    if (!request) return;
    const task = requestAnimationFrame(() => {
      const current = useBoardStore.getState().sessions[boardId];
      if (current?.revealRequest !== request || !stageRef.current) return;
      const objects = current.document.objects.filter(object => request.ids.includes(object.id));
      useBoardStore.getState().consumeReveal(boardId, request.sequence);
      if (objects.length) void flow.setViewport(revealBoardBounds(flow.getViewport(), getBoardBounds(objects), boardVisibleArea(stageRef.current), request.shrink), { duration: boardMotionDuration() });
    });
    return () => cancelAnimationFrame(task);
  }, [boardId, session.revealRequest, flow]);
  const [drawing, setDrawing] = useState<{ start: BoardPoint; end: BoardPoint } | null>(null);
  const drawingStart = useRef<BoardPoint | null>(null);
  const drawingTool = editor.editable && editor.tool && !['select', 'connect'].includes(editor.tool) ? editor.tool as Exclude<BoardTool, 'select' | 'connect'> : null;
  const [grouping, setGrouping] = useState<{ ids?: string[] } | null>(null);
  const [menu, setMenu] = useState<BoardMenuPosition | null>(null);
  const closeMenu = useCallback(() => { setMenu(null); requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body || document.activeElement.closest('.board-context-menu')) stageRef.current?.closest<HTMLElement>('.board-workspace')?.focus({ preventScroll: true }); }); }, []);
  const createObject = useCallback((tool: BoardTool, point: BoardPoint, size?: { width: number; height: number }) => {
    if (!editor.editable || tool === 'select' || tool === 'connect') return;
    const state = useBoardStore.getState();
    const previous = new Set(state.sessions[boardId].document.objects.map(object => object.id));
    state.executeOperation(boardId, doc => drawBoardObject(doc, tool, { ...point, ...(size ?? (tool === 'sticky' ? { width: 240, height: 180 } : tool === 'frame' ? { width: 560, height: 360 } : { width: 240, height: 160 })) }));
    const ids = useBoardStore.getState().sessions[boardId].document.objects.filter(object => !previous.has(object.id)).map(object => object.id);
    state.setSelection(boardId, ids);
    editor.setTool?.('select');
    if (tool === 'text' || tool === 'sticky') {
      state.beginInteraction(boardId); editor.editObject?.(ids[0]);
    } else {
      editor.editObject?.(null);
      stageRef.current?.closest<HTMLElement>('.board-workspace')?.focus({ preventScroll: true });
    }
  }, [boardId, editor]);
  useEffect(() => { drawingStart.current = null; setDrawing(null); }, [drawingTool]);
  useEffect(() => {
    if (session.fitSelectionRequest <= session.handledFitSelectionRequest) return;
    const frame = requestAnimationFrame(() => {
      const state = useBoardStore.getState();
      const ids = state.sessions[boardId]?.selectedObjectIds ?? [];
      if (state.consumeFitSelection(boardId, session.fitSelectionRequest) && ids.length) {
        void flow.fitView({ nodes: ids.map(id => ({ id })), padding: 0.2, maxZoom: 1, duration: boardMotionDuration() });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [boardId, session.fitSelectionRequest, session.handledFitSelectionRequest, flow]);
  const { nodes, edges } = useMemo(() => boardToFlow(session.document, session.selectedObjectIds, session.selectedConnectionIds, editor.editable, nodeRuntime), [session.document, session.selectedObjectIds, session.selectedConnectionIds, editor.editable, nodeRuntime]);
  const onNodesChange = useCallback((changes: NodeChange<BoardFlowNode>[]) => {
    setNodeRuntime(runtime => applyBoardNodeRuntimeChanges(runtime, changes));
    const state = useBoardStore.getState();
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) {
      const ids = new Set(state.sessions[boardId].selectedObjectIds);
      selected.forEach(change => { if (change.type === 'select') { if (change.selected) ids.add(change.id); else ids.delete(change.id); } });
      state.setSelection(boardId, [...ids], state.sessions[boardId].selectedConnectionIds);
    }
    if (!editor.editable) return;
    const filtered = snapping.filterChanges(changes);
    const updatedNodes = applyNodeChanges(filtered, nodes);
    const updates = flowGeometryUpdates(updatedNodes, filtered);
    if (updates.length) state.updateInteraction(boardId, document => updateObjects(document, updates, useBoardStore.getState().sessions[boardId].interaction?.objects));
    if (changes.some(change => change.type === 'dimensions' && change.resizing === false)) state.commitInteraction(boardId);
  }, [boardId, nodes, editor.editable, snapping.filterChanges]);
  const finishDrag = useCallback(() => {
    if (snapping.finish()) return;
    const state = useBoardStore.getState();
    const current = state.sessions[boardId];
    const updates = current.document.objects.filter(object => current.selectedObjectIds.includes(object.id) && object.type !== 'frame' && object.type !== 'smart-frame')
      .map(object => ({ id: object.id, frameId: findContainingFrame(object, current.document.objects)?.id ?? null }));
    if (updates.length) state.updateInteraction(boardId, document => updateObjects(document, updates));
    state.commitInteraction(boardId);
  }, [boardId, snapping.finish]);
  const beginPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    connections.pointerDown(event);
    const target = event.target as HTMLElement;
    if (!event.defaultPrevented && event.button === 0 && !drawingTool && !editor.connecting && target.classList.contains('react-flow__pane')) {
      marquee.current = { start: { x: event.clientX, y: event.clientY }, active: false, additive: event.ctrlKey || event.metaKey || event.shiftKey, edges: [...useBoardStore.getState().sessions[boardId].selectedConnectionIds] };
    }
    if (!event.defaultPrevented && !target.closest('input, textarea, button, a, [contenteditable="true"], [role="menu"]')) stageRef.current?.closest<HTMLElement>('.board-workspace')?.focus({ preventScroll: true });
  };
  return <div ref={stageRef} className="board-stage" style={{ background: boardBackground(session.document.backgroundColor) }} data-connecting={editor.connecting || !!connections.preview} onPointerDownCapture={beginPointer} onPointerUpCapture={connections.pointerUp} onClickCapture={connections.click}
    onPointerCancel={() => { marquee.current = null; connections.cancel(); }}
    onPointerMove={event => {
      setBoardPointer(boardId, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      connections.pointerMove(event);
    }} onDoubleClick={event => { event.stopPropagation(); if (editor.editable && (event.target as HTMLElement).classList.contains('react-flow__pane')) setMenu({ x: event.clientX, y: event.clientY, point: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), kind: 'create' }); }}
    onDragOver={event => { if (editor.editable && (hasStackCardDrag(event.dataTransfer) || hasInternalImageDragType(event.dataTransfer))) { event.preventDefault(); event.dataTransfer.dropEffect = hasStackCardDrag(event.dataTransfer) ? 'move' : 'copy'; } }}
    onDrop={event => {
      if (hasStackCardDrag(event.dataTransfer)) {
        event.preventDefault(); event.stopPropagation();
        const source = getStackCardDrag(event.dataTransfer);
        clearStackCardDrag(); clearInternalImageDragData();
        if (!editor.editable || !source) return;
        if (source.boardId !== boardId) { editor.reportError?.('Move stack cards within their original Canvas.'); return; }
        if ((event.target as HTMLElement).closest<HTMLElement>('.react-flow__node')?.dataset.id === source.stackId) return;
        const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        useBoardStore.getState().executeOperation(boardId, document => extractStackMember(document, source.stackId, source.objectId, point));
        useBoardStore.getState().setSelection(boardId, [source.objectId]);
        return;
      }
      if (!editor.editable || !hasInternalImageDragType(event.dataTransfer)) return;
      event.preventDefault();
      const ids = getInternalImageDragIds(event.dataTransfer);
      clearInternalImageDragData();
      if (ids.length) editor.dropAssets?.(ids, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    }}>
    <ReactFlow<BoardFlowNode> key={boardId} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} style={{ background: boardBackground(session.document.backgroundColor) }}
      onSelectionStart={() => { if (marquee.current) marquee.current.active = true; }}
      onSelectionEnd={event => {
        const gesture = marquee.current; marquee.current = null;
        if (!gesture?.active || !stageRef.current) return;
        const visible = stageRef.current.querySelector('.react-flow__selection')?.getBoundingClientRect();
        const rect = visible && visible.width && visible.height ? { x: visible.left, y: visible.top, width: visible.width, height: visible.height }
          : { x: Math.min(gesture.start.x, event.clientX), y: Math.min(gesture.start.y, event.clientY), width: Math.abs(event.clientX - gesture.start.x), height: Math.abs(event.clientY - gesture.start.y) };
        const state = useBoardStore.getState(), current = state.sessions[boardId];
        const manual = new Set(current.document.connections.map(edge => edge.id));
        const ids = new Set(gesture.additive ? gesture.edges : []);
        stageRef.current.querySelectorAll<SVGPathElement>('.react-flow__edge-path').forEach(path => {
          const id = path.closest('.react-flow__edge')?.getAttribute('data-id');
          if (id && manual.has(id) && connectionPathIntersectsRect(path, rect)) ids.add(id);
        });
        state.setSelection(boardId, current.selectedObjectIds, [...ids]);
        if (ids.size) editor.inspectSelection?.();
      }}
      onNodesChange={onNodesChange} onEdgesChange={changes => {
        const selected = new Set(useBoardStore.getState().sessions[boardId].selectedConnectionIds);
        changes.forEach(change => { if (change.type === 'select' && session.document.connections.some(connection => connection.id === change.id)) { if (change.selected) selected.add(change.id); else selected.delete(change.id); } });
        useBoardStore.getState().setSelection(boardId, useBoardStore.getState().sessions[boardId].selectedObjectIds, [...selected]);
      }}
      onNodeDragStart={(event, node, nodes) => { editor.begin(); snapping.begin(event, node, nodes); }} onNodeDragStop={finishDrag} onConnect={connections.connect}
      connectionMode={ConnectionMode.Loose} nodesDraggable={editor.editable && !drawingTool && !editor.connecting && !connections.preview} nodesConnectable={editor.editable && !drawingTool}
      connectionRadius={20 / zoom} connectOnClick={false}
      defaultViewport={session.document.viewport} minZoom={0.1} maxZoom={4} deleteKeyCode={null} selectionKeyCode={null}
      multiSelectionKeyCode={["Control", "Meta", "Shift"]} panActivationKeyCode="Space" panOnDrag={[1, 2]} selectionOnDrag={!drawingTool && !editor.connecting && !connections.preview} selectionMode={SelectionMode.Partial} panOnScroll
      zoomOnScroll={false} zoomOnPinch zoomActivationKeyCode={['Control', 'Meta']} zoomOnDoubleClick={false}
      onMoveEnd={() => useBoardStore.getState().setViewport(boardId, flow.getViewport())}
      onNodeClick={() => editor.inspectSelection?.()} onEdgeClick={() => editor.inspectSelection?.()}
      onNodeContextMenu={(event, node) => {
        if ((event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return;
        event.preventDefault(); event.stopPropagation();
        const state = useBoardStore.getState();
        if (!state.sessions[boardId].selectedObjectIds.includes(node.id)) state.setSelection(boardId, [node.id]);
        setMenu({ x: event.clientX, y: event.clientY, point: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), kind: 'selection' });
      }}
      onSelectionContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, point: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), kind: 'selection' }); }}
      onEdgeContextMenu={(event, edge) => { event.preventDefault(); event.stopPropagation(); if (edge.type !== 'manual') return; useBoardStore.getState().setSelection(boardId, [], [edge.id]); setMenu({ x: event.clientX, y: event.clientY, point: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), kind: 'edge' }); }}
      onPaneContextMenu={event => { event.preventDefault(); useBoardStore.getState().setSelection(boardId, []); setMenu({ x: event.clientX, y: event.clientY, point: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), kind: 'pane' }); }}
      onPaneClick={() => { closeMenu(); useBoardStore.getState().setSelection(boardId, []); }}
      onlyRenderVisibleElements elevateNodesOnSelect={false}>
      <Panel position="bottom-right" className="board-minimap-panel"><BoardViewportControls boardId={boardId} onFitAll={onFitAll} backgroundOpen={backgroundOpen} setBackgroundOpen={setBackgroundOpen} editable={editor.editable}/></Panel>
      <Panel position="bottom-left"><BoardCanvasHelp/></Panel>
      {showGrid && <Background bgColor={boardBackground(session.document.backgroundColor)} color={boardGridColor(session.document.backgroundColor)} gap={24} size={1} />}
    </ReactFlow>
    {!!snapping.guides.length && <svg aria-label="Smart Guides" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1001, overflow: 'hidden' }}>
      <g transform={`translate(${viewportX ?? 0}, ${viewportY ?? 0}) scale(${zoom})`}>
        {snapping.guides.map(guide => <line key={guide.axis} data-axis={guide.axis} data-reference={guide.referenceId}
          x1={guide.axis === 'x' ? guide.coordinate : guide.start} y1={guide.axis === 'y' ? guide.coordinate : guide.start}
          x2={guide.axis === 'x' ? guide.coordinate : guide.end} y2={guide.axis === 'y' ? guide.coordinate : guide.end}
          stroke="#e879f9" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
      </g>
    </svg>}
    {connections.preview && <>
      <svg className="board-connect-preview" aria-label="Connection preview"><g transform={`translate(${viewportX ?? 0}, ${viewportY ?? 0}) scale(${zoom})`}>
        <path d={connections.preview.path} style={{ stroke: connectionStyle.color, strokeWidth: connectionStyle.width, strokeDasharray: connectionStyle.lineStyle === 'dashed' ? `${connectionStyle.width * 4} ${connectionStyle.width * 3}` : 'none' }} vectorEffect="non-scaling-stroke" />
        {connections.preview.target && <rect className="board-connect-target" x={connections.preview.target.x - 3 / zoom} y={connections.preview.target.y - 3 / zoom} width={connections.preview.target.width + 6 / zoom} height={connections.preview.target.height + 6 / zoom} rx={8 / zoom} vectorEffect="non-scaling-stroke" />}
      </g></svg>
      <div className="board-connect-hint">Connect: drag or click a destination · Esc to cancel</div>
    </>}
    {grouping && <BoardVisualGroupingDialog boardId={boardId} ids={grouping.ids} close={() => setGrouping(null)} />}
    <BoardSelectionResizer boardId={boardId} />
    <BoardSmartFrameFilterPopover boardId={boardId} />
    {menu && <BoardContextMenu boardId={boardId} menu={menu} close={closeMenu} create={createObject} fit={onFitAll} changeBackground={() => { useBoardUIStore.getState().setUIHidden(false); setBackgroundOpen(true); }} autoGroup={ids => setGrouping({ ids })} />}
    {!session.document.objects.length && editor.editable && <div className="board-empty-start nodrag nopan">
      <h2>Start your board</h2><p>Arrange selected references, or explore a source with a Smart Frame.</p>
      <div><button className="board-button" onClick={() => { useBoardUIStore.getState().setLibraryOpen(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Search canvas library"]')?.focus()); }}>Add references</button><small>Select files in the side library, then drag them here or use Add to canvas.</small></div>
      <div><button className="board-button" onClick={() => queryActions?.create()}>Explore library</button><small>Choose and filter a source in Library, then add it to this board. Dynamic results update; Snapshots keep a fixed set.</small></div>
      <footer>Ctrl + wheel to zoom · Wheel to scroll · Shift + wheel to scroll horizontally · Right drag or Space + drag to pan</footer>
    </div>}
    {drawingTool && <div className="board-drawing-hint">Drag to draw {drawingTool === 'text' ? 'a text box' : `a ${drawingTool}`} · Esc to cancel</div>}
    {drawingTool && <div className="board-draw-overlay" aria-label={`Draw ${drawingTool}`}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = { x: event.clientX, y: event.clientY };
        drawingStart.current = start;
        const rect = event.currentTarget.getBoundingClientRect();
        const local = { x: start.x - rect.left, y: start.y - rect.top };
        setDrawing({ start: local, end: local });
      }}
      onPointerMove={event => {
        if (drawingStart.current) {
          const rect = event.currentTarget.getBoundingClientRect();
          setDrawing({ start: { x: drawingStart.current.x - rect.left, y: drawingStart.current.y - rect.top }, end: { x: event.clientX - rect.left, y: event.clientY - rect.top } });
        }
      }}
      onPointerCancel={() => { drawingStart.current = null; setDrawing(null); }}
      onPointerUp={event => {
        const start = drawingStart.current;
        drawingStart.current = null; setDrawing(null);
        if (!start) return;
        const a = flow.screenToFlowPosition(start);
        const b = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        if (Math.abs(event.clientX - start.x) < 4 && Math.abs(event.clientY - start.y) < 4) { createObject(drawingTool, a); return; }
        const bounds = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(1, Math.abs(b.x - a.x)), height: Math.max(1, Math.abs(b.y - a.y)) };
        createObject(drawingTool, bounds, bounds);
      }}>
      {drawing && <svg viewBox="0 0 100 100" preserveAspectRatio="none" data-shape={drawingTool} className="board-draw-preview" style={{ position: 'absolute', left: Math.min(drawing.start.x, drawing.end.x), top: Math.min(drawing.start.y, drawing.end.y), width: Math.abs(drawing.end.x - drawing.start.x), height: Math.abs(drawing.end.y - drawing.start.y) }} >{drawingTool === 'ellipse' ? <ellipse cx="50" cy="50" rx="49" ry="49" /> : drawingTool === 'diamond' ? <polygon points="50,1 99,50 50,99 1,50" /> : <rect x="1" y="1" width="98" height="98" />}</svg>}
    </div>}
  </div>;
}
