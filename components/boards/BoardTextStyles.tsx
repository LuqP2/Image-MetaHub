import { useTranslation, type MessageKey } from '../../i18n/useTranslation';
import { useEffect, useState } from 'react';
import { BoardColorField, BoardPropertyRow } from './BoardPropertyControls';
import { BOARD_COLORS } from './BoardSelectionStyles';
import { useBoardStore } from '../../store/useBoardStore';
import { updateObjects } from '../../services/boards/operations';
import { boardFontFamily } from '../../services/boards/fontFamily';
import type { BoardTextObject } from '../../services/boards/types';
import { boardTextAlignment, boardTextColor, type BoardTypographyObject } from '../../services/boards/textAppearance';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';

export default function BoardTextStyles({ boardId, editable, showCommonStyles = true }: { boardId: string; editable: boolean; showCommonStyles?: boolean }) {
  const { t } = useTranslation();
  const session = useBoardStore(state => state.sessions[boardId]);
  const texts = session.document.objects.filter((object): object is BoardTypographyObject => (object.type === 'text' || object.type === 'shape') && session.selectedObjectIds.includes(object.id));
  const [fonts, setFonts] = useState<string[]>([]);
  const [status, setStatus] = useState<MessageKey | ''>('');
  useEffect(() => {
    let active = true;
    const load = window.electronAPI?.boardsFonts;
    if (!load) return;
    setStatus('canvas.loadingFonts');
    void load().then(result => {
      if (!active) return;
      if (result.success) { setFonts(result.data); setStatus(''); }
      else setStatus('canvas.fontsUnavailable');
    }).catch(() => { if (active) setStatus('canvas.fontsUnavailable'); });
    return () => { active = false; };
  }, []);
  if (!texts.length) return null;
  const first = texts[0];
  const family = texts.every(text => text.fontFamily === first.fontFamily) ? first.fontFamily ?? '' : '__mixed';
  const background = texts.every(text => text.backgroundColor === first.backgroundColor) ? first.backgroundColor : undefined;
  const apply = (patch: Partial<Pick<BoardTextObject, 'fontFamily' | 'backgroundColor' | 'color' | 'fontSize' | 'textAlign' | 'backgroundRoundness'>>, continuous = false) => useBoardStore.getState()[continuous ? 'updateInteraction' : 'executeOperation'](boardId, document => updateObjects(document, texts.map(text => {
    const { color, ...typography } = patch;
    return { id: text.id, ...typography, ...(color === undefined ? {} : text.type === 'shape' ? { textColor: color } : { color }) };
  })));
  const families = [...new Set([...fonts, ...texts.flatMap(text => text.fontFamily ? [text.fontFamily] : []), 'sans-serif', 'serif', 'monospace'])].sort((a, b) => a.localeCompare(b));
  const color = texts.every(text => boardTextColor(text) === boardTextColor(first)) ? boardTextColor(first) : '';
  const size = texts.every(text => text.fontSize === first.fontSize) ? first.fontSize : '';
  const commit = () => useBoardStore.getState().commitInteraction(boardId);
  const alignment = texts.every(text => boardTextAlignment(text) === boardTextAlignment(first)) ? boardTextAlignment(first) : null;
  const roundness = texts.every(text => Math.min(text.backgroundRoundness ?? 8, 24) === Math.min(first.backgroundRoundness ?? 8, 24)) ? Math.min(first.backgroundRoundness ?? 8, 24) : null;
  return <fieldset disabled={!editable} className="board-selection-styles board-text-properties"><legend className={texts.some(text => text.type === 'shape') ? undefined : 'sr-only'}>{texts.some(text => text.type === 'shape') ? t('imageViewer.editor.text') : t('canvas.textProperties')}</legend>{session.selectedObjectIds.length > 1 && <p className="board-property-hint">{t('canvas.textApplies', { count: texts.length })}</p>}
    <label className="board-font-field">{t('canvas.font')}<select className="board-input" aria-label={t('canvas.font')} value={family} onChange={event => apply({ fontFamily: event.target.value || undefined })}>
      <option value="">{t('canvas.default')}</option><option value="__mixed" disabled>{t('canvas.mixed')}</option>
      {families.map(name => <option key={name} value={name} style={{ fontFamily: boardFontFamily(name) }}>{name}</option>)}
    </select></label>
    {showCommonStyles && <><BoardPropertyRow label={t('canvas.size')}><input className="board-input board-number-input" type="number" aria-label={t('canvas.fontSize')} value={size} placeholder={t('canvas.mixed')} min={1} max={300} onChange={event => { const value = Number(event.target.value); if (value >= 1 && value <= 300) apply({ fontSize: value }, true); }} onBlur={commit}/></BoardPropertyRow>
    <BoardPropertyRow label={t('canvas.textColor')}><BoardColorField label={texts.some(text => text.type === 'shape') ? t('canvas.textColor') : t('canvas.customColor')} value={color || '#e5e7eb'} mixed={!color} disabled={!editable} onChange={value => apply({ color: value }, true)} onBlur={commit} presets={BOARD_COLORS} onPreset={value => apply({ color: value })}/></BoardPropertyRow></>}
    <BoardPropertyRow label={t('canvas.alignment')}><div className="board-alignment-options" role="group" aria-label={t('canvas.textAlignment')}>{([{ value: 'left', label: t('canvas.alignLeft'), Icon: AlignLeft }, { value: 'center', label: t('canvas.alignCenter'), Icon: AlignCenter }, { value: 'right', label: t('canvas.alignRight'), Icon: AlignRight }] as const).map(({ value, label, Icon }) => <button type="button" key={value} className="board-icon-button" aria-label={label} title={label} aria-pressed={alignment === value} onClick={() => apply({ textAlign: value })}><Icon size={16}/></button>)}</div></BoardPropertyRow>
    {status && <small role="status">{t(status)}</small>}
    <label className="board-checkbox"><input type="checkbox" aria-label={t('canvas.textBackground')} checked={texts.every(text => !!text.backgroundColor)} ref={element => { if (element) element.indeterminate = texts.some(text => !!text.backgroundColor) && !texts.every(text => !!text.backgroundColor); }} onChange={event => apply({ backgroundColor: event.target.checked ? '#1f2937' : null })}/>{t('canvas.background')}</label>
    {texts.some(text => !!text.backgroundColor) && <><BoardPropertyRow label={t('imageViewer.exr.color')}><BoardColorField label={t('canvas.textBackgroundColor')} value={background || '#1f2937'} mixed={background === undefined} disabled={!editable} onChange={value => apply({ backgroundColor: value }, true)} onBlur={commit}/></BoardPropertyRow>
      <BoardPropertyRow label={t('canvas.corners')}><div className="board-roundness-control"><input type="range" aria-label={t('canvas.backgroundRoundness')} min={0} max={24} step={1} value={roundness ?? 8} aria-valuetext={roundness === null ? t('canvas.mixed') : t('canvas.cornerRadius', { radius: roundness })} onChange={event => apply({ backgroundRoundness: Number(event.target.value) }, true)} onBlur={commit} onPointerUp={commit} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit(); }}/><span>{roundness === null ? t('canvas.mixed') : `${roundness} px`}</span><small>{t('canvas.square')}</small><small>{t('canvas.rounded')}</small></div></BoardPropertyRow></>}
  </fieldset>;
}
