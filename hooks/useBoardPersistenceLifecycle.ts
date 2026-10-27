import { useEffect } from 'react';
import { hasPendingBoardChanges, useBoardStore } from '../store/useBoardStore';

/** Mounted at App level: leaving the workspace never abandons an unsaved session. */
export function useBoardPersistenceLifecycle() {
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.boardsSetDirty || !api.onBoardsFlushRequested || !api.boardsFlushAcknowledged) return;
    const publish = () => api.boardsSetDirty?.(hasPendingBoardChanges());
    publish();
    const unsubscribe = useBoardStore.subscribe(publish);
    const unsubscribeFlush = api.onBoardsFlushRequested(requestId => {
      useBoardStore.getState().setClosing(true);
      void useBoardStore.getState().flushAll().then(
        () => api.boardsFlushAcknowledged?.(requestId, { success: true }),
        error => api.boardsFlushAcknowledged?.(requestId, { success: false, error: error instanceof Error ? error.message : String(error) }),
      );
    });
    const unsubscribeCancel = api.onBoardsCloseCancelled?.(() => useBoardStore.getState().setClosing(false));
    return () => { unsubscribe(); unsubscribeFlush(); unsubscribeCancel?.(); };
  }, []);
}
