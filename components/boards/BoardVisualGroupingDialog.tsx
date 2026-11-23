import { useTranslation, type MessageKey } from '../../i18n/useTranslation';
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
  const { t } = useTranslation();
  const editor = useBoardEditor();
  const document = useBoardStore(state => state.sessions[boardId].document);
  const settings = useSettingsStore();
  const semantic = useSemanticStore();
  const { semanticSearchImageLimit } = useFeatureAccess();
  const [threshold, setThreshold] = useState(0.75);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ key: MessageKey; values?: Record<string, number> } | null>(null);
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
      const prepared = await prepareVisualGrouping(uniqueImages, { signal: controller.signal, limit: semanticSearchImageLimit, progress: (done, total) => setProgress({ key: 'canvas.preparingImages', values: { done, total } }) });
      controller.signal.throwIfAborted(); setFailures(prepared.failures); setProgress({ key: 'canvas.groupingImages' });
      const result = await runVisualGroupingWorker(prepared.vectors, threshold, controller.signal, (done, total) => setProgress({ key: 'canvas.groupingProgress', values: { done, total } }));
      controller.signal.throwIfAborted();
      const objectGroups = result.groups.map(group => images.filter(item => group.includes(item.image!.id)).map(item => item.object.id));
      // Repeated appearances of the same image form a group even when its vector is an isolated singleton.
      for (const id of result.isolated) {
        const matches = images.filter(item => item.image!.id === id).map(item => item.object.id);
        if (matches.length > 1) objectGroups.push(matches);
      }
      setPreview({ result, objectGroups, fingerprint: initialFingerprint, modelKey, contentKey });
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (abort.current === controller) { setBusy(false); setProgress(null); } }
  };
  return createPortal(<div className="board-grouping-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <div ref={root} role="dialog" aria-modal="true" aria-label={t('canvas.autoGroup')} tabIndex={-1} className="board-grouping-dialog" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')];
        const index = controls.indexOf(window.document.activeElement as HTMLElement);
        if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0]?.focus(); }
      }
    }}>
      <header><h2>{t('canvas.autoGroup')}</h2><button className="board-button" aria-label={t('canvas.groupingClose')} onClick={dismiss}>×</button></header>
      <p>{t('canvas.groupingCounts', { candidates: candidates.length, unique: uniqueImages.length, indexed: ready })}</p>
      {candidates.length !== images.length && <p>{t('canvas.groupingStay', { count: candidates.length - images.length })}</p>}
      {!settings.semanticSearchEnabled ? <button className="board-button" onClick={() => settings.setSemanticSearchEnabled(true)}>{t('canvas.enableVisual')}</button>
        : !semantic.modelInstalled ? <div><p>{t('canvas.downloadVisualHelp')}</p><button className="board-button" disabled={semantic.modelDownloading} onClick={() => void semantic.startModelDownload().then(installed => { if (installed) void useSemanticStore.getState().openForLibrary(); })}>{semantic.modelDownloading ? t('canvas.downloadingVisual') : t('canvas.downloadVisual')}</button></div> : null}
      <label>{t('canvas.similarity', { value: threshold.toFixed(2) })}<input type="range" min="0.5" max="0.99" step="0.01" value={threshold} disabled={busy} onChange={event => { setThreshold(Number(event.target.value)); setPreview(null); }} /></label>
      <p>{t('canvas.similarityHelp')}</p>
      {semantic.isBackfilling && <p>{t('canvas.pauseIndexing')}</p>}
      {busy && <p role="status">{progress ? t(progress.key, progress.values) : ''}</p>}
      {(error || semantic.lastError) && <p role="alert">{error === 'canvas.groupingChanged' ? t('canvas.groupingChanged') : error || semantic.lastError}</p>}
      {failures.length > 0 && <details className="ui-disclosure"><summary>{t('canvas.prepareFailed', { count: failures.length })}</summary>{failures.map(failure => <p key={failure.imageId}>{uniqueImages.find(image => image.id === failure.imageId)?.name}: {failure.error}</p>)}</details>}
      {preview && <div><p>{t('canvas.groupsPreview', { groups: preview.objectGroups.length, images: images.length - preview.objectGroups.flat().length })}</p>
        <div className="board-grouping-preview">{preview.objectGroups.map((group, i) => <section key={i}><strong>{t('canvas.visualGroup', { index: i + 1, count: group.length })}</strong><div>{group.slice(0, 4).map(id => { const image = images.find(item => item.object.id === id)?.image; return image ? <BoardResultThumbnail key={id} image={image} open={() => {}} /> : null; })}</div></section>)}</div>
        {stale && <p role="alert">{t('canvas.groupingStale')}</p>}
      </div>}
      <footer><button className="board-button" onClick={dismiss}>{t('libraryFolders.cancel')}</button>
        <button className={`board-button ${preview ? '' : 'board-button--primary'}`} disabled={busy || !editor.editable || !settings.semanticSearchEnabled || !semantic.modelInstalled || semantic.isBackfilling || images.length < 2} onClick={() => void run()}>{ready < uniqueImages.length ? t('canvas.prepareAndGroup') : t('canvas.calculateGroups')}</button>
        {preview && <button className="board-button board-button--primary" disabled={!!stale || busy || !editor.editable || !settings.semanticSearchEnabled || preview.objectGroups.length === 0} onClick={() => {
          const state = useBoardStore.getState(), current = state.sessions[boardId];
          const currentContentKey = JSON.stringify([...new Map(candidates.map(object => editor.resolveAsset?.(object)?.image).filter(image => image && isVisibleWithSafeMode(image, getHiddenSensitiveTagSet(useSettingsStore.getState()))).map(image => [image!.id, image!])).values()].map(image => [image.id, contentKeyForImage(image)]));
          if (!current || state.closing || current.recovering || visualGroupFingerprint(current.document, candidates.map(object => object.id)) !== preview.fingerprint || useSemanticStore.getState().modelKey !== preview.modelKey || currentContentKey !== preview.contentKey) { setError('canvas.groupingChanged'); return; }
          const existing = new Set(current.document.objects.map(object => object.id));
          state.executeOperation(boardId, document => applyVisualGroups(document, preview.objectGroups));
          const added = useBoardStore.getState().sessions[boardId].document.objects.filter(object => !existing.has(object.id)).map(object => object.id);
          state.setSelection(boardId, added); state.requestReveal(boardId, added); dismiss();
        }}>{t('canvas.applyGroups')}</button>}
      </footer>
    </div>
  </div>, window.document.body);
}
