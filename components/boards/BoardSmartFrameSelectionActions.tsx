import { useState } from 'react';
import { useBoardStore } from '../../store/useBoardStore';
import type { BoardDocument } from '../../services/boards/types';
import type { BoardSmartFrameObject } from '../../services/boards/queryTypes';
import { intersectSmartFrames, subtractSmartFrames } from '../../services/boards/smartFrameOperations';
import BoardSetOperationDialog from './BoardSetOperationDialog';

export default function BoardSmartFrameSelectionActions({ boardId, frames, editable }: { boardId: string; frames: BoardSmartFrameObject[]; editable: boolean }) {
  const [difference, setDifference] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (operation: (document: BoardDocument) => BoardDocument) => {
    const state = useBoardStore.getState();
    if (!editable || state.closing || state.sessions[boardId]?.recovering) return;
    try {
      const previous = new Set(state.sessions[boardId].document.objects.map(object => object.id));
      state.executeOperation(boardId, operation);
      const ids = useBoardStore.getState().sessions[boardId].document.objects.filter(object => !previous.has(object.id)).map(object => object.id);
      state.setSelection(boardId, ids); state.requestFitSelection(boardId); setError(null); setDifference(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <div className="board-smart-selection-actions">
    {error && <p role="alert">{error}</p>}
    <button className="board-button" disabled={!editable || frames.length < 2} onClick={() => run(document => intersectSmartFrames(document, frames.map(frame => frame.id)))}>Intersect frames</button>
    <button className="board-button" disabled={!editable || frames.length !== 2} onClick={() => setDifference(true)}>Difference…</button>
    {difference && <BoardSetOperationDialog frames={frames} disabled={!editable} close={() => setDifference(false)} confirm={(left, right) => run(document => subtractSmartFrames(document, left, right))} />}
  </div>;
}
