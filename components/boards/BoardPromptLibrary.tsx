import { Bookmark } from 'lucide-react';
import { usePromptLibraryPreview } from '../../hooks/usePromptLibraryPreview';
import { useEffect, useState } from 'react';
import { useSavedPromptStore } from '../../store/useSavedPromptStore';
import type { SavedPrompt } from '../../types';
import type { BoardPromptInput } from '../../services/boards/types';
import { itemTitle } from '../../services/promptLibrary/search';
import { setPromptDrag } from '../../services/boards/prompts';
import PromptCardDialog, { materializeCanvasPrompt } from './PromptCardDialog';
import { useBoardPrompts } from './BoardPromptContext';

export default function BoardPromptLibrary({ editable }: { editable: boolean }) {
  const { prompts, loadLibrary, isLoading, error } = useSavedPromptStore();
  const actions = useBoardPrompts();
  const [search, setSearch] = useState('');
  const [preparing, setPreparing] = useState<SavedPrompt | null>(null);
  const [prepared, setPrepared] = useState<Record<string, { revision: number; input: BoardPromptInput }>>({});
  useEffect(() => { void loadLibrary(); }, [loadLibrary]);
  const resolve = (item: SavedPrompt) => {
    if (item.editor?.document?.mode === 'template') return prepared[item.id]?.revision === (item.revision ?? 1) ? prepared[item.id].input : null;
    try { return materializeCanvasPrompt(item); } catch { return null; }
  };
  const visible = prompts.filter(item => `${itemTitle(item)} ${item.positivePrompt} ${item.negativePrompt}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="board-prompt-library">
    <label>Search prompts<input aria-label="Search canvas prompts" className="board-input" value={search} onChange={event => setSearch(event.target.value)} /></label>
    {isLoading && <p role="status">Loading prompts…</p>}{error && <p role="alert">{error}<button className="board-button" onClick={() => void loadLibrary()}>Retry</button></p>}
    {!isLoading && !visible.length && <p>No matching saved prompts.</p>}
    {visible.map(item => <PromptLibraryCard key={item.id} item={item} input={resolve(item)} editable={editable} add={actions.add} prepare={() => setPreparing(item)} />)}
    {preparing && <PromptCardDialog key={preparing.id} item={preparing} onClose={() => setPreparing(null)} onPrepared={input => { setPrepared(current => ({ ...current, [preparing.id]: { revision: preparing.revision ?? 1, input } })); setPreparing(null); }} />}
  </div>;
}

function PromptLibraryCard({ item, input, editable, add, prepare }: { item: SavedPrompt; input: BoardPromptInput | null; editable: boolean; add(input: BoardPromptInput): void; prepare(): void }) {
  const preview = usePromptLibraryPreview(item);
  return <article draggable={editable && !!input} onDragStart={event => { if (editable && input) setPromptDrag(event.dataTransfer, input); else event.preventDefault(); }}>
    <div className="board-prompt-library-summary">
      <div className="board-prompt-library-preview" title={preview.status || itemTitle(item)}>
        {preview.url ? <img src={preview.url} alt={`Preview for ${itemTitle(item)}`} draggable={false} /> : <Bookmark size={22} aria-hidden="true" />}
      </div>
      <div className="board-prompt-library-copy"><strong>{itemTitle(item)}</strong><p>{input?.positivePrompt ?? item.positivePrompt}</p></div>
    </div>
    <button className="board-button" disabled={!editable} onClick={() => { if (input) add(input); else prepare(); }}>{input ? 'Add to canvas' : 'Fill template values…'}</button>
    {item.editor?.document?.mode === 'template' && input && <button className="board-button" disabled={!editable} onClick={prepare}>Change values…</button>}
    <small>{input ? 'Drag to place on canvas' : 'Confirm template values before dragging'}</small>
  </article>;
}
