import { memo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { BoardFlowNode } from '../../services/boards/reactFlowAdapter';
import BoardNodeControls from './BoardNodeControls';
import { useBoardEditor } from './BoardEditorContext';

export default memo(function BoardTextNode({ data, selected }: NodeProps<BoardFlowNode>) {
  const editor = useBoardEditor();
  const [editing, setEditing] = useState(false);
  const object = data.object;
  if (object.type !== 'text') return null;
  return <div className="board-text" style={{ color: object.color === '#e5e7eb' ? 'rgb(var(--gray-100))' : object.color, fontSize: object.fontSize }} onDoubleClick={() => { if (editor.editable) { editor.begin(); setEditing(true); } }}>
    <BoardNodeControls selected={!!selected} />
    {editing && editor.editable ? <textarea className="board-textarea nodrag nowheel" autoFocus value={object.text} aria-label="Board text"
      onChange={event => editor.change({ id: object.id, text: event.target.value })}
      onBlur={() => { editor.commit(); setEditing(false); }}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { editor.cancel(); setEditing(false); } }} />
      : <div className="board-text-content">{object.text || 'Double-click to edit'}</div>}
  </div>;
});
