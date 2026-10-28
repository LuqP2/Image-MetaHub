import { useState } from 'react';
import type { BoardSummary } from '../../services/boards/types';

export default function BoardList({ summaries, editable, onOpen, onCreate, onDuplicate, onDelete, onRename, onImport }: {
  summaries: BoardSummary[]; editable: boolean; onOpen(id: string): void; onCreate(name: string): void;
  onDuplicate(id: string): void; onDelete(id: string): void; onRename(id: string, name: string): void; onImport(): void;
}) {
  const [name, setName] = useState('Untitled board');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  return <div className="board-list">
    <div className="board-list-heading"><div><h1>Canvas</h1><p>Arrange references, text and ideas on a visual board.</p></div><button className="board-button" disabled={!editable} onClick={onImport}>Import board</button></div>
    <form className="board-create" onSubmit={event => { event.preventDefault(); if (name.trim()) onCreate(name.trim()); }}>
      <input className="board-input" aria-label="New board name" value={name} onChange={event => setName(event.target.value)} disabled={!editable} />
      <button className="board-button" type="submit" disabled={!editable || !name.trim()}>Create board</button>
    </form>
    {!editable && <p>Existing boards remain available to view and export. Editing requires Pro or an active trial.</p>}
    {!summaries.length && <p>No boards yet. Create a board to start arranging your ideas.</p>}
    <div className="board-list-grid">{summaries.map(summary => <article key={summary.id}>
      {renaming === summary.id ? <form onSubmit={event => { event.preventDefault(); if (rename.trim()) { onRename(summary.id, rename.trim()); setRenaming(null); } }}>
        <input className="board-input" aria-label="Rename board" autoFocus value={rename} onChange={event => setRename(event.target.value)} />
        <button className="board-button" type="submit">Save name</button><button className="board-button" type="button" onClick={() => setRenaming(null)}>Cancel</button>
      </form> : <button className="board-list-open" disabled={!!summary.error} onClick={() => onOpen(summary.id)}><strong>{summary.name}</strong><span>{summary.objectCount} objects · {new Date(summary.updatedAt).toLocaleDateString()}</span></button>}
      {summary.error ? <p role="alert">{summary.error}</p> : <div className="board-list-actions">
        <button className="board-button" disabled={!editable} onClick={() => { setRenaming(summary.id); setRename(summary.name); }}>Rename</button>
        <button className="board-button" disabled={!editable} onClick={() => onDuplicate(summary.id)}>Duplicate</button>
        <button className="board-button" disabled={!editable} onClick={() => setDeleting(summary.id)}>Delete</button>
      </div>}
      {deleting === summary.id && <div role="alert"><p>Delete this board?</p><button className="board-button" onClick={() => { onDelete(summary.id); setDeleting(null); }}>Delete board</button><button className="board-button" onClick={() => setDeleting(null)}>Cancel</button></div>}
    </article>)}</div>
  </div>;
}
