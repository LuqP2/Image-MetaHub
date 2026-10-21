import React, { useEffect, useRef, useState } from 'react';
import { getPreviewValues, rememberPreviewValues } from '../../services/promptLibrary/sessionDraft';
import { Heart, MoreHorizontal, Pencil, X, ChevronLeft, ChevronRight, Search, Plus, Trash2 } from 'lucide-react';
import type { IndexedImage, PromptEditorData, PromptLibraryItem } from '../../types';
import { allVariables, compilePrompt, normalizeEditor } from '../../services/promptLibrary/core.mjs';
import { usePromptLibraryPreview } from '../../hooks/usePromptLibraryPreview';
import { selectedPromptText, usePromptBlockExtraction } from '../../hooks/usePromptBlockExtraction';
import PromptPreview from './PromptPreview';
import { VariableValues, buttonClass } from './PromptVariables';
import PromptTagsInput from './PromptTagsInput';
import PromptCategoryInput from './PromptCategoryInput';
import PromptInlineText from './PromptInlineText';
import { startComfyTextDrag } from '../comfyui/ComfyTextDrag';
import BlockFieldSuggestions from './BlockFieldSuggestions';
import { compileBlockForUse } from '../../services/promptLibrary/blockFields';
import { useSavedPromptStore } from '../../store/useSavedPromptStore';
import { useImageStore } from '../../store/useImageStore';
import { buildSavedPromptSource } from '../../hooks/useSavePrompt';
import { linkSessionPreview, removeSessionPreview, sessionPreviewFile } from '../../services/promptLibrary/sessionPreviews';
import PromptPreviewPicker from './PromptPreviewPicker';

export default function PromptDetails({ item, onEdit, onClose, onFavorite, onDuplicate, onRemove, onDuplicates, onViewSource, onFindImages, onPendingSave, onSuggestionDraftChange, renderActions, renderSecondaryActions, workspace = false, onSendSelection, onPrevious, onNext, position }: {
  item: PromptLibraryItem; onEdit: (latest: PromptLibraryItem) => void; onClose: () => void; onFavorite: (latest: PromptLibraryItem) => void;
  onDuplicate: () => void; onRemove: () => void; onDuplicates: () => void; onViewSource: (path: string) => void | Promise<void>;
  renderActions?: (result: ReturnType<typeof compilePrompt>) => React.ReactNode;
  renderSecondaryActions?: () => React.ReactNode;
  onFindImages?: (prompt: string) => void;
  onPendingSave?: (operation: Promise<void>) => void;
  onSuggestionDraftChange?: (name: string, dirty: boolean) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  position?: string;
  workspace?: boolean;
  onSendSelection?: (text: string) => void;
}) {
  const editor = normalizeEditor(item.editor);
  const block = 'text' in item;
  const preview = usePromptLibraryPreview(item);
  const [previewOpen, setPreviewOpen] = useState(() => localStorage.getItem('imh-prompt-details-preview-open') === 'true');
  const [values, setValues] = useState<Record<string, string>>(() => workspace ? getPreviewValues('comfyui', 'details:' + item.id) : {});
  useEffect(() => { if (workspace) rememberPreviewValues('comfyui', 'details:' + item.id, values); }, [workspace, item.id, values]);
  const [menu, setMenu] = useState(false);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [error, setError] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const detailsBusy = useRef(false);
  const [previewPicker, setPreviewPicker] = useState(false);
  const [savingPreview, setSavingPreview] = useState(false);
  const previewBusy = useRef(false);
  const pendingSave = useRef<Promise<void> | null>(null);
  const libraryPrompts = useSavedPromptStore(state => state.prompts);
  const libraryBlocks = useSavedPromptStore(state => state.blocks);
  const suggestions = [...new Set([...libraryPrompts, ...libraryBlocks].flatMap(entry => entry.editor?.tags || []))];
  const categories = [...new Set([...libraryPrompts, ...libraryBlocks].map(entry => entry.editor?.category || '').filter(Boolean))];
  const latestItem = () => {
    const state = useSavedPromptStore.getState();
    const latest = (block ? state.blocks : state.prompts).find(entry => entry.id === item.id);
    if (!latest) throw new Error('This item no longer exists.');
    return latest;
  };
  const trackPendingSave = (operation: Promise<void>) => {
    pendingSave.current = operation;
    onPendingSave?.(operation);
    const clear = () => { if (pendingSave.current === operation) pendingSave.current = null; };
    void operation.then(clear, clear);
  };
  const afterPendingSave = async (action: () => void) => {
    try { while (pendingSave.current) await pendingSave.current; action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save changes.'); }
  };
  const saveDetails = (patch: Partial<Pick<PromptEditorData, 'title' | 'category' | 'tags' | 'notes'>>) => {
    if (detailsBusy.current) return Promise.reject(new Error('Please wait for the current change to save.'));
    detailsBusy.current = true;
    setSavingDetails(true); setError('');
    const previous = pendingSave.current;
    const operation = (async () => {
      if (previous) await previous;
      const latest = latestItem();
      await useSavedPromptStore.getState().mutate({ action: 'update', kind: block ? 'block' : 'prompt', item: { ...latest, editor: { ...normalizeEditor(latest.editor), ...patch } }, expectedRevision: latest.revision || 1 });
    })();
    trackPendingSave(operation);
    void operation.then(() => {}, cause => setError(cause instanceof Error ? cause.message : 'Could not save changes.'))
      .finally(() => { detailsBusy.current = false; setSavingDetails(false); });
    return operation;
  };
  const savePreview = (image: IndexedImage | null) => {
    if (previewBusy.current) return;
    previewBusy.current = true;
    setSavingPreview(true); setError('');
    const previous = pendingSave.current;
    const operation = (async () => {
      if (previous) await previous;
      let nextPreview: PromptEditorData['preview'] = 'hidden';
      let file: File | undefined;
      if (image) {
        if (window.electronAPI) {
          const directory = useImageStore.getState().directories.find(entry => entry.id === image.directoryId)?.path;
          const source = buildSavedPromptSource(image, directory);
          if (!source) throw new Error('This image cannot be linked. Its Library folder is unavailable.');
          nextPreview = source;
        } else {
          file = await image.handle.getFile();
          nextPreview = { kind: 'session', name: file.name };
        }
      }
      const latest = latestItem();
      const previousFile = sessionPreviewFile(item.id);
      if (file) linkSessionPreview(item.id, file);
      try {
        await useSavedPromptStore.getState().mutate({ action: 'update', kind: block ? 'block' : 'prompt', item: { ...latest, editor: { ...normalizeEditor(latest.editor), preview: nextPreview } }, expectedRevision: latest.revision || 1 });
        if (!image) removeSessionPreview(item.id);
      } catch (cause) {
        if (file) { if (previousFile) linkSessionPreview(item.id, previousFile); else removeSessionPreview(item.id); }
        throw cause;
      }
    })();
    trackPendingSave(operation);
    void operation.then(() => setPreviewPicker(false), cause => setError(cause instanceof Error ? cause.message : 'Could not save preview.'))
      .finally(() => { previewBusy.current = false; setSavingPreview(false); });
  };
  const extraction = usePromptBlockExtraction();
  let variables = editor.variables;
  try { if (!block) variables = editor.document?.mode === 'template' ? allVariables(editor.document) : []; } catch { variables = []; }
  const result = block ? { positivePrompt: item.text, negativePrompt: '', errors: [] } : compilePrompt(item, values);
  const blockUse = block && workspace ? compileBlockForUse(item, () => 0) : null;
  const canDragBlock = !!blockUse && !blockUse.errors.length && !!blockUse.positivePrompt.trim();
  const findResult = block ? compileBlockForUse(item, () => 0) : result;
  const findImages = () => void afterPendingSave(() => {
    const latest = latestItem();
    const resolved = 'text' in latest ? compileBlockForUse(latest) : compilePrompt(latest, values);
    if (resolved.errors.length) { setError(resolved.errors.join(' ')); return; }
    const query = resolved.positivePrompt.trim() || resolved.negativePrompt.trim();
    if (query) onFindImages?.(query);
  });
  const sendSelection = () => {
    if (!selection || !onSendSelection) return;
    const resolved = block ? compileBlockForUse({ ...item, text: selection.text }) : null;
    if (resolved?.errors.length) setError(resolved.errors.join(' '));
    else onSendSelection(resolved ? resolved.positivePrompt : selection.text);
    setSelection(null);
  };
  const metadata = Object.entries(editor.metadata).filter(([, value]) => Array.isArray(value) ? value.length : !!value);
  const source = async () => {
    if (!window.electronAPI) return;
    const response = await window.electronAPI.savedPromptsResolveSource(item.id);
    if (response.success && response.data.status === 'available') void onViewSource(response.data.absolutePath);
    else setError('Source unavailable');
  };
  return <section aria-label="Prompt details" className="flex h-full min-h-0 flex-col rounded-xl border border-gray-700 bg-gray-900/50">
    <header className={`flex shrink-0 items-center border-b border-gray-700 ${workspace ? 'gap-1 p-2' : 'gap-2 p-3'}`}>
      {position && <><button className="app-top-icon-button" aria-label="Previous item" title="Previous" disabled={!onPrevious} onClick={onPrevious}><ChevronLeft size={16} /></button><span className="shrink-0 text-[11px] text-gray-400">{position}</span><button className="app-top-icon-button" aria-label="Next item" title="Next" disabled={!onNext} onClick={onNext}><ChevronRight size={16} /></button></>}
      <div className="min-w-0 flex-1"><PromptInlineText value={editor.title} label="Title" placeholder={block ? 'Untitled block' : 'Untitled prompt'} disabled={savingDetails} onSave={title => saveDetails({ title })} /></div>
      <button className={`app-top-icon-button ${editor.favorite ? '!text-red-400' : ''}`} aria-label="Toggle favorite" aria-pressed={editor.favorite} onClick={() => void afterPendingSave(() => onFavorite(latestItem()))}><Heart size={16} fill={editor.favorite ? 'currentColor' : 'none'} /></button>
      <div className="relative"><button className="app-top-icon-button" aria-label="Item actions" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={16} /></button>{menu && <><button tabIndex={-1} aria-label="Close item actions" className="fixed inset-0 z-20 cursor-default" onClick={() => setMenu(false)} /><div className="absolute right-0 top-11 z-30 w-44 rounded-lg border border-gray-700 bg-gray-900 p-1 shadow-xl">{[['Duplicate', onDuplicate], ['Check duplicates', onDuplicates], ['Remove', onRemove]].map(([label, action]) => <button key={label as string} className={`block w-full rounded p-2 text-left text-xs hover:bg-gray-800 ${label === 'Remove' ? 'text-red-400' : ''}`} onClick={() => { setMenu(false); (action as () => void)(); }}>{label as string}</button>)}</div></>}</div>
      <button className="app-top-icon-button" aria-label="Close details" onClick={onClose}><X size={16} /></button>
    </header>
    <div className={`min-h-0 flex-1 overflow-y-auto ${workspace ? 'space-y-2 p-2' : 'space-y-4 p-4'}`}>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <PromptCategoryInput compact value={editor.category} suggestions={categories} disabled={savingDetails} onChange={category => { void saveDetails({ category }).catch(() => {}); }} />
        <PromptTagsInput compact tags={editor.tags} suggestions={suggestions} disabled={savingDetails} onChange={tags => { void saveDetails({ tags }).catch(() => {}); }} />
        {savingDetails && <p role="status" className="text-[11px] text-gray-500">Saving…</p>}
      </div>
      <details open={previewOpen} onToggle={e => { const open = e.currentTarget.open; setPreviewOpen(open); localStorage.setItem('imh-prompt-details-preview-open', String(open)); }} className="rounded-lg border border-gray-700 p-2 text-xs text-gray-400">
        <summary className="cursor-pointer">Preview image</summary>
        {preview.url ? <img src={preview.url} alt="Linked preview" className="mt-2 max-h-44 w-full rounded bg-gray-950/50 object-contain" /> : <p className="pt-2">{editor.preview && editor.preview !== 'hidden' ? preview.status : 'No preview image.'}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="app-top-icon-button !h-6 !w-6 !p-1" aria-label={preview.url || (editor.preview && editor.preview !== 'hidden') ? 'Replace preview image' : 'Add preview image'} title={preview.url || (editor.preview && editor.preview !== 'hidden') ? 'Replace preview image' : 'Add preview image'} disabled={savingPreview} onClick={() => { setError(''); setPreviewPicker(true); }}>{preview.url || (editor.preview && editor.preview !== 'hidden') ? <Pencil size={13} /> : <Plus size={13} />}</button>
          {(preview.url || (editor.preview && editor.preview !== 'hidden')) && <button type="button" className="app-top-icon-button !h-6 !w-6 !p-1" aria-label="Remove preview image" title="Remove preview image" disabled={savingPreview} onClick={() => savePreview(null)}><Trash2 size={13} /></button>}
          {savingPreview && <span role="status">Saving preview…</span>}
        </div>
      </details>
      {!block && variables.length > 0 && <section className="space-y-2 rounded-lg border border-accent/25 bg-accent/5 p-3"><h4 className="text-sm font-semibold">Fill values</h4><p className="text-xs text-gray-400">These values replace the placeholders in the final text when copying or sending to a node. Your saved text stays unchanged.</p><VariableValues variables={variables} values={values} onChange={setValues} /></section>}
      {block && !workspace && <BlockFieldSuggestions block={item} beforeSave={() => pendingSave.current} onPending={trackPendingSave} onDraftChange={onSuggestionDraftChange} />}
      <div draggable={canDragBlock} onDragStart={event => { if (block) { if (canDragBlock) startComfyTextDrag(event, compileBlockForUse(item).positivePrompt); else event.preventDefault(); } }} onContextMenu={e => { const text = selectedPromptText(); if (text) { e.preventDefault(); setSelection({ text, x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - (onSendSelection ? 150 : 100)) }); } }}><PromptPreview onEditContent={() => void afterPendingSave(() => onEdit(latestItem()))} compact={workspace} channel={block ? 'block' : undefined} result={result} heading={block ? 'Preview' : 'Prompt'} /></div>
      {block && workspace && <p className="text-xs text-gray-400">Drag to a node to pick a random suggested value for each field.</p>}
      {!workspace && renderActions?.(result)}
      {onFindImages && <button className={buttonClass} disabled={findResult.errors.length > 0 || !(findResult.positivePrompt.trim() || findResult.negativePrompt.trim())} onClick={findImages}><Search size={14} />Find images</button>}
      {renderSecondaryActions?.()}
      <section className="space-y-1"><h4 className="text-xs text-gray-400">Notes</h4><PromptInlineText value={editor.notes} label="Notes" placeholder="+ Add notes" multiline disabled={savingDetails} onSave={notes => saveDetails({ notes })} /></section>
      <details className="space-y-3 border-t border-gray-700 pt-3 text-xs text-gray-400"><summary className="cursor-pointer">Information</summary>{metadata.map(([key, value]) => <div key={key} className="break-words"><span className="capitalize">{key}: </span>{Array.isArray(value) ? value.join(', ') : value}</div>)}<p>Saved {new Date(item.createdAt).toLocaleString()}</p>{item.updatedAt && <p>Updated {new Date(item.updatedAt).toLocaleString()}</p>}{'sourceCreatedAt' in item && item.sourceCreatedAt && <p>Source date {new Date(item.sourceCreatedAt).toLocaleString()}</p>}{'source' in item && item.source && window.electronAPI && <button className={buttonClass} onClick={() => void source()}>View Source</button>}</details>
    </div>
    {workspace && renderActions && <footer className="shrink-0 border-t border-gray-700 p-2">{renderActions(result)}</footer>}
    {selection && <><button className="fixed inset-0 z-[11000] cursor-default" aria-label="Dismiss selection menu" onClick={() => setSelection(null)} /><div className="fixed z-[11001] flex flex-col items-stretch rounded-lg border border-gray-700 bg-gray-900 p-1 shadow-xl" style={{ left: selection.x, top: selection.y }}>{onSendSelection && <button className={buttonClass} onClick={sendSelection}>Send to selected node</button>}<button className={buttonClass} onClick={() => { extraction.open(selection.text, 'source' in item ? item.source : null); setSelection(null); }}>Save Selection as Block</button></div></>}
    {extraction.dialog}
    {previewPicker && <PromptPreviewPicker busy={savingPreview} error={error} onChoose={savePreview} onClose={() => setPreviewPicker(false)} />}
  </section>;
}
