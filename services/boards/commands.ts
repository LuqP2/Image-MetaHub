import type { Directory, IndexedImage } from '../../types';
import { useBoardStore } from '../../store/useBoardStore';
import { useImageStore } from '../../store/useImageStore';
import { addAssets, duplicateObjects } from './operations';
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
