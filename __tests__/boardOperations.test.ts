import { describe, expect, it } from 'vitest';
import { addAssets, addConnection, drawBoardObject, createFrame, duplicateObjects, removeObjects, setObjectFrame, updateObjects, arrangeObjectsInGrid } from '../services/boards/operations';
import { createBoardDocument } from '../services/boards/document.mjs';
import { getBoardBounds, findContainingFrame, toBoardAbsolute, toFrameRelative } from '../services/boards/layout';
import { boardLocator, boardWithTexts } from './helpers/boardFixtures';

describe('board composition operations', () => {
  it('draws exact bounds and groups enclosed objects without moving them', () => {
    const original = boardWithTexts();
    const bounds = { x: -40, y: -40, width: 400, height: 250 };
    const result = drawBoardObject(original, 'frame', bounds);
    const frame = result.objects.find(object => object.type === 'frame')!;
    expect(frame).toMatchObject(bounds);
    expect(result.objects.find(object => object.id === original.objects[0].id)).toMatchObject({ x: 0, y: 0, frameId: frame.id });
    const textBounds = { x: 20, y: 30, width: 160, height: 90 };
    const withText = drawBoardObject(result, 'text', textBounds);
    expect(withText.objects.at(-1)).toMatchObject({ ...textBounds, frameId: frame.id });
    expect(withText.objects.slice(0, -1)).toEqual(result.objects);
  });

  it('preserves unrelated memberships when drawing a frame after resizing another frame', () => {
    const original = boardWithTexts();
    const framed = createFrame(original, [original.objects[0].id]);
    const frame = framed.objects[0];
    const resized = updateObjects(framed, [{ id: frame.id, width: 1, height: 1 }]);
    const child = resized.objects.find(object => object.id === original.objects[0].id)!;
    expect(findContainingFrame(child, resized.objects)).toBeNull();
    expect(child.frameId).toBe(frame.id);

    const drawn = drawBoardObject(resized, 'frame', { x: 2000, y: 2000, width: 400, height: 300 });
    for (const object of resized.objects) {
      expect(drawn.objects.find(item => item.id === object.id)).toEqual(object);
    }
    const moved = updateObjects(drawn, [{ id: frame.id, x: frame.x + 100, y: frame.y + 50 }]);
    expect(moved.objects.find(object => object.id === child.id)).toMatchObject({
      frameId: frame.id, x: child.x + 100, y: child.y + 50,
    });
  });

  it('adopts enclosed objects into the newly drawn frame even when another frame overlaps', () => {
    const original = boardWithTexts();
    const framed = createFrame(original, [original.objects[0].id]);
    const drawn = drawBoardObject(framed, 'frame', { x: -40, y: -40, width: 400, height: 250 });
    const newFrame = drawn.objects.find(object => !framed.objects.some(item => item.id === object.id))!;
    expect(drawn.objects.find(object => object.id === original.objects[0].id)?.frameId).toBe(newFrame.id);
  });

  it('inherits frame displacement per coordinate while applying member property changes', () => {
    const original = boardWithTexts();
    const board = createFrame(original, [original.objects[0].id]);
    const frame = board.objects[0];
    const child = board.objects[1];
    const updated = updateObjects(board, [{ id: frame.id, x: frame.x + 100, y: frame.y + 50 }, { id: child.id, text: 'changed', width: 500 }]);
    expect(updated.objects[1]).toMatchObject({ x: child.x + 100, y: child.y + 50, text: 'changed', width: 500 });
    const explicitX = updateObjects(board, [{ id: frame.id, x: frame.x + 100, y: frame.y + 50 }, { id: child.id, x: 999 }]);
    expect(explicitX.objects[1]).toMatchObject({ x: 999, y: child.y + 50 });
  });
  it('adds a batch in stable order without overlap, respecting the anchor', () => {
    const assets = Array.from({ length: 6 }, (_, index) => ({ name: `${index}.png`, reference: { kind: 'path' as const, locator: boardLocator(`${index}.png`) }, mediaType: 'image' as const, width: 512, height: index % 2 ? 1024 : 512 }));
    const board = addAssets(createBoardDocument(), assets, { x: -100, y: 200 });
    expect(board.objects.map(object => object.type === 'asset' && object.name)).toEqual(assets.map(asset => asset.name));
    expect(board.objects[0]).toMatchObject({ x: -100, y: 200, width: 280 });
    expect(board.objects[3].y).toBeGreaterThan(board.objects[1].y + board.objects[1].height);
    expect(new Set(board.objects.map(object => object.id)).size).toBe(6);
  });
  it('moves frame members once, preserves positions on frame removal, and deletes incident edges', () => {
    const initial = boardWithTexts();
    const framed = createFrame(initial, initial.objects.map(object => object.id));
    const frame = framed.objects[0];
    const connected = addConnection(framed, { sourceObjectId: initial.objects[0].id, targetObjectId: initial.objects[1].id, sourceSide: 'right', targetSide: 'left', label: 'test', color: '#ffffff' });
    const moved = updateObjects(connected, [{ id: frame.id, x: frame.x + 100, y: frame.y + 50 }]);
    expect(moved.objects.find(object => object.id === initial.objects[0].id)).toMatchObject({ x: 100, y: 50 });
    const resized = updateObjects(moved, [{ id: frame.id, width: 900, height: 800 }]);
    expect(resized.objects[1]).toEqual(moved.objects[1]);
    const unframed = removeObjects(resized, [frame.id]);
    expect(unframed.objects[0]).toMatchObject({ x: 100, y: 50, frameId: null });
    expect(unframed.connections).toHaveLength(1);
    expect(removeObjects(unframed, [initial.objects[0].id]).connections).toHaveLength(0);
    expect(initial.objects[0]).toMatchObject({ x: 0, y: 0, frameId: null });
  });
  it('duplicates an entire frame with internal edges and excludes outgoing edges', () => {
    const original = boardWithTexts();
    const framed = createFrame(original, [original.objects[0].id]);
    const board = addConnection(framed, { sourceObjectId: original.objects[0].id, targetObjectId: original.objects[1].id, sourceSide: 'right', targetSide: 'left', label: '', color: '#ffffff' });
    const copy = duplicateObjects(board, [framed.objects[0].id]);
    expect(copy.objects).toHaveLength(5);
    expect(copy.connections).toHaveLength(1);
    const copiedFrame = copy.objects[3];
    expect(copy.objects[4]).toMatchObject({ frameId: copiedFrame.id, x: copiedFrame.x + 24, y: copiedFrame.y + 48 });
    expect(copiedFrame.x >= framed.objects[0].x + framed.objects[0].width + 24 || copiedFrame.y + copiedFrame.height + 24 <= framed.objects[0].y).toBe(true);
    const all = duplicateObjects(board, board.objects.map(object => object.id));
    expect(all.connections).toHaveLength(2);
    expect(all.connections[1].sourceObjectId).not.toBe(board.connections[0].sourceObjectId);
  });
  it('selects the top overlapping frame and converts coordinates reversibly', () => {
    const board = boardWithTexts();
    const first = createFrame(board, [board.objects[0].id]);
    const second = createFrame(first, [board.objects[0].id]);
    const frames = second.objects.filter(object => object.type === 'frame');
    expect(findContainingFrame(board.objects[0], second.objects)?.id).toBe(frames.sort((a, b) => b.zIndex - a.zIndex)[0].id);
    expect(toBoardAbsolute(toFrameRelative(board.objects[0], frames[0]), frames[0])).toEqual({ x: 0, y: 0 });
    expect(() => setObjectFrame(second, frames[0].id, frames[1].id)).toThrow();
  });
  it('arranges selected frames without moving their selected children twice', () => {
    const original = boardWithTexts();
    const board = createFrame(original, [original.objects[0].id]);
    const result = arrangeObjectsInGrid(board, board.objects.map(object => object.id));
    const frame = result.objects.find(object => object.type === 'frame')!;
    const child = result.objects.find(object => object.frameId === frame.id)!;
    expect(toFrameRelative(child, frame)).toEqual(toFrameRelative(board.objects[1], board.objects[0]));
    expect(getBoardBounds(result.objects).width).toBeGreaterThan(0);
  });
});
