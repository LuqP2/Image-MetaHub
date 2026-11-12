import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { IndexedImage } from '../../types';
import type { BoardAssetObject, BoardPromptObject } from '../../services/boards/types';
import { useBoardStore } from '../../store/useBoardStore';
import { useBoardQueryStore } from '../../store/useBoardQueryStore';
import { useImageStore } from '../../store/useImageStore';
import { useSavedPromptStore } from '../../store/useSavedPromptStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { addPromptToBoard, buildPromptIndex, normalizePromptMatch, promptImageKey, uniquePromptImages } from '../../services/boards/prompts';
import { BoardPromptContext } from './BoardPromptContext';
import { getHiddenSensitiveTagSet, isVisibleWithSafeMode } from '../../utils/safeModeVisibility';
import { getBoardReferenceBaseline } from '../../services/boards/referenceSync';
import { createBoardAssetReference } from '../../services/boards/assetResolver';
import { addAssets } from '../../services/boards/operations';
import { findFreeBoardPosition, getBoardBounds } from '../../services/boards/layout';
import { emptyEditor } from '../../services/promptLibrary/core.mjs';
import { usePromptDialogFocus } from '../../hooks/usePromptDialogFocus';

function PromptSaveDialog({ card, close }: { card: BoardPromptObject; close(): void }) {
  const [title, setTitle] = useState(card.title);
  const [positive, setPositive] = useState(card.positivePrompt);
  const [negative, setNegative] = useState(card.negativePrompt);
  const [folderId, setFolderId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = usePromptDialogFocus(close, busy);
  const [status, setStatus] = useState('');
  const folders = useSavedPromptStore(state => state.folders);
  const { canUseAdvancedPromptLibrary, showProModal } = useFeatureAccess();
  const save = async () => {
    if (!canUseAdvancedPromptLibrary) { showProModal('prompt_library_advanced'); return; }
    setBusy(true); setError('');
    try {
      const editor = { ...emptyEditor(), title, folderId };
      const store = useSavedPromptStore.getState();
      if (store.prompts.some(prompt => prompt.positivePrompt === positive && prompt.negativePrompt === negative)) { setStatus('This prompt is already in your Prompt Library.'); return; }
      await store.mutate({ action: 'create', kind: 'prompt', item: { positivePrompt: positive, negativePrompt: negative, textBasis: 'authored', source: null, sourceCreatedAt: null, editor } });
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save prompt.'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4" onKeyDown={event => event.stopPropagation()}><section ref={ref} role="dialog" aria-modal="true" aria-label="Save card to Prompt Library" className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-5 text-gray-100">
    <h2>Save to Prompt Library</h2><div className="board-prompt-inspector">
      <label>Title<input className="board-input" value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>Folder<select className="board-input" value={folderId} onChange={event => setFolderId(event.target.value)}><option value="">Unfiled</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
      <label>Positive prompt<textarea className="board-textarea" value={positive} onChange={event => setPositive(event.target.value)} /></label>
      <label>Negative prompt<textarea className="board-textarea" value={negative} onChange={event => setNegative(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
      <button className="board-button" disabled={busy || !(positive.trim() || negative.trim())} onClick={() => void save()}>Save new prompt</button><button className="board-button" disabled={busy} onClick={close}>Close</button>
    </div></section></div>;
}
function BringDialog({ count, busy, error, close, confirm }: { count: number; busy: boolean; error: string; close(): void; confirm(): void }) {
  const ref = usePromptDialogFocus(close, busy);
  return <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4" onKeyDown={event => event.stopPropagation()}><section ref={ref} role="dialog" aria-modal="true" aria-label="Bring matching images" className="space-y-4 rounded-xl border border-gray-700 bg-gray-900 p-5 text-gray-100">
    <h2>Bring matching images</h2><p>{count} matching images are not yet on this Canvas.</p>{error && <p role="alert">{error}</p>}
    <button className="board-button" disabled={busy || count === 0} onClick={confirm}>Add {count} images</button><button className="board-button" disabled={busy} onClick={close}>Cancel</button>
  </section></div>;
}
export default function BoardPromptIntegration({ images, loading, resolve, editable, onOpenLibrary, children }: { images: IndexedImage[]; loading: boolean; editable: boolean; resolve(object: BoardAssetObject): { status: string; image?: IndexedImage }; onOpenLibrary?(id: string): void; children: ReactNode }) {
  const boardId = useBoardStore(state => state.activeBoardId);
  const session = useBoardStore(state => boardId ? state.sessions[boardId] : undefined);
  const results = useBoardQueryStore(state => boardId ? state.results[boardId] : undefined);
  const enabled = useSettingsStore(state => state.enableSafeMode);
  const blur = useSettingsStore(state => state.blurSensitiveImages);
  const sensitiveTags = useSettingsStore(state => state.sensitiveTags);
  const live = useRef({ loading, editable });
  live.current = { loading, editable };
  const [originError, setOriginError] = useState('');
  const [bring, setBring] = useState<BoardPromptObject | null>(null);
  const [saving, setSaving] = useState<BoardPromptObject | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const visibleImages = useMemo(() => {
    const hidden = getHiddenSensitiveTagSet({ enableSafeMode: enabled, blurSensitiveImages: blur, sensitiveTags });
    return images.filter(image => isVisibleWithSafeMode(image, hidden));
  }, [images, enabled, blur, sensitiveTags]);
  const index = useMemo(() => buildPromptIndex(visibleImages), [visibleImages]);
  const uniqueIndex = useMemo(() => new Map([...index].map(([key, entries]) => [key, uniquePromptImages(entries)])), [index]);
  const byId = useMemo(() => new Map(visibleImages.map(image => [image.id, image])), [visibleImages]);
  // Geometry changes do not invalidate membership, the prompt index or match counts.
  const presenceKey = JSON.stringify(session?.document.objects.flatMap<unknown>(object => object.type === 'asset' ? [{ id: object.id, reference: object.reference }] : object.type === 'smart-frame' ? [{ id: object.id, source: object.source, criteria: object.criteria, groupConstraints: object.groupConstraints }] : []));
  const present = useMemo(() => {
    const keys = new Set<string>();
    for (const object of session?.document.objects ?? []) {
      if (object.type === 'asset') { const image = resolve(object).image; if (image && byId.has(image.id)) keys.add(promptImageKey(image)); }
      if (object.type === 'smart-frame') {
        const result = results?.[object.id];
        const definitionKey = JSON.stringify({ source: object.source, criteria: object.criteria, groupConstraints: object.groupConstraints });
        if (result?.status === 'ready' && result.definitionKey === definitionKey) for (const id of result.imageIds) { const image = byId.get(id); if (image) keys.add(promptImageKey(image)); }
      }
    }
    return keys;
  }, [presenceKey, results, resolve, byId]);
  const countsByPrompt = useMemo(() => new Map([...uniqueIndex].map(([key, entries]) => [key, { library: entries.length, canvas: entries.filter(image => present.has(promptImageKey(image))).length }])), [uniqueIndex, present]);
  const selected = session?.selectedObjectIds.length === 1 && !session.selectedConnectionIds.length ? session.document.objects.find(object => object.id === session.selectedObjectIds[0]) : null;
  const activeText = selected?.type === 'prompt' ? normalizePromptMatch(selected.positivePrompt) : '';
  const matchedIds = useMemo(() => new Set(!loading && activeText ? (index.get(activeText) ?? []).map(image => image.id) : []), [index, activeText, loading]);
  const matchedObjectIds = useMemo(() => new Set(session?.document.objects.flatMap(object => object.type === 'asset' && matchedIds.has(resolve(object).image?.id ?? '') ? [object.id] : []) ?? []), [presenceKey, resolve, matchedIds]);
  const candidates = bring ? (uniqueIndex.get(normalizePromptMatch(bring.positivePrompt)) ?? []).filter(image => !present.has(promptImageKey(image))) : [];
  const confirmBring = async () => {
    if (!boardId || !bring || loading || !editable) return;
    const targetId = boardId;
    const captured = useBoardStore.getState().sessions[targetId];
    const imageSet = useImageStore.getState().images;
    const querySet = useBoardQueryStore.getState().results[targetId];
    const safeModeKey = JSON.stringify([enabled, blur, sensitiveTags]);
    setBusy(true); setError('');
    try {
      const baseline = await getBoardReferenceBaseline();
      const state = useBoardStore.getState();
      const settings = useSettingsStore.getState();
      if (live.current.loading || !live.current.editable || state.activeBoardId !== targetId || state.closing || state.sessions[targetId]?.recovering || state.sessions[targetId]?.document !== captured.document || useImageStore.getState().images !== imageSet || querySet !== useBoardQueryStore.getState().results[targetId] || safeModeKey !== JSON.stringify([settings.enableSafeMode, settings.blurSensitiveImages, settings.sensitiveTags])) throw new Error('The Canvas or library changed. Review the updated matches and try again.');
      const directories = useImageStore.getState().directories;
      state.executeOperation(targetId, document => {
        const assets = candidates.map(image => { const dimensions = image.dimensions?.match(/(\d+)\s*x\s*(\d+)/i); return { name: image.name, mediaType: 'image' as const, reference: createBoardAssetReference(image, directories, baseline), ...(dimensions ? { width: Number(dimensions[1]), height: Number(dimensions[2]) } : {}) }; });
        if (!assets.length) return document;
        const prototype = addAssets(document, assets, { x: 0, y: 0 });
        const oldIds = new Set(document.objects.map(object => object.id));
        const added = prototype.objects.filter(object => !oldIds.has(object.id));
        const bounds = getBoardBounds(added);
        const preferred = { x: bring.x + bring.width + 48, y: bring.y };
        const free = findFreeBoardPosition(document.objects, bounds, preferred);
        const point = free.x >= preferred.x ? free : { x: Math.max(preferred.x, ...document.objects.map(object => object.x + object.width + 24)), y: preferred.y };
        return addAssets(document, assets, point);
      });
      setBring(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add matching images.'); }
    finally { setBusy(false); }
  };
  return <BoardPromptContext.Provider value={{ loading, matchedIds, matchedObjectIds,
    counts: text => countsByPrompt.get(normalizePromptMatch(text)) ?? { canvas: 0, library: 0 },
    add: (input, point) => { if (editable && boardId) addPromptToBoard(boardId, input, point); },
    bring: card => { setError(''); setBring(card); },
    save: card => { void useSavedPromptStore.getState().loadLibrary(); setSaving(card); },
    openLibrary: id => { void (async () => {
      await useSavedPromptStore.getState().loadLibrary();
      const library = useSavedPromptStore.getState();
      if (library.error) { setOriginError(library.error); return; }
      if (!library.prompts.some(prompt => prompt.id === id)) { setOriginError('The source prompt is no longer in your Prompt Library. This card keeps its own copy.'); return; }
      onOpenLibrary?.(id);
    })(); },
  }}>{originError && <div role="alert" className="border-b border-red-500/40 p-2 text-sm text-red-300">{originError}<button className="board-button" onClick={() => setOriginError('')}>Dismiss</button></div>}{children}
    {bring && <BringDialog count={loading ? 0 : candidates.length} busy={busy} error={error} close={() => setBring(null)} confirm={() => void confirmBring()} />}
    {saving && <PromptSaveDialog card={saving} close={() => setSaving(null)} />}
  </BoardPromptContext.Provider>;
}
