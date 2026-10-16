import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, X } from 'lucide-react';
import { Reorder } from 'framer-motion';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import type { PromptBlock, PromptDocument, PromptLibraryItem, SavedPrompt } from '../../types';
import { compilePrompt, emptyEditor } from '../../services/promptLibrary/core.mjs';
import { appendAdditions, blockAddition, promptAddition, type CompositionAddition } from '../../services/promptLibrary/composition';
import { filterItems, emptyFilters } from '../../services/promptLibrary/search';
import { usePromptDialogFocus } from '../../hooks/usePromptDialogFocus';
import { buttonClass, fieldClass } from './PromptVariables';
import PromptPartCard from './PromptPartCard';

function CatalogRow({ index, style, data }: ListChildComponentProps<{ items: PromptLibraryItem[]; onChoose: (item: PromptLibraryItem) => void }>) {
  const item = data.items[index];
  const isBlock = 'text' in item;
  const title = item.editor?.title || (isBlock ? 'Untitled block' : 'Untitled prompt');
  return <div style={style} className="pb-2 pr-2"><article className="flex h-full items-center gap-3 rounded-lg border border-gray-700 bg-gray-950/40 p-3">
    <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{title}</h3><p className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-gray-400">{isBlock ? item.text : item.positivePrompt || item.negativePrompt}</p>{item.editor?.category && <p className="mt-1 truncate text-[11px] text-gray-400">{item.editor.category}</p>}</div>
    <button type="button" aria-label={`Add ${isBlock ? 'block' : 'prompt'} ${title}`} className={buttonClass + ' shrink-0 !border-accent/30 !text-accent'} onClick={() => data.onChoose(item)}>+ Add</button>
  </article></div>;
}

export default function PromptBlockPicker({ blocks, prompts = [], document, channel, values, onConfirm, onClose }: {
  blocks: PromptBlock[];
  prompts?: SavedPrompt[];
  document: PromptDocument;
  channel: 'positive' | 'negative';
  values: Record<string, string>;
  onConfirm: (additions: CompositionAddition[]) => boolean;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'block' | 'prompt'>('block');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [favorites, setFavorites] = useState(false);
  const [pending, setPending] = useState<CompositionAddition[]>([]);
  const [error, setError] = useState('');
  const ref = usePromptDialogFocus(onClose);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus(); }, []);
  const items = kind === 'block' ? blocks : prompts;
  const categories = useMemo(() => [...new Set(items.map(item => item.editor?.category).filter(Boolean))].sort(), [items]);
  const visible = useMemo(() => filterItems(items, { ...emptyFilters, query, category, favorite: favorites }), [items, query, category, favorites]);
  let validationError = '';
  let proposed = document;
  try { proposed = appendAdditions(document, pending); }
  catch (cause) { validationError = cause instanceof Error ? cause.message : 'Conflicting variables'; }
  const result = compilePrompt({ editor: { ...emptyEditor(), document: proposed } }, values);
  const choose = (item: PromptLibraryItem) => {
    try {
      const addition = 'text' in item ? blockAddition(item, channel) : promptAddition(item);
      if (!addition.positive.length && !addition.negative.length) { setError('This prompt has no text to add.'); return; }
      appendAdditions(document, [...pending, addition]);
      setPending(current => [...current, addition]); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Conflicting variables'); }
  };
  const move = (from: number, to: number) => {
    if (from < 0 || to < 0 || to >= pending.length) return;
    setPending(current => { const next = [...current]; const [addition] = next.splice(from, 1); next.splice(to, 0, addition); return next; });
  };
  const noun = pending.some(item => item.kind === 'prompt') ? pending.every(item => item.kind === 'prompt') ? 'prompt' : 'item' : 'block';
  return createPortal(<div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4"><section ref={ref} role="dialog" aria-modal="true" aria-label="Choose prompt blocks" className="flex h-[85vh] max-h-[760px] w-full max-w-[1100px] flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 text-gray-100 shadow-2xl">
    <header className="flex shrink-0 items-center justify-between border-b border-gray-700 p-4"><div><h2 className="font-semibold">Add to Compose</h2><p className="text-xs text-gray-400">Blocks go to {channel === 'negative' ? 'Negative' : 'Prompt'}. Saved prompts include both channels.</p></div><button type="button" className="app-top-icon-button" aria-label="Close block picker" onClick={onClose}><X size={16} /></button></header>
    <div className="grid min-h-0 flex-1 overflow-y-auto min-[900px]:grid-cols-[45%_55%] min-[900px]:overflow-hidden">
      <section aria-label="Item catalog" className="flex min-h-0 flex-col gap-3 p-4 min-[900px]:border-r min-[900px]:border-gray-700">
        <div role="tablist" aria-label="Items to add" className="app-top-segmented self-start">{(['block', 'prompt'] as const).map(tab => <button key={tab} type="button" role="tab" aria-selected={kind === tab} className={`app-top-segment ${kind === tab ? 'app-top-segment-active' : ''}`} onClick={() => { setKind(tab); setQuery(''); setCategory(''); }}>{tab === 'block' ? 'Blocks' : 'Prompts'}</button>)}</div>
        <div className="flex items-center gap-2"><Search size={16} className="shrink-0 text-gray-400" /><input ref={searchRef} aria-label={kind === 'block' ? 'Search blocks' : 'Search prompts'} className={fieldClass} type="search" placeholder={`Search ${kind === 'block' ? 'blocks' : 'prompts'}, tags and content…`} value={query} onChange={e => setQuery(e.target.value)} /></div>
        <div className="flex flex-wrap items-center gap-2"><button type="button" className={buttonClass + (favorites ? ' !border-accent !bg-accent/15 !text-accent ring-1 ring-accent/30' : '')} aria-pressed={favorites} onClick={() => setFavorites(!favorites)}>{favorites && <Check size={14} aria-hidden="true" />}Favorites only</button>{kind === 'block' && <select aria-label="Block category" className={fieldClass + ' !w-auto min-w-0 flex-1'} value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>}</div>
        <div className="h-[min(220px,30vh)] min-h-[100px] min-[900px]:h-auto min-[900px]:flex-1">{visible.length ? <AutoSizer>{({ width, height }) => <FixedSizeList height={height || 260} width={width || 400} itemSize={108} itemCount={visible.length} itemData={{ items: visible, onChoose: choose }} itemKey={index => visible[index].id}>{CatalogRow}</FixedSizeList>}</AutoSizer> : <p className="p-6 text-center text-sm text-gray-400">{items.length ? `No matching ${kind === 'block' ? 'blocks' : 'prompts'}.` : kind === 'block' ? 'No blocks yet. Create reusable text in Blocks to add it here.' : 'No saved prompts yet.'}</p>}</div>
      </section>
      <section aria-label="Selected items" className="flex min-h-0 flex-col gap-3 p-4">
        <h3 className="shrink-0 text-sm font-semibold">Selected items <span role="status" className="text-gray-400">({pending.length})</span></h3>
        {(error || validationError) && <p role="alert" className="shrink-0 text-xs text-amber-600 dark:text-amber-300">{error || validationError}</p>}
        <Reorder.Group as="div" axis="y" values={pending} onReorder={setPending} layoutScroll className="min-h-0 flex-1 space-y-2 overflow-y-auto p-1">
          {!pending.length && <p className="rounded-lg border border-dashed border-gray-700 p-4 text-sm text-gray-400">Use + Add to select blocks or saved prompts, then confirm.</p>}
          {pending.map((addition, index) => <PromptPartCard key={addition.id} reorderValue={addition} part={{ id: addition.id, kind: 'block', enabled: true, title: addition.title, text: [...addition.positive.map(part => part.text), ...addition.negative.map(part => `Negative: ${part.text}`)].join('\n') }} index={index} count={pending.length} channel={channel} disabled={false} onMove={to => move(index, to)} onRemove={() => { setPending(current => current.filter(item => item.id !== addition.id)); setError(''); }} />)}
        </Reorder.Group>
      </section>
    </div>
    <section aria-label="Preview" className="max-h-[26vh] shrink-0 space-y-2 overflow-y-auto border-t border-gray-700 bg-gray-950/70 px-4 py-3"><h3 className="text-xs font-semibold">Preview</h3>{result.errors.length > 0 && <p className="text-xs text-amber-600 dark:text-amber-300">{result.errors.join(' ')} Fill pending fields in the editor after adding.</p>}{result.positivePrompt && <pre aria-label="Prompt preview" className="whitespace-pre-wrap break-words text-sm leading-relaxed">{result.positivePrompt}</pre>}{result.negativePrompt && <div><p className="text-[11px] font-semibold text-gray-400">Negative prompt</p><pre aria-label="Negative prompt preview" className="whitespace-pre-wrap break-words text-sm leading-relaxed">{result.negativePrompt}</pre></div>}{!result.positivePrompt && !result.negativePrompt && <p className="text-xs text-gray-400">Add items to preview the result.</p>}</section>
    <footer className="flex shrink-0 justify-end gap-2 border-t border-gray-700 p-3"><button type="button" className={buttonClass} onClick={onClose}>Cancel</button><button type="button" className={buttonClass + ' !border-accent/40 !bg-accent/15'} disabled={!pending.length || !!validationError} onClick={() => { if (onConfirm(pending)) onClose(); else setError('The selected items could not be added. Check the composition and try again.'); }}>Add {pending.length} {noun}{pending.length === 1 ? '' : 's'}</button></footer>
  </section></div>, window.document.body);
}
