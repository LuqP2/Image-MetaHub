import { findFreeBoardPosition } from './layout';
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

/** Preflight expanded size/depth before cloning; share one document budget across a duplication batch. */
export function createFrameDetacher(document: BoardDocument) {
  const byId = new Map(document.objects.map(object => [object.id, object]));
  const frameSizes = new Map<string, { nodes: number; height: number }>();
  const active = new Set<string>();
  let remaining = 10000;
  for (const object of document.objects) if (object.type === 'smart-frame') {
    mapSetExpression(object.source, source => { remaining--; return source; });
  }
  const measure = (source: BoardSetExpression, depth: number): { nodes: number; height: number } => {
    if (depth > 64) throw new Error('Frame dependency depth exceeded.');
    let children: BoardSetExpression[] = [];
    if (source.kind === 'frame') {
      const frame = byId.get(source.frameId);
      if (!frame) return { nodes: 1, height: 0 };
      if (frame.type !== 'smart-frame') throw new Error('Query source must point to a Smart Frame.');
      const cached = frameSizes.get(frame.id);
      if (cached) {
        if (depth + 1 + cached.height > 64) throw new Error('Frame dependency depth exceeded.');
        return { nodes: 1 + cached.nodes, height: 1 + cached.height };
      }
      if (active.has(frame.id)) throw new Error('Cyclic frame dependency.');
      active.add(frame.id);
      const size = measure(frame.source, depth + 1);
      active.delete(frame.id);
      frameSizes.set(frame.id, size);
      return { nodes: 1 + size.nodes, height: 1 + size.height };
    }
    if (source.kind === 'query') children = [source.source];
    if (source.kind === 'intersection') children = source.inputs;
    if (source.kind === 'difference') children = [source.left, source.right];
    let nodes = 1, height = 0;
    for (const child of children) {
      const size = measure(child, depth + 1);
      nodes += size.nodes; height = Math.max(height, 1 + size.height);
      if (nodes > 10000) throw new Error('Query expression limit exceeded.');
    }
    return { nodes, height };
  };
  const build = (source: BoardSetExpression): BoardSetExpression => {
    switch (source.kind) {
      case 'frame': {
        const frame = byId.get(source.frameId);
        if (!frame) return { ...source };
        if (frame.type !== 'smart-frame') throw new Error('Query source must point to a Smart Frame.');
        return { kind: 'query', source: build(frame.source), criteria: structuredClone(frame.criteria), groupConstraints: structuredClone(frame.groupConstraints) };
      }
      case 'query': return { ...source, source: build(source.source), criteria: structuredClone(source.criteria), groupConstraints: structuredClone(source.groupConstraints) };
      case 'intersection': return { kind: 'intersection', inputs: source.inputs.map(build) };
      case 'difference': return { kind: 'difference', left: build(source.left), right: build(source.right) };
      default: return structuredClone(source);
    }
  };
  return (source: BoardSetExpression): BoardSetExpression => {
    const size = measure(source, 0);
    if (size.nodes > remaining) throw new Error('Query expression limit exceeded.');
    remaining -= size.nodes;
    return build(source);
  };
}

/** Freeze available frame dependencies while retaining missing, live library and collection sources. */
export function detachFrameSource(document: BoardDocument, source: BoardSetExpression): BoardSetExpression {
  return createFrameDetacher(document)(source);
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
function positionBeside(document: BoardDocument, parent: BoardSmartFrameObject, size = { width: 640, height: 420 }) {
  return findFreeBoardPosition(document.objects, size, { x: parent.x + parent.width + 64, y: parent.y });
}
export function branchSmartFrame(document: BoardDocument, id: string, constraints: BoardGroupConstraint[] = [], title?: string) {
  const parent = getFrame(document, id);
  return createSmartFrame(document, { ...positionBeside(document, parent), title: title?.trim() || `${parent.title} branch`,
    source: { kind: 'frame', frameId: id }, groupConstraints: constraints });
}
export const branchSmartFrameGroup = branchSmartFrame;
export function duplicateSmartFrameQuery(document: BoardDocument, id: string) {
  const parent = getFrame(document, id);
  const source = detachFrameSource(document, parent.source);
  return createSmartFrame(document, { ...parent, id: crypto.randomUUID(),
    ...positionBeside(document, parent, parent), title: `${parent.title} (copy)`, source });
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
