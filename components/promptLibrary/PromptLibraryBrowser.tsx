import React, { useMemo, useState } from 'react';
import { Bookmark, Blocks, Heart, LayoutGrid, List, SlidersHorizontal } from 'lucide-react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import type { PromptLibraryItem } from '../../types';
import { itemTitle, itemType, type PromptLibraryFilters } from '../../services/promptLibrary/search';
import { usePromptLibraryPreview } from '../../hooks/usePromptLibraryPreview';
import { buttonClass, fieldClass } from './PromptVariables';

type Rows = {
  selected: Set<string>; activeId?: string; selectionMode: boolean;
  onOpen: (item: PromptLibraryItem) => void; onSelect: (id: string) => void; onFavorite: (item: PromptLibraryItem) => void;
};
function Card({ item, data, grid }: { item: PromptLibraryItem; data: Rows; grid: boolean }) {
  const preview = usePromptLibraryPreview(item);
  const text = 'text' in item ? item.text : item.positivePrompt || item.negativePrompt;
  const badge = 'text' in item ? item.editor?.category : itemType(item) === 'template' ? 'Template' : null;
  const model = item.editor?.metadata.model?.trim();
  const title = item.editor?.title?.trim() || ('text' in item ? 'Untitled block' : '');
  return <article onClick={() => { if (data.selectionMode) data.onSelect(item.id); }} className={`group relative flex h-full min-w-0 rounded-xl border transition-colors ${data.selectionMode ? 'cursor-pointer' : ''} ${grid ? 'flex-col' : 'items-center gap-3 p-3'} ${(data.selectionMode ? data.selected.has(item.id) : data.activeId === item.id) ? 'border-accent/60 bg-accent/10' : 'border-gray-700/70 bg-gray-900/50 hover:border-gray-600'}`}>
    {data.selectionMode && <input className={grid ? 'absolute left-3 top-3 z-10' : 'shrink-0'} aria-label={`Select ${itemTitle(item)}`} type="checkbox" checked={data.selected.has(item.id)} onClick={e => e.stopPropagation()} onChange={() => data.onSelect(item.id)} />}
    <button type="button" aria-label={`${data.selectionMode ? 'Select card' : 'Open'} ${itemTitle(item)}`} aria-pressed={data.selectionMode ? data.selected.has(item.id) : undefined} className={`flex min-w-0 flex-1 text-left ${grid ? 'flex-col overflow-hidden' : 'items-center gap-3'}`} onClick={e => { e.stopPropagation(); if (data.selectionMode) data.onSelect(item.id); else data.onOpen(item); }}>
      <div className={`flex shrink-0 items-center justify-center overflow-hidden bg-gray-950/60 text-gray-600 ${grid ? 'h-32 w-full rounded-t-xl' : 'h-16 w-16 rounded-lg'}`}>
        {preview.url ? <img src={preview.url} alt="" className="h-full w-full object-cover" /> : 'text' in item ? <Blocks size={24} /> : <Bookmark size={24} />}
      </div>
      <div className={`min-w-0 flex-1 ${grid ? 'p-3 pr-10' : 'pr-8'}`}>
        {title && <p className="truncate text-sm font-semibold">{title}</p>}
        <p className={`${title ? 'mt-1 ' : ''}line-clamp-2 whitespace-pre-wrap break-words text-xs text-gray-400`}>{text}</p>
        {(badge || model || !!item.editor?.tags.length) && <div className="mt-2 flex items-center gap-1.5 overflow-hidden text-[11px] text-gray-400">
          {badge && <span className="shrink-0 rounded border border-accent/25 bg-accent/10 px-1.5 text-accent">{badge}</span>}
          {model && <span className="truncate">{model}</span>}
          {item.editor?.tags.slice(0, 2).map(tag => <span key={tag} className="truncate rounded-full bg-gray-800/60 px-2">{tag}</span>)}
        </div>}
      </div>
    </button>
    <button type="button" aria-label={`${item.editor?.favorite ? 'Unfavorite' : 'Favorite'} ${itemTitle(item)}`} className={`absolute right-2 ${grid ? 'bottom-16' : 'top-3'} rounded-md p-1.5 ${item.editor?.favorite ? 'text-red-400' : 'text-gray-500 hover:text-gray-200'}`} onClick={e => { e.stopPropagation(); data.onFavorite(item); }}><Heart size={16} fill={item.editor?.favorite ? 'currentColor' : 'none'} /></button>
  </article>;
}
type RowData = Rows & { items: PromptLibraryItem[]; columns: number; grid: boolean };
function Row({ index, style, data }: ListChildComponentProps<RowData>) {
  return <div style={style} className="pb-2 pr-2"><div className="grid h-full gap-2" style={{ gridTemplateColumns: `repeat(${data.columns}, minmax(0, 1fr))` }}>
    {data.items.slice(index * data.columns, (index + 1) * data.columns).map(item => <Card key={item.id} item={item} data={data} grid={data.grid} />)}
  </div></div>;
}
export default function PromptLibraryBrowser({ all, visible, filters, onFilters, selected, activeId, onOpen, onSelect, onFavorite, selectionMode, onSelectionMode, showFilters, onToggleFilters }: Rows & {
  all: PromptLibraryItem[]; visible: PromptLibraryItem[]; filters: PromptLibraryFilters;
  onFilters: (filters: PromptLibraryFilters) => void; onSelectionMode: () => void;
  showFilters: boolean; onToggleFilters: () => void;
}) {
  const [grid, setGrid] = useState(false);
  const rows = useMemo(() => ({ items: visible, selected, activeId, onOpen, onSelect, onFavorite, selectionMode }), [visible, selected, activeId, onOpen, onSelect, onFavorite, selectionMode]);
  const filterCount = filters.tags.length + filters.models.length + Number(filters.favorite) + Number(!!filters.type) + Number(!!filters.category) + Number(!!filters.from || !!filters.to);
  return <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
    <div className="flex gap-2"><input type="search" aria-label="Search saved prompts" className={fieldClass + ' min-w-0'} placeholder="Search prompts, tags and content…" value={filters.query} onChange={e => onFilters({ ...filters, query: e.target.value })} /><button aria-label="Filters" aria-pressed={showFilters} className={buttonClass + (showFilters ? ' !border-accent/40 !bg-accent/15' : '')} onClick={onToggleFilters}><SlidersHorizontal size={15} />{filterCount > 0 && filterCount}</button></div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
      <span className="mr-auto">{visible.length === all.length ? `${all.length} items` : `${visible.length} of ${all.length} items`}</span>
      <select aria-label="Sort prompts" className={fieldClass + ' !w-auto !py-1.5 !text-xs'} value={filters.sort} onChange={e => onFilters({ ...filters, sort: e.target.value as PromptLibraryFilters['sort'] })}><option value="saved">Date saved</option><option value="updated">Last updated</option><option value="title">Title</option><option value="source">Source date</option></select>
      <button aria-label="Reverse sort order" className="app-top-icon-button" onClick={() => onFilters({ ...filters, descending: !filters.descending })}>{filters.descending ? '↓' : '↑'}</button>
      <div className="app-top-segmented"><button aria-label="List view" aria-pressed={!grid} className={`app-top-segment !px-2 ${!grid ? 'app-top-segment-active' : ''}`} onClick={() => setGrid(false)}><List size={15} /></button><button aria-label="Grid view" aria-pressed={grid} className={`app-top-segment !px-2 ${grid ? 'app-top-segment-active' : ''}`} onClick={() => setGrid(true)}><LayoutGrid size={15} /></button></div>
      <button aria-pressed={selectionMode} className={buttonClass} onClick={onSelectionMode}>{selectionMode ? 'Done selecting' : 'Select'}</button>
    </div>
    {filterCount > 0 && <div className="flex flex-wrap gap-1 text-xs text-gray-400">{[...filters.tags, ...filters.models, filters.favorite && 'Favorites', filters.type, filters.category, (filters.from || filters.to) && 'Date range'].filter(Boolean).map((label, index) => <span key={index} className="rounded-full border border-gray-700 px-2 py-1">{label}</span>)}<button className="px-2 text-accent" onClick={() => onFilters({ ...filters, tags: [], models: [], favorite: false, type: '', category: '', from: '', to: '' })}>Clear filters</button></div>}
    <div className="min-h-0 flex-1">
      {!visible.length ? <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center text-sm text-gray-400"><Bookmark size={28} /><p>{all.length ? 'No matching prompts' : 'No saved prompts yet'}</p><p className="text-xs">{all.length ? 'Try another search or clear your filters.' : 'Create a prompt or save one from an image to get started.'}</p></div> : <AutoSizer>{({ width, height }) => {
        const columns = grid ? Math.max(1, Math.floor(width / 230)) : 1;
        return <FixedSizeList height={height || 400} width={width || 400} itemSize={grid ? 244 : 112} itemCount={Math.ceil(visible.length / columns)} itemData={{ ...rows, columns, grid }} itemKey={index => `${columns}:${visible[index * columns].id}`} overscanCount={2}>{Row}</FixedSizeList>;
      }}</AutoSizer>}
    </div>
  </div>;
}
