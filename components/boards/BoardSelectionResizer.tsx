import { useEffect, useRef } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useBoardStore } from '../../store/useBoardStore';
import { getBoardBounds, findContainingFrame } from '../../services/boards/layout';
import { scaleBoardSelection } from '../../services/boards/selectionScale';
import { updateObjects } from '../../services/boards/operations';
import { useBoardEditor } from './BoardEditorContext';

export default function BoardSelectionResizer({ boardId }: { boardId: string }) {
  const session = useBoardStore(state => state.sessions[boardId]);
  const editor = useBoardEditor();
  const flow = useReactFlow();
  const viewport = useViewport();
  const gesture = useRef<(() => void) | null>(null);
  const selected = session.document.objects.filter(object => session.selectedObjectIds.includes(object.id));
  const eligible = editor.editable && !editor.connecting && (!editor.tool || editor.tool === 'select') && selected.length > 1 && selected.every(object => object.type === 'asset' && object.mediaType === 'image');
  const selectionKey = session.selectedObjectIds.join('|');
  useEffect(() => () => gesture.current?.(), [boardId, selectionKey, eligible]);
  if (!eligible) return null;
  const bounds = getBoardBounds(selected);
  return <>{selected.map(object => <div key={object.id} data-selected-card={object.id} className="board-selection-resizer" style={{ left: viewport.x + object.x * viewport.zoom, top: viewport.y + object.y * viewport.zoom, width: object.width * viewport.zoom, height: object.height * viewport.zoom }}>
    {(['nw', 'ne', 'sw', 'se'] as const).map(corner => <button key={corner} className={`board-selection-corner ${corner} nodrag nopan`} aria-label={`Scale selected images ${corner}`} onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const initial = selected.map(object => ({ ...object }));
      const ids = initial.map(object => object.id);
      const anchor = { x: bounds.x + (corner.includes('w') ? bounds.width : 0), y: bounds.y + (corner.includes('n') ? bounds.height : 0) };
      const start = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const dx = start.x - anchor.x, dy = start.y - anchor.y;
      const pointerId = event.pointerId;
      const state = useBoardStore.getState();
      state.beginInteraction(boardId);
      const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); gesture.current = null; };
      const cancel = () => { cleanup(); if (useBoardStore.getState().sessions[boardId]) state.cancelInteraction(boardId); };
      const move = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        const point = flow.screenToFlowPosition({ x: next.clientX, y: next.clientY });
        const scale = ((point.x - anchor.x) * dx + (point.y - anchor.y) * dy) / (dx * dx + dy * dy || 1);
        state.updateInteraction(boardId, document => scaleBoardSelection(document, ids, initial, anchor, scale));
      };
      const finish = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        move(next); cleanup();
        state.updateInteraction(boardId, document => updateObjects(document, document.objects.filter(object => ids.includes(object.id)).map(object => ({ id: object.id, frameId: findContainingFrame(object, document.objects)?.id ?? null }))));
        state.commitInteraction(boardId);
      };
      const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); next.stopImmediatePropagation(); cancel(); } };
      gesture.current = cancel;
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel);
    }} />)}
  </div>)}</>;
}
