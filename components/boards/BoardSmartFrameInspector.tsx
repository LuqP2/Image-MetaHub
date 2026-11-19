import { useBoardPresentation } from '../../i18n/useBoardPresentation';
import { useTranslation } from '../../i18n/useTranslation';
import { boardGroupingLabel } from './boardPresentation';
import Section from './BoardInspectorSection';
import BoardSmartFrameLayoutEditor from './BoardSmartFrameLayoutEditor';
import { useState } from 'react';
import { reconnectableFrames } from '../../services/boards/queryGraph';
import BoardInheritedQuerySummary from './BoardInheritedQuerySummary';
import type { BoardDocument } from '../../services/boards/types';
import type { BoardSmartFrameObject } from '../../services/boards/queryTypes';
import { useBoardStore } from '../../store/useBoardStore';
import { useBoardQueryStore } from '../../store/useBoardQueryStore';
import { reconnectSmartFrameSource, branchSmartFrame, duplicateSmartFrameQuery, updateSmartFrameLayout } from '../../services/boards/smartFrameOperations';
import { updateObjects } from '../../services/boards/operations';
import BoardSmartFrameFilters from './BoardSmartFrameFilters';
import { useBoardQueryActions } from './BoardQueryContext';

export default function BoardSmartFrameInspector({ boardId, frame, editable }: { boardId: string; frame: BoardSmartFrameObject; editable: boolean }) {
  const { t } = useTranslation();
  const { boardSourceLabel, boardConstraintLabel } = useBoardPresentation();
  const [error, setError] = useState<string | null>(null);
  const document = useBoardStore(state => state.sessions[boardId].document);
  const frames = document.objects.filter((object): object is BoardSmartFrameObject => object.type === 'smart-frame');
  const candidates = reconnectableFrames(frames, frame.id);
  const run = (operation: (document: BoardDocument) => BoardDocument) => {
    const state = useBoardStore.getState();
    if (!editable || state.closing || state.sessions[boardId]?.recovering) return;
    try {
      const previous = new Set(state.sessions[boardId].document.objects.map(object => object.id));
      state.executeOperation(boardId, operation);
      const added = useBoardStore.getState().sessions[boardId].document.objects.filter(object => !previous.has(object.id)).map(object => object.id);
      if (added.length) { state.setSelection(boardId, added); state.requestReveal(boardId, [frame.id, ...added], true); }
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const result = useBoardQueryStore(state => state.results[boardId]?.[frame.id]);
  const actions = useBoardQueryActions();
  const collectionId = frame.source.kind === 'collection' ? frame.source.collectionId : null;
  const sourceValue = frame.source.kind === 'collection' ? `collection:${frame.source.collectionId}` : frame.source.kind === 'frame' ? `frame:${frame.source.frameId}` : frame.source.kind;
  return <div onBlur={() => useBoardStore.getState().commitInteraction(boardId)}>
    <div className="board-query-identity"><small>{frame.source.kind === 'snapshot' ? t('canvas.snapshotFixedFiles') : t('canvas.dynamicFollows')}{result?.status === 'ready' ? t('canvas.frameImages', { count: result.totalCount }) : ''}</small><label>{t('imageViewer.collection.title')}<input className="board-input" value={frame.title} disabled={!editable} onChange={event => useBoardStore.getState().updateInteraction(boardId, document => updateObjects(document, [{ id: frame.id, title: event.target.value }]))} /></label></div>
    {error && <p role="alert">{error}</p>}
    <Section title={t('canvas.source')} defaultOpen stateKey={`${boardId}:source`}>
    <label>{t('canvas.source')}<select className="board-input" disabled={!editable} value={sourceValue} onChange={event => {
      const value = event.target.value;
      run(document => reconnectSmartFrameSource(document, frame.id, value === 'library' ? { kind: 'library' } : value.startsWith('frame:') ? { kind: 'frame', frameId: value.slice(6) } : { kind: 'collection', collectionId: value.slice(11) }));
    }}>
      <option value="library">{t('canvas.entireLibrary')}</option>
      {frame.source.kind !== 'library' && frame.source.kind !== 'collection' && frame.source.kind !== 'frame' && <option value={sourceValue} disabled>{boardSourceLabel(frame.source, frames)}</option>}
      {frame.source.kind === 'frame' && !candidates.some(candidate => candidate.id === (frame.source.kind === 'frame' ? frame.source.frameId : '')) && <option value={sourceValue} disabled>{t('canvas.sourceUnavailable')}</option>}
      {frame.source.kind === 'collection' && !actions?.collections.some(collection => collection.id === collectionId) && <option value={sourceValue} disabled>{t('canvas.missingCollection')}</option>}
      {actions?.collections.map(collection => <option key={collection.id} value={`collection:${collection.id}`}>{t('canvas.collectionNamed', { name: collection.name })}</option>)}
      {candidates.map(candidate => <option key={candidate.id} value={`frame:${candidate.id}`}>{t('canvas.frameNamed', { name: frames.find(item => item.id === candidate.id)?.title ?? '' })}</option>)}
    </select></label>
    <div className="board-inspector-action-list"><button className="board-button" disabled={!editable || result?.status !== 'ready'} onClick={() => actions?.snapshot(frame.id)}>{t('canvas.freeze')}</button>
    <button className="board-button" disabled={!editable} onClick={() => actions?.useCurrentFilters(frame.id)}>{t('canvas.useCurrent')}</button></div>
    <BoardInheritedQuerySummary source={frame.source} frames={frames} />
    </Section>
    <Section title={t('shell.filters')} defaultOpen stateKey={`${boardId}:filters`}>
    {frame.groupConstraints.length > 0 && <section aria-label={t('canvas.localGroupFilters')}><h3>{t('canvas.groupFilters')}</h3>
      {frame.groupConstraints.map((constraint, index) => <div key={index}>
        <span title={constraint.kind === 'exact' ? constraint.value : undefined}>{boardGroupingLabel(constraint.dimension, t)}: {boardConstraintLabel(constraint)}</span>
        <button className="board-button" disabled={!editable} onClick={() => run(document => updateObjects(document, [{ id: frame.id, groupConstraints: frame.groupConstraints.filter((_, position) => position !== index) }]))}>{t('canvas.removeGroupFilter')}</button>
      </div>)}
    </section>}
    <h3>{t('canvas.localFilters')}</h3>
    <BoardSmartFrameFilters boardId={boardId} frame={frame} editable={editable} />
    </Section>
    <Section title={t('canvas.layout')} stateKey={`${boardId}:layout`}>
    <BoardSmartFrameLayoutEditor layout={frame.layout} disabled={!editable} change={layout => run(document => updateSmartFrameLayout(document, frame.id, layout))} />
    </Section>
    <Section title={t('canvas.relationships')} defaultOpen stateKey={`${boardId}:relations`}>
    <div className="board-inspector-action-list"><button className="board-button" disabled={!editable} onClick={() => run(document => branchSmartFrame(document, frame.id))}>{t('canvas.branch')}</button>
    <button className="board-button" disabled={!editable} onClick={() => run(document => duplicateSmartFrameQuery(document, frame.id))}>{t('canvas.duplicateQuery')}</button></div>
    </Section>

  </div>;
}
