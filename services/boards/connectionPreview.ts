import { getBezierPath, Position, type InternalNode } from '@xyflow/react';
import type { BoardBounds, BoardPoint } from './layout';
import type { BoardSide } from './types';
import { facingBoardSides } from './connectionGeometry';

const positions: Record<BoardSide, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };
const anchor = (bounds: BoardBounds, side: BoardSide): BoardPoint => ({
  x: bounds.x + (side === 'left' ? 0 : side === 'right' ? bounds.width : bounds.width / 2),
  y: bounds.y + (side === 'top' ? 0 : side === 'bottom' ? bounds.height : bounds.height / 2),
});

function measuredAnchor(node: InternalNode | undefined, side: BoardSide): BoardPoint | undefined {
  const handle = node?.internals.handleBounds?.source?.find(handle => handle.id === side)
    ?? node?.internals.handleBounds?.target?.find(handle => handle.id === side);
  if (!node || !handle) return undefined;
  // Edges attach to the outer end of the measured handle, not its center.
  return anchor({ x: node.internals.positionAbsolute.x + handle.x, y: node.internals.positionAbsolute.y + handle.y, width: handle.width, height: handle.height }, side);
}

/** Uses the same Bezier path and edge anchors as the committed React Flow connection. */
export function boardConnectionPreview(source: BoardBounds, pointer: BoardPoint, target?: BoardBounds, sourceSide?: BoardSide, nodes?: { source?: InternalNode; target?: InternalNode }) {
  const sides = facingBoardSides(source, target ?? { ...pointer, width: 0, height: 0 });
  const fromSide = sourceSide ?? sides.sourceSide;
  const from = measuredAnchor(nodes?.source, fromSide) ?? anchor(source, fromSide);
  const to = target ? measuredAnchor(nodes?.target, sides.targetSide) ?? anchor(target, sides.targetSide) : pointer;
  const [path] = getBezierPath({ sourceX: from.x, sourceY: from.y, sourcePosition: positions[fromSide], targetX: to.x, targetY: to.y, targetPosition: positions[sides.targetSide] });
  return { path, sourceSide: fromSide, targetSide: sides.targetSide };
}
