import React, { useLayoutEffect, useRef, useState } from 'react';
import { masonryWindow, type MasonryLayout, type MasonryRect } from '../utils/masonryLayout';

interface Props {
  layout: MasonryLayout;
  scrollRef: React.MutableRefObject<HTMLDivElement | null>;
  initialScrollTop: number;
  onResize: (width: number) => void;
  onScroll: (top: number) => void;
  onViewport: (visible: MasonryRect[], ahead: MasonryRect[]) => void;
  renderItem: (rect: MasonryRect) => React.ReactNode;
}

/** Virtualized independently of the regular grid's row geometry. */
export default function MasonryGridLayout({ layout, scrollRef, initialScrollTop, onResize, onScroll, onViewport, renderItem }: Props) {
  const [viewport, setViewport] = useState({ top: initialScrollTop, height: 600 });
  const previousLayout = useRef(layout);
  const initialTop = useRef(initialScrollTop);
  const restored = useRef(false);
  const lastScrollTop = useRef(initialScrollTop);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      onResize(element.clientWidth);
      lastScrollTop.current = element.scrollTop;
      setViewport({ top: element.scrollTop, height: element.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onResize, scrollRef]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const previous = previousLayout.current;
    if (!restored.current && element.clientWidth > 0 && layout.rects.length && layout.cardWidth > 1) {
      element.scrollTop = initialTop.current;
      restored.current = true;
    } else if (restored.current && previous !== layout) {
      // A shorter inner element can make the browser clamp scrollTop before this
      // effect runs. Anchor against the last observed offset of the old layout.
      const previousTop = lastScrollTop.current;
      const anchor = masonryWindow(previous, previousTop, previousTop + element.clientHeight)
        .filter(rect => !rect.header).sort((a, b) => a.top - b.top)[0];
      const next = anchor && layout.rects.find(rect => rect.key === anchor.key);
      if (next && anchor) element.scrollTop = Math.max(0, next.top + previousTop - anchor.top);
    }
    previousLayout.current = layout;
    lastScrollTop.current = element.scrollTop;
    setViewport({ top: element.scrollTop, height: element.clientHeight });
    onScroll(element.scrollTop);
  }, [layout, onScroll, scrollRef]);

  const visible = masonryWindow(layout, viewport.top, viewport.top + viewport.height);
  const ahead = masonryWindow(layout, viewport.top + viewport.height, viewport.top + viewport.height * 2);
  const rendered = masonryWindow(layout, Math.max(0, viewport.top - viewport.height), viewport.top + viewport.height * 2);
  // Stable layout + viewport dependencies avoid scheduling work on selection/hover rerenders.
  useLayoutEffect(() => { onViewport(visible, ahead); }, [layout, viewport.top, viewport.height, onViewport]);

  return <div ref={scrollRef} data-masonry-scroll="true" className="h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar-if-needed"
    style={{ overflowAnchor: 'none' }}
    onScroll={event => {
      const element = event.currentTarget;
      lastScrollTop.current = element.scrollTop;
      setViewport({ top: element.scrollTop, height: element.clientHeight });
      onScroll(element.scrollTop);
    }}>
    <div data-grid-background="true" style={{ position: 'relative', height: layout.height, minHeight: '100%' }}>
      {rendered.map(rect => <React.Fragment key={rect.key}>{renderItem(rect)}</React.Fragment>)}
    </div>
  </div>;
}
