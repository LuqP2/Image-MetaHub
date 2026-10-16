import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PromptBlock, PromptLibraryItem, SavedPrompt } from '../../types';
import { useSavedPromptStore } from '../../store/useSavedPromptStore';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { emptyEditor, makeDocument, normalizeEditor, compilePrompt } from '../../services/promptLibrary/core.mjs';
import { clearDraft, getDraft } from '../../services/promptLibrary/sessionDraft';
import { emptyFilters, filterItems, type PromptLibraryFilters } from '../../services/promptLibrary/search';
import PromptLibraryBrowser from '../promptLibrary/PromptLibraryBrowser';
import PromptLibraryFiltersPanel from '../promptLibrary/PromptLibraryFilters';
import PromptDetails from '../promptLibrary/PromptDetails';
import PromptEditor from '../promptLibrary/PromptEditor';
import { useSendToComfyUINode } from '../../hooks/useSendToComfyUINode';
import ComfyUITextActions from './ComfyUITextActions';
import ComfyTextDrag from './ComfyTextDrag';
import { compileBlockForUse } from '../../services/promptLibrary/blockFields';
import { buttonClass } from '../promptLibrary/PromptVariables';
import { fieldClass } from '../promptLibrary/PromptVariables';

function NodeItemActions({ result, block, busy, onSend }: { result: ReturnType<typeof compilePrompt>; block?: PromptBlock; busy: boolean; onSend: (text: string, mode: 'append' | 'replace') => void }) {
  const [channel, setChannel] = useState<'positive' | 'negative'>('positive');
  const effectiveChannel = !result.positivePrompt ? 'negative' : !result.negativePrompt ? 'positive' : channel;
  const text = effectiveChannel === 'negative' ? result.negativePrompt : result.positivePrompt;
  const useResult = block ? compileBlockForUse(block, () => 0) : result;
  const resolveText = () => block ? compileBlockForUse(block).positivePrompt : text;
  return <div className="flex flex-wrap items-center gap-1.5">
    <ComfyTextDrag text={text} disabled={busy || !!useResult.errors.length || !(block ? useResult.positivePrompt : text).trim()} resolveText={block ? resolveText : undefined} />
    {result.positivePrompt && result.negativePrompt && <select aria-label="Text to send" className={fieldClass + ' min-w-0 flex-1 !px-2 !py-1.5 !text-xs'} value={effectiveChannel} onChange={e => setChannel(e.target.value as typeof channel)}><option value="positive">Prompt</option><option value="negative">Negative</option></select>}
    <button className={buttonClass + ' !px-2 !py-1.5'} title="Append text to the selected node field" disabled={busy || !!useResult.errors.length || !(block ? useResult.positivePrompt : text).trim()} onClick={() => onSend(resolveText(), 'append')}>+ Add to node</button>
    <button className={buttonClass + ' !px-2 !py-1.5'} title="Replace the selected node field with this text" disabled={busy || !!useResult.errors.length || !(block ? useResult.positivePrompt : text).trim()} onClick={() => onSend(resolveText(), 'replace')}>Replace</button>
    {block && !!useResult.errors.length && <p className="w-full text-xs text-amber-400">{useResult.errors.join(' ')}</p>}
  </div>;
}

export type WorkspaceCompositionRequest = { id: number; positive: string; negative: string } | { id: number; text: string; channel: 'positive' | 'negative'; block?: PromptBlock };
type Draft = Partial<SavedPrompt & PromptBlock>;
const emptyComposition = (): Draft => ({ positivePrompt: '', negativePrompt: '', editor: { ...emptyEditor(), document: { ...makeDocument(), positive: [], negative: [] } } });
const session: { kind: 'prompt' | 'block'; filters: PromptLibraryFilters; selected: string | null; editing: Draft | null; blockEditing: Draft | null; editingKind: 'prompt' | 'block'; mode: 'browse' | 'details' | 'edit' | 'blockedit'; offset: number } = {
  kind: 'prompt', filters: emptyFilters, selected: null, editing: null, blockEditing: null, editingKind: 'prompt', mode: 'browse', offset: 0,
};
export default function WorkspacePrompts({ active, request, onOpenLibrary, onViewSource }: {
  active: boolean; request: WorkspaceCompositionRequest | null; onOpenLibrary: () => void; onViewSource: (path: string) => void | Promise<void>;
}) {
  const { prompts, blocks, loadLibrary, mutate, error, isLoading } = useSavedPromptStore();
  const { canUseAdvancedPromptLibrary, showProModal } = useFeatureAccess();
  const direct = useSendToComfyUINode();
  const [kind, setKind] = useState<'prompt' | 'block'>(session.kind);
  const [filters, setFilters] = useState(session.filters);
  const [selected, setSelected] = useState(session.selected);
  const [editing, setEditing] = useState<Draft | null>(() => getDraft('comfyui')?.initial || session.editing || (canUseAdvancedPromptLibrary ? emptyComposition() : { editor: emptyEditor(), positivePrompt: '', negativePrompt: '' }));
  const [editingKind, setEditingKind] = useState(getDraft('comfyui')?.kind || session.editingKind);
  const [mode, setMode] = useState<typeof session.mode>(session.mode);
  const [editorKey, setEditorKey] = useState(0);
  const [blockEditing, setBlockEditing] = useState<Draft | null>(() => getDraft('comfyui-block')?.initial || session.blockEditing);
  const [blockKey, setBlockKey] = useState(0);
  const [append, setAppend] = useState<Extract<WorkspaceCompositionRequest, { text: string }> | undefined>();
  const [showFilters, setShowFilters] = useState(false);
  const [actionError, setActionError] = useState('');
  const dirty = useRef(Boolean(getDraft('comfyui')));
  const onDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  useEffect(() => { void loadLibrary(); }, [loadLibrary]);
  useEffect(() => { Object.assign(session, { kind, filters, selected, editing, blockEditing, editingKind, mode }); }, [kind, filters, selected, editing, blockEditing, editingKind, mode]);
  const all = kind === 'prompt' ? prompts : blocks;
  const visible = useMemo(() => filterItems(all, filters), [all, filters]);
  const item = all.find(entry => entry.id === selected);
  const gate = () => { if (canUseAdvancedPromptLibrary) return true; showProModal('prompt_library_advanced'); return false; };
  const replaceEditor = (draft: Draft, nextKind: 'prompt' | 'block') => {
    if (nextKind === 'block') {
      if (getDraft('comfyui-block') && !window.confirm('Replace the unsaved block edit?')) return false;
      clearDraft('comfyui-block'); setBlockEditing(draft); setBlockKey(key => key + 1); setMode('blockedit'); return true;
    }
    if (dirty.current && !window.confirm('Replace the current unsaved Workspace draft?')) return false;
    clearDraft('comfyui'); setAppend(undefined); dirty.current = false;
    setEditing(draft); setEditingKind(nextKind); setEditorKey(key => key + 1); setMode('edit'); return true;
  };
  useEffect(() => {
    if (!request || !gate()) return;
    if ('positive' in request) {
      replaceEditor({ editor: { ...emptyEditor(), document: makeDocument(request.positive, request.negative) } }, 'prompt');
    } else {
      if (!editing || editingKind !== 'prompt') {
        if (!replaceEditor(emptyComposition(), 'prompt')) return;
      }
      setAppend(request); setMode('edit');
    }
  }, [request?.id]);
  const run = async (command: Parameters<typeof mutate>[0]) => {
    try { setActionError(''); return await mutate(command); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Operation failed'); return undefined; }
  };
  const favorite = (target: PromptLibraryItem) => {
    const editor = normalizeEditor(target.editor);
    void run({ action: 'update', kind: 'text' in target ? 'block' : 'prompt', item: { ...target, editor: { ...editor, favorite: !editor.favorite } }, expectedRevision: target.revision || 1 });
  };
  const useBase = (target: PromptLibraryItem) => {
    if (!gate()) return;
    const editor = normalizeEditor(target.editor);
    if ('text' in target) {
      const blockRequest = { id: Date.now(), text: target.text, channel: 'positive' as const, block: target };
      if (!editing || editingKind !== 'prompt') {
        if (!replaceEditor(emptyComposition(), 'prompt')) return;
      }
      setAppend(blockRequest); setMode('edit');
    } else replaceEditor({ positivePrompt: target.positivePrompt, negativePrompt: target.negativePrompt, editor: { ...editor, document: editor.document || makeDocument(target.positivePrompt, target.negativePrompt), favorite: false } }, 'prompt');
  };
  const addBlock = (target: PromptBlock, channel: 'positive' | 'negative') => {
    if (!gate()) return;
    if (!editing || editingKind !== 'prompt') {
      if (!replaceEditor(emptyComposition(), 'prompt')) return;
    }
    setAppend({ id: Date.now(), text: target.text, channel, block: target }); setMode('edit');
  };
  const sendBlock = (block: PromptBlock, mode: 'append' | 'replace' | 'replaceSelection' = 'append') => {
    const result = compileBlockForUse(block);
    if (result.errors.length) { setKind('block'); setSelected(block.id); setMode('details'); setActionError(result.errors.join(' ')); return; }
    setActionError(''); void direct.send(result.positivePrompt, mode);
  };
  const sendPrompt = (prompt: SavedPrompt, channel: 'positive' | 'negative' = 'positive', mode: 'append' | 'replace' | 'replaceSelection' = 'append') => {
    const result = compilePrompt(prompt);
    if (result.errors.length) {
      setKind('prompt'); setSelected(prompt.id); setMode('details');
      setActionError('Fill the template fields, then use Add to selected node.'); return;
    }
    setActionError('');
    void direct.send(channel === 'negative' ? result.negativePrompt : result.positivePrompt, mode);
  };
  const duplicateItem = (target: PromptLibraryItem) => void run({ action: 'duplicate', kind: 'text' in target ? 'block' : 'prompt', id: target.id }).then(id => { if (id && mode === 'details') setSelected(id); });
  const removeItem = (target: PromptLibraryItem) => {
    if (!window.confirm('Delete this saved item?')) return;
    void run({ action: 'remove', kind: 'text' in target ? 'block' : 'prompt', id: target.id }).then(() => {
      if (!useSavedPromptStore.getState()['text' in target ? 'blocks' : 'prompts'].some(entry => entry.id === target.id) && selected === target.id) { setSelected(null); setMode('browse'); }
    });
  };
  const currentIndex = visible.findIndex(entry => entry.id === selected);
  const activeSection = mode === 'edit' ? 'compose' : mode === 'blockedit' ? 'block' : kind;
  const navigate = (delta: number) => { const target = visible[currentIndex + delta]; if (target) { setSelected(target.id); setMode('details'); } };
  return <section aria-label="Workspace Prompt Library" className="flex h-full min-h-0 flex-col gap-1.5 p-2 text-gray-100">
    <div className="flex items-center gap-1 app-top-segmented">
      {(['prompt', 'block'] as const).map(value => <button key={value} className={`app-top-segment ${activeSection === value ? 'app-top-segment-active' : ''}`} aria-pressed={activeSection === value} onClick={() => { session.offset = 0; setKind(value); setFilters(emptyFilters); setSelected(null); setMode('browse'); setShowFilters(false); }}>{value === 'prompt' ? 'Prompts' : 'Blocks'}</button>)}
      <button className={`app-top-segment ${activeSection === 'compose' ? 'app-top-segment-active' : ''}`} aria-pressed={activeSection === 'compose'} onClick={() => { if (editing) setMode('edit'); else replaceEditor(canUseAdvancedPromptLibrary ? emptyComposition() : { editor: emptyEditor(), positivePrompt: '', negativePrompt: '' }, 'prompt'); }}>Compose</button>
    </div>
    {mode !== 'details' && <div className="flex flex-wrap items-center gap-2">
      {mode === 'browse' && kind === 'block' && <button className={buttonClass} onClick={() => { if (gate()) replaceEditor({ editor: emptyEditor(), text: '' }, 'block'); }}>New block</button>}
      {mode === 'blockedit' && <button className={buttonClass} onClick={() => setMode('browse')}>Back to library</button>}
      {getDraft('comfyui-block') && mode === 'browse' && <button className={buttonClass} onClick={() => setMode('blockedit')}>Resume block edit</button>}
      <button className="ml-auto text-xs text-gray-400 hover:text-gray-100" onClick={onOpenLibrary}>Open full library ↗</button>
    </div>}
    {direct.panel}
    {(error || actionError) && <p role="alert" className="text-xs text-red-400 light:text-red-800">{actionError || error}<button className={buttonClass} onClick={() => void loadLibrary()}>Retry</button></p>}
    <div hidden={mode !== 'browse'} className={`flex min-h-0 flex-1 flex-col gap-2 ${mode === 'browse' ? '' : 'hidden'}`}>
      {showFilters && <div className="max-h-56 shrink-0 overflow-auto"><PromptLibraryFiltersPanel kind={kind} all={all} filters={filters} onChange={setFilters} onClose={() => setShowFilters(false)} /></div>}
      {isLoading && !all.length ? <p>Loading saved prompts…</p> : <PromptLibraryBrowser onAddToCompose={block => addBlock(block, 'positive')} textDrag key={kind} onContextOpen={() => void direct.refreshSelection()} canReplaceSelection={direct.hasSelection} compact directBlocks directPrompts useBusy={direct.busy} all={all} visible={visible} filters={filters} onFilters={setFilters} selected={new Set()} selectionMode={false} onSelectionMode={() => {}} activeId={selected || undefined} onOpen={target => { setSelected(target.id); setMode('details'); }} onSelect={() => {}} onFavorite={favorite} showFilters={showFilters} onToggleFilters={() => setShowFilters(!showFilters)} onContextAction={(target, action, channel) => {
        if (action === 'edit') replaceEditor(target, 'text' in target ? 'block' : 'prompt');
        else if (action === 'duplicate') duplicateItem(target);
        else if (action === 'remove') removeItem(target);
        else if ('text' in target) sendBlock(target, action);
        else sendPrompt(target, channel, action);
      }} onUse={(target, channel) => 'text' in target ? sendBlock(target) : sendPrompt(target, channel)} scrollOffset={session.offset} onScrollOffset={offset => { if (active && mode === 'browse') session.offset = offset; }} />}
    </div>
    {item && <div hidden={mode !== 'details'} className={`min-h-0 flex-1 ${mode === 'details' ? '' : 'hidden'}`}><PromptDetails workspace onSendSelection={text => { setActionError(''); void direct.send(text); }} key={item.id} item={item} onClose={() => setMode('browse')} onEdit={() => replaceEditor(item, kind)} onFavorite={() => favorite(item)} onDuplicate={() => duplicateItem(item)} onRemove={() => removeItem(item)} onPrevious={currentIndex > 0 ? () => navigate(-1) : undefined} onNext={currentIndex >= 0 && currentIndex < visible.length - 1 ? () => navigate(1) : undefined} position={currentIndex >= 0 ? `${currentIndex + 1}/${visible.length}` : undefined} onDuplicates={onOpenLibrary} onViewSource={onViewSource} renderActions={result => <NodeItemActions key={item.id} block={'text' in item ? item : undefined} result={result} busy={direct.busy} onSend={(text, mode) => { setActionError(''); void direct.send(text, mode); }} />} renderSecondaryActions={() => <button className="text-xs text-gray-400 hover:text-accent" onClick={() => 'text' in item ? addBlock(item, 'positive') : useBase(item)}>Use in Compose</button>} /></div>}
    {mode === 'details' && !item && <p className="text-xs text-gray-400">This item is no longer available.</p>}
    {editing && <div hidden={mode !== 'edit'} className={`min-h-0 flex-1 ${mode === 'edit' ? '' : 'hidden'}`}><PromptEditor key={editorKey} initial={editing} kind={editingKind} compact draftContext="comfyui" appendText={append} onDirty={onDirty} onViewSource={onViewSource} onClose={() => { if (!dirty.current || window.confirm('Discard this Workspace draft?')) { clearDraft('comfyui'); setEditing(canUseAdvancedPromptLibrary ? emptyComposition() : { editor: emptyEditor(), positivePrompt: '', negativePrompt: '' }); setEditorKey(key => key + 1); setAppend(undefined); setMode('edit'); dirty.current = false; } }} onSaved={id => { clearDraft('comfyui'); setEditing(null); setAppend(undefined); setKind(editingKind); setSelected(id || null); setMode(id ? 'details' : 'browse'); dirty.current = false; }} renderActions={(result, visible, channel) => <ComfyUITextActions compact sourceChannel={channel} positive={result.positivePrompt} negative={result.negativePrompt} errors={result.errors} active={active && mode === 'edit' && visible} />} /></div>}
    {blockEditing && <div hidden={mode !== 'blockedit'} className={`min-h-0 flex-1 ${mode === 'blockedit' ? '' : 'hidden'}`}><PromptEditor key={blockKey} initial={blockEditing} kind="block" compact draftContext="comfyui-block" onDirty={() => {}} onViewSource={onViewSource} onClose={() => { if (!getDraft('comfyui-block') || window.confirm('Discard this unsaved block edit?')) { clearDraft('comfyui-block'); setBlockEditing(null); setMode('browse'); } }} onSaved={id => { clearDraft('comfyui-block'); setBlockEditing(null); setKind('block'); setSelected(id || null); setMode(id ? 'details' : 'browse'); }} /></div>}
  </section>;
}
