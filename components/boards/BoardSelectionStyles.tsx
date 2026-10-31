import { useBoardStore } from '../../store/useBoardStore';
import { updateObjects } from '../../services/boards/operations';

export const BOARD_COLORS = ['#fde68a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#ddd6fe', '#e5e7eb'];
export default function BoardSelectionStyles({ boardId, editable }: { boardId: string; editable: boolean }) {
  const session = useBoardStore(state => state.sessions[boardId]);
  const selected = session.document.objects.filter(object => session.selectedObjectIds.includes(object.id));
  const colored = selected.filter(object => object.type !== 'asset');
  const texts = selected.filter(object => object.type === 'text' || object.type === 'sticky' || object.type === 'shape');
  const shapes = selected.filter(object => object.type === 'shape');
  const color = colored.length && colored.every(object => object.color === colored[0].color) ? colored[0].color : '';
  const fontSize = texts.length && texts.every(object => object.fontSize === texts[0].fontSize) ? texts[0].fontSize : '';
  const apply = (ids: string[], patch: { color?: string; fontSize?: number; borderColor?: string; borderWidth?: number }, continuous = false) => useBoardStore.getState()[continuous ? 'updateInteraction' : 'executeOperation'](boardId, doc => updateObjects(doc, ids.map(id => ({ id, ...patch }))));
  const commit = () => useBoardStore.getState().commitInteraction(boardId);
  if (!colored.length) return null;
  return <fieldset disabled={!editable} className="board-selection-styles"><legend>Style</legend>
    <label>Color {color === '' && <small>Mixed</small>}<input type="color" aria-label="Custom color" value={color || '#e5e7eb'} onChange={event => apply(colored.map(item => item.id), { color: event.target.value }, true)} onBlur={commit} /></label>
    <div className="board-color-palette">{BOARD_COLORS.map(value => <button key={value} aria-label={`Color ${value}`} aria-pressed={color === value} style={{ background: value }} onClick={() => apply(colored.map(item => item.id), { color: value })} />)}</div>
    {!!texts.length && <label>Font size<input className="board-input" type="number" aria-label="Font size" min={1} max={300} placeholder="Mixed" value={fontSize} onChange={event => { const value = Number(event.target.value); if (value >= 1 && value <= 300) apply(texts.map(item => item.id), { fontSize: value }, true); }} onBlur={commit} /></label>}
    {!!shapes.length && <><label>Border color<input type="color" aria-label="Border color" value={shapes[0].borderColor} onChange={event => apply(shapes.map(item => item.id), { borderColor: event.target.value })} /></label><label>Border width<select className="board-input" aria-label="Border width" value={shapes.every(item => item.borderWidth === shapes[0].borderWidth) ? shapes[0].borderWidth : ''} onChange={event => apply(shapes.map(item => item.id), { borderWidth: Number(event.target.value) })}><option value="" disabled>Mixed</option>{[1, 2, 4].map((width, index) => <option key={width} value={width}>{['Thin', 'Medium', 'Thick'][index]}</option>)}</select></label></>}
  </fieldset>;
}
