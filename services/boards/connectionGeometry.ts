import type { BoardObject, BoardSide } from './types';

export function facingBoardSides(source: Pick<BoardObject, 'x' | 'y' | 'width' | 'height'>, target: Pick<BoardObject, 'x' | 'y' | 'width' | 'height'>): { sourceSide: BoardSide; targetSide: BoardSide } {
  const dx = target.x + target.width / 2 - source.x - source.width / 2;
  const dy = target.y + target.height / 2 - source.y - source.height / 2;
  return Math.abs(dx) >= Math.abs(dy) ? { sourceSide: dx >= 0 ? 'right' : 'left', targetSide: dx >= 0 ? 'left' : 'right' }
    : { sourceSide: dy >= 0 ? 'bottom' : 'top', targetSide: dy >= 0 ? 'top' : 'bottom' };
}
