import { memo, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, GripHorizontal } from 'lucide-react';
import { useStore, type NodeProps } from '@xyflow/react';
import type { BoardFlowNode } from '../../services/boards/reactFlowAdapter';
import type { BoardAssetObject } from '../../services/boards/types';
import { useBoardStore } from '../../store/useBoardStore';
import { setStackCover, unstack } from '../../services/boards/stackOperations';
import { useBoardEditor } from './BoardEditorContext';
import BoardNodeControls from './BoardNodeControls';
import BoardResultThumbnail from './BoardResultThumbnail';

function StackImage({ object, stackId }: { object: BoardAssetObject; stackId: string }) {
  const editor = useBoardEditor();
  const boardId = useBoardStore(state => state.activeBoardId);
  const result = editor.resolveAsset?.(object);
  return result?.image ? <BoardResultThumbnail image={result.image} draggable={editor.editable} stackDrag={boardId ? { boardId, stackId, objectId: object.id } : undefined} open={() => editor.openAsset?.(object)} /> : <span className="board-stack-missing">{object.name} · {result?.status === 'loading' ? 'Loading…' : 'Unavailable'}</span>;
}
export default memo(function BoardStackNode({ data, selected }: NodeProps<BoardFlowNode>) {
  const editor = useBoardEditor();
  const boardId = useBoardStore(state => state.activeBoardId);
  const objects = useBoardStore(state => boardId ? state.sessions[boardId]?.document.objects : undefined);
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  // Closed stacks do not need to rerender on every pan/zoom gesture.
  const transform = useStore(state => expanded ? state.transform : null);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 480, maxHeight: 480 });
  useLayoutEffect(() => {
    if (!expanded) return;
    const measure = () => {
      const bounds = anchor.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(480, window.innerWidth - 24);
      const maxHeight = Math.min(480, window.innerHeight - 24);
      const preferredLeft = bounds.right + 12 + width <= window.innerWidth - 12 ? bounds.right + 12 : bounds.left - width - 12;
      setPosition({ left: Math.max(12, Math.min(preferredLeft, window.innerWidth - width - 12)), top: Math.max(12, Math.min(bounds.top, window.innerHeight - maxHeight - 12)), width, maxHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [expanded, transform, data.object.x, data.object.y, data.object.width, data.object.height]);
  if (data.object.type !== 'stack') return null;
  const stack = data.object;
  const members = stack.memberIds.map(id => objects?.find(object => object.id === id)).filter((object): object is BoardAssetObject => object?.type === 'asset');
  const coverIndex = Math.max(0, members.findIndex(object => object.id === stack.coverId));
  const current = members[(coverIndex + offset % Math.max(1, members.length) + members.length) % Math.max(1, members.length)];
  const run = (operation: Parameters<ReturnType<typeof useBoardStore.getState>['executeOperation']>[1]) => { if (editor.editable && boardId) useBoardStore.getState().executeOperation(boardId, operation); };
  return <div ref={anchor} className="board-stack" onDoubleClick={event => { event.stopPropagation(); if (current) editor.openAsset?.(current); }}>
    <BoardNodeControls selected={!!selected} keepAspectRatio minWidth={Math.max(80, ...members.map(member => stack.width * Math.max(80 / member.width, 60 / member.height)))} minHeight={Math.max(60, ...members.map(member => stack.height * Math.max(80 / member.width, 60 / member.height)))} />
    <header className="board-stack-drag-handle" data-editable={editor.editable} title="Drag to move stack" aria-label="Move stack" onDoubleClick={event => event.stopPropagation()}>
      <GripHorizontal size={16} aria-hidden="true" />
      <span>Stack</span>
      <span className="board-stack-count" aria-label={`Image ${current ? stack.memberIds.indexOf(current.id) + 1 : 0} of ${stack.memberIds.length}`}>{current ? stack.memberIds.indexOf(current.id) + 1 : 0}/{stack.memberIds.length}</span>
    </header>
    <div className="board-stack-picture">{current ? <StackImage object={current} stackId={stack.id} /> : <span>Unavailable</span>}</div>
    <div className="board-stack-actions nodrag nopan" onDoubleClick={event => event.stopPropagation()}>
      <button className="board-icon-button" aria-label="Previous stack image" onClick={() => setOffset(value => value - 1)}><ChevronLeft size={16}/></button>
      <button className="board-icon-button" aria-label="Next stack image" onClick={() => setOffset(value => value + 1)}><ChevronRight size={16}/></button>
      <button className="board-button" disabled={!editor.editable || !current || current.id === stack.coverId} onClick={() => { if (current) { run(document => setStackCover(document, stack.id, current.id)); setOffset(0); } }}>Set cover</button>
      <button className="board-button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Collapse' : 'Expand'}</button>
      <button className="board-button" disabled={!editor.editable} onClick={() => { run(document => unstack(document, stack.id)); if (boardId) useBoardStore.getState().setSelection(boardId, stack.memberIds); }}>Unstack</button>
    </div>
    {expanded && createPortal(<div className="board-stack-expanded nodrag nopan nowheel" style={position} onDoubleClick={event => event.stopPropagation()}>{members.map(member => <div key={member.id}><StackImage object={member} stackId={stack.id} /><button className="board-button" disabled={!editor.editable} onClick={() => { run(document => setStackCover(document, stack.id, member.id)); setOffset(0); }}>Set cover</button></div>)}</div>, document.body)}
  </div>;
});
