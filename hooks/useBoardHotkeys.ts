import { duplicateBoardSelection, copyBoardSelection, pasteBoardSelection, deleteBoardSelection } from '../services/boards/commands';
import type { KeyboardEvent } from 'react';
import { useCallback } from 'react';
import { useBoardStore } from '../store/useBoardStore';

/** Capture destructive editor keys before document-level library hotkeys see them. */
export function useBoardHotkeys(boardId: string | null, editable: boolean, openSelection?: () => void, onError?: (message: string) => void) {
  return useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (!boardId || event.defaultPrevented || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.closest('[role="dialog"]')) return;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if ((key === 'enter' || key === ' ') && target.closest('button, a')) return;
    const command = event.ctrlKey || event.metaKey;
    if (target.closest('[data-board-results]')) {
      if (command && key === 'c') event.stopPropagation();
      if (key === 'delete' || key === 'backspace' || (command && ['a', 'd', 'z', 'y', 'x', 'v'].includes(key))) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    const state = useBoardStore.getState();
    const session = state.sessions[boardId];
    if (!session) return;
    let action: (() => void) | undefined;
    if (command && key === 'a') action = () => state.setSelection(boardId, session.document.objects.map(object => object.id));
    else if (key === 'escape') action = () => { state.cancelInteraction(boardId); state.setSelection(boardId, []); };
    else if (key === 'enter') action = openSelection;
    else if (editable && (key === 'delete' || key === 'backspace')) action = () => deleteBoardSelection(boardId);
    else if (command && key === 'c') action = () => { void copyBoardSelection(boardId).catch(error => onError?.(String(error.message ?? error))); };
    else if (editable && command && key === 'x') action = () => { void copyBoardSelection(boardId, true).catch(error => onError?.(String(error.message ?? error))); };
    else if (editable && command && key === 'v') action = () => { void pasteBoardSelection(boardId).catch(error => onError?.(String(error.message ?? error))); };
    else if (editable && command && key === 'd') action = () => duplicateBoardSelection(boardId);
    else if (editable && command && key === 'z') action = () => event.shiftKey ? state.redo(boardId) : state.undo(boardId);
    else if (editable && event.ctrlKey && key === 'y') action = () => state.redo(boardId);
    // Also block destructive keys while read-only: never forward them to library deletion.
    if (action || key === 'delete' || key === 'backspace' || (command && ['x', 'v', 'd', 'z', 'y'].includes(key))) {
      event.preventDefault(); event.stopPropagation(); action?.();
    }
  }, [boardId, editable, openSelection, onError]);
}
