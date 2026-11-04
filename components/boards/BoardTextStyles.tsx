import { useEffect, useState } from 'react';
import { useBoardStore } from '../../store/useBoardStore';
import { updateObjects } from '../../services/boards/operations';
import type { BoardTextObject } from '../../services/boards/types';

export default function BoardTextStyles({ boardId, editable }: { boardId: string; editable: boolean }) {
  const session = useBoardStore(state => state.sessions[boardId]);
  const texts = session.document.objects.filter((object): object is BoardTextObject => object.type === 'text' && session.selectedObjectIds.includes(object.id));
  const [fonts, setFonts] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let active = true;
    const load = window.electronAPI?.boardsFonts;
    if (!load) return;
    setStatus('Loading fonts...');
    void load().then(result => {
      if (!active) return;
      if (result.success) { setFonts(result.data); setStatus(''); }
      else setStatus('System fonts unavailable.');
    }).catch(() => { if (active) setStatus('System fonts unavailable.'); });
    return () => { active = false; };
  }, []);
  if (!texts.length) return null;
  const first = texts[0];
  const family = texts.every(text => text.fontFamily === first.fontFamily) ? first.fontFamily ?? '' : '__mixed';
  const background = texts.every(text => text.backgroundColor === first.backgroundColor) ? first.backgroundColor : undefined;
  const apply = (patch: Partial<Pick<BoardTextObject, 'fontFamily' | 'backgroundColor'>>, continuous = false) => useBoardStore.getState()[continuous ? 'updateInteraction' : 'executeOperation'](boardId, document => updateObjects(document, texts.map(text => ({ id: text.id, ...patch }))));
  const families = [...new Set([...fonts, ...texts.flatMap(text => text.fontFamily ? [text.fontFamily] : []), 'sans-serif', 'serif', 'monospace'])].sort((a, b) => a.localeCompare(b));
  return <fieldset disabled={!editable} className="board-selection-styles"><legend>Text appearance</legend>
    <label>Font<select className="board-input" aria-label="Font" value={family} onChange={event => apply({ fontFamily: event.target.value || undefined })}>
      <option value="">Default</option><option value="__mixed" disabled>Mixed</option>
      {families.map(name => <option key={name} value={name} style={{ fontFamily: JSON.stringify(name) }}>{name}</option>)}
    </select></label>
    {status && <small role="status">{status}</small>}
    <label className="board-checkbox"><input type="checkbox" aria-label="Text background" checked={texts.every(text => !!text.backgroundColor)} ref={element => { if (element) element.indeterminate = texts.some(text => !!text.backgroundColor) && !texts.every(text => !!text.backgroundColor); }} onChange={event => apply({ backgroundColor: event.target.checked ? '#1f2937' : null })}/>Background</label>
    {texts.some(text => !!text.backgroundColor) && <label>Background color{background === undefined && <small>Mixed</small>}<input type="color" aria-label="Text background color" value={background || '#1f2937'} onChange={event => apply({ backgroundColor: event.target.value }, true)} onBlur={() => useBoardStore.getState().commitInteraction(boardId)} /></label>}
  </fieldset>;
}
