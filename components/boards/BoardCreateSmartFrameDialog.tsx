import { useLayoutEffect, useRef, useState } from 'react';
export default function BoardCreateSmartFrameDialog({ collections, create, close, selectionCount = 0, currentViewSnapshot = false }: {
  collections: Array<{ id: string; name: string }>; create(source: string): void; close(): void; selectionCount?: number; currentViewSnapshot?: boolean;
}) {
  const [source, setSource] = useState('library');
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current!;
    const focus = () => dialog.querySelector<HTMLElement>('select')?.focus();
    const contain = (event: FocusEvent) => { if (event.target instanceof Node && !dialog.contains(event.target)) focus(); };
    focus(); document.addEventListener('focusin', contain);
    return () => { document.removeEventListener('focusin', contain); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const snapshot = source === 'selection' || source === 'current' && currentViewSnapshot;
  const explanation = source === 'library' ? 'Explore all visible library images. Results follow changes to the library.'
    : source === 'selection' ? 'Fix the selected files from the main Library as a Snapshot. New files are not added automatically.'
    : source === 'current' ? currentViewSnapshot ? 'Capture the current scoped or visual-search results as a Snapshot. New files are not added automatically.' : 'Copy the current Library filters into a local query. Results follow changes to the library.'
    : 'Explore this live collection. Results follow changes to its files and criteria.';
  return <div className="board-dialog-backdrop"><div ref={ref} role="dialog" aria-modal="true" aria-label="Create Smart Frame" aria-describedby="board-create-explanation" className="board-query-dialog" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('select, button:not(:disabled)')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <h2>Create Smart Frame</h2><label>Source<select className="board-input" value={source} onChange={event => setSource(event.target.value)}>
      <option value="library">Entire library</option><option value="current">Current library view ({currentViewSnapshot ? 'Snapshot' : 'Dynamic'})</option><option value="selection" disabled={!selectionCount}>Selected library images ({selectionCount.toLocaleString()}) · Snapshot</option>
      {collections.map(collection => <option key={collection.id} value={`collection:${collection.id}`}>{collection.name} (Live collection)</option>)}
    </select></label><p id="board-create-explanation">{explanation}</p><small>{snapshot ? 'Snapshot · fixed file set' : 'Dynamic · follows source changes'}</small>
    <div className="board-dialog-actions"><button className="board-button" disabled={source === 'selection' && !selectionCount} onClick={() => create(source)}>Create</button><button className="board-button" onClick={close}>Cancel</button></div>
  </div></div>;
}
