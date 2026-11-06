import { describe, it, expect } from 'vitest';
import { createBoardDocument } from '../services/boards/document.mjs';
import { addAssets } from '../services/boards/operations';
import { scaleBoardSelection } from '../services/boards/selectionScale';

describe('selection scale', () => {
  const document = addAssets(createBoardDocument(), [1, 2, 3].map(i => ({ name: `${i}`, mediaType: 'image' as const, width: i * 200, height: 300, reference: { kind: 'path' as const, locator: { imageId: `${i}`, directoryPath: null, relativePath: `${i}.png` } } })), { x: 100, y: 50 });
  const ids = document.objects.map(object => object.id);
  it('scales dimensions and spacing from the original snapshot', () => {
    const first = scaleBoardSelection(document, ids, document.objects, { x: 20, y: 30 }, 2);
    const second = scaleBoardSelection(first, ids, document.objects, { x: 20, y: 30 }, 3);
    second.objects.forEach((object, i) => {
      expect(object.x).toBe(20 + (document.objects[i].x - 20) * 3);
      expect(object.width).toBe(document.objects[i].width * 3);
      expect(object.height / object.width).toBeCloseTo(document.objects[i].height / document.objects[i].width);
    });
  });
  it('clamps the whole selection to the strictest minimum', () => {
    const result = scaleBoardSelection(document, ids, document.objects, { x: 0, y: 0 }, -1);
    expect(result.objects.every(object => object.width >= 80 && object.height >= 60)).toBe(true);
    expect(new Set(result.objects.map((object, i) => object.width / document.objects[i].width)).size).toBe(1);
  });
});
