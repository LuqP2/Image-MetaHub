import React, { useEffect, useMemo, useState } from 'react';
import { Heart } from 'lucide-react';
import PromptTagsInput from './PromptTagsInput';
import type { PromptLibraryItem, PromptBlock, SavedPrompt } from '../../types';
import { normalizeEditor, makeDocument, compilePrompt, allVariables, documentText } from '../../services/promptLibrary/core.mjs';
import { useSavedPromptStore } from '../../store/useSavedPromptStore';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { useImageStore } from '../../store/useImageStore';
import { buildSavedPromptSource } from '../../hooks/useSavePrompt';
import { usePromptBlockExtraction, selectedPromptText } from '../../hooks/usePromptBlockExtraction';
import { usePromptLibraryPreview, linkSessionPreview } from '../../hooks/usePromptLibraryPreview';
import PromptComposer from './PromptComposer';
import PromptPreview from './PromptPreview';
import { sessionDraft, rememberDraft, clearDraft } from '../../services/promptLibrary/sessionDraft';
import { VariableDefinitions, VariableValues, buttonClass, fieldClass } from './PromptVariables';
export default function PromptEditor({ initial, kind, onSaved, onClose, onDirty, onViewSource, onSaveFailed, requestSave = 0 }: {
  initial: Partial<SavedPrompt & PromptBlock>;
  kind: 'prompt' | 'block';
  onSaved: (id?: string) => void;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
  onViewSource: (path: string) => void | Promise<void>;
  requestSave?: number;
  onSaveFailed?: () => void;
}) {
  const [draft, setDraft] = useState(() => {
    const recovered = sessionDraft?.kind === kind && sessionDraft.initial.id === initial.id ? sessionDraft.draft : initial;
    return { ...recovered, editor: recovered === initial ? normalizeEditor(initial.editor) : recovered.editor || normalizeEditor(null) };
  });
  const [tab, setTab] = useState<'content' | 'compose' | 'fields' | 'details'>(kind === 'prompt' && initial.editor?.document ? 'compose' : 'content');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(() => sessionDraft?.kind === kind && sessionDraft.initial.id === initial.id ? sessionDraft.pendingFile : null);
  const prompts = useSavedPromptStore((s) => s.prompts);
  const blocks = useSavedPromptStore((s) => s.blocks);
  const mutate = useSavedPromptStore((s) => s.mutate);
  const { canUseAdvancedPromptLibrary, showProModal } = useFeatureAccess();
  const extraction = usePromptBlockExtraction();
  const live = [...prompts, ...blocks].find((p) => p.id === initial.id);
  const conflict = !!live && (live.revision || 1) !== (initial.revision || 1);
  const advanced = kind === 'block' || !!draft.editor.document;
  const editableContent = !advanced || canUseAdvancedPromptLibrary;
  const editor = draft.editor;
  const preview = usePromptLibraryPreview(initial.id ? initial as PromptLibraryItem : null);
  const dirty = JSON.stringify(draft) !== JSON.stringify({ ...initial, editor: normalizeEditor(initial.editor) });
  useEffect(() => {
    onDirty(dirty); if(dirty)
      rememberDraft(kind, initial, draft, pendingFile);
    else
      clearDraft();
  }, [dirty, onDirty, draft, kind, initial, pendingFile]);
  useEffect(() => {
    if(!dirty)
      return; const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const update = (patch: Partial<typeof draft>) => setDraft((p) => ({ ...p, ...patch }));
  const updateEditor = (patch: Partial<typeof editor>) => update({ editor: { ...editor, ...patch } });
  const variables = useMemo(() => {
    try {
      return kind === 'block' ? editor.variables : editor.document?.mode === 'template' ? allVariables(editor.document) : [];
    }
    catch {
      return [];
    }
  }, [editor, kind]);
  const result = kind === 'block' ? compilePrompt({ positivePrompt: draft.text || '', editor: { ...editor, document: { ...makeDocument(draft.text || ''), mode: 'template', variables: editor.variables } } }, values) : compilePrompt(draft, values);
  const gate = () => {
    if(canUseAdvancedPromptLibrary)
      return true; showProModal('prompt_library_advanced'); return false;
  };
  const save = async (copy = false) => {
    if (busy) return;
    const baseline = normalizeEditor(initial.editor);
    const advancedChanged = kind === 'block' ? draft.text !== initial.text || JSON.stringify(editor.variables) !== JSON.stringify(baseline.variables) : JSON.stringify(editor.document) !== JSON.stringify(baseline.document);
    if((advancedChanged || (!initial.id && advanced)) && !gate()) { onSaveFailed?.(); return; }
    setBusy(true);
    setError('');
    try {
      const item = { ...draft };
      if(copy)
        delete item.id;
      const id = await mutate({ action: copy || !initial.id ? 'create' : 'update', kind, item, expectedRevision: initial.revision || 1 });
      if(pendingFile && id)
        linkSessionPreview(id, pendingFile);
      clearDraft();
      onDirty(false);
      onSaved(id);
    }
    catch(cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed');
      onSaveFailed?.();
    }
    finally {
      setBusy(false);
    }
  };
  const copyAsText = async () => {
    setBusy(true);
    setError('');
    try {
      const id = await mutate({ action: 'create', kind: 'prompt', item: { positivePrompt: result.positivePrompt, negativePrompt: result.negativePrompt, editor: { ...editor, title: `${editor.title} Copy`, document: null, favorite: false } } });
      clearDraft();
      onSaved(id);
    }
    catch(cause) {
      setError(cause instanceof Error ? cause.message : 'Copy failed');
    }
    finally {
      setBusy(false);
    }
  };
  const context = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const text = e.currentTarget.value.slice(e.currentTarget.selectionStart, e.currentTarget.selectionEnd); if(text.trim()) {
      e.preventDefault();
      setSelectedText(text);
    }
  };
  useEffect(() => {
    if(requestSave > 0)
      void save();
  }, [requestSave]);
  const convertPlain = () => {
    if(result.errors.length) {
      setError(result.errors.join(' '));
      return;
    } if(window.confirm('Convert this composition to plain text? Its block structure will be removed.')) {
      update({ positivePrompt: result.positivePrompt, negativePrompt: result.negativePrompt, editor: { ...editor, document: null } });
    }
  };
  const linkLibrary = async () => {
    const state = useImageStore.getState();
    const image = state.previewImage || state.selectedImage;
    if(!image) {
      setError('Select an image in the Library first, then return here to link it. Your draft will be preserved.');
      return;
    }
    if (!image.fileType?.startsWith('image/') && !/\.(png|jpe?g|webp|gif|avif)$/i.test(image.name)) {
      setError('Choose an image to use as preview.'); return;
    }
    try {
      if (!window.electronAPI) {
        const file = await image.handle.getFile(); setPendingFile(file);
        updateEditor({ preview: { kind: 'session', name: file.name } });
      } else {
        const directory = state.directories.find((entry) => entry.id === image.directoryId)?.path;
        const source = buildSavedPromptSource(image, directory);
        if (!source) { setError('This image cannot be linked. Use Link image file.'); return; }
        updateEditor({ preview: source });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not link image.'); }
  };
  const startComposition = () => {
    if (!editor.document) {
      if (!gate()) return;
      updateEditor({ document: makeDocument(draft.positivePrompt, draft.negativePrompt) });
    }
    setTab('compose');
  };
  const startTemplate = () => {
    if (!gate()) return;
    if (kind === 'prompt') updateEditor({ document: { ...(editor.document || makeDocument(draft.positivePrompt, draft.negativePrompt)), mode: 'template' } });
    setTab('fields');
  };
  const suggestions = [...new Set([...prompts, ...blocks].flatMap(item => item.editor?.tags || []))];
  return <section aria-label="Prompt editor" className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/50 text-gray-100">
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-700 p-3">
      <div className="mr-auto min-w-0"><h3 className="truncate text-sm font-semibold">{initial.id ? `Edit ${kind}` : `New ${kind}`}{initial.editor?.title ? ` · ${initial.editor.title}` : ''}</h3><p className="text-[11px] text-gray-400">{dirty ? 'Unsaved changes' : 'No changes yet'}</p></div>
      <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className={buttonClass + ' !border-accent/40 !bg-accent/15 !text-gray-100'} disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
    </header>
    <div className="shrink-0 space-y-3 border-b border-gray-700 p-3">
      <div className="flex items-end gap-3"><label className="block min-w-0 flex-1 text-xs text-gray-400">Title<input aria-label="Title" className={fieldClass} placeholder={kind === 'block' ? 'Name this reusable block…' : 'Give this prompt a name…'} value={editor.title} onChange={e => updateEditor({ title: e.target.value })} /></label><button type="button" className={`app-top-icon-button ${editor.favorite ? '!text-red-400' : ''}`} aria-label="Favorite" aria-pressed={editor.favorite} onClick={() => updateEditor({ favorite: !editor.favorite })}><Heart size={16} fill={editor.favorite ? 'currentColor' : 'none'} /></button></div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="app-top-segmented">{(['content', 'compose', 'fields', 'details'] as const).filter(t => kind !== 'block' || t !== 'compose').map(t => <button type="button" key={t} aria-pressed={tab === t} className={`app-top-segment ${tab === t ? 'app-top-segment-active' : ''}`} onClick={() => t === 'compose' ? startComposition() : setTab(t)}>{t === 'content' ? 'Text' : t === 'compose' ? 'Compose' : t === 'fields' ? 'Template fields' : 'Organization'}</button>)}</div>
        {(editor.document || variables.length > 0) && <button type="button" className={buttonClass + ' lg:hidden'} onClick={() => setMobilePreview(!mobilePreview)}>{mobilePreview ? 'Back to editing' : 'Show result'}</button>}
      </div>
    </div>
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className={`min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4 ${mobilePreview ? 'hidden lg:block' : ''}`}>
        {conflict && <div role="alert" className="space-y-2 rounded border border-amber-500/50 p-3 text-xs text-amber-400">This item changed in another window. Your draft is preserved.<div className="flex gap-2"><button className={buttonClass} onClick={() => { if (window.confirm('Discard this draft and reload?')) onSaved(initial.id); }}>Reload</button><button className={buttonClass} onClick={() => void save(true)}>Save as a copy</button></div></div>}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {!editableContent && <p className="text-xs text-gray-400">Advanced structure is read-only on Free. You can edit organization, fill fields, copy or export your saved content.</p>}
        {tab === 'content' && <div className="space-y-4">
          {kind === 'block' ? <label className="block text-xs text-gray-400">Block text<textarea aria-label="Block text" rows={8} readOnly={!editableContent} className={fieldClass} value={draft.text || ''} onChange={e => update({ text: e.target.value })} onContextMenu={context} /></label> : editor.document ? <div className="space-y-3 rounded-lg border border-gray-700 p-4"><p className="text-sm">This prompt is made from blocks and free text.</p><p className="text-xs text-gray-400">Edit each part in Compose. The expanded result is shown in the preview.</p><button className={buttonClass} onClick={() => setTab('compose')}>Open composition</button><details className="space-y-2 text-xs"><summary className="cursor-pointer text-gray-400">Convert or create a text copy</summary><p className="pt-2 text-gray-400">Converting replaces the block structure with the expanded text.</p><button disabled={!canUseAdvancedPromptLibrary} className={buttonClass} onClick={convertPlain}>Convert to plain text</button><button className={buttonClass} disabled={!!result.errors.length} onClick={() => void copyAsText()}>Create copy as text</button></details></div> : <>{(['positivePrompt', 'negativePrompt'] as const).map(key => <label key={key} className="block text-xs text-gray-400">{key === 'positivePrompt' ? 'Positive prompt' : 'Negative prompt'}<textarea aria-label={key === 'positivePrompt' ? 'Positive prompt' : 'Negative prompt'} rows={key === 'positivePrompt' ? 10 : 5} className={fieldClass + ' leading-relaxed'} value={draft[key] || ''} onChange={e => update({ [key]: e.target.value })} onContextMenu={context} /></label>)}<div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={startComposition}>Compose with blocks</button><button className={buttonClass} onClick={startTemplate}>Add template fields</button></div></>}
        </div>}
        {tab === 'compose' && editor.document && <PromptComposer document={editor.document} blocks={blocks} disabled={!canUseAdvancedPromptLibrary} onChange={document => { const text = documentText(document); update({ ...text, editor: { ...editor, document } }); }} onExtract={text => extraction.open(text)} onError={setError} />}
        {tab === 'fields' && <section className="space-y-4"><h3 className="text-sm font-semibold">Define template fields</h3><p className="text-xs text-gray-400">Name the fields people will fill when using this {kind}. Include each field in your text as {'{{name}}'}.</p>{kind === 'block' ? <VariableDefinitions disabled={!editableContent} variables={editor.variables} onChange={variables => updateEditor({ variables })} /> : editor.document?.mode === 'template' ? <VariableDefinitions disabled={!canUseAdvancedPromptLibrary} variables={editor.document.variables} onChange={variables => updateEditor({ document: { ...editor.document!, variables } })} /> : <button className={buttonClass} onClick={startTemplate}>Add template fields</button>}</section>}
        {tab === 'details' && <div className="space-y-5">
          <PromptTagsInput tags={editor.tags} onChange={tags => updateEditor({ tags })} suggestions={suggestions} />
          {kind === 'block' && <label className="block text-xs text-gray-400">Category<input className={fieldClass} value={editor.category} onChange={e => updateEditor({ category: e.target.value })} /></label>}
          <label className="block text-xs text-gray-400">Notes<textarea aria-label="Notes" className={fieldClass} rows={4} value={editor.notes} onChange={e => updateEditor({ notes: e.target.value })} /></label>
          <section className="space-y-3 rounded-lg border border-gray-700 p-3"><h3 className="text-xs font-semibold">Preview image</h3>{preview.url && <img src={preview.url} alt="Linked preview" className="max-h-40 w-full object-contain" />}<p className="text-xs text-gray-400">{pendingFile ? pendingFile.name : preview.status}</p><div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={linkLibrary}>Link selected Library image</button>{window.electronAPI ? <button className={buttonClass} onClick={async () => { const response = await window.electronAPI.promptLibraryChoosePreview(); if (response.success && response.data) updateEditor({ preview: response.data }); else if (response.success === false) setError(response.error); }}>Link image file</button> : <label className={buttonClass}>Link image file<input type="file" accept="image/*" className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) { setPendingFile(file); updateEditor({ preview: { kind: 'session', name: file.name } }); } }} /></label>}<button className={buttonClass} onClick={() => { setPendingFile(null); updateEditor({ preview: 'hidden' }); }}>Hide preview</button></div></section>
          <details className="space-y-3 rounded-lg border border-gray-700 p-3 text-xs text-gray-400"><summary className="cursor-pointer font-semibold">Generation parameters (optional)</summary><div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-2">{(['model', 'generator', 'sampler', 'scheduler'] as const).map(key => <label key={key} className="block capitalize">{key}<input className={fieldClass} value={editor.metadata[key]} onChange={e => updateEditor({ metadata: { ...editor.metadata, [key]: e.target.value } })} /></label>)}</div><label className="block">LoRAs (one per line)<textarea className={fieldClass} value={editor.metadata.loras.join('\n')} onChange={e => updateEditor({ metadata: { ...editor.metadata, loras: e.target.value.split('\n') } })} /></label></details>
        </div>}
        {selectedText && <div className="flex flex-wrap gap-2 rounded border border-gray-700 p-2"><button className={buttonClass} onClick={() => { extraction.open(selectedText, 'source' in initial ? initial.source || null : null); setSelectedText(null); }}>Save Selection as Block</button><button className={buttonClass} onClick={() => setSelectedText(null)}>Cancel selection</button></div>}
      </div>
      {(editor.document || variables.length > 0) && <aside aria-label="Composition result" className={`min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-gray-700 p-4 lg:w-[40%] lg:min-w-[300px] lg:flex-none lg:border-l lg:border-t-0 ${mobilePreview ? '' : 'hidden lg:block'}`}>
        {variables.length > 0 && <section className="space-y-2"><h3 className="text-xs font-semibold">Try template fields</h3><p className="text-xs text-gray-400">Preview values are used for copying, without changing saved defaults.</p><VariableValues variables={variables} values={values} onChange={setValues} /></section>}
        <div onContextMenu={e => { const text = selectedPromptText(); if (text) { e.preventDefault(); setSelectedText(text); } }}><PromptPreview result={result} /></div>
      </aside>}
    </div>
    {extraction.dialog}
  </section>;
}
