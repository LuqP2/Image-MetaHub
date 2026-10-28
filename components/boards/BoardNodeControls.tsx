import { Handle, Position, NodeResizer } from '@xyflow/react';
import { useBoardEditor } from './BoardEditorContext';

export default function BoardNodeControls({ selected, keepAspectRatio = false }: { selected: boolean; keepAspectRatio?: boolean }) {
  const editor = useBoardEditor();
  const showHandles = editor.editable && (selected || editor.connecting);
  return <>
    <NodeResizer isVisible={selected && editor.editable} minWidth={80} minHeight={60} keepAspectRatio={keepAspectRatio}
      onResizeStart={editor.begin} />
    {([['top', Position.Top], ['right', Position.Right], ['bottom', Position.Bottom], ['left', Position.Left]] as const).map(([id, position]) =>
      <Handle key={id} id={id} type="source" position={position} isConnectable={editor.editable} style={{ opacity: showHandles ? 1 : 0, pointerEvents: showHandles ? 'auto' : 'none' }} />)}
  </>;
}
