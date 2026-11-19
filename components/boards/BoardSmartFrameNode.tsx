import { useTranslation } from '../../i18n/useTranslation';
import { useBoardPresentation } from '../../i18n/useBoardPresentation';
import { useBoardUIStore } from '../../store/useBoardUIStore';
import { useBoardEditor } from './BoardEditorContext';
import BoardRichText from './BoardRichText';
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
  const { t } = useTranslation();
  const { boardSourceLabel, boardSourceMode, boardConstraintLabel } = useBoardPresentation();
  const editor = useBoardEditor();
  const boardId = useBoardStore(state => state.activeBoardId);
  const result = useBoardQueryStore(state => boardId ? state.results[boardId]?.[data.object.id] : undefined);
  const previous = useRef<typeof result>();
  if (result?.status === 'ready') previous.current = result;
  const shown = result?.status === 'loading' || result?.status === 'updating' ? previous.current : result;
  const objects = useBoardStore(state => boardId ? state.sessions[boardId]?.document.objects : undefined);
  const actions = useBoardQueryActions();
  if (data.object.type !== 'smart-frame') return null;
  const frame = data.object;
  const criteria = [...frame.groupConstraints.map(boardConstraintLabel), ...summarizeBoardCriteria(frame.criteria, t)];
  return <div aria-busy={result?.status === 'loading' || result?.status === 'updating'} className="board-smart-frame" style={{ borderColor: frame.color }}>
    <BoardNodeControls selected={!!selected} />
    <header><strong><BoardRichText text={frame.title} /></strong><span>{result?.status === 'ready' ? t('canvas.imagesInFrame', { count: result.totalCount }) : result?.status === 'error' || result?.status === 'source-missing' ? t('canvas.unavailableState') : t('imageViewer.provenance.loading')}</span>
      <button className="board-button nodrag nopan" data-board-filter-trigger={frame.id} disabled={!editor.editable} aria-label={t('canvas.filtersFor', { title: frame.title })} onClick={() => {
        if (!boardId) return;
        const ui = useBoardUIStore.getState(); ui.setFilterTarget(ui.filterTarget?.frameId === frame.id && ui.filterTarget.boardId === boardId ? null : { boardId, frameId: frame.id });
      }}>{t('canvas.filtersButton', { count: criteria.length })}</button>
    </header>
    <div className="board-frame-context"><span>{boardSourceLabel(frame.source, objects)}</span><small>{boardSourceMode(frame.source)}</small></div>
    {criteria.length > 0 && <small className="board-frame-criteria" title={criteria.join(' · ')}>{criteria.slice(0, 2).join(' · ')}{criteria.length > 2 ? t('canvas.moreFilters', { count: criteria.length - 2 }) : ''}</small>}
    {result?.error && <div role="alert">{result.error}<button className="board-button nodrag" onClick={() => actions?.retry()}>{t('generationQueue.retry')}</button></div>}
    {!!result?.unavailableReferences && <small>{t('canvas.unavailableReferences', { count: result.unavailableReferences })}</small>}
    {shown?.status === 'ready' && shown.grouped?.kind === 'groups' && <BoardSmartFrameGroups key={JSON.stringify(frame.layout)} frameId={frame.id} groups={shown.grouped.groups} />}
    {shown?.status === 'ready' && shown.grouped?.kind === 'matrix' && <BoardSmartFrameMatrix key={JSON.stringify(frame.layout)} frameId={frame.id} matrix={shown.grouped} />}
    {shown?.status === 'ready' && !shown.grouped && <BoardSmartFrameResults imageIds={shown.imageIds} frameId={frame.id} />}
  </div>;
});
