import { useTranslation } from '../../i18n/useTranslation';
import { translatePromptMessage } from '../../i18n/promptMessages';
import { useState } from 'react';
import type { BoardPromptObject } from '../../services/boards/types';
import { updateObjects } from '../../services/boards/operations';
import { useBoardStore } from '../../store/useBoardStore';
import { duplicateBoardSelection } from '../../services/boards/commands';
import { copyTextToClipboard } from '../../utils/imageUtils';
import { useBoardPrompts } from './BoardPromptContext';

export default function BoardPromptInspector({ boardId, card, editable }: { boardId: string; card: BoardPromptObject; editable: boolean }) {
  const { t } = useTranslation();
  const prompts = useBoardPrompts();
  const [status, setStatus] = useState('');
  const count = prompts.counts(card.positivePrompt);
  const edit = (key: 'title' | 'positivePrompt' | 'negativePrompt', value: string) => {
    if (editable) useBoardStore.getState().updateInteraction(boardId, document => updateObjects(document, [{ id: card.id, [key]: value }]));
  };
  const commit = () => useBoardStore.getState().commitInteraction(boardId);
  const copy = async (text: string) => { const result = await copyTextToClipboard(text); setStatus(result.success ? 'promptLibrary.copied' : result.error || 'promptLibrary.copyFailed'); };
  return <section className="board-prompt-inspector">
    <label>{t('imageViewer.collection.title')}<input aria-label={t('promptLibrary.cardTitle')} className="board-input" value={card.title} disabled={!editable} onChange={event => edit('title', event.target.value)} onBlur={commit} /></label>
    <label>{t('imageViewer.provenance.positive')}<textarea data-board-positive-prompt aria-label={t('promptLibrary.cardPositive')} className="board-textarea" value={card.positivePrompt} disabled={!editable} onChange={event => edit('positivePrompt', event.target.value)} onBlur={commit} /></label>
    <button className="board-button" onClick={() => void copy(card.positivePrompt)}>{t('promptLibrary.copyPositive')}</button>
    <label>{t('imageViewer.provenance.negative')}<textarea aria-label={t('promptLibrary.cardNegative')} className="board-textarea" value={card.negativePrompt} disabled={!editable} onChange={event => edit('negativePrompt', event.target.value)} onBlur={commit} /></label>
    <button className="board-button" onClick={() => void copy(card.negativePrompt)}>{t('promptLibrary.copyNegative')}</button>
    <p role="status">{prompts.loading ? t('promptLibrary.loadingMatches') : t('promptLibrary.cardCounts', { canvasCount: count.canvas, libraryCount: count.library })}</p>
    <small>{t('promptLibrary.exactHelp')}</small>
    <button className="board-button" disabled={!editable || prompts.loading || !count.library} onClick={() => prompts.bring(card)}>{t('promptLibrary.bringMatches')}</button>
    <button className="board-button" disabled={!editable} onClick={() => { duplicateBoardSelection(boardId); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-board-positive-prompt]')?.focus()); }}>{t('promptLibrary.duplicateVariation')}</button>
    <button className="board-button" disabled={!editable || !(card.positivePrompt.trim() || card.negativePrompt.trim())} onClick={() => prompts.save(card)}>{t('promptLibrary.saveLibrary')}</button>
    {card.origin?.kind === 'library' && <button className="board-button" onClick={() => { if (card.origin?.kind === 'library') prompts.openLibrary(card.origin.id); }}>{t('promptLibrary.openLibrary')}</button>}
    {status && <p role="status">{translatePromptMessage(status, t)}</p>}
  </section>;
}
