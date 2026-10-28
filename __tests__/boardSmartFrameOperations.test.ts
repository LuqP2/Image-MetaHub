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
