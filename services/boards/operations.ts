import { createFrameDetacher } from './smartFrameOperations';
import type { BoardAssetInput, BoardAssetObject, BoardConnection, BoardDocument, BoardObject, BoardTextObject } from './types';
import { normalizeBoardDocument } from './document.mjs';
import { findContainingFrame, getBoardBounds, gridPositions, type BoardPoint, type BoardBounds } from './layout';

const id = () => crypto.randomUUID();
const changed = (document: BoardDocument, patch: Partial<BoardDocument>) => normalizeBoardDocument({ ...document, ...patch, updatedAt: Date.now() });
const top = (document: BoardDocument) => Math.max(0, ...document.objects.map(object => object.zIndex));

export function addAssets(document: BoardDocument, assets: BoardAssetInput[], anchor: BoardPoint): BoardDocument {
  const objects: BoardAssetObject[] = assets.map((asset, index) => ({
    id: id(), type: 'asset', x: 0, y: 0, width: 280,
    height: Math.max(100, Math.min(420, asset.width && asset.height ? 280 * asset.height / asset.width : 210)) + 32,
    zIndex: top(document) + index + 1, frameId: null, reference: asset.reference,
    name: asset.name, mediaType: asset.mediaType, visibleFields: [],
  }));
  const positions = gridPositions(objects, anchor);
  return changed(document, { objects: [...document.objects, ...objects.map((object, index) => {
    const positioned = { ...object, ...positions[index] };
    return { ...positioned, frameId: findContainingFrame(positioned, document.objects)?.id ?? null };
  })] });
}

export function addText(document: BoardDocument, position: BoardPoint): BoardDocument {
  const object: BoardTextObject = { id: id(), type: 'text', ...position, width: 280, height: 120, zIndex: top(document) + 1, frameId: null, text: 'Text', fontSize: 24, color: '#e5e7eb' };
  object.frameId = findContainingFrame(object, document.objects)?.id ?? null;
  return changed(document, { objects: [...document.objects, object] });
}

export function createFrame(document: BoardDocument, selectedObjectIds: string[], position: BoardPoint = { x: 0, y: 0 }): BoardDocument {
  const selected = document.objects.filter(object => selectedObjectIds.includes(object.id) && object.type !== 'frame' && object.type !== 'smart-frame');
  const bounds = selected.length ? getBoardBounds(selected) : { ...position, width: 560, height: 360 };
  const frameId = id();
  const frame: BoardObject = { id: frameId, type: 'frame', x: bounds.x - 24, y: bounds.y - 48, width: bounds.width + 48, height: bounds.height + 72, zIndex: Math.min(0, ...document.objects.map(object => object.zIndex)) - 1, frameId: null, title: 'Frame', color: '#6366f1' };
  return changed(document, { objects: [frame, ...document.objects.map(object => object.type !== 'frame' && object.type !== 'smart-frame' && selected.includes(object) ? { ...object, frameId } : object)] });
}

/** Draw at exact board coordinates; adopt objects whose centers lie inside a new frame. */
export function drawBoardObject(document: BoardDocument, type: 'text' | 'frame', bounds: BoardBounds): BoardDocument {
  const next = type === 'text' ? addText(document, bounds) : createFrame(document, [], bounds);
  const object = next.objects.find(item => !document.objects.some(existing => existing.id === item.id))!;
  const positioned = { ...object, ...bounds } as BoardObject;
  const objects = next.objects.map(item => item.id === object.id ? positioned : item);
  return changed(next, { objects: objects.map(item => {
    if (item.type === 'frame' || item.type === 'smart-frame' || (type === 'text' && item.id !== object.id)) return item;
    // Drawing a frame only adopts its own enclosed objects. Resizing an existing
    // frame can leave members outside its bounds without breaking their membership.
    const frame = findContainingFrame(item, type === 'frame' ? [positioned] : objects);
    if (type === 'frame' && !frame) return item;
    return { ...item, frameId: frame?.id ?? null };
  }) });
}

export type BoardObjectUpdate = { id: string } & Partial<BoardObject>;
export function updateObjects(document: BoardDocument, updates: BoardObjectUpdate[]): BoardDocument {
  const byId = new Map(updates.map(update => [update.id, update]));
  const objects = document.objects.map(object => {
    const update = byId.get(object.id);
    let next = update ? { ...object, ...update, id: object.id, type: object.type } as BoardObject : object;
    // A frame drag moves members once; explicit member positions win for multi-selection.
    const parentUpdate = object.frameId ? byId.get(object.frameId) : null;
    const parent = parentUpdate ? document.objects.find(candidate => candidate.id === object.frameId) : null;
    if (parent && parentUpdate) next = {
      ...next,
      x: update?.x ?? object.x + (parentUpdate.x ?? parent.x) - parent.x,
      y: update?.y ?? object.y + (parentUpdate.y ?? parent.y) - parent.y,
    };
    return next;
  });
  const frames = new Map(objects.filter(object => object.type === 'frame').map(object => [object.id, object]));
  // Ensure parent frames never cover members even after bring-to-front operations.
  return changed(document, { objects: objects.map(object => object.frameId && frames.has(object.frameId)
    ? { ...object, zIndex: Math.max(object.zIndex, frames.get(object.frameId)!.zIndex + 1) } : object) });
}

export function removeObjects(document: BoardDocument, objectIds: string[]): BoardDocument {
  const removed = new Set(objectIds);
  return changed(document, {
    objects: document.objects.filter(object => !removed.has(object.id)).map(object => object.frameId && removed.has(object.frameId) ? { ...object, frameId: null } : object),
    connections: document.connections.filter(connection => !removed.has(connection.sourceObjectId) && !removed.has(connection.targetObjectId)),
  });
}

export function duplicateObjects(document: BoardDocument, objectIds: string[], offset: BoardPoint = { x: 32, y: 32 }): BoardDocument {
  const selected = new Set(objectIds);
  for (const object of document.objects) if (object.frameId && selected.has(object.frameId)) selected.add(object.id);
  const ids = new Map(document.objects.filter(object => selected.has(object.id)).map(object => [object.id, id()]));
  const detach = createFrameDetacher(document);
  const copies = document.objects.filter(object => selected.has(object.id)).map(object => ({
    ...object, ...(object.type === 'smart-frame' ? { source: detach(object.source) } : {}), id: ids.get(object.id)!, x: object.x + offset.x, y: object.y + offset.y,
    frameId: object.frameId ? ids.get(object.frameId) ?? object.frameId : null,
    zIndex: object.zIndex + top(document) + 2,
  } as BoardObject));
  return changed(document, { objects: [...document.objects, ...copies], connections: [...document.connections,
    ...document.connections.filter(connection => ids.has(connection.sourceObjectId) && ids.has(connection.targetObjectId)).map(connection => ({
      ...connection, id: id(), sourceObjectId: ids.get(connection.sourceObjectId)!, targetObjectId: ids.get(connection.targetObjectId)!,
    })),
  ] });
}

export function addConnection(document: BoardDocument, connection: Omit<BoardConnection, 'id' | 'type'>): BoardDocument {
  return changed(document, { connections: [...document.connections, { ...connection, id: id(), type: 'manual' }] });
}
export function updateConnection(document: BoardDocument, connectionId: string, patch: Partial<Omit<BoardConnection, 'id' | 'type'>>): BoardDocument {
  return changed(document, { connections: document.connections.map(connection => connection.id === connectionId ? { ...connection, ...patch, id: connection.id, type: 'manual' } : connection) });
}
export function removeConnections(document: BoardDocument, connectionIds: string[]): BoardDocument {
  return changed(document, { connections: document.connections.filter(connection => !connectionIds.includes(connection.id)) });
}
export function arrangeObjectsInGrid(document: BoardDocument, objectIds: string[]): BoardDocument {
  const ids = new Set(objectIds);
  // Children of selected frames are moved with the frame rather than arranged a second time.
  const objects = document.objects.filter(object => ids.has(object.id) && !(object.frameId && ids.has(object.frameId)));
  const positions = gridPositions(objects, getBoardBounds(objects));
  return updateObjects(document, objects.map((object, index) => ({ id: object.id, ...positions[index] })));
}
export function setObjectFrame(document: BoardDocument, objectId: string, frameId: string | null): BoardDocument {
  return updateObjects(document, [{ id: objectId, frameId }]);
}
