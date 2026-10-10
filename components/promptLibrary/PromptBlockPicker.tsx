import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Blocks, Search, X } from 'lucide-react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import type { PromptBlock } from '../../types';
import { filterItems, emptyFilters } from '../../services/promptLibrary/search';
import { usePromptLibraryPreview } from '../../hooks/usePromptLibraryPreview';
import { usePromptDialogFocus } from '../../hooks/usePromptDialogFocus';
import { fieldClass } from './PromptVariables';

function BlockRow({ index, style, data }: ListChildComponentProps<{ blocks: PromptBlock[]; onChoose: (block: PromptBlock) => void; inline?: boolean }>) {
  const block = data.blocks[index];
  const preview = usePromptLibraryPreview(block);
  const [expanded, setExpanded] = useState(false);
  if (data.inline) return <div style={style} className="pb-2"><article className="flex h-full items-center gap-2 rounded-lg border border-gray-700 bg-gray-950/30 p-2">
    <button aria-label={`Inspect block ${block.editor.title || 'Untitled block'}`} className="min-w-0 flex-1 text-left" onClick={() => setExpanded(!expanded)}><h3 className="truncate text-xs font-semibold">{block.editor.title || 'Untitled block'}</h3><p className={`whitespace-pre-wrap break-words text-xs text-gray-400 ${expanded ? 'max-h-16 overflow-auto' : 'line-clamp-2'}`}>{block.text}</p>{block.editor.category && <p className="text-[11px] text-accent">{block.editor.category}</p>}</button>
    <button aria-label={`Add block ${block.editor.title || 'Untitled block'}`} className="shrink-0 rounded border border-accent/30 px-2 py-1.5 text-xs text-accent" onClick={() => data.onChoose(block)}>+ Add</button>
  </article></div>;
  return <div style={style} className="pb-2 pr-2"><button className="flex h-full w-full items-center gap-3 rounded-lg border border-gray-700 bg-gray-950/30 p-3 text-left hover:border-accent/50 hover:bg-accent/5" onClick={() => data.onChoose(block)}>
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-950 text-gray-500">{preview.url ? <img alt="" src={preview.url} className="h-full w-full object-cover" /> : <Blocks size={20} />}</div>
    <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{block.editor.title || 'Untitled block'}</h3><p className="line-clamp-2 text-xs text-gray-400">{block.text}</p>{block.editor.category && <p className="mt-1 text-[11px] text-accent">{block.editor.category}</p>}</div>
  </button></div>;
}
export default function PromptBlockPicker({ blocks, channel, onChoose, onClose, inline = false }: { blocks: PromptBlock[]; channel: string; onChoose: (block: PromptBlock) => boolean | void; onClose: () => void; inline?: boolean }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [favorites, setFavorites] = useState(false);
  const [status, setStatus] = useState('');
  const ref = usePromptDialogFocus(onClose, false, !inline);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus(); }, []);
  const categories = [...new Set(blocks.map(b => b.editor.category).filter(Boolean))].sort();
  const visible = useMemo(() => filterItems(blocks, { ...emptyFilters, query, category, favorite: favorites }) as PromptBlock[], [blocks, query, category, favorites]);
  const content = <div className={inline ? '' : 'fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4'}><section ref={ref} role="dialog" aria-modal={inline ? undefined : true} aria-label="Choose a prompt block" className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 rounded-xl border border-gray-700 bg-gray-900 p-3 text-gray-100">
    <header className="flex items-center justify-between"><h2 className="font-semibold">Add block to {channel} prompt</h2><button className="app-top-icon-button" aria-label="Close block picker" onClick={onClose}><X size={16} /></button></header>
    <details className="text-xs text-gray-400"><summary className="cursor-pointer">About saved copies</summary><p>A saved copy of the block is inserted. Later edits to the original will not change this composition.</p></details>
    <div className="flex items-center gap-2"><Search size={16} className="text-gray-500" /><input ref={searchRef} aria-label="Search blocks" className={fieldClass} type="search" placeholder="Search blocks, tags and content…" value={query} onChange={e => setQuery(e.target.value)} /></div>
    {inline && <button className="self-start rounded border border-gray-700 px-2 py-1 text-xs" aria-pressed={favorites} onClick={() => setFavorites(!favorites)}>Favorites only</button>}
    {status && <p role="status" className="text-xs text-accent">{status}</p>}
    {categories.length > 0 && <div className="flex flex-wrap gap-1.5">{['', ...categories].map(c => <button key={c} className={`rounded-full border px-3 py-1 text-xs ${c === category ? 'border-accent/40 bg-accent/15 text-gray-100' : 'border-gray-700 text-gray-400'}`} aria-pressed={c === category} onClick={() => setCategory(c)}>{c || 'All categories'}</button>)}</div>}
    <div className="h-[min(360px,45vh)] min-h-0">{visible.length ? <AutoSizer>{({ width, height }) => <FixedSizeList height={height || 360} width={width || 550} itemSize={inline ? 100 : 108} itemCount={visible.length} itemData={{ blocks: visible, inline, onChoose: (block: PromptBlock) => { const added = onChoose(block); if (inline) setStatus(added === false ? 'Block could not be added. Check the composition error.' : `Added ${block.editor.title || 'block'} to ${channel}.`); } }} itemKey={index => visible[index].id}>{BlockRow}</FixedSizeList>}</AutoSizer> : <p className="p-6 text-center text-sm text-gray-400">{blocks.length ? 'No matching blocks.' : 'No blocks yet. Save a selected prompt fragment as a block, or create one in Blocks.'}</p>}</div>
  </section></div>;
  return inline ? content : createPortal(content, document.body);
}
