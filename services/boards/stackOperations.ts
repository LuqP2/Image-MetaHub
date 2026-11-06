import type { BoardDocument, BoardStackObject } from './types';
import { normalizeBoardDocument } from './document.mjs';
import { stackableImages } from './stackMembership';
import { findContainingFrame, type BoardPoint } from './layout';

export function createStack(document: BoardDocument, ids: string[]): BoardDocument {
  if (!stackableImages(document, ids)) throw new Error('Select at least two images in the same frame, or two loose images.');
  const members = ids.map(id => document.objects.find(object => object.id === id)!);
  const cover = members[0];
  const stack: BoardStackObject = { id: crypto.randomUUID(), type: 'stack', memberIds: [...ids], coverId: cover.id,
    x: cover.x, y: cover.y, width: cover.width, height: cover.height, frameId: cover.frameId,
    zIndex: Math.max(...document.objects.map(object => object.zIndex), 0) + 1 };
  return normalizeBoardDocument({ ...document, objects: [...document.objects, stack] });
}
export function unstack(document: BoardDocument, stackId: string): BoardDocument {
  return normalizeBoardDocument({ ...document, objects: document.objects.filter(object => object.id !== stackId || object.type !== 'stack'), connections: document.connections.filter(edge => edge.sourceObjectId !== stackId && edge.targetObjectId !== stackId) });
}
export function setStackCover(document: BoardDocument, stackId: string, coverId: string): BoardDocument {
  return normalizeBoardDocument({ ...document, objects: document.objects.map(object => object.id === stackId && object.type === 'stack' && object.memberIds.includes(coverId) ? { ...object, coverId } : object) });
}

/** Move the existing member out, keeping its ID, reference and connections. */
export function extractStackMember(document: BoardDocument, stackId: string, memberId: string, point: BoardPoint): BoardDocument {
  const stack = document.objects.find(object => object.id === stackId && object.type === 'stack');
  const member = document.objects.find(object => object.id === memberId && object.type === 'asset');
  if (stack?.type !== 'stack' || member?.type !== 'asset' || !stack.memberIds.includes(memberId)) return document;
  const remaining = stack.memberIds.filter(id => id !== memberId);
  const moved = { ...member, ...point };
  moved.frameId = findContainingFrame(moved, document.objects)?.id ?? null;
  return normalizeBoardDocument({ ...document,
    objects: document.objects.filter(object => remaining.length > 1 || object.id !== stackId).map(object => object.id === memberId ? moved : object.id === stackId ? {
      ...stack, memberIds: remaining, coverId: remaining.includes(stack.coverId) ? stack.coverId : remaining[0],
    } : object),
    connections: document.connections.map(edge => remaining.length > 1 ? edge : { ...edge,
      sourceObjectId: edge.sourceObjectId === stackId ? remaining[0] : edge.sourceObjectId,
      targetObjectId: edge.targetObjectId === stackId ? remaining[0] : edge.targetObjectId,
    }),
  });
}
