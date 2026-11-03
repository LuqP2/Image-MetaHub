import { useCallback, useEffect, useRef, useState } from 'react';
import { useReactFlow, type NodeChange } from '@xyflow/react';
import { useBoardStore } from '../store/useBoardStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { createBoardSnapGesture, resolveBoardSnapGesture, type BoardSnapGesture, type SmartGuide } from '../services/boards/snapping';
import { updateObjects } from '../services/boards/operations';
import type { BoardFlowNode } from '../services/boards/reactFlowAdapter';
import type { BoardPoint } from '../services/boards/layout';

function screenPoint(event: MouseEvent | TouchEvent): BoardPoint | null {
  const point = 'touches' in event ? event.touches[0] ?? event.changedTouches[0] : event;
  return point ? { x: point.clientX, y: point.clientY } : null;
}

/** The pointer and initial document geometry own the drag; React Flow's corrected nodes never do. */
export function useBoardSnapping(boardId: string) {
  const flow = useReactFlow<BoardFlowNode>();
  const gesture = useRef<BoardSnapGesture | null>(null);
  const [guides, setGuides] = useState<SmartGuide[]>([]);
  const smartGuides = useSettingsStore(state => state.canvasSmartGuides);
  const snapToGrid = useSettingsStore(state => state.canvasSnapToGrid);

  const apply = useCallback(() => {
    const active = gesture.current;
    if (!active || active.cancelled) return;
    const state = useBoardStore.getState();
    if (!state.sessions[boardId]) return;
    const settings = useSettingsStore.getState();
    const result = resolveBoardSnapGesture(active, flow.screenToFlowPosition(active.pointer, { snapToGrid: false }),
      flow.getViewport().zoom, settings.canvasSmartGuides, settings.canvasSnapToGrid);
    state.updateInteraction(boardId, document => updateObjects(document, result.updates));
    setGuides(result.guides);
  }, [boardId, flow]);

  const cancel = useCallback(() => {
    const active = gesture.current;
    if (!active || active.cancelled) return;
    // Keep the cancelled gesture until drag-stop to reject late React Flow position events.
    active.cancelled = true;
    useBoardStore.getState().cancelInteraction(boardId);
    setGuides([]);
  }, [boardId]);

  useEffect(() => {
    setGuides([]);
    const move = (event: MouseEvent | TouchEvent) => {
      const active = gesture.current;
      const point = screenPoint(event);
      if (active && !active.cancelled && point) { active.pointer = point; active.shift = event.shiftKey; }
    };
    const key = (event: KeyboardEvent) => {
      const active = gesture.current;
      if (!active || active.cancelled) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
      else if (event.key === 'Shift' && active.shift !== event.shiftKey) { active.shift = event.shiftKey; apply(); }
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('touchmove', move, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', key, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchcancel', cancel);
    return () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('touchmove', move, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', key, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchcancel', cancel);
      if (gesture.current && !gesture.current.cancelled) useBoardStore.getState().cancelInteraction(boardId);
      gesture.current = null;
    };
  }, [boardId, apply, cancel]);
  useEffect(() => { apply(); }, [smartGuides, snapToGrid, apply]);

  const begin = useCallback((event: MouseEvent | TouchEvent, node: BoardFlowNode, nodes: BoardFlowNode[]) => {
    const point = screenPoint(event);
    const document = useBoardStore.getState().sessions[boardId]?.document;
    gesture.current = point && document ? createBoardSnapGesture(document.objects, nodes.map(item => item.id), node.id,
      flow.screenToFlowPosition(point, { snapToGrid: false }), event.shiftKey) : null;
    if (gesture.current && point) gesture.current.pointer = point;
    setGuides([]);
  }, [boardId, flow]);

  const filterChanges = useCallback((changes: NodeChange<BoardFlowNode>[]) => {
    const active = gesture.current;
    if (!active) return changes;
    const ids = new Set(active.originals.map(object => object.id));
    const hasPosition = changes.some(change => change.type === 'position' && ids.has(change.id));
    if (hasPosition) apply();
    return changes.filter(change => change.type !== 'position' || !ids.has(change.id));
  }, [apply]);

  const finish = useCallback(() => {
    const cancelled = gesture.current?.cancelled ?? false;
    if (!cancelled) apply();
    gesture.current = null;
    setGuides([]);
    return cancelled;
  }, [apply]);
  return { begin, filterChanges, finish, guides };
}
