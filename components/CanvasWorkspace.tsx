import { useTranslation } from '../i18n/useTranslation';
import { externalBoardPath, externalBoardReference, loadExternalBoardAsset } from '../services/boards/externalAssets';
import { getElectronAbsoluteMediaPath } from '../services/mediaSourceCache';
import { areFilesystemPathsEqual } from '../utils/filesystemPath';
import { isSupportedMediaFileName } from '../utils/mediaTypes.js';
import { addAssets } from '../services/boards/operations';
import type { BoardAssetInput } from '../services/boards/types';
import BoardExternalViewer from './boards/BoardExternalViewer';
import BoardPromptIntegration from './boards/BoardPromptIntegration';
import BoardPromptLibrary from './boards/BoardPromptLibrary';
import BoardImagePromptActions from './boards/BoardImagePromptActions';
import { captureLibraryForCanvas } from '../services/boards/libraryCapture';
import { getHiddenSensitiveTagSet, isVisibleWithSafeMode } from '../utils/safeModeVisibility';
import { useBoardQueries } from '../hooks/useBoardQueries';
import { useBoardQueryStore } from '../store/useBoardQueryStore';
import { BoardQueryContext } from './boards/BoardQueryContext';
import { createSmartFrame, replaceSmartFrameWithSnapshot, updateSmartFrameQuery, reconnectSmartFrameSource } from '../services/boards/smartFrameOperations';
import { useSettingsStore } from '../store/useSettingsStore';
import type { BoardAssetReference } from '../services/boards/types';
import { ExternalLink, Star } from 'lucide-react';
import { useBoardUIStore } from '../store/useBoardUIStore';
import { useCallback, useMemo, useState, useRef } from 'react';
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
import { findFreeBoardPosition, type BoardPoint } from '../services/boards/layout';

export default function CanvasWorkspace({ loading, onOpenImage, onCompareImages, onOpenPromptLibrary }: { onOpenPromptLibrary?(id: string): void; loading: boolean; onOpenImage(image: IndexedImage, navigationImages: IndexedImage[]): void; onCompareImages(images: IndexedImage[]): void }) {
  const { t } = useTranslation();
  const { images, directories, resolve, refreshExternalAssets } = useBoardAssets(loading);
  const boardId = useBoardStore(state => state.activeBoardId);
  const session = useBoardStore(state => boardId ? state.sessions[boardId] : undefined);
  const closing = useBoardStore(state => state.closing);
  const retryQueries = useBoardQueries(boardId, loading);
  const collections = useImageStore(state => state.collections);
  const imagesById = useMemo(() => new Map(images.map(image => [image.id, image])), [images]);
  const { canUseCanvas, canUseComparison, showProModal } = useFeatureAccess();
  const editable = canUseCanvas && !closing && !session?.recovering;
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const [error, setError] = useState<string | null>(null);
  const [libraryTab, setLibraryTab] = useState<'images' | 'prompts'>('images');
  const [relinkId, setRelinkId] = useState<string | null>(null);
  const [externalViewer, setExternalViewer] = useState<BoardAssetObject | null>(null);
  const navigation = useMemo(() => {
    const byId = new Map<string, IndexedImage>();
    session?.document.objects.forEach(object => { if (object.type === 'asset') { const result = resolve(object); if (result.status === 'resolved') byId.set(result.image.id, result.image); } });
    return [...byId.values()];
  }, [session?.document.objects, resolve]);
  const open = useCallback((object: BoardAssetObject) => {
    const result = resolve(object);
    if (result.status !== 'resolved') return;
    if (object.reference.kind === 'external') setExternalViewer(object);
    else onOpenImage(result.image, navigation);
  }, [resolve, onOpenImage, navigation]);
  const add = useCallback(async (selected: IndexedImage[], anchor?: BoardPoint) => {
    if (!editable || !boardId) return;
    try { await addImagesToBoard(boardId, selected, directories, anchor); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [editable, boardId, directories]);
  const dropFiles = async (files: File[], anchor: BoardPoint) => {
    if (!editable || !boardId) return;
    const destination = boardId;
    const inputs: BoardAssetInput[] = [];
    const ignored: string[] = [];
    for (const file of files) {
      try {
        const path = window.electronAPI?.getPathForFile?.(file);
        if (!path || !isSupportedMediaFileName(file.name)) throw new Error('Unsupported file');
        const existing = images.find(image => { const source = getElectronAbsoluteMediaPath(image); return source && areFilesystemPathsEqual(source, path); });
        if (existing) {
          const reference = createBoardAssetReference(existing, directories, await getBoardReferenceBaseline());
          inputs.push({ reference, name: existing.name, mediaType: boardMediaType(existing) });
          continue;
        }
        const authorization = await window.electronAPI?.boardsAuthorizeDroppedFile?.(destination, file);
        if (!authorization || authorization.success === false) throw new Error((authorization && authorization.success === false && authorization.error) || 'External file access unavailable.');
        const reference = externalBoardReference(authorization.data);
        const loaded = await loadExternalBoardAsset(destination, reference);
        if (loaded.status !== 'resolved') throw new Error('File unavailable');
        inputs.push({ reference, name: loaded.image.name, mediaType: boardMediaType(loaded.image) });
      } catch { ignored.push(file.name); }
    }
    const state = useBoardStore.getState();
    if (state.activeBoardId !== destination || !state.sessions[destination] || state.closing || state.sessions[destination].recovering || !editableRef.current) return;
    if (inputs.length) state.executeOperation(destination, document => addAssets(document, inputs, anchor));
    setError(ignored.length ? `Could not add: ${ignored.join(', ')}. Drag supported media files rather than folders.` : null);
  };
  const pickExternal = async () => {
    if (!editable || !boardId || !selectedAsset) return;
    const destination = boardId, objectId = selectedAsset.id;
    const defaultPath = selectedAsset.reference.kind === 'external' ? externalBoardPath(selectedAsset.reference) : undefined;
    try {
      const picked = await window.electronAPI?.boardsPickExternalFile?.({ boardId: destination, defaultPath });
      if (!picked) throw new Error('External files require the updated desktop app.');
      if (picked.success === false) throw new Error(picked.error);
      if (!picked.data) return;
      const reference = externalBoardReference(picked.data);
      const loaded = await loadExternalBoardAsset(destination, reference);
      if (loaded.status !== 'resolved') throw new Error('File unavailable.');
      const state = useBoardStore.getState();
      if (state.activeBoardId !== destination || !state.sessions[destination] || state.closing || state.sessions[destination].recovering || !editableRef.current) return;
      state.executeOperation(destination, document => updateObjects(document, [{ id: objectId, reference, name: loaded.image.name, mediaType: boardMediaType(loaded.image) }]));
      refreshExternalAssets();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const selected = session?.document.objects.filter(object => session.selectedObjectIds.includes(object.id)) ?? [];
  const selectedAsset = selected.length === 1 && selected[0].type === 'asset' ? selected[0] : null;
  const externalViewerImage = externalViewer ? resolve(externalViewer) : null;
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
  const libraryBacked = selectedAsset?.reference.kind !== 'external';
  const inspector = resolution?.status === 'resolved' ? <>
    <div className="board-asset-actions"><button className="board-button" onClick={() => selectedAsset && open(selectedAsset)}><ExternalLink size={14}/>{t('canvas.openViewer')}</button>
    {libraryBacked && <button className="board-button" aria-pressed={Boolean(resolution.image.isFavorite)} onClick={() => { void useImageStore.getState().toggleFavorite(resolution.image.id).catch(cause => setError(String(cause))); }}><Star size={14} fill={resolution.image.isFavorite ? "currentColor" : "none"}/>{t('canvas.favorite')}</button>}</div>
    {libraryBacked && <RatingStars size={16} className="board-rating" rating={resolution.image.rating} onChange={rating => { void useImageStore.getState().setImageRating(resolution.image.id, rating).catch(cause => setError(String(cause))); }} />}
  </> : null;
  const metadata = resolution?.status === 'resolved' ? <ComparisonMetadataPanel promptActions={selectedAsset ? <BoardImagePromptActions image={resolution.image} object={selectedAsset} editable={editable} /> : undefined} className="board-embedded-metadata" image={resolution.image} isExpanded onToggleExpanded={() => {}} presentation="embedded" /> : null;
  const status = selectedAsset && resolution?.status !== 'resolved' ? <div className="board-asset-status"><p>{resolution?.status === 'loading' ? t('canvas.loadingLibrary') : resolution?.status === 'ambiguous' ? t('canvas.ambiguous') : resolution?.status === 'approval-required' ? t('canvasFeedback.approvalRequired') : t('canvas.missing')}</p>{(resolution?.status === 'missing' || resolution?.status === 'ambiguous' || resolution?.status === 'approval-required') && <><button className="board-button" disabled={!editable} onClick={() => { void pickExternal(); }}>{resolution?.status === 'approval-required' ? t('canvasFeedback.approveExternal') : t('canvasFeedback.locateExternal')}</button><p>{t('canvas.relinkHelp')}</p><button className="board-button" disabled={!editable} onClick={() => { useBoardUIStore.getState().setLibraryOpen(true); setRelinkId(selectedAsset.id); }}>{t('canvas.locate')}</button></>}</div> : null;

  const captureReferences = async (selected: IndexedImage[]): Promise<BoardAssetReference[]> => {
    const baseline = await getBoardReferenceBaseline();
    const state = useImageStore.getState();
    return selected.map(image => createBoardAssetReference(resolveLiveBoardImage(image, state.images), state.directories, baseline));
  };
  const runQueryAction = (action: () => Promise<void>) => { void action().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))); };
  const ensureEditable = () => {
    const state = useBoardStore.getState();
    if (!editable || !boardId || state.activeBoardId !== boardId || state.closing || state.sessions[boardId]?.recovering) throw new Error(t('canvas.unavailable'));
  };
  const snapshotQuery = async (frameId: string) => {
    ensureEditable();
    const result = useBoardQueryStore.getState().results[boardId!]?.[frameId];
    if (result?.status !== 'ready') throw new Error(t('canvas.waitSnapshot'));
    const definition = useBoardStore.getState().sessions[boardId!].document.objects.find(object => object.id === frameId);
    if (definition?.type !== 'smart-frame' || result.definitionKey !== JSON.stringify({ source: definition.source, criteria: definition.criteria, groupConstraints: definition.groupConstraints })) throw new Error(t('canvas.queryChangedWait'));
    const imageSet = useImageStore.getState().images;
    const selected = result.imageIds.map(id => imagesById.get(id)).filter((image): image is IndexedImage => !!image);
    const references = await captureReferences(selected);
    ensureEditable();
    const latest = useBoardStore.getState().sessions[boardId!].document.objects.find(object => object.id === frameId);
    if (latest?.type !== 'smart-frame' || result.definitionKey !== JSON.stringify({ source: latest.source, criteria: latest.criteria, groupConstraints: latest.groupConstraints })) throw new Error(t('canvas.queryChangedRetry'));
    if (useBoardQueryStore.getState().results[boardId!]?.[frameId] !== result || useImageStore.getState().images !== imageSet) throw new Error(t('canvas.resultsChanged'));
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
    create: (center: BoardPoint) => {
      try {
        ensureEditable();
        const state = useBoardStore.getState();
        if (!state.sessions[boardId!]) return;
        const id = crypto.randomUUID();
        state.executeOperation(boardId!, document => createSmartFrame(document, {
          id, ...findFreeBoardPosition(document.objects, { width: 640, height: 420 }, { x: center.x - 320, y: center.y - 210 }),
        }));
        state.setSelection(boardId!, [id]);
        state.requestReveal(boardId!, [id], true);
        useBoardUIStore.getState().setFilterTarget(null);
        setError(null);
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }, snapshot: (id: string) => runQueryAction(() => snapshotQuery(id)),
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
  return <BoardPromptIntegration key={boardId ?? "list"} images={images} loading={loading} resolve={resolve} editable={editable} onOpenLibrary={onOpenPromptLibrary}><BoardQueryContext.Provider value={queryActions}><div className="flex h-full min-h-0 flex-col">

    {externalViewer && externalViewerImage?.status === 'resolved' && <BoardExternalViewer image={externalViewerImage.image} directoryPath={externalViewer.reference.locator.directoryPath!} close={() => setExternalViewer(null)} />}
    {!canUseCanvas && <div className="border-b border-gray-700 p-2 text-sm"><button onClick={() => showProModal('canvas')}>{t('canvas.enable')}</button></div>}
    {error && <div role="alert" className="border-b border-red-500/40 p-2 text-sm text-red-300">{error}<button className="ml-3 underline" onClick={() => setError(null)}>{t('licensing.dismiss')}</button></div>}
    <BoardWorkspace onDropFiles={(files, anchor) => { void dropFiles(files, anchor); }} editable={canUseCanvas} resolveAsset={resolve} onOpenAsset={open}
      onDropAssets={(ids, anchor) => {
        const byId = new Map(images.map(image => [image.id, image]));
        void add(ids.map(id => byId.get(id)).filter((image): image is IndexedImage => Boolean(image)), anchor);
      }}
      assetPanel={<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col"><div role="tablist" aria-label={t('canvas.library')} className="flex gap-2 p-2"><button role="tab" aria-selected={libraryTab === 'images' || !!relinkId} className="board-button" onClick={() => setLibraryTab('images')}>{t('librarySearch.images')}</button><button role="tab" aria-selected={libraryTab === 'prompts' && !relinkId} className="board-button" disabled={!!relinkId} onClick={() => setLibraryTab('prompts')}>{t('metadataEditor.prompts')}</button></div><div className="flex min-h-0 flex-1 flex-col">{libraryTab === 'prompts' && !relinkId ? <BoardPromptLibrary editable={editable} /> : <BoardAssetBrowser images={images} directories={directories} editable={editable} onAdd={selected => { void add(selected); }} onPick={relinkId ? image => { void relink(image); } : undefined} onCancelPick={() => setRelinkId(null)} />}</div></div>}
      libraryLocked={Boolean(relinkId)} assetActions={inspector} assetMetadata={metadata} assetStatus={status}
      selectionActions={selected.length > 0 && selected.every(item => item.type === 'asset' && item.mediaType === 'image') ? <div className="board-selection-actions"><button className="board-button board-button--ghost" title={compareEnabled ? t('canvas.compare') : t('canvas.compareHelp')} disabled={!compareEnabled} onClick={() => canUseComparison ? onCompareImages([...selectedImages.values()]) : showProModal('comparison')}>{t('canvas.compare')}</button></div> : null} />
  </div></BoardQueryContext.Provider></BoardPromptIntegration>;
}
