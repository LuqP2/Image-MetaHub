import { facingBoardSides } from '../../services/boards/connectionGeometry';
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
import { applyNodeChanges, Background, ConnectionMode, Panel, ReactFlow, SelectionMode, useReactFlow, useViewport, type Connection, type NodeChange } from '@xyflow/react';
import { useBoardStore } from '../../store/useBoardStore';
import { boardToFlow, flowGeometryUpdates, type BoardFlowNode } from '../../services/boards/reactFlowAdapter';
import { addConnection, drawBoardObject, updateObjects } from '../../services/boards/operations';
import { findContainingFrame, type BoardPoint } from '../../services/boards/layout';
import BoardAssetNode from './BoardAssetNode';
import BoardTextNode from './BoardTextNode';
import BoardFrameNode from './BoardFrameNode';
import BoardConnection from './BoardConnection';
import BoardViewportControls from './BoardViewportControls';
import BoardCanvasHelp from './BoardCanvasHelp';
import { useBoardEditor } from './BoardEditorContext';
import type { BoardSide } from '../../services/boards/types';

const nodeTypes = { sticky: BoardCreativeNode, shape: BoardCreativeNode, link: BoardCreativeNode, 'smart-frame': BoardSmartFrameNode, asset: BoardAssetNode, text: BoardTextNode, frame: BoardFrameNode };
const edgeTypes = { manual: BoardConnection, query: BoardQueryConnection };

export default function BoardCanvas({ boardId, onFitAll = () => {} }: { boardId: string; onFitAll?: () => void }) {
  const exists = useBoardStore(state => !!state.sessions[boardId]);
  return exists ? <BoardCanvasContent boardId={boardId} onFitAll={onFitAll} /> : null;
}

function BoardCanvasContent({ boardId, onFitAll }: { boardId: string; onFitAll: () => void }) {
  const session = useBoardStore(state => state.sessions[boardId]);
  const queryActions = useBoardQueryActions();
  const editor = useBoardEditor();
  const flow = useReactFlow<BoardFlowNode>();
  const { zoom } = useViewport();
  const stageRef = useRef<HTMLDivElement>(null);
  const cardConnection = useRef<{ sourceId: string; start: BoardPoint } | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<{ start: BoardPoint; end: BoardPoint } | null>(null);
  useEffect(() => { cardConnection.current = null; setConnectionPreview(null); }, [editor.connecting, boardId]);
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
    if (tool !== 'frame') { state.beginInteraction(boardId); editor.editObject?.(ids[0]); }
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
  const { nodes, edges } = useMemo(() => boardToFlow(session.document, session.selectedObjectIds, session.selectedConnectionIds, editor.editable), [session.document, session.selectedObjectIds, session.selectedConnectionIds, editor.editable]);
  const onNodesChange = useCallback((changes: NodeChange<BoardFlowNode>[]) => {
    const state = useBoardStore.getState();
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) {
      const ids = new Set(state.sessions[boardId].selectedObjectIds);
      selected.forEach(change => { if (change.type === 'select') { if (change.selected) ids.add(change.id); else ids.delete(change.id); } });
      state.setSelection(boardId, [...ids], state.sessions[boardId].selectedConnectionIds);
    }
    if (!editor.editable) return;
    const updatedNodes = applyNodeChanges(changes, nodes);
    const updates = flowGeometryUpdates(updatedNodes, changes);
    if (updates.length) state.updateInteraction(boardId, document => updateObjects(document, updates));
    if (changes.some(change => change.type === 'dimensions' && change.resizing === false)) state.commitInteraction(boardId);
  }, [boardId, nodes, editor.editable]);
  const finishDrag = useCallback(() => {
    const state = useBoardStore.getState();
    const current = state.sessions[boardId];
    const updates = current.document.objects.filter(object => current.selectedObjectIds.includes(object.id) && object.type !== 'frame' && object.type !== 'smart-frame')
      .map(object => ({ id: object.id, frameId: findContainingFrame(object, current.document.objects)?.id ?? null }));
    if (updates.length) state.updateInteraction(boardId, document => updateObjects(document, updates));
    state.commitInteraction(boardId);
  }, [boardId]);
  const connect = useCallback((connection: Connection) => {
    if (!editor.editable || !connection.source || !connection.target) return;
    useBoardStore.getState().executeOperation(boardId, document => addConnection(document, {
      sourceObjectId: connection.source, targetObjectId: connection.target,
      sourceSide: (connection.sourceHandle || 'right') as BoardSide, targetSide: (connection.targetHandle || 'left') as BoardSide,
      color: '#94a3b8', label: '',
    }));
  }, [boardId, editor.editable]);
  const beginCardConnection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (editor.connecting && editor.editable && event.button === 0 && !target.closest('input,textarea,a,button,.react-flow__handle,.react-flow__resize-control')) {
      const node = target.closest<HTMLElement>('.react-flow__node[data-id]');
      if (node?.dataset.id) {
        event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
        const rect = event.currentTarget.getBoundingClientRect();
        const start = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        cardConnection.current = { sourceId: node.dataset.id, start };
        setConnectionPreview({ start, end: start });
        return;
      }
    }
    if (!target.closest('input, textarea, button, a, [contenteditable="true"], [role="menu"]')) stageRef.current?.closest<HTMLElement>('.board-workspace')?.focus({ preventScroll: true });
  };
  const finishCardConnection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = cardConnection.current;
    if (!gesture) return;
    event.preventDefault(); event.stopPropagation(); cardConnection.current = null; setConnectionPreview(null);
    const id = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.react-flow__node[data-id]')?.dataset.id;
    const current = useBoardStore.getState().sessions[boardId]?.document;
    const source = current?.objects.find(object => object.id === gesture.sourceId);
    const target = current?.objects.find(object => object.id === id);
    if (editor.editable && source && target && source.id !== target.id) {
      const sides = facingBoardSides(source, target);
      connect({ source: source.id, target: target.id, sourceHandle: sides.sourceSide, targetHandle: sides.targetSide });
    }
  };
  return <div ref={stageRef} className="board-stage" data-connecting={editor.connecting} onPointerDownCapture={beginCardConnection} onPointerUpCapture={finishCardConnection}
    onPointerCancel={() => { cardConnection.current = null; setConnectionPreview(null); }}
    onPointerMove={event => {
      setBoardPointer(boardId, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      if (cardConnection.current) { const rect = event.currentTarget.getBoundingClientRect(); setConnectionPreview({ start: cardConnection.current.start, end: { x: event.clientX - rect.left, y: event.clientY - rect.top } }); }
    }} onDoubleClick={event => { event.stopPropagation(); if (editor.editable && (event.target as HTMLElement).classList.contains('react-flow__pane')) setMenu({ x: event.clientX, y: event.clientY, point: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), kind: 'create' }); }}
    onDragOver={event => { if (editor.editable && hasInternalImageDragType(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDrop={event => {
      if (!editor.editable || !hasInternalImageDragType(event.dataTransfer)) return;
      event.preventDefault();
      const ids = getInternalImageDragIds(event.dataTransfer);
      clearInternalImageDragData();
      if (ids.length) editor.dropAssets?.(ids, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    }}>
    <ReactFlow<BoardFlowNode> key={boardId} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      onNodesChange={onNodesChange} onEdgesChange={changes => {
        const selected = new Set(useBoardStore.getState().sessions[boardId].selectedConnectionIds);
        changes.forEach(change => { if (change.type === 'select' && session.document.connections.some(connection => connection.id === change.id)) { if (change.selected) selected.add(change.id); else selected.delete(change.id); } });
        useBoardStore.getState().setSelection(boardId, useBoardStore.getState().sessions[boardId].selectedObjectIds, [...selected]);
      }}
      onNodeDragStart={editor.begin} onNodeDragStop={finishDrag} onConnect={connect}
      connectionMode={ConnectionMode.Loose} nodesDraggable={editor.editable && !drawingTool && !editor.connecting} nodesConnectable={editor.editable && !drawingTool}
      connectionRadius={20 / zoom} connectOnClick={false}
      defaultViewport={session.document.viewport} minZoom={0.1} maxZoom={4} deleteKeyCode={null} selectionKeyCode={null}
      multiSelectionKeyCode={["Control", "Meta", "Shift"]} panActivationKeyCode="Space" panOnDrag={[1]} selectionOnDrag={!drawingTool && !editor.connecting} selectionMode={SelectionMode.Partial} panOnScroll={false}
      zoomOnScroll zoomOnPinch zoomActivationKeyCode={['Control', 'Meta']} zoomOnDoubleClick={false}
      onMoveEnd={() => useBoardStore.getState().setViewport(boardId, flow.getViewport())}
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
      <Panel position="bottom-right" className="board-minimap-panel"><BoardViewportControls boardId={boardId} onFitAll={onFitAll}/></Panel>
      <Panel position="bottom-left"><BoardCanvasHelp/></Panel>
      <Background color="rgb(var(--gray-700) / .55)" gap={24} size={1} />
    </ReactFlow>
    {connectionPreview && <svg className="board-connect-preview" aria-label="Connection preview"><path d={`M ${connectionPreview.start.x} ${connectionPreview.start.y} L ${connectionPreview.end.x} ${connectionPreview.end.y}`} /></svg>}
    {menu && <BoardContextMenu boardId={boardId} menu={menu} close={closeMenu} create={createObject} fit={onFitAll} />}
    {!session.document.objects.length && editor.editable && <div className="board-empty-start nodrag nopan">
      <h2>Start your board</h2><p>Collect references or explore your library with a live query.</p>
      <div><button className="board-button" onClick={() => { useBoardUIStore.getState().setLibraryOpen(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Search canvas library"]')?.focus()); }}>Add references</button><small>Choose files from the side library and arrange them freely.</small></div>
      <div><button className="board-button" onClick={() => queryActions?.create()}>Explore library</button><small>Create a Smart Frame to filter, group and branch results.</small></div>
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
