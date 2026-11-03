import { BOARD_GRID_GAP, getBoardBounds, type BoardBounds, type BoardPoint } from './layout';
import type { BoardObject } from './types';

export interface SnapReference extends BoardBounds { id: string }
export interface SmartGuide { axis: 'x' | 'y'; coordinate: number; start: number; end: number; referenceId: string }
export interface BoardSnapGesture {
  originals: SnapReference[];
  bounds: BoardBounds;
  references: SnapReference[];
  /** Board coordinates captured once at drag start. */
  pointerStart: BoardPoint;
  /** Latest screen coordinates, reconverted with the current viewport (including auto-pan). */
  pointer: BoardPoint;
  shift: boolean;
  cancelled: boolean;
}
const imageCard = (object: BoardObject) => object.type === 'asset' && object.mediaType === 'image';
const geometry = ({ id, x, y, width, height }: BoardObject): SnapReference => ({ id, x, y, width, height });

export function createBoardSnapGesture(objects: BoardObject[], ids: string[], sourceId: string, pointer: BoardPoint, shift: boolean): BoardSnapGesture | null {
  const moving = new Set(ids);
  const selected = objects.filter(object => moving.has(object.id));
  if (!selected.length || !selected.some(object => object.id === sourceId) || !selected.every(imageCard)) return null;
  const originals = selected.map(geometry);
  return {
    originals, bounds: getBoardBounds(originals), pointerStart: pointer, pointer, shift, cancelled: false,
    references: objects.filter(object => !moving.has(object.id) && (imageCard(object) || object.type === 'frame' || object.type === 'smart-frame')).map(geometry),
  };
}
interface Candidate { correction: number; distance: number; reference: SnapReference; coordinate: number; order: number }
const intervalGap = (a: number, sizeA: number, b: number, sizeB: number) => Math.max(0, a - b - sizeB, b - a - sizeA);
const compare = (a: Candidate, b: Candidate) => Math.abs(a.correction) - Math.abs(b.correction)
  || a.distance - b.distance || (a.reference.id < b.reference.id ? -1 : a.reference.id > b.reference.id ? 1 : 0) || a.order - b.order;

/** Always accepts FREE geometry, never a previously snapped rectangle. */
export function snapBoardBounds(free: BoardBounds, references: SnapReference[], zoom: number, objects: boolean, grid: boolean) {
  const threshold = 6 / Math.max(0.1, zoom);
  const winners: Partial<Record<'x' | 'y', Candidate>> = {};
  if (objects) for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? 'width' : 'height';
    const perpendicular = axis === 'x' ? 'y' : 'x';
    const perpendicularSize = axis === 'x' ? 'height' : 'width';
    for (const reference of references) {
      const distance = intervalGap(free[perpendicular], free[perpendicularSize], reference[perpendicular], reference[perpendicularSize]);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        const coordinate = reference[axis] + reference[size] * b / 2;
        const correction = coordinate - (free[axis] + free[size] * a / 2);
        if (Math.abs(correction) > threshold) continue;
        const candidate = { correction, distance, reference, coordinate, order: a * 3 + b };
        if (!winners[axis] || compare(candidate, winners[axis]) < 0) winners[axis] = candidate;
      }
    }
  }
  const correction = {
    x: winners.x?.correction ?? (grid ? Math.round(free.x / BOARD_GRID_GAP) * BOARD_GRID_GAP - free.x : 0),
    y: winners.y?.correction ?? (grid ? Math.round(free.y / BOARD_GRID_GAP) * BOARD_GRID_GAP - free.y : 0),
  };
  const snapped = { ...free, x: free.x + correction.x, y: free.y + correction.y };
  const guides: SmartGuide[] = [];
  for (const axis of ['x', 'y'] as const) {
    const winner = winners[axis];
    if (!winner) continue;
    const perpendicular = axis === 'x' ? 'y' : 'x';
    const size = axis === 'x' ? 'height' : 'width';
    const margin = 8 / Math.max(0.1, zoom);
    guides.push({ axis, coordinate: winner.coordinate, referenceId: winner.reference.id,
      start: Math.min(snapped[perpendicular], winner.reference[perpendicular]) - margin,
      end: Math.max(snapped[perpendicular] + snapped[size], winner.reference[perpendicular] + winner.reference[size]) + margin });
  }
  return { correction, guides };
}
export function resolveBoardSnapGesture(gesture: BoardSnapGesture, pointer: BoardPoint, zoom: number, objects: boolean, grid: boolean) {
  const delta = { x: pointer.x - gesture.pointerStart.x, y: pointer.y - gesture.pointerStart.y };
  const free = { ...gesture.bounds, x: gesture.bounds.x + delta.x, y: gesture.bounds.y + delta.y };
  const result = snapBoardBounds(free, gesture.references, zoom, objects !== gesture.shift, grid);
  return { guides: result.guides, updates: gesture.originals.map(object => ({ id: object.id,
    x: object.x + delta.x + result.correction.x, y: object.y + delta.y + result.correction.y })) };
}
