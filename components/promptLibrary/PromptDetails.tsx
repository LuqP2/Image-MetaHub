import React, { useState } from 'react';
import { Heart, MoreHorizontal, Pencil, X } from 'lucide-react';
import type { PromptLibraryItem } from '../../types';
import { allVariables, compilePrompt, makeDocument, normalizeEditor } from '../../services/promptLibrary/core.mjs';
import { usePromptLibraryPreview } from '../../hooks/usePromptLibraryPreview';
import { selectedPromptText, usePromptBlockExtraction } from '../../hooks/usePromptBlockExtraction';
import PromptPreview from './PromptPreview';
import { VariableValues, buttonClass } from './PromptVariables';

export default function PromptDetails({ item, onEdit, onClose, onFavorite, onDuplicate, onRemove, onDuplicates, onViewSource }: {
  item: PromptLibraryItem; onEdit: () => void; onClose: () => void; onFavorite: () => void;
  onDuplicate: () => void; onRemove: () => void; onDuplicates: () => void; onViewSource: (path: string) => void | Promise<void>;
}) {
  const editor = normalizeEditor(item.editor);
  const block = 'text' in item;
  const preview = usePromptLibraryPreview(item);
  const [values, setValues] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState(false);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [error, setError] = useState('');
  const extraction = usePromptBlockExtraction();
  let variables = editor.variables;
  try { if (!block) variables = editor.document?.mode === 'template' ? allVariables(editor.document) : []; } catch { variables = []; }
  const result = block ? compilePrompt({ positivePrompt: item.text, editor: { ...editor, document: { ...makeDocument(item.text), mode: 'template', variables: editor.variables } } }, values) : compilePrompt(item, values);
  const metadata = Object.entries(editor.metadata).filter(([, value]) => Array.isArray(value) ? value.length : !!value);
  const source = async () => {
    if (!window.electronAPI) return;
    const response = await window.electronAPI.savedPromptsResolveSource(item.id);
    if (response.success && response.data.status === 'available') void onViewSource(response.data.absolutePath);
    else setError('Source unavailable');
  };
  return <section aria-label="Prompt details" className="flex h-full min-h-0 flex-col rounded-xl border border-gray-700 bg-gray-900/50">
    <header className="flex items-center gap-2 border-b border-gray-700 p-3">
      <div className="min-w-0 flex-1">{(editor.title.trim() || block) && <h3 className="truncate text-sm font-semibold">{editor.title.trim() || 'Untitled block'}</h3>}</div>
      <button className={`app-top-icon-button ${editor.favorite ? '!text-red-400' : ''}`} aria-label="Toggle favorite" aria-pressed={editor.favorite} onClick={onFavorite}><Heart size={16} fill={editor.favorite ? 'currentColor' : 'none'} /></button>
      <button className={buttonClass} onClick={onEdit}><Pencil size={14} />Edit</button>
      <div className="relative"><button className="app-top-icon-button" aria-label="Item actions" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={16} /></button>{menu && <><button tabIndex={-1} aria-label="Close item actions" className="fixed inset-0 z-20 cursor-default" onClick={() => setMenu(false)} /><div className="absolute right-0 top-11 z-30 w-44 rounded-lg border border-gray-700 bg-gray-900 p-1 shadow-xl">{[['Duplicate', onDuplicate], ['Check duplicates', onDuplicates], ['Remove', onRemove]].map(([label, action]) => <button key={label as string} className={`block w-full rounded p-2 text-left text-xs hover:bg-gray-800 ${label === 'Remove' ? 'text-red-400' : ''}`} onClick={() => { setMenu(false); (action as () => void)(); }}>{label as string}</button>)}</div></>}</div>
      <button className="app-top-icon-button" aria-label="Close details" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {!editor.title.trim() && <button className="text-xs text-accent hover:underline" onClick={onEdit}>Add a title to make this {block ? 'block' : 'prompt'} easier to find</button>}
      {variables.length > 0 && <section className="space-y-2 rounded-lg border border-accent/25 bg-accent/5 p-3"><h4 className="text-sm font-semibold">Fill template fields</h4><p className="text-xs text-gray-400">These values are used for copying. Your saved template stays unchanged.</p><VariableValues variables={variables} values={values} onChange={setValues} /></section>}
      <div onContextMenu={e => { const text = selectedPromptText(); if (text) { e.preventDefault(); setSelection({ text, x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 100) }); } }}><PromptPreview result={result} heading={block ? 'Block text' : 'Prompt'} /></div>
      {preview.url && <img src={preview.url} alt="Linked preview" className="max-h-52 w-full rounded-lg bg-gray-950/50 object-contain" />}
      {!!editor.tags.length && <div className="flex flex-wrap gap-1.5">{editor.tags.map(tag => <span key={tag} className="rounded-full border border-gray-700 px-2 py-1 text-xs text-gray-400">{tag}</span>)}</div>}
      {editor.category && <p className="text-xs text-gray-400">Category: {editor.category}</p>}
      {editor.notes && <section><h4 className="mb-2 text-xs text-gray-400">Notes</h4><p className="whitespace-pre-wrap break-words text-sm">{editor.notes}</p></section>}
      <details className="space-y-3 border-t border-gray-700 pt-3 text-xs text-gray-400"><summary className="cursor-pointer">Information</summary>{metadata.map(([key, value]) => <div key={key} className="break-words"><span className="capitalize">{key}: </span>{Array.isArray(value) ? value.join(', ') : value}</div>)}<p>Saved {new Date(item.createdAt).toLocaleString()}</p>{item.updatedAt && <p>Updated {new Date(item.updatedAt).toLocaleString()}</p>}{'sourceCreatedAt' in item && item.sourceCreatedAt && <p>Source date {new Date(item.sourceCreatedAt).toLocaleString()}</p>}{'source' in item && item.source && window.electronAPI && <button className={buttonClass} onClick={() => void source()}>View Source</button>}</details>
    </div>
    {selection && <><button className="fixed inset-0 z-[11000] cursor-default" aria-label="Dismiss selection menu" onClick={() => setSelection(null)} /><div className="fixed z-[11001] rounded-lg border border-gray-700 bg-gray-900 p-1 shadow-xl" style={{ left: selection.x, top: selection.y }}><button className={buttonClass} onClick={() => { extraction.open(selection.text, 'source' in item ? item.source : null); setSelection(null); }}>Save Selection as Block</button></div></>}
    {extraction.dialog}
  </section>;
}
