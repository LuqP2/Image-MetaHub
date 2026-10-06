import { describe, expect, it } from 'vitest';
import { buildMasonryLayout, masonryWindow, masonryKeyboardTarget, masonrySelection, type MasonryItem } from '../utils/masonryLayout';

const build = (items: MasonryItem[], width = 408, labels = 0) => buildMasonryLayout(items, width, 120, 8, labels, 66);

describe('masonry geometry', () => {
  it('places items in the shortest column with left-first ties, preserving aspect ratios', () => {
    const layout = build([{ key: 'portrait', aspectRatio: .5 }, { key: 'landscape', aspectRatio: 2 }, { key: 'square', aspectRatio: 1 }, { key: 'next', aspectRatio: 1 }]);
    expect(layout.rects.map(rect => rect.column)).toEqual([0, 1, 2, 1]);
    expect(layout.rects.map(rect => rect.imageHeight)).toEqual([240, 60, 120, 120]);
    expect(layout.rects[3].top).toBe(76);
  });

  it('reserves labels, uses a fixed fallback and fits a narrow viewport', () => {
    const layout = build([{ key: 'unknown' }, { key: 'invalid', aspectRatio: NaN }, { key: 'zero', aspectRatio: 0 }], 60, 40);
    expect(layout.columns.length).toBe(1);
    for (const rect of layout.rects) {
      expect(rect.left + rect.width).toBeLessThanOrEqual(60);
      expect(rect.height).toBe(rect.width * 1.2 + 40);
    }
  });

  it('flushes columns at group headers and never overlaps after resizing', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ key: `${i}`, aspectRatio: i % 3 === 0 ? .4 : 1.8 }));
    const grouped = [...items.slice(0, 30), { key: 'group', header: true }, ...items.slice(30)];
    for (const width of [408, 280, 80]) {
      const layout = build(grouped, width, 40);
      const header = layout.headers[0];
      expect(header.width).toBe(width);
      for (const rect of layout.rects.slice(0, 30)) expect(rect.top + rect.height).toBeLessThanOrEqual(header.top);
      for (const rect of layout.rects.slice(31)) expect(rect.top).toBeGreaterThanOrEqual(header.top + header.height);
      for (const column of layout.columns) for (let i = 1; i < column.length; i++) {
        expect(column[i].top).toBeGreaterThan(column[i - 1].top + column[i - 1].height);
      }
    }
  });

  it('queries viewport and drag selection including tall cards beginning above the viewport', () => {
    const layout = build([{ key: 'tall', aspectRatio: .1 }, ...Array.from({ length: 18000 }, (_, i) => ({ key: `${i}`, aspectRatio: 1 }))]);
    const window = masonryWindow(layout, 600, 900);
    const expected = layout.rects.filter(rect => rect.top <= 900 && rect.top + rect.height >= 600);
    expect(window).toEqual(expected);
    expect(window.length).toBeLessThan(20);
    expect(window.some(rect => rect.key === 'tall')).toBe(true);
    expect(masonrySelection(layout, { left: 8, right: 128, top: 600, bottom: 900 }).map(rect => rect.key)).toEqual(['tall']);
  });

  it('navigates geometrically and skips headers for Home/End and page movement', () => {
    const layout = build([{ key: 'header', header: true }, ...Array.from({ length: 30 }, (_, i) => ({ key: `${i}`, aspectRatio: i === 0 ? .5 : 1 }))]);
    expect(masonryKeyboardTarget(layout, -1, 'Home', 300)).toBe(1);
    expect(masonryKeyboardTarget(layout, 1, 'End', 300)).toBe(30);
    const right = masonryKeyboardTarget(layout, 1, 'ArrowRight', 300);
    expect(layout.rects[right].column).toBe(1);
    const down = masonryKeyboardTarget(layout, 1, 'ArrowDown', 300);
    expect(layout.rects[down].column).toBe(0);
    expect(layout.rects[down].top).toBeGreaterThan(layout.rects[1].top);
    expect(masonryKeyboardTarget(layout, down, 'ArrowUp', 300)).toBe(1);
    const page = masonryKeyboardTarget(layout, 1, 'PageDown', 300);
    expect(layout.rects[page].top).toBeGreaterThan(layout.rects[1].top);
    expect(masonryKeyboardTarget(layout, 1, 'ArrowLeft', 300)).toBe(1);
  });
});
