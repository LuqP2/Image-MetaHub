import { useEffect, useRef } from 'react';
import type { BoardSmartFrameObject } from '../../services/boards/queryTypes';
import { updateSmartFrameQuery } from '../../services/boards/smartFrameOperations';
import { useBoardStore } from '../../store/useBoardStore';
import { useBoardQueryStore } from '../../store/useBoardQueryStore';
import BoardQueryFilterEditor from './BoardQueryFilterEditor';

export default function BoardSmartFrameFilters({ boardId, frame, editable }: { boardId: string; frame: BoardSmartFrameObject; editable: boolean }) {
  const result = useBoardQueryStore(state => state.results[boardId]?.[frame.id]);
  const facets = useRef(result?.facets);
  if (result?.facets) facets.current = result.facets;
  useEffect(() => () => { if (useBoardStore.getState().sessions[boardId]) useBoardStore.getState().commitInteraction(boardId); }, [boardId, frame.id]);
  return <div onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) useBoardStore.getState().commitInteraction(boardId); }}>
    <BoardQueryFilterEditor value={frame.criteria} facets={facets.current} disabled={!editable} onChange={(criteria, typing) => {
      const state = useBoardStore.getState();
      if (!editable || state.closing || state.sessions[boardId]?.recovering) return;
      const operation = (document: import('../../services/boards/types').BoardDocument) => updateSmartFrameQuery(document, frame.id, criteria);
      if (typing) state.updateInteraction(boardId, operation); else state.executeOperation(boardId, operation);
    }} />
  </div>;
}
