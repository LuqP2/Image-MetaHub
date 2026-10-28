import { afterEach, describe, expect, it } from 'vitest';
import { clearInternalImageDragData, getInternalImageDragId, getInternalImageDragIds, INTERNAL_IMAGE_DRAG_TYPE, setInternalImageDragData } from '../utils/internalImageDrag';
afterEach(clearInternalImageDragData);
describe('canvas internal drag', () => {
  it('reads every validated ID without changing the primary-image API', () => {
    const payloads = new Map<string, string>();
    const data = { setData: (key: string, value: string) => payloads.set(key, value), getData: (key: string) => payloads.get(key) ?? '' } as DataTransfer;
    setInternalImageDragData(data, 'b', ['a', 'b', 'c']);
    expect(getInternalImageDragId(data)).toBe('b');
    expect(getInternalImageDragIds(data)).toEqual(['b', 'a', 'c']);
    payloads.set(INTERNAL_IMAGE_DRAG_TYPE, JSON.stringify({ imageIds: ['a', null, '', 'a', 12, 'b'] }));
    expect(getInternalImageDragIds(data)).toEqual(['a', 'b']);
    payloads.clear();
    expect(getInternalImageDragIds(data)).toEqual(['b', 'a', 'c']);
    clearInternalImageDragData();
    expect(getInternalImageDragIds(data)).toEqual([]);
  });
});
