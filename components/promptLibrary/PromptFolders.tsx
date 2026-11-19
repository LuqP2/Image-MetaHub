import { useTranslation } from '../../i18n/useTranslation';
import { translatePromptMessage } from '../../i18n/promptMessages';
import React, { useState } from 'react';
import type { PromptFolder, PromptLibraryMutation } from '../../types';
import { buttonClass, fieldClass } from './PromptVariables';
export default function PromptFolders({ folders, value, onChange, onMutate, onRemove, removing }: { folders: PromptFolder[]; value: string; onChange: (id: string) => void; onMutate: (command: PromptLibraryMutation) => Promise<unknown>; onRemove: (id: string) => void; removing: boolean }) {
  const { t } = useTranslation();
  const [operation, setOperation] = useState<{ kind: 'create' } | { kind: 'rename'; folderId: string } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = folders.find(folder => folder.id === value);
  return <nav aria-label={t('promptLibrary.folders')} className="flex flex-wrap items-center gap-2 text-xs">
    <label>{t('promptLibrary.folder')} <select className={fieldClass + ' !w-auto'} aria-label={t('promptLibrary.browseFolder')} value={value} onChange={event => onChange(event.target.value)}><option value="all">{t('promptLibrary.allFolders')}</option><option value="none">{t('promptLibrary.unfiled')}</option>{[...folders].sort((a,b) => a.name.localeCompare(b.name)).map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
    <button className={buttonClass} onClick={() => { setOperation({ kind: 'create' }); setName(''); }}>{t('promptLibrary.newFolder')}</button>
    {current && <><button className={buttonClass} onClick={() => { setOperation({ kind: 'rename', folderId: current.id }); setName(current.name); }}>{t('promptLibrary.renameFolder')}</button><button className={buttonClass} disabled={busy || removing} onClick={() => { if (window.confirm(t('promptLibrary.deleteFolderConfirm'))) onRemove(current.id); }}>{t('promptLibrary.deleteFolder')}</button></>}
    {operation && <form className="flex items-center gap-2" onSubmit={async event => { event.preventDefault(); setError(''); setBusy(true); try { await onMutate(operation.kind === 'create' ? { action: 'folder-create', name } : { action: 'folder-rename', id: operation.folderId, name }); setOperation(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'promptLibrary.folderFailed'); } finally { setBusy(false); } }}><input autoFocus aria-label={t('promptLibrary.folderName')} maxLength={100} value={name} onChange={event => setName(event.target.value)} className={fieldClass} /><button disabled={busy || !name.trim()} className={buttonClass}>{t('promptLibrary.saveFolder')}</button><button type="button" className={buttonClass} onClick={() => setOperation(null)}>{t('promptLibrary.cancel')}</button></form>}
    {error && <p role="alert" className="text-red-400">{translatePromptMessage(error, t)}</p>}
  </nav>;
}
