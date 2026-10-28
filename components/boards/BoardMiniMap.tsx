import type { PointerEvent } from 'react';
import { useReactFlow, useStore, useViewport } from '@xyflow/react';
import type { BoardObject } from '../../services/boards/types';
import { getBoardBounds } from '../../services/boards/layout';

/** Keep the map scale tied to the content so zoom visibly changes the viewport rectangle. */
export default function BoardMiniMap({ objects }: { objects: BoardObject[] }) {
  const viewport = useViewport();
  const width = useStore(state => state.width);
  const height = useStore(state => state.height);
  const flow = useReactFlow();
  const bounds = objects.length ? getBoardBounds(objects) : { x: -500, y: -375, width: 1000, height: 750 };
  const scale = Math.max(bounds.width / 200, bounds.height / 150, 1) * 1.3;
  const map = { x: bounds.x + bounds.width / 2 - scale * 100, y: bounds.y + bounds.height / 2 - scale * 75, width: scale * 200, height: scale * 150 };
  const navigate = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    void flow.setCenter(map.x + (event.clientX - rect.left) / rect.width * map.width, map.y + (event.clientY - rect.top) / rect.height * map.height, { zoom: viewport.zoom });
  };
  return <svg className="board-minimap-svg" aria-label="Board overview" role="img" viewBox={`${map.x} ${map.y} ${map.width} ${map.height}`}
    onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); navigate(event); }}
    onPointerMove={event => { if (event.buttons === 1) navigate(event); }}
    onWheel={event => { event.preventDefault(); event.stopPropagation(); void flow.zoomTo(Math.max(0.1, Math.min(4, viewport.zoom * Math.exp(-event.deltaY * 0.002)))); }}>
    {objects.map(object => <rect key={object.id} className="board-minimap-node" data-type={object.type} x={object.x} y={object.y} width={object.width} height={object.height} vectorEffect="non-scaling-stroke" />)}
    <rect className="board-minimap-viewport" x={-viewport.x / viewport.zoom} y={-viewport.y / viewport.zoom} width={width / viewport.zoom} height={height / viewport.zoom} vectorEffect="non-scaling-stroke" />
  </svg>;
}
