import { describe, expect, it } from 'vitest';
import { connectionPathIntersectsRect, segmentIntersectsBoardRect } from '../services/boards/connectionSelection';

describe('connection marquee geometry', () => {
  it('selects a crossing segment without requiring either endpoint inside', () => {
    expect(segmentIntersectsBoardRect({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 45, y: 45, width: 10, height: 10 })).toBe(true);
    expect(segmentIntersectsBoardRect({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 10, y: 80, width: 10, height: 10 })).toBe(false);
  });
  it('uses the displayed curve and its screen transform, not only its bounding rectangle', () => {
    const path = {
      getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 }),
      getTotalLength: () => 100,
      getPointAtLength: (t: number) => ({ x: t, y: 25 * Math.sin(t / 100 * Math.PI) }),
    } as unknown as SVGPathElement;
    expect(connectionPathIntersectsRect(path, { x: 195, y: 95, width: 10, height: 10 })).toBe(true);
    expect(connectionPathIntersectsRect(path, { x: 195, y: 50, width: 10, height: 10 })).toBe(false);
  });
});
