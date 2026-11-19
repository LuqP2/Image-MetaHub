import { useTranslation } from '../../i18n/useTranslation';
import { useEffect, useRef, useState } from 'react';
import hotkeyManager from '../../services/hotkeyManager';
import type { IndexedImage } from '../../types';
import { useBoardStore } from '../../store/useBoardStore';
import { useImageStore } from '../../store/useImageStore';
import { addImagesToBoard } from '../../services/boards/commands';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';

export default function AddToBoardDialog({ images, onClose, onAdded }: { images: IndexedImage[]; onClose(): void; onAdded(): void }) {
  const { t } = useTranslation();
  const summaries = useBoardStore(state => state.summaries);
  const { canUseCanvas, showProModal } = useFeatureAccess();
  const [name, setName] = useState(t('canvas.untitled'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    hotkeyManager.pauseHotkeys();
    dialog.current?.querySelector('input')?.focus();
    return () => { hotkeyManager.resumeHotkeys(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { void useBoardStore.getState().loadBoardList().catch(cause => setError(String(cause))); }, []);
  const add = async (id?: string) => {
    if (!canUseCanvas) { showProModal('canvas'); return; }
    setBusy(true); setError(null);
    try {
      const boardId = id ?? await useBoardStore.getState().createBoard(name.trim() || t('canvas.untitled'));
      await useBoardStore.getState().openBoard(boardId);
      await addImagesToBoard(boardId, images, useImageStore.getState().directories);
      await useBoardStore.getState().flushBoard(boardId);
      onAdded();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 p-4" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') {
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])];
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label={t('canvas.addToBoardTitle')} className="max-h-[80vh] w-full max-w-md overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-5 text-gray-100 shadow-xl">
      <div className="mb-4 flex justify-between"><h2 className="font-semibold">{t('canvas.addAssetsTitle', { count: images.length })}</h2><button disabled={busy} onClick={onClose} aria-label={t('canvas.closeAddToBoard')}>×</button></div>
      {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
      <fieldset disabled={busy} className="flex flex-col gap-2"><input className="rounded border border-gray-700 bg-gray-800 p-2" aria-label={t('canvas.newName')} value={name} onChange={event => setName(event.target.value)} />
        <button className="rounded border border-accent/40 bg-accent/15 p-2 text-accent hover:bg-accent/25" onClick={() => { void add(); }}>{t('canvas.createAndAdd')}</button>
        {summaries.filter(summary => !summary.error).map(summary => <button className="rounded border border-gray-700 p-2 text-left" key={summary.id} onClick={() => { void add(summary.id); }}>{summary.name}</button>)}
      </fieldset>
    </section>
  </div>;
}
