import type { Directory, IndexedImage } from '../../types';
import { useBoardStore } from '../../store/useBoardStore';
import { useImageStore } from '../../store/useImageStore';
import { addAssets } from './operations';
import { boardMediaType, createBoardAssetReference, resolveLiveBoardImage } from './assetResolver';
import { getBoardReferenceBaseline } from './referenceSync';
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
  const stage = document.querySelector('.board-stage');
  const bounds = stage?.getBoundingClientRect();
  const point = anchor ?? { x: ((bounds?.width || 700) / 2 - viewport.x) / viewport.zoom, y: ((bounds?.height || 500) / 2 - viewport.y) / viewport.zoom };
  state.executeOperation(boardId, document => addAssets(document, currentImages.map(image => ({
    reference: createBoardAssetReference(image, currentDirectories.length ? currentDirectories : directories, appliedRemapIds), name: image.name, mediaType: boardMediaType(image),
    ...(() => { const match = image.dimensions?.match(/(\d+)\s*x\s*(\d+)/i); return match ? { width: Number(match[1]), height: Number(match[2]) } : {}; })(),
  })), point));
  const ids = useBoardStore.getState().sessions[boardId].document.objects.filter(object => !previousIds.has(object.id)).map(object => object.id);
  state.setSelection(boardId, ids);
  if (!anchor) state.requestFitSelection(boardId);
  return ids;
}
