import { useState } from 'react';
export default function BoardCreateSmartFrameDialog({ collections, create, close }: {
  collections: Array<{ id: string; name: string }>; create(source: string): void; close(): void;
}) {
  const [source, setSource] = useState('library');
  return <div className="board-dialog-backdrop"><div role="dialog" aria-modal="true" aria-label="Create Smart Frame" className="board-query-dialog" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') close(); }}>
    <h2>Create Smart Frame</h2><label>Source<select className="board-input" value={source} onChange={event => setSource(event.target.value)}>
      <option value="library">Entire library</option><option value="current">Current library view</option><option value="selection">Selected library images (Snapshot)</option>
      {collections.map(collection => <option key={collection.id} value={`collection:${collection.id}`}>{collection.name} (Live)</option>)}
    </select></label><p>Current scoped or visual-search views are captured as Snapshots.</p>
    <button className="board-button" onClick={() => create(source)}>Create</button><button className="board-button" onClick={close}>Cancel</button>
  </div></div>;
}
