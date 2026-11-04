import { useEffect, useRef } from 'react';
import { useBoardUIStore } from '../../store/useBoardUIStore';

export default function BoardPanelResizeHandle({ side }: { side: 'library' | 'inspector' }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const width = useBoardUIStore(state => side === 'library' ? state.libraryWidth : state.inspectorWidth);
  const change = (value: number) => useBoardUIStore.getState().setPanelWidth(side, value);
  const finish = () => { drag.current = null; document.body.style.removeProperty('cursor'); document.body.style.removeProperty('user-select'); };
  useEffect(() => {
    const move = (event: PointerEvent) => { if (drag.current) useBoardUIStore.getState().setPanelWidth(side, drag.current.width + (event.clientX - drag.current.x) * (side === 'library' ? 1 : -1)); };
    const stop = () => { drag.current = null; document.body.style.removeProperty('cursor'); document.body.style.removeProperty('user-select'); };
    document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', stop, true); document.addEventListener('pointercancel', stop, true);
    return () => { document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', stop, true); document.removeEventListener('pointercancel', stop, true); stop(); };
  }, [side]);
  return <div role="separator" aria-orientation="vertical" aria-label={`Resize ${side} sidebar`} aria-valuemin={side === 'library' ? 220 : 260} aria-valuemax={560} aria-valuenow={width} tabIndex={0} className={`board-panel-resizer board-panel-resizer--${side}`}
    onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); change(width + (event.key === 'ArrowRight' ? 16 : -16) * (side === 'library' ? 1 : -1)); } }}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { x: event.clientX, width }; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }}
    onPointerUp={finish} onPointerCancel={finish}><span /></div>;
}
