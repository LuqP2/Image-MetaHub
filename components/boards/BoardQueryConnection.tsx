import { memo, useId } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

export default memo(function BoardQueryConnection(props: EdgeProps) {
  const markerId = `board-query-arrow-${useId().replace(/:/g, '')}`;
  const [path, x, y] = getBezierPath(props);
  const color = typeof props.data?.color === 'string' ? props.data.color : '#818cf8';
  return <>
    <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill={color} /></marker></defs>
    <BaseEdge path={path} markerEnd={`url(#${markerId})`} style={{ stroke: color, strokeWidth: 2, strokeDasharray: '6 4', pointerEvents: 'none' }} interactionWidth={0} />
    <EdgeLabelRenderer><div className="board-edge-label board-query-edge-label" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, pointerEvents: 'none' }}>{props.label}</div></EdgeLabelRenderer>
  </>;
});
