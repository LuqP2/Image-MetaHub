import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import MasonryGridLayout from '../components/MasonryGridLayout';
import { buildMasonryLayout, masonryWindow, type MasonryRect } from '../utils/masonryLayout';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const items = Array.from({ length: 18000 }, (_, i) => ({ key: `item-${i}`, aspectRatio: 1 }));
const build = (width: number, ratios = items) => buildMasonryLayout(ratios, width, 120, 8, 0, 66);
const renderItem = (rect: MasonryRect) => <div data-index={rect.index}>{rect.key}</div>;

describe('virtual masonry viewport', () => {
  it('mounts only viewport + overscan, schedules visible/ahead items and restores a saved offset', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(408);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    const scrollRef = { current: null as HTMLDivElement | null };
    const onViewport = vi.fn();
    const onScroll = vi.fn();
    const layout = build(408);
    const { container } = render(<MasonryGridLayout layout={layout} scrollRef={scrollRef}
      initialScrollTop={5000} onResize={vi.fn()} onScroll={onScroll} onViewport={onViewport} renderItem={renderItem} />);
    expect(scrollRef.current?.scrollTop).toBe(5000);
    expect(onScroll).toHaveBeenLastCalledWith(5000);
    expect(container.querySelectorAll('[data-index]').length).toBeLessThan(30);
    expect(onViewport).toHaveBeenLastCalledWith(masonryWindow(layout, 5000, 5300), masonryWindow(layout, 5300, 5600));
    scrollRef.current!.scrollTop = 10000;
    fireEvent.scroll(scrollRef.current!);
    expect(onScroll).toHaveBeenLastCalledWith(10000);
    expect(onViewport).toHaveBeenLastCalledWith(masonryWindow(layout, 10000, 10300), masonryWindow(layout, 10300, 10600));
  });

  it('keeps an anchor at its viewport offset when ratios or column width change', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(408);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    const scrollRef = { current: null as HTMLDivElement | null };
    const props = { scrollRef, initialScrollTop: 500, onResize: vi.fn(), onScroll: vi.fn(), onViewport: vi.fn(), renderItem };
    const first = build(408);
    const anchor = masonryWindow(first, 500, 800).sort((a, b) => a.top - b.top)[0];
    const offset = anchor.top - 500;
    const { rerender } = render(<MasonryGridLayout {...props} layout={first} />);
    const corrected = build(408, items.map((item, i) => i < 4 ? { ...item, aspectRatio: .5 } : item));
    rerender(<MasonryGridLayout {...props} layout={corrected} />);
    expect(corrected.rects[anchor.index].top - scrollRef.current!.scrollTop).toBe(offset);
    const nextTop = scrollRef.current!.scrollTop;
    const nextAnchor = masonryWindow(corrected, nextTop, nextTop + 300).sort((a, b) => a.top - b.top)[0];
    const resized = build(280, items.map((item, i) => i < 4 ? { ...item, aspectRatio: .5 } : item));
    rerender(<MasonryGridLayout {...props} layout={resized} />);
    expect(resized.rects[nextAnchor.index].top - scrollRef.current!.scrollTop).toBe(nextAnchor.top - nextTop);
    const restored = scrollRef.current!.scrollTop;
    rerender(<MasonryGridLayout {...props} layout={resized} />);
    expect(scrollRef.current!.scrollTop).toBe(restored);
  });

  it('uses the old viewport offset if the browser clamps scroll before a shorter layout commits', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(408);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    const scrollRef = { current: null as HTMLDivElement | null };
    const props = { scrollRef, initialScrollTop: 5000, onResize: vi.fn(), onScroll: vi.fn(), onViewport: vi.fn(), renderItem };
    const previous = build(408, items.map(item => ({ ...item, aspectRatio: .25 })));
    const anchor = masonryWindow(previous, 5000, 5300).sort((a, b) => a.top - b.top)[0];
    const { rerender } = render(<MasonryGridLayout {...props} layout={previous} />);
    scrollRef.current!.scrollTop = 0;
    const next = build(408);
    rerender(<MasonryGridLayout {...props} layout={next} />);
    expect(next.rects[anchor.index].top - scrollRef.current!.scrollTop).toBe(anchor.top - 5000);
  });
});
