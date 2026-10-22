import React, { useRef, useState } from 'react';
import { fieldClass } from './PromptVariables';

export default function PromptInlineText({ value, label, placeholder, multiline = false, disabled, onSave }: {
  value: string; label: string; placeholder: string; multiline?: boolean; disabled: boolean; onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const canceled = useRef(false);
  const commit = async () => {
    if (saving.current || canceled.current) return;
    if (draft === value) { setEditing(false); return; }
    saving.current = true;
    try { await onSave(draft); setEditing(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save.'); }
    finally { saving.current = false; }
  };
  const props = { autoFocus: true, 'aria-label': label, value: draft, className: fieldClass + ' !py-1 !text-xs', disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: () => void commit(), onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); canceled.current = true; setEditing(false); }
      if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); void commit(); }
    } };
  return <div className="min-w-0">{editing ? multiline ? <textarea {...props} rows={3} /> : <input {...props} /> : <button type="button" aria-label={`Edit ${label.toLowerCase()}`} title={`Edit ${label.toLowerCase()}`} disabled={disabled} className="w-full rounded text-left text-inherit hover:underline" onClick={() => { canceled.current = false; setDraft(value); setError(''); setEditing(true); }}><span className={multiline ? 'whitespace-pre-wrap break-words text-xs' : 'block truncate text-sm font-semibold'}>{value || placeholder}</span></button>}{error && <p role="alert" className="text-xs text-red-400">{error}</p>}</div>;
}
