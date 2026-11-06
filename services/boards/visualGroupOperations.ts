import type { BoardAssetObject, BoardDocument, BoardFrameObject } from './types';
import { normalizeBoardDocument } from './document.mjs';
import { findFreeBoardPosition, getBoardBounds, gridPositions } from './layout';
import { stackMembership } from './stackMembership';

export function visualGroupingCandidates(document: BoardDocument, selectedIds?: string[]): BoardAssetObject[] {
  const members = stackMembership(document.objects);
  const selected = selectedIds ? new Set(selectedIds) : null;
  return document.objects.filter((object): object is BoardAssetObject => object.type === 'asset' && object.mediaType === 'image' && !members.has(object.id)
    && (selected ? selected.has(object.id) || !!object.frameId && selected.has(object.frameId) : object.frameId === null));
}
export function visualGroupFingerprint(document: BoardDocument, ids: string[]): string {
  return JSON.stringify(ids.map(id => document.objects.find(object => object.id === id) ?? null));
}
export function applyVisualGroups(document: BoardDocument, groups: string[][]): BoardDocument {
  const byId = new Map(document.objects.map(object => [object.id, object]));
  const used = new Set<string>(), hidden = stackMembership(document.objects);
  const batches = groups.filter(group => group.length >= 2).map(group => group.map(id => {
    const object = byId.get(id);
    if (used.has(id) || hidden.has(id) || object?.type !== 'asset' || object.mediaType !== 'image') throw new Error('Grouping images changed. Recalculate the groups.');
    used.add(id); return object;
  }));
  if (!batches.length) return document;
  const obstacles = document.objects.filter(object => !used.has(object.id));
  const updates = new Map<string, BoardAssetObject>();
  const frames: BoardFrameObject[] = [];
  const preferred = getBoardBounds(batches.flat());
  batches.forEach((members, index) => {
    const positions = gridPositions(members, { x: 24, y: 48 });
    const bounds = getBoardBounds(members.map((object, i) => ({ ...object, ...positions[i] })));
    const size = { width: bounds.width + 48, height: bounds.height + 72 };
    const point = findFreeBoardPosition([...obstacles, ...frames], size, preferred);
    const frame: BoardFrameObject = { id: crypto.randomUUID(), type: 'frame', title: `Visual group ${index + 1}`, color: '#6366f1', ...point, ...size, frameId: null,
      zIndex: Math.min(0, ...document.objects.map(object => object.zIndex)) - index - 1 };
    frames.push(frame);
    members.forEach((object, i) => updates.set(object.id, { ...object, x: point.x + positions[i].x, y: point.y + positions[i].y, frameId: frame.id }));
  });
  return normalizeBoardDocument({ ...document, objects: [...document.objects.map(object => updates.get(object.id) ?? object), ...frames] });
}
