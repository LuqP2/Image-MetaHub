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

const nodeTypes = { 'smart-frame': BoardSmartFrameNode, asset: BoardAssetNode, text: BoardTextNode, frame: BoardFrameNode };
const edgeTypes = { manual: BoardConnection };

export default function BoardCanvas({ boardId, onFitAll = () => {} }: { boardId: string; onFitAll?: () => void }) {
  const session = useBoardStore(state => state.sessions[boardId]);
  const editor = useBoardEditor();
  const flow = useReactFlow<BoardFlowNode>();
  const { zoom } = useViewport();
  const [drawing, setDrawing] = useState<{ start: BoardPoint; end: BoardPoint } | null>(null);
  const drawingStart = useRef<BoardPoint | null>(null);
  const drawingTool = editor.editable && (editor.tool === 'text' || editor.tool === 'frame') ? editor.tool : null;
  useEffect(() => { drawingStart.current = null; setDrawing(null); }, [drawingTool]);
  useEffect(() => {
    if (session.fitSelectionRequest <= session.handledFitSelectionRequest) return;
    const frame = requestAnimationFrame(() => {
      const state = useBoardStore.getState();
      const ids = state.sessions[boardId]?.selectedObjectIds ?? [];
      if (state.consumeFitSelection(boardId, session.fitSelectionRequest) && ids.length) {
        void flow.fitView({ nodes: ids.map(id => ({ id })), padding: 0.2 });
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
  return <div className="board-stage" onDoubleClick={event => event.stopPropagation()}
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
        changes.forEach(change => { if (change.type === 'select') { if (change.selected) selected.add(change.id); else selected.delete(change.id); } });
        useBoardStore.getState().setSelection(boardId, useBoardStore.getState().sessions[boardId].selectedObjectIds, [...selected]);
      }}
      onNodeDragStart={editor.begin} onNodeDragStop={finishDrag} onConnect={connect}
      connectionMode={ConnectionMode.Loose} nodesDraggable={editor.editable && !drawingTool} nodesConnectable={editor.editable && !drawingTool}
      connectionRadius={20 / zoom} connectOnClick={false}
      defaultViewport={session.document.viewport} minZoom={0.1} maxZoom={4} deleteKeyCode={null} selectionKeyCode={null}
      multiSelectionKeyCode={["Control", "Meta", "Shift"]} panActivationKeyCode="Space" panOnDrag={[1]} selectionOnDrag={!drawingTool} selectionMode={SelectionMode.Partial} panOnScroll={false}
      zoomOnScroll zoomOnPinch zoomActivationKeyCode={['Control', 'Meta']} zoomOnDoubleClick={false}
      onMoveEnd={() => useBoardStore.getState().setViewport(boardId, flow.getViewport())}
      onPaneClick={() => useBoardStore.getState().setSelection(boardId, [])}
      onlyRenderVisibleElements elevateNodesOnSelect={false}>
      <Panel position="bottom-right" className="board-minimap-panel"><BoardViewportControls boardId={boardId} onFitAll={onFitAll}/></Panel>
      <Panel position="bottom-left"><BoardCanvasHelp/></Panel>
      <Background color="rgb(var(--gray-700) / .55)" gap={24} size={1} />
    </ReactFlow>
    {drawingTool && <div className="board-drawing-hint">Drag to draw {drawingTool === 'text' ? 'a text box' : 'a frame'} · Esc to cancel</div>}
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
        if (Math.abs(event.clientX - start.x) < 4 && Math.abs(event.clientY - start.y) < 4) return;
        const bounds = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(1, Math.abs(b.x - a.x)), height: Math.max(1, Math.abs(b.y - a.y)) };
        const state = useBoardStore.getState();
        const previousIds = new Set(state.sessions[boardId].document.objects.map(object => object.id));
        state.executeOperation(boardId, document => drawBoardObject(document, drawingTool, bounds));
        state.setSelection(boardId, useBoardStore.getState().sessions[boardId].document.objects.filter(object => !previousIds.has(object.id)).map(object => object.id));
        editor.setTool?.('select');
      }}>
      {drawing && <div className="board-draw-preview" style={{ position: 'absolute', left: Math.min(drawing.start.x, drawing.end.x), top: Math.min(drawing.start.y, drawing.end.y), width: Math.abs(drawing.end.x - drawing.start.x), height: Math.abs(drawing.end.y - drawing.start.y) }} />}
    </div>}
  </div>;
}
