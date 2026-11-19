import { useTranslation } from '../../i18n/useTranslation';
import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useBoardStore } from '../../store/useBoardStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { updateObjects } from '../../services/boards/operations';
import { boardSnapReferences, snapBoardBounds } from '../../services/boards/snapping';
import type { BoardFrameObject } from '../../services/boards/types';
import { useBoardEditor } from './BoardEditorContext';

const edges = ['top', 'right', 'bottom', 'left'] as const;
const corners = ['top left', 'top right', 'bottom left', 'bottom right'] as const;

export default function BoardFrameResizer({ boardId, frame, selected }: { boardId: string; frame: BoardFrameObject; selected: boolean }) {
  const editor = useBoardEditor();
  const flow = useReactFlow();
  const { t } = useTranslation();
  const { zoom } = useViewport();
  const cancelGesture = useRef<(() => void) | null>(null);
  const enabled = editor.editable && !editor.connecting && (!editor.tool || editor.tool === 'select');
  useEffect(() => () => cancelGesture.current?.(), [boardId, frame.id, enabled]);
  if (!enabled) return null;

  const startResize = (event: ReactPointerEvent<HTMLDivElement>, side: string) => {
    if (event.button !== 0 || cancelGesture.current) return;
    event.preventDefault();
    event.stopPropagation();
    const state = useBoardStore.getState();
    state.setSelection(boardId, [frame.id]);
    editor.inspectSelection?.();
    state.beginInteraction(boardId);
    const snapshot = state.sessions[boardId].document.objects;
    const references = boardSnapReferences(snapshot, new Set([frame.id]));
    const { x, y, width, height } = frame;
    const left = side.includes('left'), top = side.includes('top');
    const horizontal = left || side.includes('right');
    const vertical = top || side.includes('bottom');
    const scaleContents = horizontal && vertical && event.altKey;
    const resizeEdges = { x: horizontal ? (left ? 0 : 2) : undefined, y: vertical ? (top ? 0 : 2) : undefined } as const;
    const start = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
    const pointerId = event.pointerId;
    const minWidth = Math.min(80, width), minHeight = Math.min(60, height);

    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const point = flow.screenToFlowPosition({ x: next.clientX, y: next.clientY }, { snapToGrid: false });
      const dx = (point.x - start.x) * (left ? -1 : 1);
      const dy = (point.y - start.y) * (top ? -1 : 1);
      let nextWidth = horizontal ? Math.max(minWidth, width + dx) : width;
      let nextHeight = vertical ? Math.max(minHeight, height + dy) : height;
      if (scaleContents) {
        const scale = Math.max(minWidth / width, minHeight / height, 1 + (dx * width + dy * height) / (width ** 2 + height ** 2));
        nextWidth = width * scale;
        nextHeight = height * scale;
      }
      const boundsAt = (w: number, h: number) => ({ x: left ? x + width - w : x, y: top ? y + height - h : y, width: w, height: h });
      let bounds = boundsAt(nextWidth, nextHeight);
      const settings = useSettingsStore.getState();
      const snap = snapBoardBounds(bounds, references, flow.getViewport().zoom, settings.canvasSmartGuides !== next.shiftKey, settings.canvasSnapToGrid, resizeEdges);
      let guides = snap.guides;
      if (scaleContents) {
        const guide = [...guides].sort((a, b) => Math.abs(snap.correction[a.axis]) - Math.abs(snap.correction[b.axis]))[0];
        const axis = guide?.axis ?? (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y');
        const scale = axis === 'x' ? snap.bounds.width / width : snap.bounds.height / height;
        if (scale >= Math.max(minWidth / width, minHeight / height)) {
          bounds = boundsAt(width * scale, height * scale);
          guides = guide ? [guide] : [];
        } else guides = [];
      } else {
        bounds = boundsAt(Math.max(minWidth, snap.bounds.width), Math.max(minHeight, snap.bounds.height));
        guides = guides.filter(guide => guide.axis === 'x' ? bounds.width === snap.bounds.width : bounds.height === snap.bounds.height);
      }
      editor.showResizeGuides?.(guides);
      state.updateInteraction(boardId, document => updateObjects(document, [{ id: frame.id, ...bounds }],
        { resizeStart: snapshot, preserveFrameContents: !scaleContents }));
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', pointerCancel);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      cancelGesture.current = null;
      editor.showResizeGuides?.([]);
    };
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      move(next);
      cleanup();
      state.commitInteraction(boardId);
    };
    const cancel = () => { cleanup(); state.cancelInteraction(boardId); };
    const pointerCancel = (next: PointerEvent) => { if (next.pointerId === pointerId) cancel(); };
    const key = (next: KeyboardEvent) => {
      if (next.key !== 'Escape') return;
      next.preventDefault();
      next.stopImmediatePropagation();
      cancel();
    };
    cancelGesture.current = cancel;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', pointerCancel);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
  };

  return <>
    {edges.map(side => <div key={side} className={`react-flow__resize-control line ${side} nodrag nopan board-frame-resize`}
      data-selected={selected} title={t('canvas.dragResizeFrame')} style={{ '--board-resize-hit': `${12 / zoom}px`, '--board-resize-stroke': `${1 / zoom}px` } as CSSProperties}
      onPointerDown={event => startResize(event, side)} />)}
    {corners.map(side => <div key={side} className={`react-flow__resize-control handle ${side} nodrag nopan board-frame-resize`}
      data-selected={selected} title={t('canvas.dragResizeFrameScale')}
      style={{ width: 12 / zoom, height: 12 / zoom }} onPointerDown={event => startResize(event, side)} />)}
  </>;
}
