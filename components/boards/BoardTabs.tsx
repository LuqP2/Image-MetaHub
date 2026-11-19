import { useTranslation } from '../../i18n/useTranslation';
import { useBoardStore } from '../../store/useBoardStore';
import { Plus, TriangleAlert, X } from 'lucide-react';

export default function BoardTabs({ onError, editable = true }: { onError(message: string): void; editable?: boolean }) {
  const { t } = useTranslation();
  const ids = useBoardStore(state => state.openBoardIds);
  const sessions = useBoardStore(state => state.sessions);
  const active = useBoardStore(state => state.activeBoardId);
  const run = (action: Promise<unknown>) => { void action.catch(error => onError(String(error.message ?? error))); };
  return <nav className="board-tabs" aria-label={t('canvas.openBoards')}>
    <button className="board-button" aria-pressed={!active} onClick={() => useBoardStore.getState().showBoardList()}>{t('canvas.boards')}</button>
    <div className="board-tabs-scroll scrollbar-thin">{ids.map(id => <div key={id} className="board-tab" data-active={active === id}>
      {active === id ? <input className="board-tab-name" aria-label={t('canvas.name')} title={sessions[id]?.document.name} disabled={!editable} value={sessions[id]?.document.name ?? ''} style={{ width: `calc(${Math.max(7, Math.min(22, sessions[id]?.document.name.length ?? 7))}ch + 16px)` }} onChange={event => { if (event.target.value.trim()) useBoardStore.getState().renameBoard(id, event.target.value); }} /> : <button className="board-tab-name" title={sessions[id]?.document.name} onClick={() => run(useBoardStore.getState().openBoard(id))}>{sessions[id]?.document.name ?? t('imageViewer.provenance.loading')}</button>}
      {sessions[id]?.saveStatus === 'error' && <span title={t('canvas.saveFailed')}><TriangleAlert size={14}/></span>}
      <button className="board-icon-button board-tab-close" aria-label={t('canvas.closeNamed', { name: sessions[id]?.document.name ?? t('canvas.board') })} onClick={() => run(useBoardStore.getState().closeBoard(id))}><X size={12}/></button>
    </div>)}</div>
    <button className="board-icon-button" onClick={() => run(useBoardStore.getState().createBoard())} title={t('canvas.new')} aria-label={t('canvas.new')} disabled={!editable}><Plus size={14}/></button>
  </nav>;
}
