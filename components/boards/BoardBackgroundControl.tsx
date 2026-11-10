import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { BOARD_BACKGROUND_PRESETS, boardBackground } from '../../services/boards/background';
import { useBoardStore } from '../../store/useBoardStore';

export default function BoardBackgroundControl({ boardId, open, setOpen, editable }: { boardId: string; open: boolean; setOpen(open: boolean): void; editable: boolean }) {
  const color = useBoardStore(state => state.sessions[boardId]?.document.backgroundColor ?? null);
  const [hex, setHex] = useState(color ?? '#0a0a0a');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const commit = () => useBoardStore.getState().commitInteraction(boardId);

  useEffect(() => {
    const theme = getComputedStyle(document.documentElement).getPropertyValue('--gray-950').trim().split(/\s+/).map(Number);
    const fallback = theme.length === 3 && theme.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
      ? `#${theme.map(value => value.toString(16).padStart(2, '0')).join('')}` : '#0a0a0a';
    setHex(color ?? fallback);
  }, [color, open]);

  useEffect(() => {
    if (!open) return;
    (root.current?.querySelector<HTMLButtonElement>('.board-background-presets button[aria-pressed="true"]') ?? root.current?.querySelector<HTMLButtonElement>('.board-background-presets button'))?.focus();
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { useBoardStore.getState().commitInteraction(boardId); setOpen(false); }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        useBoardStore.getState().commitInteraction(boardId); setOpen(false); trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key, true);
      useBoardStore.getState().commitInteraction(boardId);
    };
  }, [open, boardId, setOpen]);

  const apply = (value: string | null, continuous = false) => {
    if (!editable) return;
    useBoardStore.getState()[continuous ? 'updateInteraction' : 'executeOperation'](boardId, document => ({ ...document, backgroundColor: value }));
  };
  return <div ref={root} className="board-background-control nodrag nopan nowheel">
    <button ref={trigger} type="button" className="board-icon-button" title="Board background" aria-label="Board background" aria-expanded={open} aria-haspopup="dialog" disabled={!editable} onClick={() => setOpen(!open)}>
      <span className="board-background-swatch" style={{ background: boardBackground(color) }} />
    </button>
    {open && <div className="board-background-popover board-popover" role="dialog" aria-label="Board background" onKeyDown={event => event.stopPropagation()}>
      <strong>Board background</strong>
      <div className="board-background-presets">{BOARD_BACKGROUND_PRESETS.map(preset => <button key={preset.label} type="button" title={preset.label} aria-label={preset.label} aria-pressed={color === preset.color} disabled={!editable} style={{ background: boardBackground(preset.color), color: preset.color === null ? 'rgb(var(--gray-100))' : preset.color === '#ffffff' || preset.color === '#e5e5e5' ? '#111111' : '#ffffff' }} onClick={() => apply(preset.color)}>{color === preset.color && <Check size={16} />}</button>)}</div>
      <div className="board-background-custom">
        <label>Custom color<input ref={picker} type="color" aria-label="Custom background color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : color ?? '#0a0a0a'} disabled={!editable} onChange={event => { setHex(event.target.value); apply(event.target.value, true); }} onBlur={commit} /></label>
        <input className="board-input" aria-label="Background HEX" value={hex} maxLength={7} spellCheck={false} disabled={!editable} onChange={event => { const value = event.target.value; setHex(value); if (/^#[0-9a-f]{6}$/i.test(value)) apply(value, true); }} onBlur={() => { commit(); if (!/^#[0-9a-f]{6}$/i.test(hex)) setHex(color ?? picker.current?.value ?? '#0a0a0a'); }} />
      </div>
    </div>}
  </div>;
}
