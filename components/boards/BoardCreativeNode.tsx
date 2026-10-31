import BoardRichText from './BoardRichText';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { BoardFlowNode } from '../../services/boards/reactFlowAdapter';
import BoardNodeControls from './BoardNodeControls';
import { useBoardEditor } from './BoardEditorContext';

export default memo(function BoardCreativeNode({ data, selected }: NodeProps<BoardFlowNode>) {
  const editor = useBoardEditor();
  const object = data.object;
  const [localEditing, setEditing] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const editing = editor.editable && (localEditing || editor.editingObjectId === object.id);
  useEffect(() => { if (editing && editor.tool && editor.tool !== 'select') { editor.commit(); setEditing(false); editor.editObject?.(null); } }, [editing, editor]);
  const isText = object.type === 'sticky' || object.type === 'shape';
  useLayoutEffect(() => {
    if (object.type !== 'sticky' || !editing || !textarea.current) return;
    textarea.current.style.height = '0px';
    const height = Math.max(180, textarea.current.scrollHeight + 32);
    textarea.current.style.height = `${height - 32}px`;
    if (Math.abs(height - object.height) > 1) editor.change({ id: object.id, height });
  }, [object, editing, editor]);
  if (object.type !== 'sticky' && object.type !== 'shape' && object.type !== 'link') return null;
  const finish = (cancel = false) => { if (cancel) editor.cancel(); else editor.commit(); setEditing(false); editor.editObject?.(null); };
  const start = () => { if (editor.editable) { editor.begin(); setEditing(true); } };
  return <div className={`board-creative board-creative--${object.type}`} style={{ fontSize: isText ? object.fontSize : 18 }} onDoubleClick={start}>
    <BoardNodeControls selected={!!selected} />
    {object.type === 'shape' ? <svg className="board-shape-background" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {object.shape === 'ellipse' ? <ellipse cx="50" cy="50" rx="49" ry="49" fill={object.color} stroke={object.borderColor} strokeWidth={object.borderWidth} vectorEffect="non-scaling-stroke" />
        : object.shape === 'diamond' ? <polygon points="50,1 99,50 50,99 1,50" fill={object.color} stroke={object.borderColor} strokeWidth={object.borderWidth} vectorEffect="non-scaling-stroke" />
          : <rect x="1" y="1" width="98" height="98" rx="2" fill={object.color} stroke={object.borderColor} strokeWidth={object.borderWidth} vectorEffect="non-scaling-stroke" />}
    </svg> : <div className="board-creative-background" style={{ background: object.type === 'sticky' ? object.color : undefined, borderColor: object.color }} />}
    <div className={`board-creative-content ${object.type === 'shape' ? `board-shape-text--${object.shape}` : ''}`}>
      {editing ? <>
        <textarea ref={textarea} className="board-creative-input nodrag nopan nowheel" autoFocus aria-label={object.type === 'link' ? 'Link title' : 'Note text'} value={object.type === 'link' ? object.title : object.text}
          onChange={event => editor.change({ id: object.id, ...(object.type === 'link' ? { title: event.target.value } : { text: event.target.value }) })}
          onBlur={() => finish()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing) finish(true); }} />
      </> : <div className="board-creative-text"><BoardRichText text={object.type === 'link' ? object.title : object.text || (selected ? 'Double-click to edit' : '')} /></div>}
      {object.type === 'link' && <a className="nodrag nopan board-link-url" href={object.url} target="_blank" rel="noreferrer" onDoubleClick={event => event.stopPropagation()}>{object.url}</a>}
    </div>
  </div>;
});
