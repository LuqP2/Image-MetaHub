import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** clientWidth/Height are local CSS pixels: ancestor Canvas transforms must not be measured twice. */
export default function BoardLocalSizer({ children }: { children(size: { width: number; height: number }): ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current!;
    const measure = () => setSize(previous => previous.width === element.clientWidth && previous.height === element.clientHeight ? previous : { width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="board-local-sizer">{size.width > 0 && size.height > 0 && children(size)}</div>;
}
