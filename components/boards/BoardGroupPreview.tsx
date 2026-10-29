import { useState } from 'react';
import { useBoardStore } from '../../store/useBoardStore';
import { branchSmartFrameGroup } from '../../services/boards/smartFrameOperations';
import type { BoardGroupConstraint } from '../../services/boards/queryTypes';
import { useBoardEditor } from './BoardEditorContext';
import { useBoardQueryActions } from './BoardQueryContext';
import BoardResultThumbnail from './BoardResultThumbnail';

export default function BoardGroupPreview({ frameId, label, ids, constraints, open }: {
  frameId: string; label: string; ids: string[]; constraints: BoardGroupConstraint[]; open(): void;
}) {
  const editor = useBoardEditor();
  const actions = useBoardQueryActions();
  const [error, setError] = useState<string | null>(null);
  const branch = () => {
    const state = useBoardStore.getState(), boardId = state.activeBoardId;
    if (!editor.editable || !boardId || state.closing || state.sessions[boardId]?.recovering) return;
    try {
      const previous = new Set(state.sessions[boardId].document.objects.map(object => object.id));
      state.executeOperation(boardId, document => branchSmartFrameGroup(document, frameId, constraints));
      const added = useBoardStore.getState().sessions[boardId].document.objects.filter(object => !previous.has(object.id));
      state.setSelection(boardId, added.map(object => object.id)); state.requestReveal(boardId, [frameId, ...added.map(object => object.id)], true); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <div className={`board-group-preview${ids.length ? '' : ' board-group-preview--empty'}`}><strong tabIndex={0} title={label}>{label}</strong><span>{ids.length.toLocaleString()} {ids.length === 1 ? 'image' : 'images'}</span>
    <div className="board-group-thumbnails">{ids.slice(0, 4).map(id => { const image = actions?.images.get(id); return image ? <BoardResultThumbnail key={id} image={image} open={() => actions?.open(id, frameId, ids)} /> : null; })}</div>
    <div className="board-group-actions"><button className="board-button" onClick={open}>Browse group</button><button className="board-button" disabled={!editor.editable} onClick={branch}>Branch group</button></div>
    {error && <span role="alert">{error}</span>}
  </div>;
}
