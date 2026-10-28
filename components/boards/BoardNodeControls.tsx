import { Handle, Position, NodeResizer, useNodeId, useStore } from '@xyflow/react';
import { useBoardEditor } from './BoardEditorContext';

export default function BoardNodeControls({ selected, keepAspectRatio = false }: { selected: boolean; keepAspectRatio?: boolean }) {
  const editor = useBoardEditor();
  const nodeId = useNodeId();
  const connectionState = useStore(state => {
    const connection = state.connection;
    if (!connection.inProgress) return '';
    const node = nodeId ? state.nodeLookup.get(nodeId) : undefined;
    if (!node || connection.fromNode.id === nodeId) return 'dragging';
    // Connection pointers are relative to the flow container, before its viewport transform.
    const [tx, ty, zoom] = state.transform;
    const x = (connection.pointer.x - tx) / zoom;
    const y = (connection.pointer.y - ty) / zoom;
    const position = node.internals.positionAbsolute;
    const dx = Math.max(position.x - x, 0, x - position.x - (node.measured.width ?? node.width ?? 0));
    const dy = Math.max(position.y - y, 0, y - position.y - (node.measured.height ?? node.height ?? 0));
    if (Math.hypot(dx, dy) * zoom > 36) return 'dragging';
    const handle = connection.isValid && connection.toNode?.id === nodeId ? connection.toHandle?.id : '';
    return `near:${handle ?? ''}`;
  });
  const showHandles = editor.editable && (selected || connectionState.startsWith('near:'));
  const activeHandle = connectionState.startsWith('near:') ? connectionState.slice(5) : '';
  return <>
    <NodeResizer isVisible={selected && editor.editable} minWidth={80} minHeight={60} keepAspectRatio={keepAspectRatio}
      onResizeStart={editor.begin} />
    {([['top', Position.Top], ['right', Position.Right], ['bottom', Position.Bottom], ['left', Position.Left]] as const).map(([id, position]) =>
      <Handle key={id} id={id} type="source" position={position} isConnectable={editor.editable}
        className="board-connection-handle" data-editable={editor.editable}
        isConnectableStart={editor.editable} isConnectableEnd={editor.editable}
        style={{ opacity: showHandles ? 1 : undefined, pointerEvents: editor.editable && (selected || connectionState !== '') ? 'auto' : undefined,
          ...(activeHandle === id ? { width: 14, height: 14, boxShadow: '0 0 0 4px rgb(var(--accent) / .25)' } : {}) }} />)}
  </>;
}
