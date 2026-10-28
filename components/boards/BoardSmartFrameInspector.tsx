import type { BoardSmartFrameObject } from '../../services/boards/queryTypes';
import { useBoardStore } from '../../store/useBoardStore';
import { useBoardQueryStore } from '../../store/useBoardQueryStore';
import { reconnectSmartFrameSource, updateSmartFrameQuery } from '../../services/boards/smartFrameOperations';
import { updateObjects } from '../../services/boards/operations';
import BoardQueryFilterEditor from './BoardQueryFilterEditor';
import { useBoardQueryActions } from './BoardQueryContext';

export default function BoardSmartFrameInspector({ boardId, frame, editable }: { boardId: string; frame: BoardSmartFrameObject; editable: boolean }) {
  const result = useBoardQueryStore(state => state.results[boardId]?.[frame.id]);
  const actions = useBoardQueryActions();
  const collectionId = frame.source.kind === 'collection' ? frame.source.collectionId : null;
  return <div onBlur={() => useBoardStore.getState().commitInteraction(boardId)}>
    <label>Title<input className="board-input" value={frame.title} disabled={!editable} onChange={event => useBoardStore.getState().updateInteraction(boardId, document => updateObjects(document, [{ id: frame.id, title: event.target.value }]))} /></label>
    <label>Source<select className="board-input" disabled={!editable} value={frame.source.kind === 'collection' ? `collection:${frame.source.collectionId}` : frame.source.kind}
      onChange={event => useBoardStore.getState().executeOperation(boardId, document => reconnectSmartFrameSource(document, frame.id, event.target.value === 'library' ? { kind: 'library' } : { kind: 'collection', collectionId: event.target.value.slice(11) }))}>
      <option value="library">Entire library</option>
      {frame.source.kind !== 'library' && frame.source.kind !== 'collection' && <option value={frame.source.kind}>{frame.source.kind}</option>}
      {frame.source.kind === 'collection' && !actions?.collections.some(collection => collection.id === collectionId) && <option value={`collection:${frame.source.collectionId}`}>Missing collection</option>}
      {actions?.collections.map(collection => <option key={collection.id} value={`collection:${collection.id}`}>{collection.name}</option>)}
    </select></label>
    <button className="board-button" disabled={!editable || result?.status !== 'ready'} onClick={() => actions?.snapshot(frame.id)}>Freeze as Snapshot</button>
    <button className="board-button" disabled={!editable} onClick={() => actions?.useCurrentFilters(frame.id)}>Use current library view</button>
    {frame.source.kind === 'frame' && <p>Inherited source: {frame.source.frameId}. Local criteria refine its results.</p>}
    <BoardQueryFilterEditor value={frame.criteria} facets={result?.facets} disabled={!editable}
      onChange={criteria => useBoardStore.getState().updateInteraction(boardId, document => updateSmartFrameQuery(document, frame.id, criteria))} />
  </div>;
}
