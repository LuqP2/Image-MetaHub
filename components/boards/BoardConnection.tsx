import BoardRichText from './BoardRichText';
import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

export default memo(function BoardConnection(props: EdgeProps) {
  const [path, x, y] = getBezierPath(props);
  const color = typeof props.data?.color === 'string' ? props.data.color : '#94a3b8';
  const width = typeof props.data?.width === 'number' ? props.data.width : 1.5;
  return <>
    <defs><marker id={`board-arrow-${props.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={color} /></marker></defs>
    <BaseEdge id={props.id} path={path} style={{ stroke: color, strokeWidth: width }} markerEnd={`url(#board-arrow-${props.id})`} />
    {props.label && <EdgeLabelRenderer><div className="board-edge-label" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}><BoardRichText text={String(props.label)} /></div></EdgeLabelRenderer>}
  </>;
});
