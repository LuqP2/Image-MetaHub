import { useEffect } from 'react';
import { hasPendingBoardChanges, useBoardStore } from '../store/useBoardStore';
import { flushReferenceRemaps, useBoardReferenceSync } from '../services/boards/referenceSync';

/** Mounted at App level: leaving the workspace never abandons an unsaved session. */
export function useBoardPersistenceLifecycle() {
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.boardsSetDirty || !api.onBoardsFlushRequested || !api.boardsFlushAcknowledged) return;
    const publish = () => api.boardsSetDirty?.(hasPendingBoardChanges() || useBoardReferenceSync.getState().pendingCount > 0);
    publish();
    const unsubscribe = useBoardStore.subscribe(publish);
    const unsubscribeReferences = useBoardReferenceSync.subscribe(publish);
    const unsubscribeFlush = api.onBoardsFlushRequested(requestId => {
      useBoardStore.getState().setClosing(true);
      void flushReferenceRemaps().then(() => useBoardStore.getState().flushAll()).then(
        () => api.boardsFlushAcknowledged?.(requestId, { success: true }),
        error => api.boardsFlushAcknowledged?.(requestId, { success: false, error: error instanceof Error ? error.message : String(error) }),
      );
    });
    const unsubscribeCancel = api.onBoardsCloseCancelled?.(() => useBoardStore.getState().setClosing(false));
    return () => { unsubscribe(); unsubscribeReferences(); unsubscribeFlush(); unsubscribeCancel?.(); };
  }, []);
}
