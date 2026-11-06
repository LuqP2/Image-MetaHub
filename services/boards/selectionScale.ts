import type { BoardDocument, BoardObject } from './types';
import type { BoardPoint } from './layout';
import { updateObjects } from './operations';

/** Always transform the gesture snapshot, never the previous pointer move. */
export function scaleBoardSelection(document: BoardDocument, ids: string[], initial: BoardObject[], anchor: BoardPoint, requestedScale: number): BoardDocument {
  const objects = initial.filter(object => ids.includes(object.id));
  if (!objects.length || !Number.isFinite(requestedScale)) return document;
  const scale = Math.max(requestedScale, ...objects.map(object => Math.max(80 / object.width, 60 / object.height)));
  return updateObjects(document, objects.map(object => ({ id: object.id,
    x: anchor.x + (object.x - anchor.x) * scale, y: anchor.y + (object.y - anchor.y) * scale,
    width: object.width * scale, height: object.height * scale,
  })));
}
