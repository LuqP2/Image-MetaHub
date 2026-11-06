import type { BoardDocument, BoardObject, BoardStackObject } from './types';

export const stackMembership = (objects: BoardObject[]) => new Map(objects.flatMap(object => object.type === 'stack' ? object.memberIds.map(id => [id, object] as const) : []));
export const visibleBoardObjects = (objects: BoardObject[]) => {
  const members = stackMembership(objects);
  return objects.filter(object => !members.has(object.id));
};
export function stackSelectionClosure(document: BoardDocument, ids: Iterable<string>): Set<string> {
  const selected = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const object of document.objects) {
      if (object.frameId && selected.has(object.frameId) && !selected.has(object.id)) { selected.add(object.id); changed = true; }
      if (object.type === 'stack' && selected.has(object.id)) for (const id of object.memberIds) if (!selected.has(id)) { selected.add(id); changed = true; }
    }
  }
  return selected;
}
export function stackableImages(document: BoardDocument, ids: string[]) {
  const selected = document.objects.filter(object => ids.includes(object.id));
  const members = stackMembership(document.objects);
  return selected.length >= 2 && selected.length === ids.length && selected.every(object => object.type === 'asset' && object.mediaType === 'image' && !members.has(object.id) && object.frameId === selected[0].frameId);
}
export function remapStackMembers(object: BoardObject, ids: Map<string, string>): Partial<BoardStackObject> {
  return object.type === 'stack' ? { memberIds: object.memberIds.map(id => ids.get(id) ?? id), coverId: ids.get(object.coverId) ?? object.coverId } : {};
}
