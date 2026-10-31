import { useEffect, useRef, useState } from 'react';
import { useBoardStore } from '../../store/useBoardStore';
import hotkeyManager from '../../services/hotkeyManager';
import { summarizeBoardCriteria } from './BoardInheritedQuerySummary';
import type { LibraryCanvasCapture } from '../../services/boards/libraryCapture';

const sortLabels = { asc: 'Name A–Z', desc: 'Name Z–A', 'date-asc': 'Oldest first', 'date-desc': 'Newest first', random: 'Random' };

export default function LibraryCanvasDestination({ capture, error, busy, blocked, retrySave, close, add }: {
  capture: LibraryCanvasCapture | null; error: string | null; busy: boolean; blocked: boolean; retrySave: boolean;
  close(): void; add(id?: string, name?: string): void;
}) {
  const summaries = useBoardStore(state => state.summaries);
  const [name, setName] = useState('Untitled board');
  const [loadError, setLoadError] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const focusable = () => [...(ref.current?.querySelectorAll<HTMLElement>('*') ?? [])]
    .filter(element => element.matches('button, input') && !element.matches(':disabled'));
  useEffect(() => {
    const previous = document.activeElement;
    hotkeyManager.pauseHotkeys();
    const focus = () => (focusable()[0] ?? ref.current)?.focus();
    const contain = (event: FocusEvent) => { if (event.target instanceof Node && !ref.current?.contains(event.target)) focus(); };
    focus(); document.addEventListener('focusin', contain);
    void useBoardStore.getState().loadBoardList().catch(cause => setLoadError(String(cause)));
    return () => { document.removeEventListener('focusin', contain); hotkeyManager.resumeHotkeys(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const summary = capture ? summarizeBoardCriteria(capture.intentCriteria) : [];
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 p-4" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = focusable();
      if (!controls.length) { event.preventDefault(); ref.current?.focus(); return; }
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Add to Canvas" className="scrollbar-sidebar max-h-[80vh] w-full max-w-md overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-5 text-gray-100 shadow-xl">
      <header className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Add to Canvas</h2><button aria-label="Close Add to Canvas" disabled={busy} onClick={close}>×</button></header>
      {capture && <><p className="mb-2 text-sm">Smart Frame · {capture.mode} · {capture.count.toLocaleString()} images</p>
        <p className="mb-3 text-xs text-gray-400">{capture.mode === 'Dynamic' ? 'Updates with matching images.' : 'Fixed file set. New images are not added automatically.'}</p>
        <p className="mb-4 break-words text-xs text-gray-300">{summary.join(' · ') || (capture.mode === 'Snapshot' ? 'Current scoped Library results' : 'Entire visible library')} · Sort: {sortLabels[capture.criteria.sortOrder]}</p></>}
      {(error || loadError) && <p role="alert" className="mb-3 text-sm text-red-300">{error || loadError}</p>}
      {blocked && <p role="status" className="mb-2 text-xs">Wait for Library results to finish updating.</p>}
      <fieldset disabled={busy || blocked} className="flex flex-col gap-2">
        {retrySave ? <button className="rounded bg-indigo-600 p-2" onClick={() => add()}>Retry saving Smart Frame</button> : <>
          <label className="text-sm">New board…<input className="mt-1 w-full rounded border border-gray-700 bg-gray-800 p-2" aria-label="New board name" value={name} onChange={event => setName(event.target.value)}/></label>
          <button className="rounded bg-indigo-600 p-2" onClick={() => add(undefined, name)}>Create board and add</button>
          {summaries.filter(item => !item.error).map(item => <button key={item.id} className="rounded border border-gray-700 p-2 text-left" onClick={() => add(item.id)}>{item.name}</button>)}
        </>}
      </fieldset>
    </section>
  </div>;
}
