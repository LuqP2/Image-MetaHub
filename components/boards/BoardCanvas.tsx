import { useCallback, useMemo } from 'react';
import { applyNodeChanges, Background, ConnectionMode, ReactFlow, useReactFlow, type Connection, type NodeChange } from '@xyflow/react';
import { useBoardStore } from '../../store/useBoardStore';
import { boardToFlow, flowGeometryUpdates, type BoardFlowNode } from '../../services/boards/reactFlowAdapter';
import { addConnection, updateObjects } from '../../services/boards/operations';
import { findContainingFrame } from '../../services/boards/layout';
import BoardAssetNode from './BoardAssetNode';
import BoardTextNode from './BoardTextNode';
import BoardFrameNode from './BoardFrameNode';
import BoardConnection from './BoardConnection';
import { useBoardEditor } from './BoardEditorContext';
import type { BoardSide } from '../../services/boards/types';

const nodeTypes = { asset: BoardAssetNode, text: BoardTextNode, frame: BoardFrameNode };
const edgeTypes = { manual: BoardConnection };

export default function BoardCanvas({ boardId }: { boardId: string }) {
  const session = useBoardStore(state => state.sessions[boardId]);
  const editor = useBoardEditor();
  const flow = useReactFlow<BoardFlowNode>();
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
    const updates = current.document.objects.filter(object => current.selectedObjectIds.includes(object.id) && object.type !== 'frame')
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
  return <div className="board-stage" onDoubleClick={event => event.stopPropagation()}>
    <ReactFlow<BoardFlowNode> key={boardId} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      onNodesChange={onNodesChange} onEdgesChange={changes => {
        const selected = new Set(useBoardStore.getState().sessions[boardId].selectedConnectionIds);
        changes.forEach(change => { if (change.type === 'select') { if (change.selected) selected.add(change.id); else selected.delete(change.id); } });
        useBoardStore.getState().setSelection(boardId, useBoardStore.getState().sessions[boardId].selectedObjectIds, [...selected]);
      }}
      onNodeDragStart={editor.begin} onNodeDragStop={finishDrag} onConnect={connect}
      connectionMode={ConnectionMode.Loose} nodesDraggable={editor.editable} nodesConnectable={editor.editable}
      defaultViewport={session.document.viewport} minZoom={0.1} maxZoom={4} deleteKeyCode={null} selectionKeyCode={null}
      multiSelectionKeyCode="Shift" panActivationKeyCode="Space" panOnDrag={[1]} selectionOnDrag panOnScroll
      zoomOnScroll={false} zoomOnPinch zoomActivationKeyCode={['Control', 'Meta']} zoomOnDoubleClick={false}
      onMoveEnd={() => useBoardStore.getState().setViewport(boardId, flow.getViewport())}
      onPaneClick={() => useBoardStore.getState().setSelection(boardId, [])}
      onlyRenderVisibleElements elevateNodesOnSelect={false}>
      <Background color="#64748b" gap={24} size={1} />
    </ReactFlow>
  </div>;
}
