import { modelKindText, translateModelMessage } from '../i18n/modelMessages';
import { useTranslation } from '../i18n/useTranslation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ExternalLink,
  FolderOpen,
  Hash,
  Lock,
  Pin,
  RefreshCw,
  Search,
  Tag,
} from 'lucide-react';
import { mirrorModelManager, useModelManager } from '../services/modelLibrary/manager';
import { executeModelCommand } from './ModelManagerPanels';
import ModelDetailsPanels from './ModelDetailsPanels';
import {
  getDefaultLoraSyntax,
  getEffectiveModelPresentation,
  modelInspectorSearchText,
} from '../services/modelLibrary/presentation';
import type {
  ModelInspectorItem,
  ModelInspectorSnapshot,
} from '../services/modelLibrary/types';
import { useSettingsStore } from '../store/useSettingsStore';
import { resolveTheme } from '../src/theme/themeRegistry';

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
};


const ModelInspectorApp: React.FC = () => {
  const { t, language } = useTranslation();
  const formatDate = (value: number | null): string => value ? new Date(value).toLocaleString(language) : t('modelLibrary.unavailable');
  const [snapshot, setSnapshot] = useState<ModelInspectorSnapshot | null>(null);
  const [selectorQuery, setSelectorQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isFetchingCivitai, setIsFetchingCivitai] = useState(false);
  const [hashProgress, setHashProgress] = useState<{ requestId: string; bytesProcessed: number; totalBytes: number } | null>(null);
  const latestRevision = useRef(-1);
  const theme = useSettingsStore((state) => state.theme);
  const manager = useModelManager();
  useEffect(mirrorModelManager, []);
  useEffect(() => { if (!manager.progress) setHashProgress(null); }, [manager.progress]);

  useEffect(() => {
    let active = true;
    const applyTheme = (systemShouldUseDark: boolean) => {
      if (!active) return;
      const resolved = resolveTheme(theme, systemShouldUseDark);
      document.documentElement.classList.toggle('dark', resolved.dark);
      document.documentElement.setAttribute('data-theme', resolved.id);
    };
    const api = window.electronAPI;
    if (!api) return;
    void useSettingsStore.persist.rehydrate();
    void api.getTheme().then(({ shouldUseDarkColors }) => applyTheme(shouldUseDarkColors));
    const unsubscribe = api.onThemeUpdated(({ shouldUseDarkColors }) => applyTheme(shouldUseDarkColors));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [theme]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const unsubscribeSnapshot = api.onModelInspectorSnapshot((next) => {
      if (next.revision <= latestRevision.current) return;
      latestRevision.current = next.revision;
      setSnapshot(next);
    });
    const unsubscribeProgress = api.onModelLibraryHashProgress(setHashProgress);
    void api.modelInspectorReady();
    return () => { unsubscribeSnapshot(); unsubscribeProgress(); };
  }, []);

  const currentIndex = snapshot?.items.findIndex((item) => item.location.id === snapshot.selectedId) ?? -1;
  const currentItem = currentIndex >= 0 ? snapshot?.items[currentIndex] ?? null : null;
  const presentation = useMemo(() => currentItem
    ? getEffectiveModelPresentation(currentItem.location, currentItem.localMetadata)
    : null, [currentItem]);

  const filteredSelectorItems = useMemo(() => {
    const normalized = selectorQuery.trim().toLocaleLowerCase();
    if (!snapshot) return [];
    return normalized
      ? snapshot.items.filter((item) => modelInspectorSearchText(item).includes(normalized))
      : snapshot.items;
  }, [selectorQuery, snapshot]);

  const hashCurrent = async () => {
    if (!currentItem) return;
    setError(null);
    try { await executeModelCommand({ type: 'hash', locationId: currentItem.location.id }); }
    catch (error) { setError((error as Error).message); }
  };
  const fetchCivitai = async () => {
    if (!currentItem) return;
    setIsFetchingCivitai(true); setError(null);
    try { await executeModelCommand({ type: 'identify', locationId: currentItem.location.id }); }
    catch (error) { setError((error as Error).message); }
    finally { setIsFetchingCivitai(false); }
  };

  const copyText = async (value: string, failureMessage: string) => {
    const result = await window.electronAPI?.copyTextToClipboard(value);
    if (!result?.success) setError(result?.error || failureMessage);
  };

  if (!snapshot) {
    return <div className="flex h-screen items-center justify-center bg-gray-950 text-sm text-gray-400">{t('modelLibrary.openingInspector')}</div>;
  }
  if (!currentItem || !presentation) {
    return <div className="flex h-screen flex-col items-center justify-center bg-gray-950 px-8 text-center text-gray-300"><h1 className="text-lg font-semibold">{t('modelLibrary.noModelsCollection')}</h1><p className="mt-2 max-w-sm text-sm text-gray-500">{t('modelLibrary.collectionChanged')}</p><button type="button" onClick={() => void window.electronAPI?.modelInspectorWindowAction('close')} className="mt-5 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800">{t('modelLibrary.closeInspector')}</button></div>;
  }

  const location = currentItem.location;
  const civitai = location.civitai && 'modelId' in location.civitai ? location.civitai : undefined;
  const civitaiNotFound = location.civitai && 'status' in location.civitai ? location.civitai : undefined;
  const hashPercent = hashProgress
    ? Math.round((hashProgress.bytesProcessed / Math.max(1, hashProgress.totalBytes)) * 100)
    : 0;

  return <main className="flex h-screen min-h-0 flex-col bg-gray-950 text-gray-100">
    <header className="shrink-0 border-b border-gray-800 bg-gray-900/95 px-4 py-3 shadow-lg">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wider text-cyan-300">{t('modelLibrary.inspector')}</div>
          <h1 className="mt-0.5 truncate text-lg font-semibold" title={presentation.name}>{presentation.name}</h1>
          <div className="mt-1 text-xs text-gray-400">{t('modelLibrary.position', { current: currentIndex + 1, total: snapshot.items.length })} · {modelKindText(location.sourceKind, t)}</div>
        </div>
        <button type="button" onClick={() => void window.electronAPI?.modelInspectorWindowAction('toggle-always-on-top')} className={`inline-flex rounded-md border p-2 ${snapshot.isAlwaysOnTop ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-100' : 'border-gray-700 text-gray-300 hover:border-cyan-500/40 hover:bg-gray-800'}`} title={t('modelLibrary.alwaysTop')} aria-label={t('modelLibrary.alwaysTop')} aria-pressed={snapshot.isAlwaysOnTop}><Pin className={`h-4 w-4 ${snapshot.isAlwaysOnTop ? 'fill-current' : ''}`} /></button>
      </div>
      <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2">
        <button type="button" disabled={currentIndex <= 0} onClick={() => void window.electronAPI?.modelInspectorNavigate('previous')} className="inline-flex items-center gap-1 rounded-md border border-cyan-500/25 bg-gray-900 px-2.5 py-2 text-sm text-gray-200 hover:border-cyan-400/50 hover:bg-gray-800 disabled:border-gray-800 disabled:text-gray-600"><ChevronLeft className="h-4 w-4" />{t('modelLibrary.previous')}</button>
        <div className="min-w-0">
          <div className="relative mb-1"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-500" /><input value={selectorQuery} onChange={(event) => setSelectorQuery(event.target.value)} placeholder={t('modelLibrary.filterSelector')} className="w-full rounded-md border border-gray-700 bg-gray-950 py-1.5 pl-8 pr-2 text-xs placeholder:text-gray-500" /></div>
          <select value={location.id} onChange={(event) => void window.electronAPI?.modelInspectorSelect(event.target.value)} className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-2 text-sm">
            {!filteredSelectorItems.some((item) => item.location.id === location.id) && <option value={location.id}>{presentation.name}</option>}
            {filteredSelectorItems.map((item) => <option key={item.location.id} value={item.location.id}>{getEffectiveModelPresentation(item.location, item.localMetadata).name}</option>)}
          </select>
        </div>
        <button type="button" disabled={currentIndex >= snapshot.items.length - 1} onClick={() => void window.electronAPI?.modelInspectorNavigate('next')} className="inline-flex items-center gap-1 rounded-md border border-cyan-500/25 bg-gray-900 px-2.5 py-2 text-sm text-gray-200 hover:border-cyan-400/50 hover:bg-gray-800 disabled:border-gray-800 disabled:text-gray-600">{t('modelLibrary.next')}<ChevronRight className="h-4 w-4" /></button>
      </div>
      <button type="button" onClick={() => void window.electronAPI?.modelInspectorSetFollowSelection(!snapshot.followSelection)} className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${snapshot.followSelection ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/15 text-amber-200'}`}><Lock className="h-3 w-3" />{snapshot.followSelection ? t('modelLibrary.followOn') : t('modelLibrary.followOff')}</button>
    </header>

    <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
      {error && <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{translateModelMessage(error, t)}</div>}
      {hashProgress && <div className="mt-3"><div className="flex justify-between text-xs text-gray-400"><span>{t('modelLibrary.hashing')}</span><span>{hashPercent}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded bg-gray-800"><div className="h-full bg-cyan-400" style={{ width: `${hashPercent}%` }} /></div><button type="button" onClick={() => void executeModelCommand({ type: 'cancel' })} className="mt-2 text-xs text-amber-200">{t('modelLibrary.cancel')}</button></div>}
      <section className="mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <div className="flex items-center justify-between gap-3"><h2 className="inline-flex items-center gap-2 font-medium text-cyan-100"><Tag className="h-4 w-4" />{t('modelLibrary.triggers')}</h2>{presentation.triggerWords.length > 0 && <button type="button" onClick={() => void copyText(presentation.triggerWords.join(', '), 'modelLibrary.copyTriggersFailed')} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 px-2.5 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/10"><Clipboard className="h-3.5 w-3.5" />{t('modelLibrary.copyTriggers')}</button>}</div>
        {presentation.triggerWords.length ? <div className="mt-3 flex flex-wrap gap-2">{presentation.triggerWords.map((word) => <button type="button" key={word} onClick={() => void copyText(word, 'modelLibrary.copyTriggerFailed')} className="rounded-full border border-cyan-500/25 bg-gray-950 px-2.5 py-1 text-xs text-cyan-100 hover:border-cyan-400/60" title={t('modelLibrary.copyTrigger')}>{word}</button>)}</div> : <p className="mt-2 text-sm text-gray-500">{t('modelLibrary.noTriggers')}</p>}
      </section>

      {location.sourceKind === 'lora' && <section className="mb-4 rounded-xl border border-gray-800 bg-gray-900/70 p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-xs uppercase tracking-wider text-gray-500">{t('modelLibrary.loraSyntax')}</div><code className="mt-1 block break-all text-sm text-emerald-200">{getDefaultLoraSyntax(location, currentItem.localMetadata)}</code></div><button type="button" onClick={() => void copyText(getDefaultLoraSyntax(location, currentItem.localMetadata), 'modelLibrary.copyLoraFailed')} className="shrink-0 rounded-md border border-gray-700 px-2.5 py-2 text-xs hover:bg-gray-800">{t('modelLibrary.copyLora')}</button></div></section>}
      <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.9fr)_minmax(320px,1.1fr)]">
        <section>
          <div className="flex min-h-72 items-center justify-center overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
            {presentation.preview ? <img src={presentation.preview} alt={t('modelLibrary.previewNamed', { name: presentation.name })} className="max-h-[62vh] w-full object-contain" /> : <div className="px-8 text-center text-sm text-gray-500">{t('modelLibrary.noPreview')}<br />{t('modelLibrary.coverHelp')}</div>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-400">
            <span className="rounded-full bg-gray-800 px-2 py-1">{modelKindText(location.sourceKind, t)}</span>
            {presentation.baseModel && <span className="rounded-full bg-violet-500/15 px-2 py-1 text-violet-200">{presentation.baseModel}</span>}
            {presentation.previewSource && <span className="rounded-full bg-gray-800 px-2 py-1">{t('modelLibrary.previewSource', { source: presentation.previewSource === 'local' ? t('modelLibrary.previewLocal') : presentation.previewSource })}</span>}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-500">{t('modelLibrary.model')}</div>
            <div className="mt-1 text-xl font-semibold">{presentation.name}</div>
            {civitai && <div className="mt-1 text-sm text-gray-400">{civitai.modelName}{civitai.versionName && civitai.versionName !== presentation.name ? ` · ${civitai.versionName}` : ''}</div>}
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><Info label={t('modelLibrary.filename')} value={location.fileName} /><Info label={t('modelLibrary.architecture')} value={presentation.baseModel || t('modelLibrary.unavailable')} /><Info label={t('modelLibrary.source')} value={location.sourceName} /><Info label={t('modelLibrary.fileSize')} value={formatBytes(location.size)} /></div>
          </div>

        </section>
      </div>

      {presentation.description && <section className="mt-5 rounded-xl border border-gray-800 bg-gray-900/70 p-4"><h2 className="font-medium">{t('modelLibrary.description')}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-300">{presentation.description}</p></section>}

      <div className="mt-5 space-y-4"><ModelDetailsPanels item={currentItem} connectionExtras={<div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-medium">Civitai</h2><p className="mt-1 text-xs text-gray-500">{t('modelLibrary.civitaiActionsHelp')}</p></div>{civitai && <button type="button" onClick={() => void fetchCivitai()} disabled={isFetchingCivitai || Boolean(hashProgress)} className="inline-flex items-center gap-2 rounded-md border border-cyan-500/50 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15 disabled:text-gray-500"><RefreshCw className={`h-4 w-4 ${isFetchingCivitai || hashProgress ? 'animate-spin' : ''}`} />{isFetchingCivitai || hashProgress ? t('modelLibrary.fetching') : civitai ? t('modelLibrary.refreshCivitai') : t('modelLibrary.fetchCivitai')}</button>}</div>

            {civitai && <div className="mt-3 space-y-2 text-sm"><Info label={t('modelLibrary.modelVersion')} value={`${civitai.modelName} · ${civitai.versionName}`} /><Info label={t('modelLibrary.baseModel')} value={civitai.baseModel || t('modelLibrary.unavailable')} /><Info label={t('modelLibrary.lastFetched')} value={formatDate(civitai.fetchedAt)} /><button type="button" onClick={() => void window.electronAPI?.openExternalUrl(civitai.url)} className="inline-flex items-center gap-1.5 text-cyan-200 hover:text-cyan-100"><ExternalLink className="h-3.5 w-3.5" />{t('modelLibrary.openCivitai')}</button></div>}
            {civitaiNotFound && <p className="mt-3 text-sm text-gray-400">{t('modelLibrary.noCivitaiVersion', { date: formatDate(civitaiNotFound.fetchedAt) })}</p>}
          </div>} /></div>

      <details className="mt-5 rounded-xl border border-gray-800 bg-gray-900/70 p-4">
        <summary className="cursor-pointer font-medium">{t('modelLibrary.technicalDetails')}</summary>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><Info label={t('modelLibrary.fileLocation')} value={location.absolutePath} /><Info label={t('modelLibrary.relativePath')} value={location.relativePath} /><Info label={t('modelLibrary.created')} value={formatDate(location.createdAt)} /><Info label={t('modelLibrary.modified')} value={formatDate(location.modifiedAt)} /><Info label="SHA256" value={location.sha256 || t('modelLibrary.notComputed')} /><Info label={t('modelLibrary.embeddedMetadata')} value={location.fileMetadata ? t('modelLibrary.available') : location.metadataError || t('modelLibrary.unavailable')} /></div>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void window.electronAPI?.modelLibraryRevealLocation(location.absolutePath)} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800"><FolderOpen className="h-4 w-4" />{t('modelLibrary.openLocation')}</button>{location.sha256 ? <button type="button" onClick={() => void copyText(location.sha256 || '', 'modelLibrary.copyShaFailed')} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800"><Hash className="h-4 w-4" />{t('modelLibrary.copySha')}</button> : <button type="button" onClick={() => void hashCurrent()} disabled={Boolean(hashProgress)} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800 disabled:text-gray-600"><Hash className="h-4 w-4" />{t('modelLibrary.computeSha')}</button>}</div>
        {location.fileMetadata?.raw && <details className="mt-4 rounded-md border border-gray-800 bg-gray-950 p-3"><summary className="cursor-pointer text-sm text-gray-300">{t('modelLibrary.rawMetadata')}</summary><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-400">{JSON.stringify(location.fileMetadata.raw, null, 2)}</pre></details>}
      </details>
    </div>
  </main>;
};

const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="min-w-0"><div className="text-xs uppercase tracking-wide text-gray-500">{label}</div><div className="mt-1 break-words text-gray-200">{value}</div></div>;

export default ModelInspectorApp;
