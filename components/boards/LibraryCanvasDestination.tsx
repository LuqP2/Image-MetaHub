import { useTranslation } from '../../i18n/useTranslation';
import { useEffect, useRef, useState } from 'react';
import { useBoardStore } from '../../store/useBoardStore';
import hotkeyManager from '../../services/hotkeyManager';
import { summarizeBoardCriteria } from './BoardInheritedQuerySummary';
import type { LibraryCanvasCapture } from '../../services/boards/libraryCapture';

const sortKeys = { asc: 'canvas.nameAZ', desc: 'canvas.nameZA', 'date-asc': 'libraryGallery.oldestFirst', 'date-desc': 'libraryGallery.newestFirst', random: 'libraryGallery.random' } as const;

export default function LibraryCanvasDestination({ capture, error, busy, blocked, retrySave, close, add }: {
  capture: LibraryCanvasCapture | null; error: string | null; busy: boolean; blocked: boolean; retrySave: boolean;
  close(): void; add(id?: string, name?: string): void;
}) {
  const { t } = useTranslation();
  const summaries = useBoardStore(state => state.summaries);
  const [name, setName] = useState(t('canvas.untitled'));
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
  const summary = capture ? summarizeBoardCriteria(capture.intentCriteria, t) : [];
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
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('canvas.addToCanvasTitle')} className="scrollbar-sidebar max-h-[80vh] w-full max-w-md overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-5 text-gray-100 shadow-xl">
      <header className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{t('canvas.addToCanvasTitle')}</h2><button aria-label={t('canvas.closeAddToCanvas')} disabled={busy} onClick={close}>×</button></header>
      {capture && <><p className="mb-2 text-sm">{t('canvas.captureLine', { mode: t(capture.mode === 'Dynamic' ? 'canvas.dynamic' : 'canvas.snapshot'), count: capture.count })}</p>
        <p className="mb-3 text-xs text-gray-400">{capture.mode === 'Dynamic' ? t('canvas.updatesMatches') : t('canvas.fixedHelp')}</p>
        <p className="mb-4 break-words text-xs text-gray-300">{t('canvas.captureSummary', { summary: summary.join(' · ') || t(capture.mode === 'Snapshot' ? 'canvas.currentScoped' : 'canvas.entireVisible'), sort: t(sortKeys[capture.criteria.sortOrder]) })}</p></>}
      {(error || loadError) && <p role="alert" className="mb-3 text-sm text-red-300">{error || loadError}</p>}
      {blocked && <p role="status" className="mb-2 text-xs">{t('canvas.waitLibrary')}</p>}
      <fieldset disabled={busy || blocked} className="flex flex-col gap-2">
        {retrySave ? <button className="rounded border border-accent/40 bg-accent/15 p-2 text-accent hover:bg-accent/25" onClick={() => add()}>{t('canvas.retrySaving')}</button> : <>
          <label className="text-sm">{t('canvas.newBoardEllipsis')}<input className="mt-1 w-full rounded border border-gray-700 bg-gray-800 p-2" aria-label={t('canvas.newName')} value={name} onChange={event => setName(event.target.value)}/></label>
          <button className="rounded border border-accent/40 bg-accent/15 p-2 text-accent hover:bg-accent/25" onClick={() => add(undefined, name)}>{t('canvas.createAndAdd')}</button>
          {summaries.filter(item => !item.error).map(item => <button key={item.id} className="rounded border border-gray-700 p-2 text-left" onClick={() => add(item.id)}>{item.name}</button>)}
        </>}
      </fieldset>
    </section>
  </div>;
}
