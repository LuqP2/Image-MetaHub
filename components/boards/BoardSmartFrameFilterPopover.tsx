import { useTranslation } from '../../i18n/useTranslation';
import { useBoardPresentation } from '../../i18n/useBoardPresentation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useViewport } from '@xyflow/react';
import { useBoardStore } from '../../store/useBoardStore';
import { useBoardUIStore } from '../../store/useBoardUIStore';
import { useBoardEditor } from './BoardEditorContext';
import BoardInheritedQuerySummary from './BoardInheritedQuerySummary';
import BoardSmartFrameFilters from './BoardSmartFrameFilters';
import { updateObjects } from '../../services/boards/operations';

export default function BoardSmartFrameFilterPopover({ boardId }: { boardId: string }) {
  const target = useBoardUIStore(state => state.filterTarget);
  const objects = useBoardStore(state => state.sessions[boardId].document.objects);
  const frame = objects.find(object => object.id === target?.frameId && object.type === 'smart-frame');
  const viewport = useViewport();
  const { t } = useTranslation();
  const { boardSourceLabel, boardConstraintLabel } = useBoardPresentation();
  const editor = useBoardEditor();
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const open = target?.boardId === boardId && frame?.type === 'smart-frame';
  useEffect(() => () => { const ui = useBoardUIStore.getState(); if (ui.filterTarget?.boardId === boardId) ui.setFilterTarget(null); }, [boardId]);
  useEffect(() => {
    if (!open) return;
    const trigger = document.querySelector<HTMLElement>(`[data-board-filter-trigger="${CSS.escape(frame.id)}"]`);
    const close = () => { useBoardUIStore.getState().setFilterTarget(null); trigger?.focus({ preventScroll: true }); };
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !trigger?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); } };
    root.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', key, true); };
  }, [open, frame?.id]);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const node = document.querySelector<HTMLElement>(`.board-stage .react-flow__node[data-id="${CSS.escape(frame.id)}"]`);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 16);
      setPosition({ left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.left >= width + 20 ? rect.left - width - 12 : rect.right + 12)), top: Math.max(8, Math.min(rect.top, window.innerHeight - Math.min(620, window.innerHeight - 16) - 8)) });
    };
    measure(); window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, frame, viewport.x, viewport.y, viewport.zoom]);
  if (!open) return null;
  return createPortal(<div ref={root} className="board-filter-popover nodrag nopan nowheel" role="dialog" aria-label={t('canvas.filtersFor', { title: frame.title })} style={position} onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <header><strong>{t('canvas.filtersTitle', { title: frame.title })}</strong><button className="board-button" aria-label={t('canvas.closeFilters')} onClick={() => { useBoardUIStore.getState().setFilterTarget(null); document.querySelector<HTMLElement>(`[data-board-filter-trigger="${CSS.escape(frame.id)}"]`)?.focus(); }}>×</button></header>
    <small>{t('canvas.filterValue', { label: t('canvas.source'), value: boardSourceLabel(frame.source, objects) })}</small>
    <BoardInheritedQuerySummary source={frame.source} frames={objects.filter(object => object.type === 'smart-frame')} />
    {frame.groupConstraints.map((constraint, index) => <div className="board-filter-chip" key={index}>{boardConstraintLabel(constraint)}<button className="board-button" disabled={!editor.editable} aria-label={t('canvas.removeGroupNamed', { filter: boardConstraintLabel(constraint) })} onClick={() => useBoardStore.getState().executeOperation(boardId, document => updateObjects(document, [{ id: frame.id, groupConstraints: frame.groupConstraints.filter((_, i) => i !== index) }]))}>×</button></div>)}
    <BoardSmartFrameFilters boardId={boardId} frame={frame} editable={editor.editable} />
  </div>, document.body);
}
