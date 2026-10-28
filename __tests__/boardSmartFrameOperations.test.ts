import { addText, drawBoardObject } from '../services/boards/operations';
import { describe, expect, it } from 'vitest';
import { createBoardDocument } from '../services/boards/document.mjs';
import { createSmartFrame, branchSmartFrame, duplicateSmartFrameQuery, intersectSmartFrames, subtractSmartFrames, replaceSmartFrameWithSnapshot, reconnectSmartFrameSource } from '../services/boards/smartFrameOperations';
import { removeObjects, duplicateObjects, createFrame } from '../services/boards/operations';
import type { BoardSmartFrameObject } from '../services/boards/queryTypes';

describe('Smart Frame pure operations', () => {
  it('branches with empty local criteria and duplicates without frame dependencies', () => {
    let document = createSmartFrame(createBoardDocument(), { id: 'parent' });
    document = branchSmartFrame(document, 'parent', [{ kind: 'exact', dimension: 'lora', value: 'cinematic' }]);
    const child = document.objects[1] as BoardSmartFrameObject;
    expect(child.source).toEqual({ kind: 'frame', frameId: 'parent' });
    expect(child.criteria.selectedModels).toEqual([]);
    const copied = duplicateObjects(document, [child.id]);
    expect(JSON.stringify((copied.objects[2] as BoardSmartFrameObject).source)).not.toContain('frameId');
    const independent = duplicateSmartFrameQuery(document, child.id);
    expect((independent.objects[2] as BoardSmartFrameObject).source.kind).toBe('query');
    expect(removeObjects(independent, ['parent']).objects).toHaveLength(2);
  });
  it('builds directional differences and intersections, and rejects cycles on reconnect', () => {
    const document = createSmartFrame(createSmartFrame(createBoardDocument(), { id: 'a' }), { id: 'b' });
    expect((intersectSmartFrames(document, ['a', 'b', 'a']).objects[2] as BoardSmartFrameObject).source).toEqual({ kind: 'intersection', inputs: [{ kind: 'frame', frameId: 'a' }, { kind: 'frame', frameId: 'b' }] });
    const difference = subtractSmartFrames(document, 'a', 'b');
    expect((difference.objects[2] as BoardSmartFrameObject).source).toEqual({ kind: 'difference', left: { kind: 'frame', frameId: 'a' }, right: { kind: 'frame', frameId: 'b' } });
    expect(() => reconnectSmartFrameSource(difference, 'a', { kind: 'frame', frameId: difference.objects[2].id })).toThrow();
    expect(() => intersectSmartFrames(document, ['a', 'a'])).toThrow();
  });
  it('freezes membership, clears local constraints and keeps layout and ordering', () => {
    let document = createSmartFrame(createBoardDocument(), { id: 'a', layout: { kind: 'matrix', rows: 'model', columns: 'lora' }, groupConstraints: [{ kind: 'missing', dimension: 'lora' }] });
    document = replaceSmartFrameWithSnapshot(document, 'a', []);
    const frame = document.objects[0] as BoardSmartFrameObject;
    expect(frame.source).toEqual({ kind: 'snapshot', references: [] });
    expect(frame.groupConstraints).toEqual([]);
    expect(frame.layout.kind).toBe('matrix');
    expect(createFrame(document, ['a']).objects.find(object => object.id === 'a')?.frameId).toBeNull();
  });
});

it('does not adopt a Smart Frame when drawing a manual frame around it', () => {
  const document = createSmartFrame(addText(createBoardDocument(), { x: 200, y: 200 }), { id: 'smart', x: 100, y: 100 });
  const next = drawBoardObject(document, 'frame', { x: 0, y: 0, width: 1000, height: 1000 });
  const manual = next.objects.find(object => object.type === 'frame')!;
  expect(next.objects.find(object => object.id === 'smart')?.frameId).toBeNull();
  expect(next.objects.find(object => object.type === 'text')?.frameId).toBe(manual.id);
});

it('duplicates branches with deleted parents through both duplication commands', () => {
  let document = createSmartFrame(createBoardDocument(), { id: 'parent' });
  document = branchSmartFrame(document, 'parent');
  const childId = document.objects[1].id;
  document = removeObjects(document, ['parent']);
  for (const copy of [duplicateSmartFrameQuery(document, childId), duplicateObjects(document, [childId])]) {
    expect(copy.objects).toHaveLength(2);
    expect((copy.objects[1] as BoardSmartFrameObject).source).toEqual({ kind: 'frame', frameId: 'parent' });
    expect((copy.objects[1] as BoardSmartFrameObject).criteria).toEqual((document.objects[0] as BoardSmartFrameObject).criteria);
  }
});

it('detaches available ancestors while preserving missing nested dependencies', () => {
  let document = createSmartFrame(createBoardDocument(), { id: 'root' });
  document = branchSmartFrame(document, 'root');
  const parentId = document.objects[1].id;
  document = branchSmartFrame(document, parentId);
  const childId = document.objects[2].id;
  document = removeObjects(document, ['root']);
  const copy = duplicateSmartFrameQuery(document, childId);
  const source = (copy.objects[2] as BoardSmartFrameObject).source;
  expect(source.kind).toBe('query');
  if (source.kind === 'query') expect(source.source).toEqual({ kind: 'frame', frameId: 'root' });
});
