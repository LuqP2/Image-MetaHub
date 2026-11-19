import BoardRichText from './BoardRichText';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { useBoardStore } from '../../store/useBoardStore';
import { updateConnection } from '../../services/boards/operations';

export default memo(function BoardConnection(props: EdgeProps) {
  const [path, x, y] = (props.data?.routing === 'orthogonal' ? getSmoothStepPath : getBezierPath)(props);
  const geometry = useRef<SVGPathElement>(null);
  const [midpoint, setMidpoint] = useState({ x, y });
  const drag = useRef<{ x: number; y: number; offset: { x: number; y: number } } | null>(null);
  const flow = useReactFlow();
  const boardId = typeof props.data?.boardId === 'string' ? props.data.boardId : '';
  const offset = props.data?.labelOffset as { x: number; y: number } | undefined;
  const editable = !!props.data?.editable;
  useLayoutEffect(() => {
    const element = geometry.current;
    if (element?.getTotalLength) { const point = element.getPointAtLength(element.getTotalLength() / 2); setMidpoint({ x: point.x, y: point.y }); }
    else setMidpoint({ x, y });
  }, [path, x, y]);
  useEffect(() => {
    const cancel = () => { if (drag.current) { drag.current = null; useBoardStore.getState().cancelInteraction(boardId); } };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); cancel(); } };
    window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); cancel(); };
  }, [boardId]);
  const color = typeof props.data?.color === 'string' ? props.data.color : '#94a3b8';
  const width = typeof props.data?.width === 'number' ? props.data.width : 1.5;
  return <>
    <path ref={geometry} d={path} fill="none" stroke="none" pointerEvents="none" />
    <defs><marker id={`board-arrow-${props.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={color} /></marker></defs>
    <BaseEdge id={props.id} path={path} style={{ stroke: color, strokeWidth: width, strokeDasharray: props.data?.lineStyle === 'dashed' ? `${width * 4} ${width * 3}` : undefined }} markerEnd={`url(#board-arrow-${props.id})`} />
    {props.label && <EdgeLabelRenderer><div className="board-edge-label nodrag nopan" style={{ fontSize: Number(props.data?.labelFontSize ?? 11), pointerEvents: editable ? 'all' : 'none', cursor: editable ? 'move' : undefined, transform: `translate(-50%, -50%) translate(${midpoint.x + (offset?.x ?? 0)}px, ${midpoint.y + (offset?.y ?? 0)}px)` }}
      onPointerDown={event => { if (!editable || event.button !== 0) return; event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, offset: offset ?? { x: 0, y: 0 } }; useBoardStore.getState().beginInteraction(boardId); }}
      onPointerMove={event => { const start = drag.current; if (!start) return; event.stopPropagation(); const zoom = flow.getZoom(); useBoardStore.getState().updateInteraction(boardId, document => updateConnection(document, props.id, { labelOffset: { x: start.offset.x + (event.clientX - start.x) / zoom, y: start.offset.y + (event.clientY - start.y) / zoom } })); }}
      onPointerUp={event => { if (!drag.current) return; event.stopPropagation(); drag.current = null; useBoardStore.getState().commitInteraction(boardId); }}
      onPointerCancel={() => { if (drag.current) { drag.current = null; useBoardStore.getState().cancelInteraction(boardId); } }}
      onLostPointerCapture={() => { if (drag.current) { drag.current = null; useBoardStore.getState().cancelInteraction(boardId); } }}
    ><BoardRichText text={String(props.label)} /></div></EdgeLabelRenderer>}
  </>;
});
