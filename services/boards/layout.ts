import type { BoardObject, BoardFrameObject } from './types';

export interface BoardPoint { x: number; y: number }
export interface BoardBounds extends BoardPoint { width: number; height: number }
export const BOARD_GRID_GAP = 24;

export function getBoardBounds(objects: BoardBounds[]): BoardBounds {
  if (!objects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...objects.map(object => object.x));
  const y = Math.min(...objects.map(object => object.y));
  return { x, y, width: Math.max(...objects.map(object => object.x + object.width)) - x, height: Math.max(...objects.map(object => object.y + object.height)) - y };
}

export function gridPositions(sizes: Pick<BoardBounds, 'width' | 'height'>[], anchor: BoardPoint): BoardPoint[] {
  const columns = Math.ceil(Math.sqrt(sizes.length));
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(0, ...sizes.filter((_, index) => index % columns === column).map(size => size.width)));
  const rows = Math.ceil(sizes.length / (columns || 1));
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(0, ...sizes.slice(row * columns, (row + 1) * columns).map(size => size.height)));
  return sizes.map((_, index) => ({
    x: anchor.x + columnWidths.slice(0, index % columns).reduce((sum, width) => sum + width + BOARD_GRID_GAP, 0),
    y: anchor.y + rowHeights.slice(0, Math.floor(index / columns)).reduce((sum, height) => sum + height + BOARD_GRID_GAP, 0),
  }));
}

export function findContainingFrame(object: BoardObject, objects: BoardObject[]): BoardFrameObject | null {
  if (object.type === 'frame') return null;
  const x = object.x + object.width / 2;
  const y = object.y + object.height / 2;
  return objects.filter((candidate): candidate is BoardFrameObject => candidate.type === 'frame'
    && x >= candidate.x && x <= candidate.x + candidate.width && y >= candidate.y && y <= candidate.y + candidate.height)
    .sort((a, b) => b.zIndex - a.zIndex)[0] ?? null;
}

export const toFrameRelative = (point: BoardPoint, frame: BoardPoint): BoardPoint => ({ x: point.x - frame.x, y: point.y - frame.y });
export const toBoardAbsolute = (point: BoardPoint, frame: BoardPoint): BoardPoint => ({ x: point.x + frame.x, y: point.y + frame.y });
