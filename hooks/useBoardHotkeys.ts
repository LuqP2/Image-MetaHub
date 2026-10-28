import type { KeyboardEvent } from 'react';
import { useCallback } from 'react';
import { useBoardStore } from '../store/useBoardStore';
import { duplicateObjects, removeConnections, removeObjects } from '../services/boards/operations';

/** Capture destructive editor keys before document-level library hotkeys see them. */
export function useBoardHotkeys(boardId: string | null, editable: boolean, openSelection?: () => void) {
  return useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (!boardId || event.defaultPrevented || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.closest('[role="dialog"]')) return;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if ((key === 'enter' || key === ' ') && target.closest('button, a')) return;
    const command = event.ctrlKey || event.metaKey;
    if (target.closest('[data-board-results]')) {
      if (key === 'delete' || key === 'backspace' || (command && ['a', 'd', 'z', 'y'].includes(key))) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    const state = useBoardStore.getState();
    const session = state.sessions[boardId];
    if (!session) return;
    let action: (() => void) | undefined;
    if (command && key === 'a') action = () => state.setSelection(boardId, session.document.objects.map(object => object.id));
    else if (key === 'escape') action = () => { state.cancelInteraction(boardId); state.setSelection(boardId, []); };
    else if (key === 'enter') action = openSelection;
    else if (editable && (key === 'delete' || key === 'backspace')) action = () => state.executeOperation(boardId, document => removeConnections(removeObjects(document, session.selectedObjectIds), session.selectedConnectionIds));
    else if (editable && command && key === 'd') action = () => state.executeOperation(boardId, document => duplicateObjects(document, session.selectedObjectIds));
    else if (editable && command && key === 'z') action = () => event.shiftKey ? state.redo(boardId) : state.undo(boardId);
    else if (editable && event.ctrlKey && key === 'y') action = () => state.redo(boardId);
    // Also block destructive keys while read-only: never forward them to library deletion.
    if (action || key === 'delete' || key === 'backspace') {
      event.preventDefault(); event.stopPropagation(); action?.();
    }
  }, [boardId, editable, openSelection]);
}
