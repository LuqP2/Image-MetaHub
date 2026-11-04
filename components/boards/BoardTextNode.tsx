import BoardRichText from './BoardRichText';
import { memo, useEffect, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { BoardFlowNode } from '../../services/boards/reactFlowAdapter';
import BoardNodeControls from './BoardNodeControls';
import { useBoardEditor } from './BoardEditorContext';

export default memo(function BoardTextNode({ data, selected }: NodeProps<BoardFlowNode>) {
  const editor = useBoardEditor();
  const [localEditing, setEditing] = useState(false);
  const editing = localEditing || editor.editingObjectId === data.object.id;
  useEffect(() => { if (editing && editor.tool && editor.tool !== 'select') { editor.commit(); setEditing(false); editor.editObject?.(null); } }, [editing, editor]);
  const object = data.object;
  if (object.type !== 'text') return null;
  return <div className="board-text" style={{ color: object.color === '#e5e7eb' ? 'rgb(var(--gray-100))' : object.color, fontSize: object.fontSize }} onDoubleClick={() => { if (editor.editable) { editor.begin(); setEditing(true); } }}>
    <BoardNodeControls selected={!!selected} />
    {editing && editor.editable ? <textarea className="board-textarea nodrag nowheel" autoFocus value={object.text} aria-label="Board text"
      onChange={event => editor.change({ id: object.id, text: event.target.value })}
      onBlur={() => { editor.commit(); setEditing(false); editor.editObject?.(null); }}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { editor.cancel(); setEditing(false); editor.editObject?.(null); } }} />
      : <div className="board-text-content"><BoardRichText text={object.text || 'Double-click to edit'} /></div>}
  </div>;
});
