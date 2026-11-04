import { normalizeBoardDocument } from './document.mjs';
import { frameDependencies } from './queryGraph';
import { mapSetExpression } from './queryDocument.mjs';
import { getBoardBounds, type BoardPoint } from './layout';
import type { BoardDocument, BoardObject } from './types';

export const BOARD_CLIPBOARD_FORMAT = 'image-metahub-board-fragment';
export function selectionClosure(document: BoardDocument, ids: string[], dependencies = false): Set<string> {
  const selected = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const object of document.objects) {
      if (object.frameId && selected.has(object.frameId) && !selected.has(object.id)) { selected.add(object.id); changed = true; }
      if (dependencies && object.type === 'smart-frame' && selected.has(object.id)) {
        for (const id of frameDependencies(object.source)) if (document.objects.some(item => item.id === id) && !selected.has(id)) { selected.add(id); changed = true; }
      }
    }
  }
  return selected;
}
export function copyBoardFragment(document: BoardDocument, ids: string[]): string {
  const selected = selectionClosure(document, ids, true);
  const objects = document.objects.filter(object => selected.has(object.id)).map(object => ({ ...object, frameId: object.frameId && selected.has(object.frameId) ? object.frameId : null }));
  return JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, document: { ...document, objects, connections: document.connections.filter(edge => selected.has(edge.sourceObjectId) && selected.has(edge.targetObjectId)) } });
}
export function parseBoardFragment(text: string): BoardDocument | null {
  if (!text.trim().startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { if (text.includes(BOARD_CLIPBOARD_FORMAT)) throw new Error('Invalid board clipboard data.'); return null; }
  if (value?.format !== BOARD_CLIPBOARD_FORMAT) return null;
  if (value.version !== 1) throw new Error('Unsupported board clipboard version.');
  return normalizeBoardDocument(value.document);
}
export function pasteBoardFragment(destination: BoardDocument, fragment: BoardDocument, anchor: BoardPoint): { document: BoardDocument; ids: string[] } {
  const remap = new Map(fragment.objects.map(object => [object.id, crypto.randomUUID()]));
  // Keep missing references missing, including when the destination happens to contain the old ID.
  for (const object of fragment.objects) if (object.type === 'smart-frame') for (const id of frameDependencies(object.source)) if (!remap.has(id)) remap.set(id, crypto.randomUUID());
  const bounds = getBoardBounds(fragment.objects);
  const top = Math.max(0, ...destination.objects.map(object => object.zIndex));
  const bottom = Math.min(0, ...fragment.objects.map(object => object.zIndex));
  const copies: BoardObject[] = fragment.objects.map(object => ({ ...structuredClone(object), id: remap.get(object.id)!,
    x: object.x - bounds.x + anchor.x, y: object.y - bounds.y + anchor.y, zIndex: top + 1 + object.zIndex - bottom,
    frameId: object.frameId ? remap.get(object.frameId) ?? null : null,
    ...(object.type === 'smart-frame' ? { source: mapSetExpression(object.source, source => source.kind === 'frame' ? { ...source, frameId: remap.get(source.frameId)! } : source) } : {}),
  } as BoardObject));
  return { ids: copies.map(object => object.id), document: normalizeBoardDocument({ ...destination, objects: [...destination.objects, ...copies], connections: [...destination.connections,
    ...fragment.connections.map(edge => ({ ...edge, id: crypto.randomUUID(), sourceObjectId: remap.get(edge.sourceObjectId)!, targetObjectId: remap.get(edge.targetObjectId)! })),
  ] }) };
}
