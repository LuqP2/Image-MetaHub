import { useReactFlow } from '@xyflow/react';
import { useBoardStore } from '../../store/useBoardStore';
import { addText, arrangeObjectsInGrid, createFrame, duplicateObjects, removeConnections, removeObjects, updateObjects } from '../../services/boards/operations';
import type { BoardPoint } from '../../services/boards/layout';

export default function BoardToolbar({ boardId, editable, center, connecting, setConnecting, onBack, onExport }: {
  boardId: string; editable: boolean; center: () => BoardPoint; connecting: boolean; setConnecting(value: boolean): void; onBack(): void; onExport(): void;
}) {
  const session = useBoardStore(state => state.sessions[boardId]);
  const flow = useReactFlow();
  const run = useBoardStore(state => state.executeOperation);
  return <div className="board-toolbar" aria-label="Board tools">
    <button onClick={onBack}>Boards</button>
    <input aria-label="Board name" disabled={!editable} value={session.document.name} onChange={event => { if (event.target.value.trim()) useBoardStore.getState().renameBoard(boardId, event.target.value); }} />
    <span className="board-save-status" role="status">{session.saveStatus === 'saved' ? 'Saved' : session.saveStatus === 'error' ? 'Save failed' : 'Saving…'}</span>
    <div className="board-toolbar-group">
      <button disabled={!editable} onClick={() => run(boardId, document => addText(document, center()))}>Text</button>
      <button disabled={!editable} onClick={() => run(boardId, document => createFrame(document, session.selectedObjectIds, center()))}>Frame</button>
      <button disabled={!editable} aria-pressed={connecting} onClick={() => setConnecting(!connecting)}>Connect</button>
      <button disabled={!editable || !session.selectedObjectIds.length} onClick={() => run(boardId, document => arrangeObjectsInGrid(document, session.selectedObjectIds))}>Grid</button>
      <button disabled={!editable || !session.selectedObjectIds.length} onClick={() => run(boardId, document => duplicateObjects(document, session.selectedObjectIds))}>Duplicate</button>
      <button disabled={!editable || (!session.selectedObjectIds.length && !session.selectedConnectionIds.length)} onClick={() => run(boardId, document => removeConnections(removeObjects(document, session.selectedObjectIds), session.selectedConnectionIds))}>Remove</button>
      <button disabled={!editable || !session.selectedObjectIds.length} onClick={() => run(boardId, document => updateObjects(document, document.objects.filter(object => session.selectedObjectIds.includes(object.id)).map(object => ({ id: object.id, zIndex: Math.max(0, ...document.objects.map(item => item.zIndex)) + 1 }))))}>To front</button>
      <button disabled={!editable || !session.selectedObjectIds.length} onClick={() => run(boardId, document => updateObjects(document, document.objects.filter(object => session.selectedObjectIds.includes(object.id)).map(object => ({ id: object.id, zIndex: Math.min(0, ...document.objects.map(item => item.zIndex)) - 1 }))))}>To back</button>
    </div>
    <button disabled={!editable || !session.past.length} onClick={() => useBoardStore.getState().undo(boardId)}>Undo</button>
    <button disabled={!editable || !session.future.length} onClick={() => useBoardStore.getState().redo(boardId)}>Redo</button>
    <button onClick={() => void flow.zoomOut()}>−</button><button onClick={() => void flow.zoomIn()}>+</button>
    <button onClick={() => void flow.fitView({ padding: 0.2 })}>Fit all</button>
    <button disabled={!session.selectedObjectIds.length} onClick={() => void flow.fitView({ nodes: session.selectedObjectIds.map(id => ({ id })), padding: 0.2 })}>Fit selection</button>
    <button onClick={onExport}>Export</button>
  </div>;
}
