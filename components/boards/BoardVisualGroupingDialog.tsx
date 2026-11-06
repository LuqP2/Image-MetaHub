import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBoardStore } from '../../store/useBoardStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useSemanticStore } from '../../store/useSemanticStore';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { canReuseImageEmbedding, getIndex } from '../../services/embeddings/semanticSearchEngine';
import { prepareVisualGrouping, runVisualGroupingWorker } from '../../services/boards/visualGroupingService';
import { applyVisualGroups, visualGroupFingerprint, visualGroupingCandidates } from '../../services/boards/visualGroupOperations';
import type { VisualGroupingResult } from '../../services/boards/visualGrouping';
import { useBoardEditor } from './BoardEditorContext';
import BoardResultThumbnail from './BoardResultThumbnail';
import { getHiddenSensitiveTagSet, isVisibleWithSafeMode } from '../../utils/safeModeVisibility';
import { contentKeyForImage } from '../../services/embeddings/embeddingStore';

export default function BoardVisualGroupingDialog({ boardId, ids, close }: { boardId: string; ids?: string[]; close(): void }) {
  const editor = useBoardEditor();
  const document = useBoardStore(state => state.sessions[boardId].document);
  const settings = useSettingsStore();
  const semantic = useSemanticStore();
  const { semanticSearchImageLimit } = useFeatureAccess();
  const [threshold, setThreshold] = useState(0.75);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<Array<{ imageId: string; error: string }>>([]);
  const [preview, setPreview] = useState<{ result: VisualGroupingResult; fingerprint: string; objectGroups: string[][]; modelKey: string; contentKey: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const candidates = useMemo(() => visualGroupingCandidates(document, ids), [document, ids]);
  const images = candidates.map(object => ({ object, image: editor.resolveAsset?.(object)?.image })).filter(item => item.image && isVisibleWithSafeMode(item.image, getHiddenSensitiveTagSet(settings)));
  const uniqueImages = [...new Map(images.map(item => [item.image!.id, item.image!])).values()];
  const index = settings.semanticSearchEnabled ? getIndex() : null;
  const ready = uniqueImages.filter(image => index && canReuseImageEmbedding(index, image)).length;
  const fingerprint = visualGroupFingerprint(document, candidates.map(object => object.id));
  const contentKey = JSON.stringify(uniqueImages.map(image => [image.id, contentKeyForImage(image)]));
  const stale = preview && (preview.fingerprint !== fingerprint || preview.modelKey !== semantic.modelKey || preview.contentKey !== contentKey);
  const dismiss = () => { abort.current?.abort(); close(); };
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => { abort.current?.abort(); previous?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    let active = true;
    if (settings.semanticSearchEnabled) void semantic.refreshModelStatus().then(installed => { if (active && installed && useSettingsStore.getState().semanticSearchEnabled) return useSemanticStore.getState().openForLibrary(); }).catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; abort.current?.abort(); };
  }, [settings.semanticSearchEnabled, semantic.modelKey]);
  const run = async () => {
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    setBusy(true); setError(null); setPreview(null); setFailures([]);
    const initialFingerprint = fingerprint;
    const modelKey = semantic.modelKey;
    try {
      const prepared = await prepareVisualGrouping(uniqueImages, { signal: controller.signal, limit: semanticSearchImageLimit, progress: (done, total) => setProgress(`Preparing images: ${done} / ${total}`) });
      controller.signal.throwIfAborted(); setFailures(prepared.failures); setProgress('Grouping images…');
      const result = await runVisualGroupingWorker(prepared.vectors, threshold, controller.signal, (done, total) => setProgress(`Grouping images: ${done} / ${total}`));
      controller.signal.throwIfAborted();
      const objectGroups = result.groups.map(group => images.filter(item => group.includes(item.image!.id)).map(item => item.object.id));
      // Repeated appearances of the same image form a group even when its vector is an isolated singleton.
      for (const id of result.isolated) {
        const matches = images.filter(item => item.image!.id === id).map(item => item.object.id);
        if (matches.length > 1) objectGroups.push(matches);
      }
      setPreview({ result, objectGroups, fingerprint: initialFingerprint, modelKey, contentKey });
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (abort.current === controller) { setBusy(false); setProgress(''); } }
  };
  return createPortal(<div className="board-grouping-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <div ref={root} role="dialog" aria-modal="true" aria-label="Auto-group by visual similarity" tabIndex={-1} className="board-grouping-dialog" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')];
        const index = controls.indexOf(window.document.activeElement as HTMLElement);
        if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0]?.focus(); }
      }
    }}>
      <header><h2>Auto-group by visual similarity</h2><button className="board-button" aria-label="Close visual grouping" onClick={dismiss}>×</button></header>
      <p>{candidates.length} Canvas images · {uniqueImages.length} unique available images · {ready} indexed</p>
      {candidates.length !== images.length && <p>{candidates.length - images.length} unavailable or hidden references will stay in place.</p>}
      {!settings.semanticSearchEnabled ? <button className="board-button" onClick={() => settings.setSemanticSearchEnabled(true)}>Enable Local Visual Search</button>
        : !semantic.modelInstalled ? <div><p>Download the visual model to prepare images locally.</p><button className="board-button" disabled={semantic.modelDownloading} onClick={() => void semantic.startModelDownload().then(installed => { if (installed) void useSemanticStore.getState().openForLibrary(); })}>{semantic.modelDownloading ? 'Downloading model…' : 'Download visual model'}</button></div> : null}
      <label>Similarity: {threshold.toFixed(2)}<input type="range" min="0.5" max="0.99" step="0.01" value={threshold} disabled={busy} onChange={event => { setThreshold(Number(event.target.value)); setPreview(null); }} /></label>
      <p>Higher values create stricter groups. Every pair in a group must meet this similarity.</p>
      {semantic.isBackfilling && <p>Pause Visual Search indexing before preparing these images.</p>}
      {busy && <p role="status">{progress}</p>}
      {(error || semantic.lastError) && <p role="alert">{error || semantic.lastError}</p>}
      {failures.length > 0 && <details><summary>{failures.length} images could not be prepared</summary>{failures.map(failure => <p key={failure.imageId}>{uniqueImages.find(image => image.id === failure.imageId)?.name}: {failure.error}</p>)}</details>}
      {preview && <div><p>{preview.objectGroups.length} groups · {images.length - preview.objectGroups.flat().length} images stay in place</p>
        <div className="board-grouping-preview">{preview.objectGroups.map((group, i) => <section key={i}><strong>Visual group {i + 1} · {group.length}</strong><div>{group.slice(0, 4).map(id => { const image = images.find(item => item.object.id === id)?.image; return image ? <BoardResultThumbnail key={id} image={image} open={() => {}} /> : null; })}</div></section>)}</div>
        {stale && <p role="alert">These images or the visual model changed. Recalculate the groups.</p>}
      </div>}
      <footer><button className="board-button" onClick={dismiss}>Cancel</button>
        <button className="board-button" disabled={busy || !editor.editable || !settings.semanticSearchEnabled || !semantic.modelInstalled || semantic.isBackfilling || images.length < 2} onClick={() => void run()}>{ready < uniqueImages.length ? 'Prepare images and group' : 'Calculate groups'}</button>
        {preview && <button className="board-button" disabled={!!stale || busy || !editor.editable || !settings.semanticSearchEnabled || preview.objectGroups.length === 0} onClick={() => {
          const state = useBoardStore.getState(), current = state.sessions[boardId];
          const currentContentKey = JSON.stringify([...new Map(candidates.map(object => editor.resolveAsset?.(object)?.image).filter(image => image && isVisibleWithSafeMode(image, getHiddenSensitiveTagSet(useSettingsStore.getState()))).map(image => [image!.id, image!])).values()].map(image => [image.id, contentKeyForImage(image)]));
          if (!current || state.closing || current.recovering || visualGroupFingerprint(current.document, candidates.map(object => object.id)) !== preview.fingerprint || useSemanticStore.getState().modelKey !== preview.modelKey || currentContentKey !== preview.contentKey) { setError('The Canvas changed. Recalculate the groups.'); return; }
          const existing = new Set(current.document.objects.map(object => object.id));
          state.executeOperation(boardId, document => applyVisualGroups(document, preview.objectGroups));
          const added = useBoardStore.getState().sessions[boardId].document.objects.filter(object => !existing.has(object.id)).map(object => object.id);
          state.setSelection(boardId, added); state.requestReveal(boardId, added); dismiss();
        }}>Apply groups</button>}
      </footer>
    </div>
  </div>, window.document.body);
}
