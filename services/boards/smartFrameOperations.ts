import type { BoardAssetReference, BoardDocument } from './types';
import type { BoardGroupConstraint, BoardSetExpression, BoardSmartFrameLayout, BoardSmartFrameObject } from './queryTypes';
import type { LibraryQueryCriteria } from '../libraryQuery/types';
import { normalizeLibraryQueryCriteria } from '../libraryQuery/criteria';
import { normalizeBoardDocument } from './document.mjs';
import { mapSetExpression } from './queryDocument.mjs';

function getFrame(document: BoardDocument, id: string): BoardSmartFrameObject {
  const frame = document.objects.find(object => object.id === id);
  if (frame?.type !== 'smart-frame') throw new Error('Smart Frame is unavailable.');
  return frame;
}
const changed = (document: BoardDocument, objects: BoardDocument['objects']) => normalizeBoardDocument({ ...document, objects, updatedAt: Date.now() });

/** Freeze frame dependencies as inline queries while retaining live library/collection sources. */
export function detachFrameSource(document: BoardDocument, source: BoardSetExpression, depth = 0): BoardSetExpression {
  if (depth > 64) throw new Error('Frame dependency depth exceeded.');
  return mapSetExpression(structuredClone(source), expression => {
    if (expression.kind !== 'frame') return expression;
    const frame = getFrame(document, expression.frameId);
    return { kind: 'query', source: detachFrameSource(document, frame.source, depth + 1),
      criteria: structuredClone(frame.criteria), groupConstraints: structuredClone(frame.groupConstraints) };
  });
}

export function createSmartFrame(document: BoardDocument, input: Partial<BoardSmartFrameObject> = {}): BoardDocument {
  const frame: BoardSmartFrameObject = { id: crypto.randomUUID(), type: 'smart-frame', frameId: null,
    x: 0, y: 0, width: 640, height: 420, zIndex: Math.max(0, ...document.objects.map(object => object.zIndex)) + 1,
    title: 'Smart Frame', color: '#6366f1', source: { kind: 'library' },
    criteria: normalizeLibraryQueryCriteria(), groupConstraints: [], layout: { kind: 'grid' }, ...input };
  return changed(document, [...document.objects, frame]);
}
function updateFrame(document: BoardDocument, id: string, patch: Partial<BoardSmartFrameObject>) {
  getFrame(document, id);
  return changed(document, document.objects.map(object => object.id === id ? { ...object, ...patch, id, type: 'smart-frame', frameId: null } as BoardSmartFrameObject : object));
}
export function updateSmartFrameQuery(document: BoardDocument, id: string, criteria: LibraryQueryCriteria) {
  return updateFrame(document, id, { criteria });
}
export function updateSmartFrameLayout(document: BoardDocument, id: string, layout: BoardSmartFrameLayout) {
  return updateFrame(document, id, { layout });
}
function positionBeside(document: BoardDocument, parent: BoardSmartFrameObject) {
  const x = parent.x + parent.width + 64;
  let y = parent.y;
  while (document.objects.some(object => x < object.x + object.width && x + 640 > object.x && y < object.y + object.height && y + 420 > object.y)) y += 484;
  return { x, y };
}
export function branchSmartFrame(document: BoardDocument, id: string, constraints: BoardGroupConstraint[] = []) {
  const parent = getFrame(document, id);
  return createSmartFrame(document, { ...positionBeside(document, parent), title: `${parent.title} branch`,
    source: { kind: 'frame', frameId: id }, groupConstraints: constraints });
}
export const branchSmartFrameGroup = branchSmartFrame;
export function duplicateSmartFrameQuery(document: BoardDocument, id: string) {
  const parent = getFrame(document, id);
  return createSmartFrame(document, { ...structuredClone(parent), id: crypto.randomUUID(),
    ...positionBeside(document, parent), title: `${parent.title} (copy)`, source: detachFrameSource(document, parent.source) });
}
export function intersectSmartFrames(document: BoardDocument, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length < 2) throw new Error('Select at least two Smart Frames.');
  unique.forEach(id => getFrame(document, id));
  return createSmartFrame(document, { ...positionBeside(document, getFrame(document, unique[0])), title: 'Intersection',
    source: { kind: 'intersection', inputs: unique.map(frameId => ({ kind: 'frame', frameId })) } });
}
export function subtractSmartFrames(document: BoardDocument, leftId: string, rightId: string) {
  if (leftId === rightId) throw new Error('Select two different Smart Frames.');
  const left = getFrame(document, leftId), right = getFrame(document, rightId);
  return createSmartFrame(document, { ...positionBeside(document, left), title: `${left.title} minus ${right.title}`,
    source: { kind: 'difference', left: { kind: 'frame', frameId: leftId }, right: { kind: 'frame', frameId: rightId } } });
}
export function replaceSmartFrameWithSnapshot(document: BoardDocument, id: string, references: BoardAssetReference[]) {
  const frame = getFrame(document, id);
  return updateFrame(document, id, { source: { kind: 'snapshot', references: structuredClone(references) },
    criteria: normalizeLibraryQueryCriteria({ sortOrder: frame.criteria.sortOrder, randomSeed: frame.criteria.randomSeed }), groupConstraints: [] });
}
export function reconnectSmartFrameSource(document: BoardDocument, id: string, source: BoardSetExpression) {
  return updateFrame(document, id, { source });
}
