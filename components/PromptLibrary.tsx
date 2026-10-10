import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Blocks, MoreHorizontal, Plus } from 'lucide-react';
import type { PromptBlock, PromptLibraryItem, SavedPrompt } from '../types';
import { useSavedPromptStore } from '../store/useSavedPromptStore';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { usePromptDialogFocus } from '../hooks/usePromptDialogFocus';
import { emptyEditor, normalizeEditor } from '../services/promptLibrary/core.mjs';
import { emptyFilters, filterItems, type PromptLibraryFilters } from '../services/promptLibrary/search';
import { sessionDraft, clearDraft } from '../services/promptLibrary/sessionDraft';
import PromptLibraryBrowser from './promptLibrary/PromptLibraryBrowser';
import PromptLibraryFiltersPanel from './promptLibrary/PromptLibraryFilters';
import PromptDetails from './promptLibrary/PromptDetails';
import PromptEditor from './promptLibrary/PromptEditor';
import PromptImportExportDialog from './promptLibrary/PromptImportExportDialog';
import PromptDuplicatesPanel from './promptLibrary/PromptDuplicatesPanel';
import PromptTagsInput from './promptLibrary/PromptTagsInput';
import { buttonClass, fieldClass } from './promptLibrary/PromptVariables';

function UnsavedDialog({ onSave, onDiscard, onCancel }: { onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  const ref = usePromptDialogFocus(onCancel);
  return <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4"><section ref={ref} role="dialog" aria-modal="true" aria-label="Unsaved changes" className="space-y-4 rounded-xl border border-gray-700 bg-gray-900 p-5"><h3 className="font-semibold">Save your changes before leaving?</h3><p className="text-xs text-gray-400">Your saved item has not been changed yet.</p><div className="flex justify-end gap-2"><button className={buttonClass} onClick={onCancel}>Cancel</button><button className={buttonClass} onClick={onDiscard}>Discard</button><button className={buttonClass + ' !border-accent/40 !bg-accent/15'} onClick={onSave}>Save</button></div></section></div>;
}
export default function PromptLibrary({ onViewSource }: { onViewSource: (path: string) => void | Promise<void> }) {
  const { prompts, blocks, loadLibrary, mutate, error, isLoading, selectedPromptId, select } = useSavedPromptStore();
  const { canUseAdvancedPromptLibrary, showProModal } = useFeatureAccess();
  const [kind, setKind] = useState<'prompt' | 'block'>(sessionDraft?.kind || 'prompt');
  const [filters, setFilters] = useState<PromptLibraryFilters>(emptyFilters);
  const [selected, setSelected] = useState(new Set<string>());
  const [selectionMode, setSelectionMode] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<Partial<SavedPrompt & PromptBlock> | null>(sessionDraft?.initial || null);
  const [editorKey, setEditorKey] = useState(0);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [toolsMenu, setToolsMenu] = useState(false);
  const [actionError, setActionError] = useState('');
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [bulkCategory, setBulkCategory] = useState('');
  const dirty = useRef(false);
  const saveIntent = useRef<(() => void) | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [requestSave, setRequestSave] = useState(0);
  const onDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  useEffect(() => { void loadLibrary(); }, [loadLibrary]);
  const all: PromptLibraryItem[] = kind === 'prompt' ? prompts : blocks;
  const visible = useMemo(() => filterItems(all, filters), [all, filters]);
  const active = all.find(item => item.id === selectedPromptId);
  const change = (action: () => void) => {
    if (dirty.current) setPending(() => action);
    else { clearDraft(); action(); }
  };
  const open = (item: PromptLibraryItem) => change(() => { setEditing(null); select(item.id); setShowDuplicates(false); dirty.current = false; });
  const startEdit = () => { if (active) { setEditing(active); setEditorKey(k => k + 1); } };
  const selectId = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const run = async (operation: Parameters<typeof mutate>[0]) => {
    try { setActionError(''); const id = await mutate(operation); return { success: true as const, id }; }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Operation failed'); return { success: false as const }; }
  };
  const gate = () => { if (canUseAdvancedPromptLibrary) return true; showProModal('prompt_library_advanced'); return false; };
  const create = () => {
    if (kind === 'block' && !gate()) return;
    change(() => { setEditing({ editor: emptyEditor(), positivePrompt: '', negativePrompt: '', text: '' }); setEditorKey(k => k + 1); select(null); dirty.current = false; });
  };
  const bulk = (patch: { addTags?: string[]; removeTags?: string[]; favorite?: boolean; category?: string }) => { if (gate()) void run({ action: 'bulk', kind, ids: [...selected], ...patch }); };
  const afterSaved = (id?: string) => {
    setRequestSave(0); setEditing(null); select(id || null); setEditorKey(key => key + 1); dirty.current = false;
    if (saveIntent.current) { const action = saveIntent.current; saveIntent.current = null; setPending(null); action(); }
  };
  const duplicate = () => { if (active) void run({ action: 'duplicate', kind, id: active.id }).then(result => { if (result.success) afterSaved(result.id); }); };
  const remove = () => { if (active && window.confirm('Remove this saved item?')) void run({ action: 'remove', kind, id: active.id }).then(result => { if (result.success) { setEditing(null); select(null); } }); };
  const favorite = (item: PromptLibraryItem) => {
    const editor = normalizeEditor(item.editor);
    void run({ action: 'update', kind: 'text' in item ? 'block' : 'prompt', item: { ...item, editor: { ...editor, favorite: !editor.favorite } }, expectedRevision: item.revision || 1 });
  };
  const resetKind = (next: 'prompt' | 'block') => change(() => { setKind(next); setEditing(null); select(null); setSelected(new Set()); setSelectionMode(false); setFilters(emptyFilters); setShowDuplicates(false); dirty.current = false; });
  const setBrowseFilters = (next: PromptLibraryFilters) => { setFilters(next); setSelected(new Set()); };
  const exportSnapshot = useMemo(() => {
    if (kind === 'block') return { prompts: [], blocks: selected.size ? blocks.filter(item => selected.has(item.id)) : visible as PromptBlock[] };
    const exporting = selected.size ? prompts.filter(item => selected.has(item.id)) : visible as SavedPrompt[];
    const references = new Set(exporting.flatMap(item => [...(item.editor?.document?.positive || []), ...(item.editor?.document?.negative || [])].map(part => part.blockId)));
    return { prompts: exporting, blocks: blocks.filter(item => references.has(item.id)) };
  }, [kind, selected, prompts, blocks, visible]);
  const filteredSnapshot = useMemo(() => {
    if (kind === 'block') return { prompts: [], blocks: visible as PromptBlock[] };
    const references = new Set(visible.flatMap(item => [...(item.editor?.document?.positive || []), ...(item.editor?.document?.negative || [])].map(part => part.blockId)));
    return { prompts: visible as SavedPrompt[], blocks: blocks.filter(item => references.has(item.id)) };
  }, [kind, visible, blocks]);
  return <section className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden text-gray-100" aria-label="Prompt Library">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-700 pb-3">
      <div className="mr-auto flex items-center gap-2"><Bookmark size={18} className="text-accent" /><h2 className="text-sm font-semibold">Prompt Library</h2></div>
      <div className="app-top-segmented"><button aria-pressed={kind === 'prompt'} className={`app-top-segment ${kind === 'prompt' ? 'app-top-segment-active' : ''}`} onClick={() => resetKind('prompt')}><Bookmark size={14} />Prompts</button><button aria-pressed={kind === 'block'} className={`app-top-segment ${kind === 'block' ? 'app-top-segment-active' : ''}`} onClick={() => resetKind('block')}><Blocks size={14} />Blocks</button></div>
      <button className={buttonClass + ' !border-accent/40 !bg-accent/15 !text-gray-100'} onClick={create}><Plus size={15} />New {kind}</button>
      <div className="relative"><button className="app-top-icon-button" aria-label="Library tools" aria-expanded={toolsMenu} onClick={() => setToolsMenu(!toolsMenu)}><MoreHorizontal size={18} /></button>{toolsMenu && <><button tabIndex={-1} className="fixed inset-0 z-20 cursor-default" aria-label="Close library tools" onClick={() => setToolsMenu(false)} /><div className="absolute right-0 top-11 z-30 w-48 rounded-lg border border-gray-700 bg-gray-900 p-1 shadow-xl"><button className="block w-full rounded p-2 text-left text-xs hover:bg-gray-800 disabled:opacity-40" disabled={kind !== 'prompt' || !visible.length} onClick={() => { setToolsMenu(false); const candidates = visible.length > 1 ? visible.filter(p => p.id !== active?.id) : visible; open(candidates[Math.floor(Math.random() * candidates.length)]); }}>Random</button><button className="block w-full rounded p-2 text-left text-xs hover:bg-gray-800" onClick={() => { setToolsMenu(false); setShowTransfer(true); }}>Import / Export</button></div></>}</div>
    </header>
    {(error || actionError) && <div role="alert" className="shrink-0 rounded border border-red-500/40 p-2 text-sm text-red-400">{actionError || error}<button className={buttonClass + ' ml-2'} onClick={() => void loadLibrary()}>Retry</button></div>}
    {selectionMode && <div className="shrink-0 space-y-2 rounded-xl border border-accent/25 bg-accent/5 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2"><span className="mr-auto font-semibold">{selected.size} selected</span><button className={buttonClass} onClick={() => setSelected(new Set(visible.map(p => p.id)))}>Select filtered ({visible.length})</button><button className={buttonClass} onClick={() => { setSelected(new Set()); setSelectionMode(false); }}>Clear selection</button></div>
      {selected.size > 0 && <div className="flex flex-wrap items-end gap-2"><div className="w-56"><PromptTagsInput label="Bulk tags" tags={bulkTags} onChange={setBulkTags} suggestions={all.flatMap(i => i.editor?.tags || [])} /></div><button className={buttonClass} onClick={() => bulk({ addTags: bulkTags })}>Add tags</button><button className={buttonClass} onClick={() => bulk({ removeTags: bulkTags })}>Remove tags</button><button className={buttonClass} onClick={() => bulk({ favorite: true })}>Favorite</button><button className={buttonClass} onClick={() => bulk({ favorite: false })}>Unfavorite</button><button className={buttonClass} onClick={() => setShowTransfer(true)}>Export selected</button>{kind === 'block' && <><input aria-label="Bulk category" className={fieldClass + ' !w-32'} placeholder="Category" value={bulkCategory} onChange={e => setBulkCategory(e.target.value)} /><button className={buttonClass} onClick={() => bulk({ category: bulkCategory })}>Set category</button></>}</div>}
    </div>}
    <div className="relative flex min-h-0 min-w-0 flex-1 gap-3">
      {showFilters && !editing && <div className="absolute inset-y-0 left-0 z-10 w-60 bg-gray-950 lg:static lg:shrink-0"><PromptLibraryFiltersPanel all={all} kind={kind} filters={filters} onChange={setBrowseFilters} onClose={() => setShowFilters(false)} /></div>}
      <div className={`min-h-0 min-w-0 flex-1 ${editing || active ? 'hidden lg:block' : ''} ${editing ? 'lg:!hidden' : ''}`}>
        {isLoading && !all.length ? <p>Loading saved prompts…</p> : <PromptLibraryBrowser all={all} visible={visible} filters={filters} onFilters={setBrowseFilters} selected={selected} selectionMode={selectionMode} onSelectionMode={() => { setSelectionMode(!selectionMode); setSelected(new Set()); }} activeId={active?.id} onOpen={open} onSelect={selectId} onFavorite={favorite} showFilters={showFilters} onToggleFilters={() => setShowFilters(!showFilters)} />}
      </div>
      {editing ? <div className="min-h-0 min-w-0 flex-1"><PromptEditor key={editorKey} initial={editing} kind={kind} onDirty={onDirty} onViewSource={onViewSource} requestSave={requestSave} onSaved={afterSaved} onSaveFailed={() => { saveIntent.current = null; setPending(null); setRequestSave(0); }} onClose={() => change(() => { setEditing(null); dirty.current = false; })} /></div> : active && <div className="flex min-h-0 w-full min-w-0 flex-col gap-2 lg:w-[42%] lg:min-w-[340px] lg:max-w-xl"><PromptDetails key={active.id} item={active} onEdit={startEdit} onClose={() => { select(null); setShowDuplicates(false); }} onFavorite={() => favorite(active)} onDuplicate={duplicate} onRemove={remove} onDuplicates={() => setShowDuplicates(!showDuplicates)} onViewSource={onViewSource} />{showDuplicates && <PromptDuplicatesPanel item={active} items={all} onOpen={open} />}</div>}
    </div>
    {pending && <UnsavedDialog onSave={() => { saveIntent.current = pending; setRequestSave(n => n + 1); }} onDiscard={() => { const action = pending; setPending(null); saveIntent.current = null; clearDraft(); dirty.current = false; action(); }} onCancel={() => { setPending(null); saveIntent.current = null; }} />}
    {showTransfer && <PromptImportExportDialog snapshot={exportSnapshot} librarySnapshot={{ prompts, blocks }} filteredSnapshot={selected.size ? filteredSnapshot : undefined} scope={selected.size ? 'Selected items' : visible.length !== all.length ? 'Filtered items' : 'All items in this view'} onClose={() => setShowTransfer(false)} />}
  </section>;
}
