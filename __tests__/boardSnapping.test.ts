import { normalizeLibraryQueryCriteria } from '../services/libraryQuery/criteria';
import { describe, expect, it } from 'vitest';
import { createBoardSnapGesture, resolveBoardSnapGesture, snapBoardBounds, type SnapReference } from '../services/boards/snapping';
import type { BoardAssetObject, BoardObject } from '../services/boards/types';

const card = (id: string, x = 0, y = 0): BoardAssetObject => ({ id, type: 'asset', mediaType: 'image', x, y, width: 100, height: 100, frameId: null, zIndex: 1, name: id, visibleFields: [], reference: { kind: 'path', locator: { imageId: id, directoryPath: null, relativePath: `${id}.png` } } });
const rect = (id: string, x: number, y: number, width = 100, height = 100): SnapReference => ({ id, x, y, width, height });

describe('Canvas snapping geometry', () => {
  it('aligns centers and opposite edges in both axes', () => {
    const result = snapBoardBounds(rect('moving', 104, 104), [rect('target', 200, 200)], 1, true, false);
    expect(result.correction).toEqual({ x: -4, y: -4 });
    expect(result.guides).toHaveLength(2);
    expect(snapBoardBounds(rect('moving', 174, 500, 50, 50), [rect('target', 200, 0)], 1, true, false).correction.x).toBe(1);
  });
  it.each([0.25, 1, 4])('keeps the attraction threshold at six screen pixels at zoom %s', zoom => {
    const target = rect('target', 1000, 2000);
    expect(snapBoardBounds(rect('moving', 1000 + 6 / zoom, 0), [target], zoom, true, false).correction.x).toBeCloseTo(-6 / zoom);
    expect(snapBoardBounds(rect('moving', 1000 + 6.1 / zoom, 0), [target], zoom, true, false).correction.x).toBe(0);
  });
  it('prefers spatially near references, then stable IDs regardless of input order', () => {
    const free = rect('moving', 104, 400);
    const targets = [rect('a-far', 100, -1000), rect('z-near', 100, 420), rect('b-near', 100, 420)];
    for (const references of [targets, [...targets].reverse()]) {
      expect(snapBoardBounds(free, references, 1, true, false).guides.find(g => g.axis === 'x')?.referenceId).toBe('b-near');
    }
  });
  it('prioritizes minimal correction before perpendicular distance', () => {
    const result = snapBoardBounds(rect('moving', 104, 400), [rect('near', 100, 400), rect('far', 103, -1000)], 1, true, false);
    expect(result.guides.find(g => g.axis === 'x')?.referenceId).toBe('far');
  });
  it('anchors grid to the top-left and board origin, including negative positions', () => {
    expect(snapBoardBounds(rect('moving', -35, 37), [], 1, false, true)).toEqual({ correction: { x: 11, y: 11 }, guides: [] });
    expect(snapBoardBounds(rect('moving', -35, 37), [], 1, false, false).correction).toEqual({ x: 0, y: 0 });
  });
  it('uses objects before grid independently in each axis', () => {
    const result = snapBoardBounds(rect('moving', 101, 37), [rect('target', 100, 500)], 1, true, true);
    expect(result.correction).toEqual({ x: -1, y: 11 });
    expect(result.guides.map(g => g.axis)).toEqual(['x']);
  });
  it('moves image selections as a rigid block using free pointer displacement', () => {
    const objects = [card('a', 1, 5), card('b', 151, 45), card('target', 200, 500)];
    const gesture = createBoardSnapGesture(objects, ['a', 'b'], 'a', { x: 10, y: 10 }, false)!;
    expect(gesture.references.map(r => r.id)).toEqual(['target']);
    const result = resolveBoardSnapGesture(gesture, { x: 28, y: 19 }, 1, false, true);
    expect(result.updates).toEqual([{ id: 'a', x: 24, y: 24 }, { id: 'b', x: 174, y: 64 }]);
    expect(gesture.originals[0].x).toBe(1);
  });
  it('prepares only image cards and frames as references and rejects mixed selections', () => {
    const frame: BoardObject = { ...card('frame'), type: 'frame', frameId: null, title: 'Frame', color: '#ffffff' };
    const text: BoardObject = { ...card('text'), type: 'text', text: 'Text', fontSize: 24, color: '#ffffff' };
    const video = { ...card('video'), mediaType: 'video' as const };
    const smart: BoardObject = { ...frame, id: 'smart', type: 'smart-frame', source: { kind: 'library' }, criteria: normalizeLibraryQueryCriteria(), groupConstraints: [], layout: { kind: 'grid' } };
    const objects = [card('a'), frame, smart, text, video];
    expect(createBoardSnapGesture(objects, ['a'], 'a', { x: 0, y: 0 }, false)?.references.map(r => r.id)).toEqual(['frame', 'smart']);
    for (const id of ['frame', 'smart', 'text', 'video']) {
      expect(createBoardSnapGesture(objects, ['a', id], 'a', { x: 0, y: 0 }, false)).toBeNull();
      expect(createBoardSnapGesture(objects, [id], id, { x: 0, y: 0 }, false)).toBeNull();
    }
  });
  it('measures repeated snapping against 10k prepared rectangles', () => {
    const references = Array.from({ length: 10000 }, (_, index) => rect(`${index}`, index % 100 * 200, Math.floor(index / 100) * 200));
    const samples: number[] = [];
    for (let sample = 0; sample < 3; sample++) {
      const start = performance.now();
      for (let move = 0; move < 30; move++) snapBoardBounds(rect('moving', 200 + move, 300 + move), references, 1, true, false);
      samples.push((performance.now() - start) / 30);
    }
    console.info(`Smart Guides, 10k references, ms/move (3 samples): ${samples.map(n => n.toFixed(2)).join(', ')}`);
    expect(references).toHaveLength(10000);
  });
});
