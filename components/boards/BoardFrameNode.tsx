import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { BoardFlowNode } from '../../services/boards/reactFlowAdapter';
import BoardNodeControls from './BoardNodeControls';

export default memo(function BoardFrameNode({ data, selected }: NodeProps<BoardFlowNode>) {
  const object = data.object;
  if (object.type !== 'frame') return null;
  return <div className="board-frame" style={{ borderColor: object.color, backgroundColor: `${object.color}0c` }}>
    <BoardNodeControls selected={!!selected} />
    <div className="board-frame-title" style={{ color: object.color }}>{object.title || 'Frame'}</div>
  </div>;
});
