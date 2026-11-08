import type { BoardShapeObject, BoardTextObject } from './types';

export type BoardTypographyObject = BoardTextObject | BoardShapeObject;
export function boardTextColor(object: BoardTypographyObject): string {
  return object.type === 'shape' ? object.textColor ?? '#172033' : object.color;
}
export function boardTextAlignment(object: BoardTypographyObject): 'left' | 'center' | 'right' {
  return object.textAlign ?? (object.type === 'shape' && object.shape !== 'rectangle' ? 'center' : 'left');
}
