import BoardRichText from './BoardRichText';
import { boardSourceLabel, boardSourceMode, boardConstraintLabel } from '../../services/boards/presentation';
import { summarizeBoardCriteria } from './BoardInheritedQuerySummary';
import BoardSmartFrameGroups from './BoardSmartFrameGroups';
import BoardSmartFrameMatrix from './BoardSmartFrameMatrix';
import { memo, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { BoardFlowNode } from '../../services/boards/reactFlowAdapter';
import { useBoardQueryStore } from '../../store/useBoardQueryStore';
import { useBoardStore } from '../../store/useBoardStore';
import { useBoardQueryActions } from './BoardQueryContext';
import BoardNodeControls from './BoardNodeControls';
import BoardSmartFrameResults from './BoardSmartFrameResults';

export default memo(function BoardSmartFrameNode({ data, selected }: NodeProps<BoardFlowNode>) {
  const boardId = useBoardStore(state => state.activeBoardId);
  const result = useBoardQueryStore(state => boardId ? state.results[boardId]?.[data.object.id] : undefined);
  const previous = useRef<typeof result>();
  if (result?.status === 'ready') previous.current = result;
  const shown = result?.status === 'loading' || result?.status === 'updating' ? previous.current : result;
  const objects = useBoardStore(state => boardId ? state.sessions[boardId]?.document.objects : undefined);
  const actions = useBoardQueryActions();
  if (data.object.type !== 'smart-frame') return null;
  const frame = data.object;
  const criteria = [...frame.groupConstraints.map(boardConstraintLabel), ...summarizeBoardCriteria(frame.criteria)];
  return <div aria-busy={result?.status === 'loading' || result?.status === 'updating'} className="board-smart-frame" style={{ borderColor: frame.color }}>
    <BoardNodeControls selected={!!selected} />
    <header><strong><BoardRichText text={frame.title} /></strong><span>{result?.status === 'ready' ? `${result.totalCount.toLocaleString()} ${result.totalCount === 1 ? 'image' : 'images'} in frame` : result?.status === 'error' || result?.status === 'source-missing' ? 'Unavailable' : 'Loading…'}</span>
    </header>
    <div className="board-frame-context"><span>{boardSourceLabel(frame.source, objects)}</span><small>{boardSourceMode(frame.source)}</small></div>
    {criteria.length > 0 && <small className="board-frame-criteria" title={criteria.join(' · ')}>{criteria.slice(0, 2).join(' · ')}{criteria.length > 2 ? ` · +${criteria.length - 2} filters` : ''}</small>}
    {result?.error && <div role="alert">{result.error}<button className="board-button nodrag" onClick={() => actions?.retry()}>Retry</button></div>}
    {!!result?.unavailableReferences && <small>{result.unavailableReferences} {result.unavailableReferences === 1 ? 'reference' : 'references'} unavailable</small>}
    {shown?.status === 'ready' && shown.grouped?.kind === 'groups' && <BoardSmartFrameGroups key={JSON.stringify(frame.layout)} frameId={frame.id} groups={shown.grouped.groups} />}
    {shown?.status === 'ready' && shown.grouped?.kind === 'matrix' && <BoardSmartFrameMatrix key={JSON.stringify(frame.layout)} frameId={frame.id} matrix={shown.grouped} />}
    {shown?.status === 'ready' && !shown.grouped && <BoardSmartFrameResults imageIds={shown.imageIds} frameId={frame.id} />}
  </div>;
});
