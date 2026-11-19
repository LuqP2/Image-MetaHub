import { useTranslation } from '../../i18n/useTranslation';
import { translatePromptMessage } from '../../i18n/promptMessages';
import React, { useEffect, useMemo, useState } from 'react';
import { Heart } from 'lucide-react';
import PromptTagsInput from './PromptTagsInput';
import PromptCategoryInput from './PromptCategoryInput';
import type { PromptLibraryItem, PromptBlock, SavedPrompt } from '../../types';
import { normalizeEditor, makeDocument, compilePrompt, allVariables, documentText } from '../../services/promptLibrary/core.mjs';
import { blockAddition } from '../../services/promptLibrary/composition';
import { useSavedPromptStore } from '../../store/useSavedPromptStore';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { useImageStore } from '../../store/useImageStore';
import { buildSavedPromptSource } from '../../hooks/useSavePrompt';
import { usePromptBlockExtraction, selectedPromptText } from '../../hooks/usePromptBlockExtraction';
import { usePromptLibraryPreview, linkSessionPreview } from '../../hooks/usePromptLibraryPreview';
import PromptComposer from './PromptComposer';
import PromptPreview from './PromptPreview';
import CompositionResult from './CompositionResult';
import BlockContentEditor from './BlockContentEditor';
import { activeBlockFields, rememberBlockFields } from '../../services/promptLibrary/blockFields';
import { getDraft, rememberDraft, clearDraft, getPreviewValues, rememberPreviewValues, type PromptDraftContext } from '../../services/promptLibrary/sessionDraft';
import { VariableDefinitions, VariableValues, buttonClass, fieldClass } from './PromptVariables';
import { createSelectionField, usePromptSelectionMenu } from '../../hooks/usePromptSelectionMenu';
export default function PromptEditor({ initial, kind, onSaved, onClose, onDirty, onViewSource, onSaveFailed, requestSave = 0, draftContext = 'library', compact = false, withinPanel = false, renderActions, appendText }: {
  initial: Partial<SavedPrompt & PromptBlock>;
  kind: 'prompt' | 'block';
  onSaved: (id?: string) => void;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
  onViewSource: (path: string) => void | Promise<void>;
  requestSave?: number;
  onSaveFailed?: () => void;
  draftContext?: PromptDraftContext;
  compact?: boolean;
  withinPanel?: boolean;
  renderActions?: (result: ReturnType<typeof compilePrompt>, visible: boolean, channel?: 'positive' | 'negative') => React.ReactNode;
  appendText?: { id: string | number; text: string; channel: 'positive' | 'negative'; block?: PromptBlock };
}) {
  const { t } = useTranslation();
  const sessionDraft = getDraft(draftContext);
  const [draft, setDraft] = useState(() => {
    const recovered = sessionDraft?.kind === kind && sessionDraft.initial.id === initial.id ? sessionDraft.draft : initial;
    return { ...recovered, editor: recovered === initial ? normalizeEditor(initial.editor) : recovered.editor || normalizeEditor(null) };
  });
  const [showFields, setShowFields] = useState(false);
  const previewKey = 'edit:' + (initial.id || kind);
  const [values, setValues] = useState<Record<string, string>>(() => getPreviewValues(draftContext, previewKey));
  const [error, setError] = useState<string | string[]>('');
  const errorText = (Array.isArray(error) ? error : [error]).map(message => translatePromptMessage(message, t)).join(' ');
  const [busy, setBusy] = useState(false);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [saveDetails, setSaveDetails] = useState(false);
  const [showNegative, setShowNegative] = useState(Boolean(draft.negativePrompt || draft.editor.document?.negative.some(part => part.text.trim())));
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [fieldStatus, setFieldStatus] = useState<{ placeholder: string; text: string } | null>(null);
  const textSelection = usePromptSelectionMenu();
  const [pendingFile, setPendingFile] = useState<File | null>(() => sessionDraft?.kind === kind && sessionDraft.initial.id === initial.id ? sessionDraft.pendingFile : null);
  const folders = useSavedPromptStore(s => s.folders) ?? [];
  const prompts = useSavedPromptStore((s) => s.prompts);
  const blocks = useSavedPromptStore((s) => s.blocks);
  const mutate = useSavedPromptStore((s) => s.mutate);
  const { canUseAdvancedPromptLibrary, showProModal } = useFeatureAccess();
  const extraction = usePromptBlockExtraction();
  const live = [...prompts, ...blocks].find((p) => p.id === initial.id);
  const removed = !!initial.id && !live;
  const conflict = removed || (!!live && (live.revision || 1) !== (initial.revision || 1));
  const conflictMessage = removed ? t('promptLibrary.draftDeleted') : t('promptLibrary.draftChanged');
  const advanced = kind === 'block' || !!draft.editor.document;
  const editableContent = !advanced || canUseAdvancedPromptLibrary;
  const editor = draft.editor;
  const preview = usePromptLibraryPreview(initial.id ? initial as PromptLibraryItem : null);
  const dirty = JSON.stringify(draft) !== JSON.stringify({ ...initial, editor: normalizeEditor(initial.editor) }) ||
    (kind === 'block' && editableContent && activeBlockFields(draft.text || '', editor.variables).some(variable => !editor.variables.some(known => known.name === variable.name)));
  useEffect(() => {
    onDirty(dirty); if(dirty)
      rememberDraft(kind, initial, draft, pendingFile, draftContext);
    else
      clearDraft(draftContext);
  }, [dirty, onDirty, draft, kind, initial, pendingFile, draftContext]);
  useEffect(() => { rememberPreviewValues(draftContext, previewKey, values); }, [draftContext, previewKey, values, dirty]);
  useEffect(() => {
    if(!dirty)
      return; const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const update = (patch: Partial<typeof draft>) => setDraft((p) => ({ ...p, ...patch }));
  const updateEditor = (patch: Partial<typeof editor>) => update({ editor: { ...editor, ...patch } });
  useEffect(() => {
    if (!appendText || !canUseAdvancedPromptLibrary) return;
    setDraft(current => {
      const document = current.editor.document || makeDocument(current.positivePrompt, current.negativePrompt);
      const requestPartId = `workspace-request:${appendText.id}`;
      if (document[appendText.channel].some(part => part.id === requestPartId)) return current;
      const addition = appendText.block ? blockAddition(appendText.block, appendText.channel) : null;
      const part = addition ? addition[appendText.channel][0] : { id: crypto.randomUUID(), kind: 'text' as const, text: appendText.text, enabled: true };
      const next = { ...document, mode: addition?.template ? 'template' as const : document.mode, [appendText.channel]: [...document[appendText.channel].filter(part => !(part.kind === 'text' && !part.text)), { ...part, id: requestPartId }] };
      try { allVariables(next); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'promptLibrary.conflictingVariables'); return current; }
      return { ...current, editor: { ...current.editor, document: next } };
    });
    if (appendText.channel === 'negative') setShowNegative(true);
  }, [appendText?.id]);
  const variables = useMemo(() => {
    try {
      return kind === 'block' ? activeBlockFields(draft.text || '', editor.variables) : editor.document?.mode === 'template' ? allVariables(editor.document) : [];
    }
    catch {
      return [];
    }
  }, [editor, kind, draft.text]);
  const result = kind === 'block' ? { positivePrompt: draft.text || '', negativePrompt: '', errors: [] } : compilePrompt(draft, values);
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
      if (kind === 'block' && canUseAdvancedPromptLibrary) item.editor = { ...editor, variables };
      if(copy)
        delete item.id;
      const id = await mutate({ action: copy || !initial.id ? 'create' : 'update', kind, item, expectedRevision: initial.revision || 1 });
      if(pendingFile && id)
        linkSessionPreview(id, pendingFile);
      clearDraft(draftContext);
      onDirty(false);
      onSaved(id);
    }
    catch(cause) {
      setError(cause instanceof Error ? cause.message : 'promptLibrary.saveFailedBare');
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
      const id = await mutate({ action: 'create', kind: 'prompt', item: { positivePrompt: result.positivePrompt, negativePrompt: result.negativePrompt, editor: { ...editor, title: t('promptLibrary.copyTitle', { title: editor.title }), document: null, favorite: false } } });
      clearDraft(draftContext);
      onSaved(id);
    }
    catch(cause) {
      setError(cause instanceof Error ? cause.message : 'promptLibrary.copyFailedBare');
    }
    finally {
      setBusy(false);
    }
  };
  const context = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const channel = e.currentTarget.dataset.promptChannel === 'negativePrompt' ? 'negativePrompt' : 'positivePrompt';
    textSelection.open(e, text => extraction.open(text, 'source' in initial ? initial.source || null : null), (text, start, end) => {
      if (!gate()) return;
      const field = createSelectionField(text, variables.map(variable => variable.name));
      const currentText = kind === 'block' ? draft.text || '' : draft[channel] || '';
      const replaced = currentText.slice(0, start) + '{{' + field.name + '}}' + currentText.slice(end);
      if (kind === 'block') update({ text: replaced, editor: { ...editor, variables: [...editor.variables, field] } });
      else {
        const document = makeDocument(channel === 'positivePrompt' ? replaced : draft.positivePrompt, channel === 'negativePrompt' ? replaced : draft.negativePrompt);
        update({ [channel]: replaced, editor: { ...editor, document: { ...document, mode: 'template', variables: [field] } } });
      }
      setShowFields(true);
      setFieldStatus({ placeholder: '{{' + field.name + '}}', text });
    });
  };
  useEffect(() => {
    if(requestSave > 0)
      void save();
  }, [requestSave]);
  const convertPlain = () => {
    if (!gate()) return;
    if(result.errors.length) {
      setError(result.errors);
      return;
    } if(window.confirm(t('promptLibrary.convertConfirm'))) {
      update({ positivePrompt: result.positivePrompt, negativePrompt: result.negativePrompt, editor: { ...editor, document: null } });
    }
  };
  const linkLibrary = async () => {
    const state = useImageStore.getState();
    const image = state.previewImage || state.selectedImage;
    if(!image) {
      setError('promptLibrary.selectImageFirst');
      return;
    }
    if (!image.fileType?.startsWith('image/') && !/\.(png|jpe?g|webp|gif|avif)$/i.test(image.name)) {
      setError('promptLibrary.chooseImagePreview'); return;
    }
    try {
      if (!window.electronAPI) {
        const file = await image.handle.getFile(); setPendingFile(file);
        updateEditor({ preview: { kind: 'session', name: file.name } });
      } else {
        const directory = state.directories.find((entry) => entry.id === image.directoryId)?.path;
        const source = buildSavedPromptSource(image, directory);
        if (!source) { setError('promptLibrary.linkFileInstead'); return; }
        updateEditor({ preview: source });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'promptLibrary.linkFailed'); }
  };
  const startComposition = () => {
    if (!editor.document) {
      if (!gate()) return;
      const document = makeDocument(draft.positivePrompt, draft.negativePrompt);
      document.positive = document.positive.filter(part => part.text.length > 0);
      document.negative = document.negative.filter(part => part.text.length > 0);
      updateEditor({ document });
    }
  };
  const modeControl = <div role="group" aria-label={t('promptLibrary.editingMode')} className="app-top-segmented self-start">
    <button type="button" className={`app-top-segment ${!editor.document ? 'app-top-segment-active' : ''}`} aria-pressed={!editor.document} disabled={busy || (!!editor.document && !canUseAdvancedPromptLibrary)} onClick={() => { if (editor.document) convertPlain(); }}>{t('promptLibrary.text')}</button>
    <button type="button" className={`app-top-segment ${editor.document ? 'app-top-segment-active' : ''}`} aria-label={t('promptLibrary.composeBlocks')} aria-pressed={!!editor.document} disabled={busy} onClick={startComposition}>{t('promptLibrary.compose')}</button>
  </div>;
  const fieldDefinitions = <VariableDefinitions disabled={!canUseAdvancedPromptLibrary} variables={editor.document?.variables || []} onChange={variables => {
    if (!gate()) return;
    updateEditor({ document: { ...(editor.document || makeDocument(draft.positivePrompt, draft.negativePrompt)), mode: 'template', variables } });
  }} />;
  const suggestions = [...new Set([...prompts, ...blocks].flatMap(item => item.editor?.tags || []))];
  const categories = [...new Set([...prompts, ...blocks].map(item => item.editor?.category || '').filter(Boolean))];
  const blockContent = <BlockContentEditor text={draft.text || ''} variables={variables} disabled={!editableContent || busy} rows={compact ? 6 : 8}
    onTextChange={text => update({ text, editor: { ...editor, variables: rememberBlockFields(text, editor.variables) } })}
    onVariableChange={variable => updateEditor({ variables: rememberBlockFields(draft.text || '', [...editor.variables.filter(entry => entry.name !== variable.name), variable]) })}
    onContextMenu={context} />;
  if (compact && kind === 'block') return <section aria-label={t('promptLibrary.editor')} className="flex h-full min-h-0 flex-col overflow-hidden rounded border border-gray-800">
    <header className="flex shrink-0 items-center gap-2 border-b border-gray-800 p-3"><h3 className="mr-auto text-sm font-semibold">{initial.id ? t('promptLibrary.editSavedBlock') : t('promptLibrary.newBlock')}</h3></header>
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
      {fieldStatus && <p role="status" className="text-xs text-accent">{t('promptLibrary.fieldReplaced', fieldStatus)}</p>}
      {(error || conflict) && <p role="alert" className="text-xs text-amber-300">{errorText || conflictMessage}</p>}
      {conflict && <button className={buttonClass} disabled={busy} onClick={() => void save(true)}>{t('promptLibrary.saveCopy')}</button>}
      <label className="block text-xs">{t('promptLibrary.blockName')}<input aria-label={t('promptLibrary.title')} className={fieldClass} value={editor.title} placeholder={t('promptLibrary.nameReusable')} onChange={e => updateEditor({ title: e.target.value })} /></label>
      <PromptCategoryInput value={editor.category} suggestions={categories} disabled={busy} onChange={category => updateEditor({ category })} />
      <label className="block text-xs">{t('promptLibrary.folder')}<select aria-label={t('promptLibrary.promptFolder')} className={fieldClass} value={editor.folderId || ''} onChange={event => updateEditor({ folderId: event.target.value })}><option value="">{t('promptLibrary.unfiled')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><PromptTagsInput tags={editor.tags} suggestions={suggestions} disabled={busy} onChange={tags => updateEditor({ tags })} />
      {blockContent}
      <div className="space-y-3 text-xs"><details className="space-y-3 text-xs text-gray-400"><summary className="cursor-pointer">{t('promptLibrary.notesPreview')}</summary><label className="block">{t('promptLibrary.notes')}<textarea aria-label={t('promptLibrary.notes')} rows={2} className={fieldClass} value={editor.notes} onChange={e => updateEditor({ notes: e.target.value })} /></label>{preview.url && <img src={preview.url} alt={t('promptLibrary.linkedPreview')} className="max-h-32 w-full object-contain" />}<button className={buttonClass} onClick={linkLibrary}>{t('promptLibrary.linkSelected')}</button>{window.electronAPI && <button className={buttonClass} onClick={async () => { const response = await window.electronAPI.promptLibraryChoosePreview(); if (response.success && response.data) updateEditor({ preview: response.data }); else if (response.success === false) setError(response.error); }}>{t('promptLibrary.linkFile')}</button>}<button className={buttonClass} onClick={() => updateEditor({ preview: 'hidden' })}>{t('promptLibrary.hidePreview')}</button></details>
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-800 pt-3"><button className={buttonClass} disabled={busy} onClick={onClose}>{t('promptLibrary.cancel')}</button><button className={buttonClass} disabled={busy || !dirty || conflict} onClick={() => void save()}>{busy ? t('promptLibrary.saving') : t('promptLibrary.saveBlock')}</button></div>
    </div>
    {textSelection.menu}
    {extraction.dialog}
  </section>;
  if (compact && kind === 'prompt') return <section aria-label={t('promptLibrary.editor')} className="flex h-full min-h-0 flex-col overflow-hidden rounded border border-gray-800">
    <header className="flex shrink-0 items-center gap-2 border-b border-gray-800 p-3">
      <h3 className="mr-auto text-sm font-semibold">{initial.id ? t('promptLibrary.editSavedPrompt') : 'Compose prompt'}</h3>
      <button className={buttonClass} disabled={busy} onClick={onClose}>{initial.id ? 'Cancel edit' : 'Clear'}</button>
      <button className={buttonClass} disabled={busy} aria-expanded={saveDetails} onClick={() => setSaveDetails(!saveDetails)}>{initial.id ? 'Save changes' : 'Save to library'}</button>
    </header>
    <div className="shrink-0 border-b border-gray-800 px-3 py-2">{modeControl}</div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
      {fieldStatus && <p role="status" className="text-xs text-accent">{t('promptLibrary.fieldReplaced', fieldStatus)}</p>}
      {(error || conflict) && <p role="alert" className="text-xs text-amber-300">{errorText || conflictMessage}</p>}
      {saveDetails && <section aria-label="Save composition" className="space-y-3 rounded border border-gray-800 p-3">
        <label className="block text-xs">{t('promptLibrary.titleOptional')}<input aria-label={t('promptLibrary.title')} className={fieldClass} value={editor.title} onChange={e => updateEditor({ title: e.target.value })} /></label>
        <PromptCategoryInput value={editor.category} suggestions={categories} disabled={busy} onChange={category => updateEditor({ category })} />
        <label className="block text-xs">{t('promptLibrary.folder')}<select aria-label={t('promptLibrary.promptFolder')} className={fieldClass} value={editor.folderId || ''} onChange={event => updateEditor({ folderId: event.target.value })}><option value="">{t('promptLibrary.unfiled')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><PromptTagsInput tags={editor.tags} suggestions={suggestions} disabled={busy} onChange={tags => updateEditor({ tags })} />
        <label className="block text-xs">{t('promptLibrary.notes')}<textarea aria-label={t('promptLibrary.notes')} rows={2} className={fieldClass} value={editor.notes} onChange={e => updateEditor({ notes: e.target.value })} /></label>
        <details className="space-y-3 text-xs text-gray-400"><summary className="cursor-pointer">More library options</summary><button className={buttonClass} aria-pressed={editor.favorite} onClick={() => updateEditor({ favorite: !editor.favorite })}>{editor.favorite ? t('promptLibrary.unfavorite') : t('promptLibrary.favorite')}</button>{preview.url && <img src={preview.url} alt={t('promptLibrary.linkedPreview')} className="max-h-32 w-full object-contain" />}<button className={buttonClass} onClick={linkLibrary}>{t('promptLibrary.linkSelected')}</button>{window.electronAPI && <button className={buttonClass} onClick={async () => { const response = await window.electronAPI.promptLibraryChoosePreview(); if (response.success && response.data) updateEditor({ preview: response.data }); else if (response.success === false) setError(response.error); }}>{t('promptLibrary.linkFile')}</button>}<button className={buttonClass} onClick={() => updateEditor({ preview: 'hidden' })}>{t('promptLibrary.hidePreview')}</button>{(['model', 'generator', 'sampler', 'scheduler'] as const).map(key => <label key={key} className="block capitalize">{key}<input className={fieldClass} value={editor.metadata[key]} onChange={e => updateEditor({ metadata: { ...editor.metadata, [key]: e.target.value } })} /></label>)}<label className="block">{t('promptLibrary.lorasLines')}<textarea className={fieldClass} value={editor.metadata.loras.join('\n')} onChange={e => updateEditor({ metadata: { ...editor.metadata, loras: e.target.value.split('\n') } })} /></label></details>
        <button className={buttonClass} disabled={busy || !dirty || conflict} onClick={() => void save()}>{busy ? t('promptLibrary.saving') : initial.id ? t('promptLibrary.updateSavedPrompt') : t('promptLibrary.savePrompt')}</button>
        {conflict && <button className={buttonClass} disabled={busy} onClick={() => void save(true)}>{t('promptLibrary.saveCopy')}</button>}
      </section>}
      {editor.document ? <PromptComposer compact values={values} document={editor.document} blocks={blocks} prompts={prompts} disabled={!canUseAdvancedPromptLibrary} onChange={document => update({ ...documentText(document), editor: { ...editor, document } })} onExtract={text => extraction.open(text)} onError={setError} /> : <>
        <label className="block text-xs">{t('promptLibrary.promptType')}<textarea data-prompt-channel="positivePrompt" aria-label={t('promptLibrary.promptType')} className={fieldClass} rows={6} value={draft.positivePrompt || ''} onChange={e => update({ positivePrompt: e.target.value })} onContextMenu={context} /></label>
        {showNegative || draft.negativePrompt ? <label className="block text-xs">{t('promptLibrary.negativePrompt')}<textarea data-prompt-channel="negativePrompt" aria-label={t('promptLibrary.negativePrompt')} className={fieldClass} rows={4} value={draft.negativePrompt || ''} onChange={e => update({ negativePrompt: e.target.value })} onContextMenu={context} /></label> : <button className={buttonClass} onClick={() => setShowNegative(true)}>{t('promptLibrary.addNegative')}</button>}
      </>}
      {!!variables.length && <section className="space-y-2"><h4 className="text-xs font-semibold">{t('promptLibrary.fillValues')}</h4><VariableValues variables={variables} values={values} onChange={setValues} /></section>}
      <details className="space-y-3 text-xs text-gray-400"><summary className="cursor-pointer">{t('promptLibrary.fillable')}</summary>{fieldDefinitions}</details>
    </div>
    <CompositionResult result={result} renderActions={channel => renderActions?.(result, true, channel)} />
    {textSelection.menu}
    {extraction.dialog}
  </section>;
  return <section aria-label={t('promptLibrary.editor')} className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/50 text-gray-100">
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-700 p-3">
      <div className="mr-auto min-w-0"><h3 className="truncate text-sm font-semibold">{initial.id ? t(kind === 'block' ? 'promptLibrary.editBlock' : 'promptLibrary.editPrompt') : t(kind === 'block' ? 'promptLibrary.newBlock' : 'promptLibrary.newPrompt')}{initial.editor?.title ? ` · ${initial.editor.title}` : ''}</h3><p className="text-[11px] text-gray-400">{dirty ? t('promptLibrary.unsavedChanges') : t('promptLibrary.noChanges')}</p></div>
      {kind === 'prompt' && <><button type="button" className={buttonClass} disabled={busy} onClick={onClose}>{t('promptLibrary.cancel')}</button>
      <button type="button" className={buttonClass + ' !border-accent/40 !bg-accent/15 !text-gray-100'} disabled={busy || !dirty || conflict} onClick={() => void save()}>{busy ? t('promptLibrary.saving') : t('promptLibrary.save')}</button></>}
    </header>
    <div className="shrink-0 space-y-3 border-b border-gray-700 p-3">
      <div className="flex flex-wrap items-center gap-3">{kind === 'prompt' && modeControl}<label className="block min-w-0 flex-1 text-xs text-gray-400">{t('promptLibrary.titleOptional')}<input aria-label={t('promptLibrary.title')} className={fieldClass} placeholder={kind === 'block' ? t('promptLibrary.nameReusable') : t('promptLibrary.namePrompt')} value={editor.title} onChange={e => updateEditor({ title: e.target.value })} /></label><button type="button" className={`app-top-icon-button ${editor.favorite ? '!text-red-400' : ''}`} aria-label={t('promptLibrary.favorite')} aria-pressed={editor.favorite} onClick={() => updateEditor({ favorite: !editor.favorite })}><Heart size={16} fill={editor.favorite ? 'currentColor' : 'none'} /></button></div>
      <PromptCategoryInput value={editor.category} suggestions={categories} disabled={busy} onChange={category => updateEditor({ category })} />
      <label className="block text-xs">{t('promptLibrary.folder')}<select aria-label={t('promptLibrary.promptFolder')} className={fieldClass} value={editor.folderId || ''} onChange={event => updateEditor({ folderId: event.target.value })}><option value="">{t('promptLibrary.unfiled')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><PromptTagsInput tags={editor.tags} suggestions={suggestions} disabled={busy} onChange={tags => updateEditor({ tags })} />
      <div className="flex flex-wrap items-center gap-2">
        {kind === 'prompt' && !withinPanel && <button type="button" className={buttonClass + (compact ? '' : ' lg:hidden')} onClick={() => setMobilePreview(!mobilePreview)}>{mobilePreview ? t('promptLibrary.backEditing') : t('promptLibrary.showResult')}</button>}
      </div>
    </div>
    <div className={`flex min-h-0 flex-1 flex-col ${withinPanel ? 'overflow-y-auto' : compact ? '' : 'lg:flex-row'}`}>
      <div hidden={compact && mobilePreview} className={`min-h-0 min-w-0 space-y-4 p-4 ${withinPanel ? 'shrink-0' : 'flex-1 overflow-y-auto'} ${mobilePreview ? compact ? 'hidden' : 'hidden lg:block' : ''}`}>
        {conflict && <div role="alert" className="space-y-2 rounded border border-amber-500/50 p-3 text-xs text-amber-400">{removed ? conflictMessage : t('promptLibrary.draftPreserved')}<div className="flex gap-2">{!removed && <button className={buttonClass} onClick={() => { if (window.confirm(t('promptLibrary.discardReload'))) onSaved(initial.id); }}>{t('promptLibrary.reload')}</button>}<button className={buttonClass} onClick={() => void save(true)}>{t('promptLibrary.saveCopy')}</button></div></div>}
        {fieldStatus && <p role="status" className="text-xs text-accent">{t('promptLibrary.fieldReplaced', fieldStatus)}</p>}
        {error && <p role="alert" className="text-sm text-red-400">{errorText}</p>}
        {!editableContent && <p className="text-xs text-gray-400">{t('promptLibrary.freeReadOnly')}</p>}
        {(kind === 'block' || !editor.document) && <div className="space-y-4">
          {kind === 'block' ? blockContent : <>{(['positivePrompt', 'negativePrompt'] as const).filter(key => key === 'positivePrompt' || showNegative || !!draft.negativePrompt).map(key => <label key={key} className="block text-xs text-gray-400">{key === 'positivePrompt' ? t('promptLibrary.promptType') : t('promptLibrary.negativePrompt')}<textarea data-prompt-channel={key} aria-label={key === 'positivePrompt' ? t('promptLibrary.promptType') : t('promptLibrary.negativePrompt')} rows={key === 'positivePrompt' ? 10 : 5} className={fieldClass + ' leading-relaxed'} value={draft[key] || ''} onChange={e => update({ [key]: e.target.value })} onContextMenu={context} /></label>)}{!showNegative && !draft.negativePrompt && <button className={buttonClass} onClick={() => setShowNegative(true)}>{t('promptLibrary.addNegative')}</button>}</>}
        </div>}
        {kind === 'prompt' && editor.document && <PromptComposer compact={compact || withinPanel} values={values} document={editor.document} blocks={blocks} prompts={prompts} disabled={!canUseAdvancedPromptLibrary} onChange={document => { const text = documentText(document); update({ ...text, editor: { ...editor, document } }); }} onExtract={text => extraction.open(text)} onError={setError} />}
        {kind === 'prompt' && editor.document && <details className="space-y-2 text-xs text-gray-400"><summary className="cursor-pointer">{t('promptLibrary.convertCopy')}</summary><button disabled={!canUseAdvancedPromptLibrary} className={buttonClass} onClick={convertPlain}>{t('promptLibrary.convertPlain')}</button><button className={buttonClass} disabled={!!result.errors.length} onClick={() => void copyAsText()}>{t('promptLibrary.createTextCopy')}</button></details>}
        {kind === 'prompt' && <details open={showFields} onToggle={e => setShowFields(e.currentTarget.open)} className="space-y-3 rounded-lg border border-gray-700 p-3"><summary className="cursor-pointer text-sm font-semibold">{t('promptLibrary.fillable')}</summary>{fieldDefinitions}</details>}
        <div className="space-y-5 border-t border-gray-700 pt-4">
          <label className="block text-xs text-gray-400">{t('promptLibrary.notes')}<textarea aria-label={t('promptLibrary.notes')} className={fieldClass} rows={4} value={editor.notes} onChange={e => updateEditor({ notes: e.target.value })} /></label>
          <section className="space-y-3 rounded-lg border border-gray-700 p-3"><h3 className="text-xs font-semibold">{t('promptLibrary.previewImage')}</h3>{preview.url && <img src={preview.url} alt={t('promptLibrary.linkedPreview')} className="max-h-40 w-full object-contain" />}<p className="text-xs text-gray-400">{pendingFile ? pendingFile.name : preview.status}</p><div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={linkLibrary}>{t('promptLibrary.linkSelected')}</button>{window.electronAPI ? <button className={buttonClass} onClick={async () => { const response = await window.electronAPI.promptLibraryChoosePreview(); if (response.success && response.data) updateEditor({ preview: response.data }); else if (response.success === false) setError(response.error); }}>{t('promptLibrary.linkFile')}</button> : <label className={buttonClass}>{t('promptLibrary.linkFile')}<input type="file" accept="image/*" className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) { setPendingFile(file); updateEditor({ preview: { kind: 'session', name: file.name } }); } }} /></label>}<button className={buttonClass} onClick={() => { setPendingFile(null); updateEditor({ preview: 'hidden' }); }}>{t('promptLibrary.hidePreview')}</button></div></section>
          <details className="space-y-3 rounded-lg border border-gray-700 p-3 text-xs text-gray-400"><summary className="cursor-pointer font-semibold">{t('promptLibrary.generationParameters')}</summary><div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-2">{(['model', 'generator', 'sampler', 'scheduler'] as const).map(key => <label key={key} className="block capitalize">{key}<input className={fieldClass} value={editor.metadata[key]} onChange={e => updateEditor({ metadata: { ...editor.metadata, [key]: e.target.value } })} /></label>)}</div><label className="block">{t('promptLibrary.lorasLines')}<textarea className={fieldClass} value={editor.metadata.loras.join('\n')} onChange={e => updateEditor({ metadata: { ...editor.metadata, loras: e.target.value.split('\n') } })} /></label></details>
        </div>
        {kind === 'block' && <div className="flex justify-end gap-2 border-t border-gray-700 pt-3"><button className={buttonClass} disabled={busy} onClick={onClose}>{t('promptLibrary.cancel')}</button><button className={buttonClass} disabled={busy || !dirty || conflict} onClick={() => void save()}>{busy ? t('promptLibrary.saving') : t('promptLibrary.saveBlock')}</button></div>}
        {selectedText && <div className="flex flex-wrap gap-2 rounded border border-gray-700 p-2"><button className={buttonClass} onClick={() => { extraction.open(selectedText, 'source' in initial ? initial.source || null : null); setSelectedText(null); }}>{t('promptLibrary.saveSelection')}</button><button className={buttonClass} onClick={() => setSelectedText(null)}>{t('promptLibrary.cancelSelection')}</button></div>}
      </div>
      {kind === 'prompt' && <aside hidden={compact && !mobilePreview} aria-label={t('promptLibrary.compositionResult')} className={`space-y-4 border-t border-gray-700 p-4 ${withinPanel ? 'shrink-0' : 'min-h-0 flex-1 overflow-y-auto ' + (compact ? mobilePreview ? '' : 'hidden' : 'lg:w-[40%] lg:min-w-[300px] lg:flex-none lg:border-l lg:border-t-0 ' + (mobilePreview ? '' : 'hidden lg:block'))}`}>
        {variables.length > 0 && <section className="space-y-2"><h3 className="text-xs font-semibold">{t('promptLibrary.fillValues')}</h3><p className="text-xs text-gray-400">{t('promptLibrary.previewValuesHelp')}</p><VariableValues variables={variables} values={values} onChange={setValues} /></section>}
        <div onContextMenu={e => { const text = selectedPromptText(); if (text) { e.preventDefault(); setSelectedText(text); } }}><PromptPreview result={result} /></div>
        {renderActions?.(result, !compact || mobilePreview)}
      </aside>}
    </div>
    {textSelection.menu}
    {extraction.dialog}
  </section>;
}
