import { useState } from 'react';
import type { BoardPromptObject } from '../../services/boards/types';
import { updateObjects } from '../../services/boards/operations';
import { useBoardStore } from '../../store/useBoardStore';
import { duplicateBoardSelection } from '../../services/boards/commands';
import { copyTextToClipboard } from '../../utils/imageUtils';
import { useBoardPrompts } from './BoardPromptContext';

export default function BoardPromptInspector({ boardId, card, editable }: { boardId: string; card: BoardPromptObject; editable: boolean }) {
  const prompts = useBoardPrompts();
  const [status, setStatus] = useState('');
  const count = prompts.counts(card.positivePrompt);
  const edit = (key: 'title' | 'positivePrompt' | 'negativePrompt', value: string) => {
    if (editable) useBoardStore.getState().updateInteraction(boardId, document => updateObjects(document, [{ id: card.id, [key]: value }]));
  };
  const commit = () => useBoardStore.getState().commitInteraction(boardId);
  const copy = async (text: string) => { const result = await copyTextToClipboard(text); setStatus(result.success ? 'Copied.' : result.error || 'Could not copy prompt.'); };
  return <section className="board-prompt-inspector">
    <label>Title<input aria-label="Prompt card title" className="board-input" value={card.title} disabled={!editable} onChange={event => edit('title', event.target.value)} onBlur={commit} /></label>
    <label>Positive prompt<textarea aria-label="Card positive prompt" className="board-textarea" value={card.positivePrompt} disabled={!editable} onChange={event => edit('positivePrompt', event.target.value)} onBlur={commit} /></label>
    <button className="board-button" onClick={() => void copy(card.positivePrompt)}>Copy positive</button>
    <label>Negative prompt<textarea aria-label="Card negative prompt" className="board-textarea" value={card.negativePrompt} disabled={!editable} onChange={event => edit('negativePrompt', event.target.value)} onBlur={commit} /></label>
    <button className="board-button" onClick={() => void copy(card.negativePrompt)}>Copy negative</button>
    <p role="status">{prompts.loading ? 'Loading matches…' : `${count.canvas} images on this Canvas · ${count.library} in library`}</p>
    <small>Exact positive prompt. Ignores outer whitespace and line ending format.</small>
    <button className="board-button" disabled={!editable || prompts.loading || !count.library} onClick={() => prompts.bring(card)}>Bring matching images…</button>
    <button className="board-button" disabled={!editable} onClick={() => { duplicateBoardSelection(boardId); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[aria-label="Card positive prompt"]')?.focus()); }}>Duplicate as variation</button>
    <button className="board-button" disabled={!editable || !(card.positivePrompt.trim() || card.negativePrompt.trim())} onClick={() => prompts.save(card)}>Save to Prompt Library…</button>
    {card.origin?.kind === 'library' && <button className="board-button" onClick={() => { if (card.origin?.kind === 'library') prompts.openLibrary(card.origin.id); }}>Open in Prompt Library</button>}
    {status && <p role="status">{status}</p>}
  </section>;
}
