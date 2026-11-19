import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Portalled so the dock's horizontal scroll container cannot clip tooltips. */
export default function BoardTooltips() {
  const marker = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const root = marker.current?.parentElement;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: HTMLElement | null = null;
    const hide = () => { clearTimeout(timer); active?.removeAttribute('aria-describedby'); active = null; setTip(null); };
    const prepare = () => root.querySelectorAll<HTMLElement>('[title]').forEach(element => {
      element.dataset.boardTooltip = element.title;
      element.removeAttribute('title');
    });
    prepare();
    const observer = new MutationObserver(prepare);
    observer.observe(root, { attributes: true, attributeFilter: ['title'], childList: true, subtree: true });
    const show = (event: Event) => {
      const element = (event.target as HTMLElement).closest<HTMLElement>('[data-board-tooltip]');
      if (!element || element === active) return;
      hide(); active = element;
      const display = () => {
        const rect = element.getBoundingClientRect();
        element.setAttribute('aria-describedby', id);
        setTip({ label: element.dataset.boardTooltip!, x: Math.max(120, Math.min(window.innerWidth - 120, rect.left + rect.width / 2)), y: rect.top - 8 });
      };
      if (event.type === 'focusin') display(); else timer = setTimeout(display, 300);
    };
    root.addEventListener('pointerover', show); root.addEventListener('focusin', show);
    root.addEventListener('pointerleave', hide); root.addEventListener('focusout', hide); root.addEventListener('pointerdown', hide);
    window.addEventListener('resize', hide); window.addEventListener('scroll', hide, true);
    return () => { hide(); observer.disconnect(); root.removeEventListener('pointerover', show); root.removeEventListener('focusin', show); root.removeEventListener('pointerleave', hide); root.removeEventListener('focusout', hide); root.removeEventListener('pointerdown', hide); window.removeEventListener('resize', hide); window.removeEventListener('scroll', hide, true); };
  }, [id]);
  return <><span ref={marker} hidden />{tip && createPortal(<div id={id} role="tooltip" className="board-dock-tooltip" style={{ left: tip.x, top: tip.y }}>{tip.label}</div>, document.body)}</>;
}
