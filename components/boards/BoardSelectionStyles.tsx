import { useBoardStore } from '../../store/useBoardStore';
import { updateObjects } from '../../services/boards/operations';
import { BoardColorField, BoardPropertyRow } from './BoardPropertyControls';
import type { BoardObject } from '../../services/boards/types';

export const BOARD_COLORS = ['#fde68a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#ddd6fe', '#e5e7eb'];
export default function BoardSelectionStyles({ boardId, editable, includeText = true, includeTypography = true }: { boardId: string; editable: boolean; includeText?: boolean; includeTypography?: boolean }) {
  const session = useBoardStore(state => state.sessions[boardId]);
  const selected = session.document.objects.filter(object => session.selectedObjectIds.includes(object.id));
  const colored = selected.filter((object): object is Exclude<BoardObject, { type: 'asset' | 'stack' }> => object.type !== 'asset' && object.type !== 'stack' && (includeText || object.type !== 'text'));
  const texts = colored.filter((object): object is Extract<BoardObject, { type: 'text' | 'sticky' | 'shape' }> => object.type === 'sticky' || (includeTypography && (object.type === 'text' || object.type === 'shape')));
  const shapes = colored.filter(object => object.type === 'shape');
  const rectangles = shapes.filter(object => object.shape === 'rectangle');
  const cornerRadius = rectangles.length && rectangles.every(object => (object.cornerRadius ?? 0) === (rectangles[0].cornerRadius ?? 0)) ? rectangles[0].cornerRadius ?? 0 : null;
  const color = colored.length && colored.every(object => object.color === colored[0].color) ? colored[0].color : '';
  const fontSize = texts.length && texts.every(object => object.fontSize === texts[0].fontSize) ? texts[0].fontSize : '';
  const apply = (ids: string[], patch: { color?: string; fontSize?: number; borderColor?: string; borderWidth?: number; cornerRadius?: number }, continuous = false) => useBoardStore.getState()[continuous ? 'updateInteraction' : 'executeOperation'](boardId, doc => updateObjects(doc, ids.map(id => ({ id, ...patch }))));
  const commit = () => useBoardStore.getState().commitInteraction(boardId);
  if (!colored.length) return null;
  const colorLabel = colored.every(item => item.type === 'text') ? 'Text color' : colored.every(item => item.type === 'shape' || item.type === 'sticky') ? 'Fill' : 'Color';
  const borderColor = shapes.length && shapes.every(item => item.borderColor === shapes[0].borderColor) ? shapes[0].borderColor : '';
  return <fieldset disabled={!editable} className="board-selection-styles"><legend>{shapes.length ? 'Shape' : 'Appearance'}</legend>
    {selected.length > 1 && <p className="board-property-hint">Color applies to {colored.length} compatible objects{shapes.length ? ` · Border to ${shapes.length} shapes` : ''}.</p>}
    <BoardPropertyRow label={colorLabel}><BoardColorField label="Custom color" value={color || '#e5e7eb'} mixed={!color} disabled={!editable} onChange={value => apply(colored.map(item => item.id), { color: value }, true)} onBlur={commit} presets={BOARD_COLORS} onPreset={value => apply(colored.map(item => item.id), { color: value })}/></BoardPropertyRow>
    {!!texts.length && <BoardPropertyRow label="Font size"><input className="board-input board-number-input" type="number" aria-label="Font size" min={1} max={300} placeholder="Mixed" value={fontSize} onChange={event => { const value = Number(event.target.value); if (value >= 1 && value <= 300) apply(texts.map(item => item.id), { fontSize: value }, true); }} onBlur={commit} /></BoardPropertyRow>}
    {!!shapes.length && <><BoardPropertyRow label="Border"><BoardColorField label="Border color" value={borderColor || '#e5e7eb'} mixed={!borderColor} disabled={!editable} onChange={value => apply(shapes.map(item => item.id), { borderColor: value })}/></BoardPropertyRow><BoardPropertyRow label="Weight"><select className="board-input" aria-label="Border width" value={shapes.every(item => item.borderWidth === shapes[0].borderWidth) ? shapes[0].borderWidth : ''} onChange={event => apply(shapes.map(item => item.id), { borderWidth: Number(event.target.value) })}><option value="" disabled>Mixed</option>{[1, 2, 4].map((width, index) => <option key={width} value={width}>{['Thin', 'Medium', 'Thick'][index]} · {width} px</option>)}</select></BoardPropertyRow></>}
    {!!rectangles.length && <BoardPropertyRow label="Corners"><div className="board-roundness-control"><input type="range" aria-label="Rectangle corner radius" min={0} max={24} value={cornerRadius ?? 0} aria-valuetext={cornerRadius === null ? 'Mixed' : `${cornerRadius} px`} onChange={event => apply(rectangles.map(object => object.id), { cornerRadius: Number(event.target.value) }, true)} onBlur={commit} onPointerUp={commit} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit(); }}/><span>{cornerRadius === null ? 'Mixed' : `${cornerRadius} px`}</span></div></BoardPropertyRow>}
  </fieldset>;
}
