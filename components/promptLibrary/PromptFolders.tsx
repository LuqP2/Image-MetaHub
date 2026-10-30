import React, { useState } from 'react';
import type { PromptFolder, PromptLibraryMutation } from '../../types';
import { buttonClass, fieldClass } from './PromptVariables';
export default function PromptFolders({ folders, value, onChange, onMutate }: { folders: PromptFolder[]; value: string; onChange: (id: string) => void; onMutate: (command: PromptLibraryMutation) => Promise<unknown> }) {
  const [operation, setOperation] = useState<'create' | 'rename' | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = folders.find(folder => folder.id === value);
  return <nav aria-label="Prompt folders" className="flex flex-wrap items-center gap-2 text-xs">
    <label>Folder <select className={fieldClass + ' !w-auto'} aria-label="Browse prompt folder" value={value} onChange={event => onChange(event.target.value)}><option value="all">All folders</option><option value="none">Unfiled</option>{[...folders].sort((a,b) => a.name.localeCompare(b.name)).map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
    <button className={buttonClass} onClick={() => { setOperation('create'); setName(''); }}>New folder</button>
    {current && <><button className={buttonClass} onClick={() => { setOperation('rename'); setName(current.name); }}>Rename folder</button><button className={buttonClass} disabled={busy} onClick={async () => { if (!window.confirm('Delete this folder? Its items will remain in Unfiled.')) return; setError(''); setBusy(true); try { await onMutate({ action: 'folder-remove', id: current.id }); onChange('none'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update folder.'); } finally { setBusy(false); } }}>Delete folder</button></>}
    {operation && <form className="flex items-center gap-2" onSubmit={async event => { event.preventDefault(); setError(''); setBusy(true); try { await onMutate(operation === 'create' ? { action: 'folder-create', name } : { action: 'folder-rename', id: value, name }); setOperation(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update folder.'); } finally { setBusy(false); } }}><input autoFocus aria-label="Folder name" maxLength={100} value={name} onChange={event => setName(event.target.value)} className={fieldClass} /><button disabled={busy || !name.trim()} className={buttonClass}>Save folder</button><button type="button" className={buttonClass} onClick={() => setOperation(null)}>Cancel</button></form>}
    {error && <p role="alert" className="text-red-400">{error}</p>}
  </nav>;
}
