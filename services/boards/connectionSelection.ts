import type { BoardBounds, BoardPoint } from './layout';

/** Slab clipping also detects crossings whose two endpoints are outside the box. */
export function segmentIntersectsBoardRect(a: BoardPoint, b: BoardPoint, rect: BoardBounds): boolean {
  let start = 0, end = 1;
  for (const axis of ['x', 'y'] as const) {
    const delta = b[axis] - a[axis];
    const low = rect[axis], high = low + (axis === 'x' ? rect.width : rect.height);
    if (delta === 0) { if (a[axis] < low || a[axis] > high) return false; }
    else { const t1 = (low - a[axis]) / delta, t2 = (high - a[axis]) / delta; start = Math.max(start, Math.min(t1, t2)); end = Math.min(end, Math.max(t1, t2)); if (start > end) return false; }
  }
  return true;
}

/** Test the rendered curve, including pan/zoom, rather than its large bounding box. */
export function connectionPathIntersectsRect(path: SVGPathElement, rect: BoardBounds): boolean {
  const matrix = path.getScreenCTM();
  if (!matrix) return false;
  const length = path.getTotalLength();
  const scale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
  const count = Math.max(1, Math.min(4096, Math.ceil(length * scale / 4)));
  const point = (distance: number) => { const p = path.getPointAtLength(distance); return { x: matrix.a * p.x + matrix.c * p.y + matrix.e, y: matrix.b * p.x + matrix.d * p.y + matrix.f }; };
  let previous = point(0);
  for (let i = 1; i <= count; i++) { const next = point(length * i / count); if (segmentIntersectsBoardRect(previous, next, rect)) return true; previous = next; }
  return false;
}
