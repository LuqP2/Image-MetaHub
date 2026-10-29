import BoardSmartFrameGroups from './BoardSmartFrameGroups';
import BoardSmartFrameMatrix from './BoardSmartFrameMatrix';
import { memo, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { BoardFlowNode } from '../../services/boards/reactFlowAdapter';
import { useBoardQueryStore } from '../../store/useBoardQueryStore';
import { useBoardStore } from '../../store/useBoardStore';
import { useBoardQueryActions } from './BoardQueryContext';
import BoardNodeControls from './BoardNodeControls';
import BoardSmartFrameResults from './BoardSmartFrameResults';
import BoardResultThumbnail from './BoardResultThumbnail';

export default memo(function BoardSmartFrameNode({ data, selected }: NodeProps<BoardFlowNode>) {
  const boardId = useBoardStore(state => state.activeBoardId);
  const result = useBoardQueryStore(state => boardId ? state.results[boardId]?.[data.object.id] : undefined);
  const previous = useRef<typeof result>();
  if (result?.status === 'ready') previous.current = result;
  const shown = result?.status === 'loading' || result?.status === 'updating' ? previous.current : result;
  const actions = useBoardQueryActions();
  const [expanded, setExpanded] = useState(false);
  if (data.object.type !== 'smart-frame') return null;
  const frame = data.object;
  return <div aria-busy={result?.status === 'loading' || result?.status === 'updating'} className="board-smart-frame" style={{ borderColor: frame.color }}>
    <BoardNodeControls selected={!!selected} />
    <header><strong>{frame.title}</strong><span>{result?.status === 'ready' ? `${result.totalCount.toLocaleString()} ${result.totalCount === 1 ? 'image' : 'images'} in frame` : result?.status === 'error' || result?.status === 'source-missing' ? 'Unavailable' : 'Loading…'}</span>
      {frame.layout.kind === 'grid' && <button className="board-button nodrag nopan" onClick={() => setExpanded(!expanded)}>{expanded ? 'Preview' : 'Browse'}</button>}</header>
    <small>{frame.source.kind === 'collection' ? 'Live collection' : frame.source.kind === 'snapshot' ? 'Snapshot' : frame.source.kind}</small>
    {result?.error && <div role="alert">{result.error}<button className="board-button nodrag" onClick={() => actions?.retry()}>Retry</button></div>}
    {!!result?.unavailableReferences && <small>{result.unavailableReferences} references unavailable</small>}
    {shown?.status === 'ready' && shown.grouped?.kind === 'groups' && <BoardSmartFrameGroups key={JSON.stringify(frame.layout)} frameId={frame.id} groups={shown.grouped.groups} />}
    {shown?.status === 'ready' && shown.grouped?.kind === 'matrix' && <BoardSmartFrameMatrix key={JSON.stringify(frame.layout)} frameId={frame.id} matrix={shown.grouped} />}
    {shown?.status === 'ready' && !shown.grouped && (expanded ? <BoardSmartFrameResults imageIds={shown.imageIds} frameId={frame.id} /> :
      <div className="board-smart-preview">{shown.imageIds.slice(0, 12).map(id => { const image = actions?.images.get(id); return image ? <BoardResultThumbnail key={id} image={image} open={() => actions?.open(id, frame.id)} /> : null; })}</div>)}
  </div>;
});
