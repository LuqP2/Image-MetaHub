import { useTranslation } from '../../i18n/useTranslation';
import BoardListPreview from './BoardListPreview';
import type { BoardEditorActions } from './BoardEditorContext';
import { useState } from 'react';
import type { BoardSummary } from '../../services/boards/types';

export default function BoardList({ summaries, editable, onOpen, onCreate, onDuplicate, onDelete, onRename, onImport, resolveAsset }: {
  resolveAsset?: BoardEditorActions['resolveAsset']; summaries: BoardSummary[]; editable: boolean; onOpen(id: string): void; onCreate(name: string): void;
  onDuplicate(id: string): void; onDelete(id: string): void; onRename(id: string, name: string): void; onImport(): void;
}) {
  const { t, language } = useTranslation();
  const [name, setName] = useState(t('canvas.untitled'));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  return <div className="board-list">
    <div className="board-list-heading"><div><h1>{t('comparison.canvas')}</h1><p>{t('canvas.listHelp')}</p></div><button className="board-button" disabled={!editable} onClick={onImport}>{t('canvas.import')}</button></div>
    <form className="board-create" onSubmit={event => { event.preventDefault(); if (name.trim()) onCreate(name.trim()); }}>
      <input className="board-input" aria-label={t('canvas.newName')} value={name} onChange={event => setName(event.target.value)} disabled={!editable} />
      <button className="board-button" type="submit" disabled={!editable || !name.trim()}>{t('canvas.create')}</button>
    </form>
    {!editable && <p>{t('canvas.readOnlyHelp')}</p>}
    {!summaries.length && <p>{t('canvas.empty')}</p>}
    <div className="board-list-grid">{summaries.map(summary => <article key={summary.id}>
      {renaming === summary.id ? <form onSubmit={event => { event.preventDefault(); if (rename.trim()) { onRename(summary.id, rename.trim()); setRenaming(null); } }}>
        <input className="board-input" aria-label={t('canvas.rename')} autoFocus value={rename} onChange={event => setRename(event.target.value)} />
        <button className="board-button" type="submit">{t('canvas.saveName')}</button><button className="board-button" type="button" onClick={() => setRenaming(null)}>{t('libraryFolders.cancel')}</button>
      </form> : <button className="board-list-open" disabled={!!summary.error} onClick={() => onOpen(summary.id)}><BoardListPreview summary={summary} resolveAsset={resolveAsset} /><strong>{summary.name}</strong><span>{t('canvas.objects', { count: summary.objectCount, date: new Date(summary.updatedAt).toLocaleDateString(language) })}</span></button>}
      {summary.error ? <p role="alert">{summary.error}</p> : <div className="board-list-actions">
        <button className="board-button" disabled={!editable} onClick={() => { setRenaming(summary.id); setRename(summary.name); }}>{t('libraryFolders.rename')}</button>
        <button className="board-button" disabled={!editable} onClick={() => onDuplicate(summary.id)}>{t('imageViewer.editor.duplicate')}</button>
        <button className="board-button" disabled={!editable} onClick={() => setDeleting(summary.id)}>{t('libraryGallery.delete')}</button>
      </div>}
      {deleting === summary.id && <div role="alert"><p>{t('canvas.deleteConfirm')}</p><button className="board-button" onClick={() => { onDelete(summary.id); setDeleting(null); }}>{t('canvas.delete')}</button><button className="board-button" onClick={() => setDeleting(null)}>{t('libraryFolders.cancel')}</button></div>}
    </article>)}</div>
  </div>;
}
