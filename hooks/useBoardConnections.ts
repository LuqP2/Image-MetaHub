import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { useReactFlow, type Connection } from '@xyflow/react';
import { useBoardStore } from '../store/useBoardStore';
import { addConnection } from '../services/boards/operations';
import { boardConnectionPreview } from '../services/boards/connectionPreview';
import type { BoardPoint } from '../services/boards/layout';
import type { BoardObject, BoardSide } from '../services/boards/types';
import { useBoardEditor } from '../components/boards/BoardEditorContext';

interface ConnectionGesture {
  sourceId: string;
  sourceSide?: BoardSide;
  pointerStart: BoardPoint | null;
  dragged: boolean;
  pointerId: number | null;
}
interface Preview { path: string; source: BoardObject; target?: BoardObject }
const isSide = (value: string | undefined): value is BoardSide => !!value && ['top', 'right', 'bottom', 'left'].includes(value);

export function useBoardConnections(boardId: string, stage: RefObject<HTMLDivElement>) {
  const editor = useBoardEditor();
  const flow = useReactFlow();
  const gesture = useRef<ConnectionGesture | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const clear = useCallback(() => { gesture.current = null; setPreview(null); }, []);
  const cancel = useCallback(() => { clear(); editor.setTool?.('select'); }, [clear, editor.setTool]);
  const objectAt = (point: BoardPoint) => {
    const node = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('.react-flow__node[data-id]');
    return useBoardStore.getState().sessions[boardId]?.document.objects.find(object => object.id === node?.dataset.id);
  };
  const updatePreview = (point: BoardPoint) => {
    const active = gesture.current;
    if (!active) return;
    const source = useBoardStore.getState().sessions[boardId]?.document.objects.find(object => object.id === active.sourceId);
    if (!source) { cancel(); return; }
    const hit = objectAt(point);
    const target = hit?.id !== source.id ? hit : undefined;
    setPreview({ source, target, path: boardConnectionPreview(source, flow.screenToFlowPosition(point), target, active.sourceSide, { source: flow.getInternalNode?.(source.id), target: target ? flow.getInternalNode?.(target.id) : undefined }).path });
  };
  const connect = useCallback((connection: Connection) => {
    if (!editor.editable || connection.source === connection.target) return;
    const state = useBoardStore.getState();
    const current = state.sessions[boardId]?.document;
    if (!current?.objects.some(object => object.id === connection.source) || !current.objects.some(object => object.id === connection.target)) return;
    const existing = current.connections.find(edge => edge.sourceObjectId === connection.source && edge.targetObjectId === connection.target);
    if (existing) state.setSelection(boardId, [], [existing.id]);
    else state.executeOperation(boardId, document => addConnection(document, {
      sourceObjectId: connection.source, targetObjectId: connection.target,
      sourceSide: (connection.sourceHandle || 'right') as BoardSide, targetSide: (connection.targetHandle || 'left') as BoardSide,
      color: '#94a3b8', label: '',
    }));
    clear(); editor.setTool?.('select');
    stage.current?.closest<HTMLElement>('.board-workspace')?.focus({ preventScroll: true });
  }, [boardId, editor.editable, editor.setTool, clear, stage]);

  useEffect(() => { clear(); }, [boardId, editor.tool, editor.editable, clear]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel(); }
    };
    const outside = (event: PointerEvent) => { if (gesture.current && !stage.current?.contains(event.target as Node)) cancel(); };
    const blur = () => { if (gesture.current) cancel(); };
    window.addEventListener('keydown', key, true); window.addEventListener('blur', blur);
    document.addEventListener('pointerdown', outside, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur); document.removeEventListener('pointerdown', outside, true); };
  }, [cancel, stage]);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!gesture.current) suppressClick.current = false;
    if (!editor.editable || event.button !== 0) return;
    const node = target.closest<HTMLElement>('.react-flow__node[data-id]');
    const handle = target.closest<HTMLElement>('.react-flow__handle');
    const active = gesture.current;
    const canStart = handle || (editor.connecting && !target.closest('input,textarea,a,button,.react-flow__resize-control'));
    if (!active && editor.connecting && !node && target.closest('.react-flow__pane')) {
      event.preventDefault(); event.stopPropagation(); suppressClick.current = true; cancel(); return;
    }
    if (!active && (!canStart || !node?.dataset.id)) return;
    if (!node?.dataset.id && target.closest('.react-flow__panel')) { cancel(); return; }
    event.preventDefault(); event.stopPropagation(); suppressClick.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    if (!active) {
      const side = handle?.dataset.handleid;
      gesture.current = { sourceId: node!.dataset.id!, sourceSide: isSide(side) ? side : undefined, pointerStart: point, dragged: false, pointerId: event.pointerId };
      useBoardStore.getState().setSelection(boardId, [node!.dataset.id!]);
    } else { active.pointerStart = point; active.dragged = false; active.pointerId = event.pointerId; }
    stage.current?.closest<HTMLElement>('.board-workspace')?.focus({ preventScroll: true });
    updatePreview(point);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active) return;
    const point = { x: event.clientX, y: event.clientY };
    if (active.pointerStart && Math.hypot(point.x - active.pointerStart.x, point.y - active.pointerStart.y) > 4) active.dragged = true;
    updatePreview(point);
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    active.pointerId = null;
    const point = { x: event.clientX, y: event.clientY };
    const source = useBoardStore.getState().sessions[boardId]?.document.objects.find(object => object.id === active.sourceId);
    const target = objectAt(point);
    if (source && target && source.id !== target.id) {
      const geometry = boardConnectionPreview(source, flow.screenToFlowPosition(point), target, active.sourceSide);
      connect({ source: source.id, target: target.id, sourceHandle: geometry.sourceSide, targetHandle: geometry.targetSide });
    } else if (!source || !target || active.dragged) cancel();
    else { active.pointerStart = null; updatePreview(point); }
  };
  const click = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }
  };
  return { preview, connect, pointerDown, pointerMove, pointerUp, click, cancel };
}
