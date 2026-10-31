import { useImageStore } from '../../store/useImageStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useBoardStore } from '../../store/useBoardStore';
import { captureWorkerCriteria } from '../libraryQuery/storeAdapter';
import { normalizeQueryCriteria } from './queryDocument.mjs';
import { createBoardAssetReference } from './assetResolver';
import { getBoardReferenceBaseline } from './referenceSync';
import { getHiddenSensitiveTagSet, isVisibleWithSafeMode } from '../../utils/safeModeVisibility';
import { createSmartFrame } from './smartFrameOperations';
import { findFreeBoardPosition } from './layout';
import { visibleBoardCenter } from './viewport';
import type { BoardSmartFrameObject } from './queryTypes';

export interface LibraryCanvasCapture {
  source: BoardSmartFrameObject['source'];
  criteria: BoardSmartFrameObject['criteria'];
  mode: 'Dynamic' | 'Snapshot';
  count: number;
  intentCriteria: BoardSmartFrameObject['criteria'];
}

/** Capture before awaiting reference IO, so choosing a destination cannot change the query. */
export async function captureLibraryForCanvas(): Promise<LibraryCanvasCapture> {
  const state = useImageStore.getState();
  if (state.isLoading || state.isLibraryQueryPending) throw new Error('Wait for Library results to finish updating.');
  const settings = useSettingsStore.getState();
  const hidden = getHiddenSensitiveTagSet(settings);
  const images = state.getScopedFilteredImages().filter(image => isVisibleWithSafeMode(image, hidden));
  const snapshot = Boolean(state.semanticResult || state.activeImageScope || state.selectedNodes.length);
  const captured = captureWorkerCriteria(state, settings);
  const criteria = normalizeQueryCriteria({ ...captured, sortOrder: captured.sortOrder === 'relevance' ? 'date-desc' : captured.sortOrder });
  if (!snapshot) return { source: { kind: 'library' }, criteria, intentCriteria: criteria, mode: 'Dynamic', count: images.length };
  const baseline = await getBoardReferenceBaseline();
  if (useImageStore.getState().images !== state.images) throw new Error('The Library changed while capturing results. Try again.');
  return { source: { kind: 'snapshot', references: images.map(image => createBoardAssetReference(image, state.directories, baseline)) },
    criteria: normalizeQueryCriteria({ sortOrder: criteria.sortOrder, randomSeed: criteria.randomSeed }), intentCriteria: criteria, mode: 'Snapshot', count: images.length };
}

/** One operation, with final criteria, and an ID supplied by the caller for save retries. */
export function insertLibrarySmartFrame(boardId: string, capture: LibraryCanvasCapture, frameId: string) {
  const state = useBoardStore.getState();
  const session = state.sessions[boardId];
  if (!session || state.closing || session.recovering) throw new Error('This board is not available for editing. Choose another destination.');
  if (!session.document.objects.some(object => object.id === frameId)) {
    state.executeOperation(boardId, document => {
      const center = visibleBoardCenter(document.viewport, { x: 32, y: 32, width: 636, height: 436 });
      const position = findFreeBoardPosition(document.objects, { width: 640, height: 420 }, { x: center.x - 320, y: center.y - 210 });
      return createSmartFrame(document, { id: frameId, title: 'Library explorer', source: capture.source, criteria: capture.criteria, ...position });
    });
  }
  state.setSelection(boardId, [frameId]);
  state.requestReveal(boardId, [frameId], true);
}
