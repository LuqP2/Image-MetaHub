import { useTranslation } from '../../i18n/useTranslation';
import { useLayoutEffect, useRef, useState } from 'react';
export default function BoardCreateSmartFrameDialog({ collections, create, close, selectionCount = 0, currentViewSnapshot = false }: {
  collections: Array<{ id: string; name: string }>; create(source: string): void; close(): void; selectionCount?: number; currentViewSnapshot?: boolean;
}) {
  const { t } = useTranslation();
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
  const explanation = source === 'library' ? t('canvas.libraryExplanation')
    : source === 'selection' ? t('canvas.selectionExplanation')
    : source === 'current' ? currentViewSnapshot ? t('canvas.currentSnapshotExplanation') : t('canvas.currentQueryExplanation')
    : t('canvas.collectionExplanation');
  return <div className="board-dialog-backdrop"><div ref={ref} role="dialog" aria-modal="true" aria-label={t('canvas.createSmartFrame')} aria-describedby="board-create-explanation" className="board-query-dialog" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('select, button:not(:disabled)')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <h2>{t('canvas.createSmartFrame')}</h2><label>{t('canvas.source')}<select className="board-input" value={source} onChange={event => setSource(event.target.value)}>
      <option value="library">{t('canvas.entireLibrary')}</option><option value="current">{t('canvas.currentView', { mode: t(currentViewSnapshot ? 'canvas.snapshot' : 'canvas.dynamic') })}</option><option value="selection" disabled={!selectionCount}>{t('canvas.selectedSnapshot', { count: selectionCount })}</option>
      {collections.map(collection => <option key={collection.id} value={`collection:${collection.id}`}>{t('canvas.liveCollectionNamed', { name: collection.name })}</option>)}
    </select></label><p id="board-create-explanation">{explanation}</p><small>{snapshot ? t('canvas.snapshotFixed') : t('canvas.dynamicFollows')}</small>
    <div className="board-dialog-actions"><button className="board-button" disabled={source === 'selection' && !selectionCount} onClick={() => create(source)}>{t('canvas.createAction')}</button><button className="board-button" onClick={close}>{t('libraryFolders.cancel')}</button></div>
  </div></div>;
}
