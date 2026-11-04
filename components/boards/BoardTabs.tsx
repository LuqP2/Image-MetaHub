import { useBoardStore } from '../../store/useBoardStore';

export default function BoardTabs({ onError, editable = true }: { onError(message: string): void; editable?: boolean }) {
  const ids = useBoardStore(state => state.openBoardIds);
  const sessions = useBoardStore(state => state.sessions);
  const active = useBoardStore(state => state.activeBoardId);
  const run = (action: Promise<unknown>) => { void action.catch(error => onError(String(error.message ?? error))); };
  return <nav className="board-tabs" aria-label="Open boards">
    <button className="board-button" aria-pressed={!active} onClick={() => useBoardStore.getState().showBoardList()}>Boards</button>
    <div className="board-tabs-scroll scrollbar-thin">{ids.map(id => <div key={id} className="board-tab" data-active={active === id}>
      {active === id ? <input className="board-tab-name" aria-label="Board name" title={sessions[id]?.document.name} disabled={!editable} value={sessions[id]?.document.name ?? ''} style={{ width: `${Math.max(7, Math.min(22, sessions[id]?.document.name.length ?? 7))}ch` }} onChange={event => { if (event.target.value.trim()) useBoardStore.getState().renameBoard(id, event.target.value); }} /> : <button className="board-button" onClick={() => run(useBoardStore.getState().openBoard(id))}>{sessions[id]?.document.name ?? 'Loading…'}</button>}
      {sessions[id]?.saveStatus === 'error' && <span title="Save failed">⚠</span>}
      <button className="board-icon-button" aria-label={`Close ${sessions[id]?.document.name ?? 'board'}`} onClick={() => run(useBoardStore.getState().closeBoard(id))}>×</button>
    </div>)}</div>
    <button className="board-button" onClick={() => run(useBoardStore.getState().createBoard())} title="New board" aria-label="New board" disabled={!editable}>+</button>
  </nav>;
}
