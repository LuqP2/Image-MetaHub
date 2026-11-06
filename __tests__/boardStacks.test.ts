import { describe, expect, it } from 'vitest';
import { createBoardDocument, normalizeBoardDocument, applyBoardReferenceRemaps } from '../services/boards/document.mjs';
import { addAssets, createFrame, updateObjects, duplicateObjects, removeObjects, addConnection, drawBoardObject } from '../services/boards/operations';
import { createStack, unstack, setStackCover, extractStackMember } from '../services/boards/stackOperations';
import { copyBoardFragment, parseBoardFragment, pasteBoardFragment } from '../services/boards/clipboard';
import { boardToFlow } from '../services/boards/reactFlowAdapter';
import { getBoardBounds } from '../services/boards/layout';
import { pngExportDocument } from '../services/boards/pngExport';
import { importBoard, exportBoard } from '../services/boards/importExport';
import { boardLocator, boardRemap } from './helpers/boardFixtures';
import type { BoardStackObject } from '../services/boards/types';

const fixture = () => {
  const document = addAssets(createBoardDocument(), ['a.png', 'b.png', 'c.png'].map(name => ({ name, mediaType: 'image' as const, reference: { kind: 'path' as const, locator: boardLocator(name) } })), { x: 0, y: 0 });
  const ids = document.objects.slice(0, 2).map(object => object.id);
  const stacked = createStack(document, ids);
  return { document, ids, stacked, stack: stacked.objects.find(object => object.type === 'stack')! as BoardStackObject };
};
describe('Canvas stacks', () => {
  it('moves existing members out of a ten-card stack without ever multiplying cards', () => {
    const base = addAssets(createBoardDocument(), Array.from({ length: 10 }, (_, i) => ({ name: `${i}.png`, mediaType: 'image' as const, reference: { kind: 'path' as const, locator: boardLocator(`${i}.png`) } })), { x: 0, y: 0 });
    const ids = base.objects.map(object => object.id);
    let document = createStack(base, ids);
    const stackId = document.objects.find(object => object.type === 'stack')!.id;
    for (let i = 0; i < 9; i++) {
      document = extractStackMember(document, stackId, ids[i], { x: 2000 + i * 300, y: 100 });
      expect(document.objects.filter(object => object.type === 'asset').map(object => object.id)).toEqual(ids);
      const stack = document.objects.find(object => object.id === stackId) as BoardStackObject | undefined;
      if (i < 8) { expect(stack?.memberIds).toHaveLength(9 - i); expect(stack?.memberIds).not.toContain(ids[i]); }
      else expect(stack).toBeUndefined();
      expect(extractStackMember(document, stackId, ids[i], { x: 999, y: 999 })).toBe(document);
    }
  });
  it.each([1, 2, 3])('migrates schema %s and round-trips stacks in v4', version => {
    const { document, stacked } = fixture();
    expect(normalizeBoardDocument({ ...document, schemaVersion: version })).toEqual(document);
    expect(importBoard(exportBoard(stacked)).objects).toEqual(stacked.objects);
    expect(JSON.parse(exportBoard(stacked)).version).toBe(4);
  });
  it('validates missing, shared, nested, cross-frame members and covers', () => {
    const { stacked, stack, ids } = fixture();
    const patch = (extra: Partial<BoardStackObject>) => ({ ...stacked, objects: stacked.objects.map(object => object.id === stack.id ? { ...object, ...extra } : object) });
    expect(() => normalizeBoardDocument(patch({ memberIds: [ids[0], 'missing'] }))).toThrow();
    expect(() => normalizeBoardDocument(patch({ coverId: 'missing' }))).toThrow();
    expect(() => createStack(stacked, ids)).toThrow();
    expect(() => normalizeBoardDocument({ ...stacked, objects: [...stacked.objects, { ...stack, id: 'other' }] })).toThrow();
    expect(() => normalizeBoardDocument(patch({ memberIds: [ids[0], stack.id] }))).toThrow();
  });
  it('moves and scales hidden composition, then restores it with Unstack', () => {
    const { stacked, stack, ids } = fixture();
    const next = updateObjects(stacked, [{ id: stack.id, x: stack.x + 100, y: stack.y + 50, width: stack.width * 2, height: stack.height * 2 }]);
    for (const id of ids) {
      const before = stacked.objects.find(object => object.id === id)!;
      const after = next.objects.find(object => object.id === id)!;
      expect(after.x).toBe(stack.x + 100 + (before.x - stack.x) * 2);
      expect(after.height).toBe(before.height * 2);
    }
    expect(unstack(next, stack.id).objects).toEqual(next.objects.filter(object => object.id !== stack.id));
  });
  it('moves members once when their parent frame moves and keeps membership when reframing', () => {
    const { stacked, stack, ids } = fixture();
    const framed = createFrame(stacked, [stack.id]);
    const frame = framed.objects.find(object => object.type === 'frame')!;
    expect(framed.objects.filter(object => ids.includes(object.id)).every(object => object.frameId === frame.id)).toBe(true);
    const moved = updateObjects(framed, [{ id: frame.id, x: frame.x + 100 }]);
    expect(moved.objects.find(object => object.id === ids[1])!.x).toBe(framed.objects.find(object => object.id === ids[1])!.x + 100);
    expect(() => drawBoardObject(stacked, 'frame', { x: -10, y: -10, width: 300, height: 500 })).not.toThrow();
  });
  it('copies, duplicates and exports all members with remapped stack IDs', () => {
    const { stacked, stack, ids } = fixture();
    const fragment = parseBoardFragment(copyBoardFragment(stacked, [stack.id]))!;
    expect(fragment.objects).toHaveLength(3);
    const pasted = pasteBoardFragment(createBoardDocument(), fragment, { x: 100, y: 100 }).document;
    const copy = pasted.objects.find(object => object.type === 'stack')! as BoardStackObject;
    expect(copy.memberIds.every(id => !ids.includes(id) && pasted.objects.some(object => object.id === id))).toBe(true);
    expect(copy.memberIds).toContain(copy.coverId);
    expect(duplicateObjects(stacked, [stack.id]).objects).toHaveLength(7);
    expect(pngExportDocument(stacked, [stack.id]).objects).toHaveLength(3);
    expect(getBoardBounds(fragment.objects)).toMatchObject({ width: stack.width, height: stack.height });
  });
  it('proxies external connections without changing endpoints and hides internal connections', () => {
    const { stacked, stack, ids } = fixture();
    const external = stacked.objects.find(object => object.type === 'asset' && !ids.includes(object.id))!;
    let next = addConnection(stacked, { sourceObjectId: ids[0], targetObjectId: external.id, sourceSide: 'right', targetSide: 'left', label: '', color: '#ffffff' });
    next = addConnection(next, { sourceObjectId: ids[0], targetObjectId: ids[1], sourceSide: 'right', targetSide: 'left', label: '', color: '#ffffff' });
    const flow = boardToFlow(next, [], [], true);
    expect(flow.nodes).toHaveLength(2);
    expect(flow.edges).toHaveLength(1);
    expect(flow.edges[0].source).toBe(stack.id);
    expect(next.connections[0].sourceObjectId).toBe(ids[0]);
    expect(boardToFlow(unstack(next, stack.id), [], [], true).edges).toHaveLength(2);
  });
  it('deletes all members with the stack, dissolves small stacks and remaps hidden references', () => {
    const { stacked, stack, ids } = fixture();
    expect(removeObjects(stacked, [stack.id]).objects).toHaveLength(1);
    expect(removeObjects(stacked, [ids[0]]).objects.some(object => object.type === 'stack')).toBe(false);
    const changed = setStackCover(stacked, stack.id, ids[1]);
    expect((changed.objects.find(object => object.id === stack.id) as BoardStackObject).coverId).toBe(ids[1]);
    const remapped = applyBoardReferenceRemaps(stacked, [boardRemap('a.png', 'new.png')]);
    const member = remapped.objects.find(object => object.id === ids[0]);
    expect(member?.type === 'asset' && member.reference.locator.relativePath).toBe('new.png');
  });
});
