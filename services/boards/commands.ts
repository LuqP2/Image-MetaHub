import type { Directory, IndexedImage } from '../../types';
import { useBoardStore } from '../../store/useBoardStore';
import { useImageStore } from '../../store/useImageStore';
import { addAssets, duplicateObjects, removeObjects, removeConnections, drawBoardObject, updateObjects } from './operations';
import { copyBoardFragment, parseBoardFragment, pasteBoardFragment, selectionClosure } from './clipboard';
import { boardMediaType, createBoardAssetReference, resolveLiveBoardImage } from './assetResolver';
import { getBoardReferenceBaseline } from './referenceSync';
import { boardVisibleArea, visibleBoardCenter } from './viewport';
import type { BoardPoint } from './layout';

export async function addImagesToBoard(boardId: string, images: IndexedImage[], directories: Directory[], anchor?: BoardPoint): Promise<string[]> {
  if (!images.length) throw new Error('Select at least one library asset.');
  const appliedRemapIds = await getBoardReferenceBaseline();
  const live = useImageStore.getState().images;
  const byId = new Map(live.map(image => [image.id, image]));
  const currentImages = images.map(image => resolveLiveBoardImage(image, live, byId));
  const currentDirectories = useImageStore.getState().directories;
  const state = useBoardStore.getState();
  const session = state.sessions[boardId];
  if (!session || state.closing || session.recovering) throw new Error('This board is not available for editing.');
  const previousIds = new Set(session.document.objects.map(object => object.id));
  const viewport = session.document.viewport;
  const stage = document.querySelector<HTMLElement>('.board-stage');
  const point = anchor ?? visibleBoardCenter(viewport, stage ? boardVisibleArea(stage) : { x: 32, y: 32, width: 636, height: 436 });
  state.executeOperation(boardId, document => addAssets(document, currentImages.map(image => ({
    reference: createBoardAssetReference(image, currentDirectories.length ? currentDirectories : directories, appliedRemapIds), name: image.name, mediaType: boardMediaType(image),
    ...(() => { const match = image.dimensions?.match(/(\d+)\s*x\s*(\d+)/i); return match ? { width: Number(match[1]), height: Number(match[2]) } : {}; })(),
  })), point, !anchor));
  const ids = useBoardStore.getState().sessions[boardId].document.objects.filter(object => !previousIds.has(object.id)).map(object => object.id);
  state.setSelection(boardId, ids);
  if (!anchor) state.requestReveal(boardId, ids);
  return ids;
}

export function duplicateBoardSelection(boardId: string) {
  const state = useBoardStore.getState(), session = state.sessions[boardId];
  if (!session || state.closing || session.recovering) return;
  const previous = new Set(session.document.objects.map(object => object.id));
  state.executeOperation(boardId, document => duplicateObjects(document, session.selectedObjectIds));
  const ids = useBoardStore.getState().sessions[boardId].document.objects.filter(object => !previous.has(object.id)).map(object => object.id);
  state.setSelection(boardId, ids);
  state.requestReveal(boardId, ids);
}

const pastePositions = new Map<string, { text: string; count: number }>();
const pointers = new Map<string, BoardPoint>();
export function setBoardPointer(boardId: string, point: BoardPoint) { pointers.set(boardId, point); }
export function boardPasteAnchor(boardId: string): BoardPoint {
  const session = useBoardStore.getState().sessions[boardId];
  const stage = document.querySelector<HTMLElement>('.board-stage');
  return pointers.get(boardId) ?? visibleBoardCenter(session.document.viewport, stage ? boardVisibleArea(stage) : { x: 0, y: 0, width: 800, height: 600 });
}
function editableSession(boardId: string) {
  const state = useBoardStore.getState();
  const session = state.sessions[boardId];
  if (!session || state.closing || session.recovering) throw new Error('This board is not available for editing.');
  return session;
}
export function deleteBoardSelection(boardId: string) {
  const session = editableSession(boardId);
  useBoardStore.getState().executeOperation(boardId, document => removeConnections(removeObjects(document, session.selectedObjectIds), session.selectedConnectionIds));
  useBoardStore.getState().setSelection(boardId, []);
}
export async function copyBoardSelection(boardId: string, cut = false) {
  const session = editableSession(boardId);
  if (!session.selectedObjectIds.length) return;
  const text = copyBoardFragment(session.document, session.selectedObjectIds);
  const sequence = session.changeSequence;
  const removed = [...selectionClosure(session.document, session.selectedObjectIds)];
  if (window.electronAPI?.copyTextToClipboard) {
    const result = await window.electronAPI.copyTextToClipboard(text);
    if (!result.success) throw new Error('Could not write to clipboard.');
  } else await navigator.clipboard.writeText(text);
  if (cut) {
    if (editableSession(boardId).changeSequence !== sequence) throw new Error('The board changed while copying. Copy succeeded; select the objects and cut again.');
    useBoardStore.getState().executeOperation(boardId, document => removeObjects(document, removed));
    useBoardStore.getState().setSelection(boardId, []);
  }
}
export async function pasteBoardSelection(boardId: string, anchor?: BoardPoint) {
  editableSession(boardId);
  let text: string;
  if (window.electronAPI?.boardsReadClipboard) {
    const result = await window.electronAPI.boardsReadClipboard();
    if (result.success === false) throw new Error(result.error);
    text = result.data;
  } else text = await navigator.clipboard.readText();
  if (!text) return;
  editableSession(boardId);
  const fragment = parseBoardFragment(text);
  const previous = pastePositions.get(boardId);
  const count = anchor ? 0 : previous?.text === text ? previous.count + 1 : 0;
  const point = anchor ?? boardPasteAnchor(boardId);
  const position = { x: point.x + count * 24, y: point.y + count * 24 };
  const state = useBoardStore.getState();
  let ids: string[] = [];
  state.executeOperation(boardId, document => {
    if (fragment) { const pasted = pasteBoardFragment(document, fragment, position); ids = pasted.ids; return pasted.document; }
    const next = drawBoardObject(document, 'text', { ...position, width: 280, height: 120 });
    const object = next.objects.find(item => !document.objects.some(old => old.id === item.id))!;
    ids = [object.id];
    return updateObjects(next, [{ id: object.id, text }]);
  });
  pastePositions.set(boardId, { text, count });
  state.setSelection(boardId, ids);
  state.requestReveal(boardId, ids);
}
