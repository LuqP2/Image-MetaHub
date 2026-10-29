import { describe, expect, it } from 'vitest';
import { findFreeBoardPosition } from '../services/boards/layout';
import { revealBoardBounds } from '../services/boards/viewport';

describe('Canvas automatic geometry', () => {
  const area = { x: 32, y: 32, width: 900, height: 600 };
  it('preserves visible content and never amplifies an insertion', () => {
    const viewport = { x: 0, y: 0, zoom: 0.7 };
    expect(revealBoardBounds(viewport, { x: 100, y: 100, width: 200, height: 200 }, area)).toEqual(viewport);
    const revealed = revealBoardBounds(viewport, { x: -900, y: 1800, width: 280, height: 420 }, area);
    expect(revealed.zoom).toBe(0.7);
    expect(-900 * revealed.zoom + revealed.x).toBeGreaterThanOrEqual(32);
    expect(2220 * revealed.zoom + revealed.y).toBeLessThanOrEqual(632);
  });
  it('only reduces zoom to show both origin and branch', () => {
    const bounds = { x: -120, y: -80, width: 1800, height: 420 };
    const revealed = revealBoardBounds({ x: 0, y: 0, zoom: 1.5 }, bounds, area, true);
    expect(revealed.zoom).toBe(0.5);
    expect(bounds.x * revealed.zoom + revealed.x).toBe(32);
  });
  it('searches deterministic rings and leaves a full collision margin', () => {
    const objects = [{ x: -200, y: -200, width: 600, height: 600 }];
    const size = { width: 280, height: 452 };
    const first = findFreeBoardPosition(objects, size, { x: -50, y: -50 });
    expect(findFreeBoardPosition(objects, size, { x: -50, y: -50 })).toEqual(first);
    expect(first.x + size.width + 24 <= -200 || first.x >= 424 || first.y + size.height + 24 <= -200 || first.y >= 424).toBe(true);
    const second = findFreeBoardPosition([...objects, { ...first, ...size }], size, { x: -50, y: -50 });
    expect(second).not.toEqual(first);
  });
});
