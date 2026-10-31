import { captureLibraryForCanvas } from '../services/boards/libraryCapture';
import { getHiddenSensitiveTagSet, isVisibleWithSafeMode } from '../utils/safeModeVisibility';
import { useBoardQueries } from '../hooks/useBoardQueries';
import { useBoardQueryStore } from '../store/useBoardQueryStore';
import { BoardQueryContext } from './boards/BoardQueryContext';
import { replaceSmartFrameWithSnapshot, updateSmartFrameQuery, reconnectSmartFrameSource } from '../services/boards/smartFrameOperations';
import { useSettingsStore } from '../store/useSettingsStore';
import type { BoardAssetReference } from '../services/boards/types';
import { ExternalLink, Star } from 'lucide-react';
import { useBoardUIStore } from '../store/useBoardUIStore';
import { useCallback, useMemo, useState } from 'react';
import type { IndexedImage } from '../types';
import BoardWorkspace from './BoardWorkspace';
import BoardAssetBrowser from './boards/BoardAssetBrowser';
import ComparisonMetadataPanel from './ComparisonMetadataPanel';
import RatingStars from './RatingStars';
import { useBoardAssets } from '../hooks/useBoardAssets';
import { useFeatureAccess } from '../hooks/useFeatureAccess';
import { useBoardStore } from '../store/useBoardStore';
import { useImageStore } from '../store/useImageStore';
import { addImagesToBoard } from '../services/boards/commands';
import { boardMediaType, createBoardAssetReference, resolveLiveBoardImage } from '../services/boards/assetResolver';
import { getBoardReferenceBaseline } from '../services/boards/referenceSync';
import { updateObjects } from '../services/boards/operations';
import type { BoardAssetObject } from '../services/boards/types';
import type { BoardPoint } from '../services/boards/layout';

export default function CanvasWorkspace({ loading, onOpenImage, onCompareImages, onExploreLibrary }: { onExploreLibrary?(boardId: string): void; loading: boolean; onOpenImage(image: IndexedImage, navigationImages: IndexedImage[]): void; onCompareImages(images: IndexedImage[]): void }) {
  const { images, directories, resolve } = useBoardAssets(loading);
  const boardId = useBoardStore(state => state.activeBoardId);
  const session = useBoardStore(state => boardId ? state.sessions[boardId] : undefined);
  const closing = useBoardStore(state => state.closing);
  const retryQueries = useBoardQueries(boardId, loading);
  const collections = useImageStore(state => state.collections);
  const imagesById = useMemo(() => new Map(images.map(image => [image.id, image])), [images]);
  const { canUseCanvas, canUseComparison, showProModal } = useFeatureAccess();
  const editable = canUseCanvas && !closing && !session?.recovering;
  const [error, setError] = useState<string | null>(null);
  const [relinkId, setRelinkId] = useState<string | null>(null);
  const navigation = useMemo(() => {
    const byId = new Map<string, IndexedImage>();
    session?.document.objects.forEach(object => { if (object.type === 'asset') { const result = resolve(object); if (result.status === 'resolved') byId.set(result.image.id, result.image); } });
    return [...byId.values()];
  }, [session?.document.objects, resolve]);
  const open = useCallback((object: BoardAssetObject) => { const result = resolve(object); if (result.status === 'resolved') onOpenImage(result.image, navigation); }, [resolve, onOpenImage, navigation]);
  const add = useCallback(async (selected: IndexedImage[], anchor?: BoardPoint) => {
    if (!editable || !boardId) return;
    try { await addImagesToBoard(boardId, selected, directories, anchor); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [editable, boardId, directories]);
  const selected = session?.document.objects.filter(object => session.selectedObjectIds.includes(object.id)) ?? [];
  const selectedAsset = selected.length === 1 && selected[0].type === 'asset' ? selected[0] : null;
  const resolution = selectedAsset ? resolve(selectedAsset) : null;
  const selectedImages = new Map<string, IndexedImage>();
  let invalidSelection = selected.length === 0;
  selected.forEach(object => {
    if (object.type !== 'asset') { invalidSelection = true; return; }
    const result = resolve(object);
    if (result.status !== 'resolved' || boardMediaType(result.image) !== 'image') { invalidSelection = true; return; }
    selectedImages.set(result.image.assetId ?? result.image.id, result.image);
  });
  const compareEnabled = !invalidSelection && selectedImages.size >= 2 && selectedImages.size <= 4;
  const relink = async (image: IndexedImage) => {
    if (!editable || !boardId || !relinkId) return;
    try {
      const baseline = await getBoardReferenceBaseline();
      const live = resolveLiveBoardImage(image, useImageStore.getState().images);
      useBoardStore.getState().executeOperation(boardId, document => updateObjects(document, [{ id: relinkId, reference: createBoardAssetReference(live, useImageStore.getState().directories, baseline), name: live.name, mediaType: boardMediaType(live) }]));
      setRelinkId(null);
    } catch (cause) { setError(String(cause)); }
  };
  const inspector = resolution?.status === 'resolved' ? <>
    <div className="board-asset-actions"><button className="board-button" onClick={() => selectedAsset && open(selectedAsset)}><ExternalLink size={14}/>Open viewer</button>
    <button className="board-button" aria-pressed={Boolean(resolution.image.isFavorite)} onClick={() => { void useImageStore.getState().toggleFavorite(resolution.image.id).catch(cause => setError(String(cause))); }}><Star size={14} fill={resolution.image.isFavorite ? "currentColor" : "none"}/>Favorite</button></div>
    <RatingStars size={16} className="board-rating" rating={resolution.image.rating} onChange={rating => { void useImageStore.getState().setImageRating(resolution.image.id, rating).catch(cause => setError(String(cause))); }} />
  </> : null;
  const metadata = resolution?.status === 'resolved' ? <ComparisonMetadataPanel image={resolution.image} isExpanded onToggleExpanded={() => {}} presentation="embedded" /> : null;
  const status = selectedAsset && resolution?.status !== 'resolved' ? <div className="board-asset-status"><p>{resolution?.status === 'loading' ? 'Library is loading…' : resolution?.status === 'ambiguous' ? 'Multiple files match this reference.' : 'This file is not available in the current library.'}</p>{(resolution?.status === 'missing' || resolution?.status === 'ambiguous') && <><p>Choose the library file for this board item to restore its reference.</p><button className="board-button" disabled={!editable} onClick={() => { useBoardUIStore.getState().setLibraryOpen(true); setRelinkId(selectedAsset.id); }}>Locate missing file</button></>}</div> : null;

  const captureReferences = async (selected: IndexedImage[]): Promise<BoardAssetReference[]> => {
    const baseline = await getBoardReferenceBaseline();
    const state = useImageStore.getState();
    return selected.map(image => createBoardAssetReference(resolveLiveBoardImage(image, state.images), state.directories, baseline));
  };
  const runQueryAction = (action: () => Promise<void>) => { void action().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))); };
  const ensureEditable = () => {
    const state = useBoardStore.getState();
    if (!editable || !boardId || state.activeBoardId !== boardId || state.closing || state.sessions[boardId]?.recovering) throw new Error('This board is not available for editing.');
  };
  const snapshotQuery = async (frameId: string) => {
    ensureEditable();
    const result = useBoardQueryStore.getState().results[boardId!]?.[frameId];
    if (result?.status !== 'ready') throw new Error('Wait for the query to finish before capturing a Snapshot.');
    const definition = useBoardStore.getState().sessions[boardId!].document.objects.find(object => object.id === frameId);
    if (definition?.type !== 'smart-frame' || result.definitionKey !== JSON.stringify({ source: definition.source, criteria: definition.criteria, groupConstraints: definition.groupConstraints })) throw new Error('The query changed. Wait for fresh results.');
    const imageSet = useImageStore.getState().images;
    const selected = result.imageIds.map(id => imagesById.get(id)).filter((image): image is IndexedImage => !!image);
    const references = await captureReferences(selected);
    ensureEditable();
    const latest = useBoardStore.getState().sessions[boardId!].document.objects.find(object => object.id === frameId);
    if (latest?.type !== 'smart-frame' || result.definitionKey !== JSON.stringify({ source: latest.source, criteria: latest.criteria, groupConstraints: latest.groupConstraints })) throw new Error('The query changed. Try capturing the Snapshot again.');
    if (useBoardQueryStore.getState().results[boardId!]?.[frameId] !== result || useImageStore.getState().images !== imageSet) throw new Error('The results changed. Try capturing the Snapshot again.');
    useBoardStore.getState().executeOperation(boardId!, document => replaceSmartFrameWithSnapshot(document, frameId, references));
  };
  const applyCurrentView = async (frameId: string) => {
    ensureEditable();
    const captured = await captureLibraryForCanvas();
    ensureEditable();
    useBoardStore.getState().executeOperation(boardId!, document => captured.source.kind === 'snapshot'
      ? replaceSmartFrameWithSnapshot(document, frameId, captured.source.references)
      : updateSmartFrameQuery(reconnectSmartFrameSource(document, frameId, captured.source), frameId, captured.criteria));
  };
  const queryActions = { images: imagesById, collections, retry: retryQueries,
    create: () => { if (editable && boardId) onExploreLibrary?.(boardId); }, snapshot: (id: string) => runQueryAction(() => snapshotQuery(id)),
    useCurrentFilters: (id: string) => runQueryAction(() => applyCurrentView(id)),
    open: (imageId: string, frameId: string, navigationIds?: string[]) => {
      const result = useBoardQueryStore.getState().results[boardId!]?.[frameId];
      const image = imagesById.get(imageId);
      const hidden = getHiddenSensitiveTagSet(useSettingsStore.getState());
      if (image && isVisibleWithSafeMode(image, hidden) && result?.status === 'ready' && result.imageIds.includes(imageId)) {
        const allowed = new Set(result.imageIds);
        const navigation = (navigationIds ?? result.imageIds).filter(id => allowed.has(id)).map(id => imagesById.get(id)).filter((entry): entry is IndexedImage => !!entry && isVisibleWithSafeMode(entry, hidden));
        if (navigation.some(entry => entry.id === imageId)) onOpenImage(image, navigation);
      }
    },
  };
  return <BoardQueryContext.Provider value={queryActions}><div className="flex h-full min-h-0 flex-col">

    {!canUseCanvas && <div className="border-b border-gray-700 p-2 text-sm"><button onClick={() => showProModal('canvas')}>Enable Canvas editing with Pro or trial</button></div>}
    {error && <div role="alert" className="border-b border-red-500/40 p-2 text-sm text-red-300">{error}<button className="ml-3 underline" onClick={() => setError(null)}>Dismiss</button></div>}
    <BoardWorkspace editable={canUseCanvas} resolveAsset={resolve} onOpenAsset={open}
      onDropAssets={(ids, anchor) => {
        const byId = new Map(images.map(image => [image.id, image]));
        void add(ids.map(id => byId.get(id)).filter((image): image is IndexedImage => Boolean(image)), anchor);
      }}
      assetPanel={<BoardAssetBrowser images={images} directories={directories} editable={editable} onAdd={selected => { void add(selected); }} onPick={relinkId ? image => { void relink(image); } : undefined} onCancelPick={() => setRelinkId(null)} />}
      libraryLocked={Boolean(relinkId)} assetActions={inspector} assetMetadata={metadata} assetStatus={status}
      selectionActions={selected.length > 0 && selected.every(item => item.type === 'asset' && item.mediaType === 'image') ? <div className="board-selection-actions"><button className="board-button" disabled={!compareEnabled} onClick={() => canUseComparison ? onCompareImages([...selectedImages.values()]) : showProModal('comparison')}>Compare selected images</button></div> : null} />
  </div></BoardQueryContext.Provider>;
}
