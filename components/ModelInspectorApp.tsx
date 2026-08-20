import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  MODEL_CATALOG_CACHE_ID,
  replaceCatalogLocation,
  validModelCatalog,
} from '../services/modelLibrary/catalog';
import { fetchCivitaiInfoWithIdentity } from '../services/modelLibrary/civitaiEnrichment';
import {
  createModelLocalMetadata,
  deleteModelLocalMetadata,
  promoteModelLocalMetadata,
  saveModelLocalMetadata,
} from '../services/modelLibrary/localMetadataStorage';
import {
  getDefaultLoraSyntax,
  getEffectiveModelPresentation,
  modelInspectorSearchText,
} from '../services/modelLibrary/presentation';
import type {
  ModelInspectorItem,
  ModelInspectorSnapshot,
  ModelLocalMetadata,
  ModelLocation,
} from '../services/modelLibrary/types';
import { useSettingsStore } from '../store/useSettingsStore';

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
};

const formatDate = (value: number | null): string => value ? new Date(value).toLocaleString() : 'Unavailable';

const ModelInspectorApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<ModelInspectorSnapshot | null>(null);
  const [selectorQuery, setSelectorQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isReadingMetadata, setIsReadingMetadata] = useState(false);
  const [isFetchingCivitai, setIsFetchingCivitai] = useState(false);
  const [hashProgress, setHashProgress] = useState<{ requestId: string; bytesProcessed: number; totalBytes: number } | null>(null);
  const metadataRequests = useRef(new Set<string>());
  const latestRevision = useRef(-1);
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    const applyTheme = (systemShouldUseDark: boolean) => {
      const isDark = ['dark', 'dracula', 'nord', 'ocean'].includes(theme)
        || (theme === 'system' && systemShouldUseDark);
      document.documentElement.classList.toggle('dark', isDark);
      document.documentElement.setAttribute('data-theme', theme === 'system' ? (systemShouldUseDark ? 'dark' : 'light') : theme);
    };
    const api = window.electronAPI;
    if (!api) return;
    void useSettingsStore.persist.rehydrate();
    void api.getTheme().then(({ shouldUseDarkColors }) => applyTheme(shouldUseDarkColors));
    return api.onThemeUpdated(({ shouldUseDarkColors }) => applyTheme(shouldUseDarkColors));
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

  const updateItem = useCallback(async (item: ModelInspectorItem) => {
    setSnapshot((current) => current ? {
      ...current,
      items: current.items.map((entry) => entry.location.id === item.location.id ? item : entry),
    } : current);
    const cache = await window.electronAPI?.getJsonCacheData(MODEL_CATALOG_CACHE_ID);
    if (cache?.success) {
      const catalog = validModelCatalog(cache.data);
      const nextCatalog = replaceCatalogLocation(catalog, item.location);
      if (nextCatalog !== catalog) {
        await window.electronAPI?.writeJsonCacheData({ cacheId: MODEL_CATALOG_CACHE_ID, data: nextCatalog });
      }
    }
    await window.electronAPI?.modelInspectorUpdateItem({ locationId: item.location.id, item });
  }, []);

  useEffect(() => {
    if (!currentItem || currentItem.location.fileMetadata || metadataRequests.current.has(currentItem.location.id)) return;
    const api = window.electronAPI;
    if (!api) return;
    metadataRequests.current.add(currentItem.location.id);
    setIsReadingMetadata(true);
    setError(null);
    void api.modelLibraryReadMetadata(currentItem.location.absolutePath).then(async (result) => {
      if (!result.success || !result.metadata) throw new Error(result.error || 'Unable to read embedded metadata.');
      await updateItem({ ...currentItem, location: { ...currentItem.location, fileMetadata: result.metadata } });
    }).catch((readError) => {
      setError(readError instanceof Error ? readError.message : 'Unable to read embedded metadata.');
    }).finally(() => setIsReadingMetadata(false));
  }, [currentItem, updateItem]);

  const saveLocal = async (value: Omit<ModelLocalMetadata, 'id' | 'sha256' | 'locationId' | 'updatedAt'>) => {
    if (!currentItem) return;
    const fallbackId = currentItem.localMetadata?.id;
    const saved = await saveModelLocalMetadata(createModelLocalMetadata(currentItem.location, value));
    if (fallbackId && fallbackId !== saved.id) await deleteModelLocalMetadata(fallbackId);
    await updateItem({ ...currentItem, localMetadata: saved });
  };

  const hashCurrent = async (): Promise<ModelInspectorItem | null> => {
    if (!currentItem || !window.electronAPI) return null;
    if (currentItem.location.sha256) return currentItem;
    const requestId = `model-inspector-hash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setHashProgress({ requestId, bytesProcessed: 0, totalBytes: currentItem.location.size });
    setError(null);
    try {
      const result = await window.electronAPI.modelLibraryHash({ filePath: currentItem.location.absolutePath, requestId });
      if (!result.success) throw new Error(result.error || 'Unable to identify this model.');
      if (result.cancelled || !result.sha256) return null;
      let localMetadata = currentItem.localMetadata;
      if (localMetadata) {
        const previousId = localMetadata.id;
        localMetadata = await saveModelLocalMetadata(promoteModelLocalMetadata(localMetadata, result.sha256));
        if (previousId !== localMetadata.id) await deleteModelLocalMetadata(previousId);
      }
      const item = {
        ...currentItem,
        localMetadata,
        location: {
          ...currentItem.location,
          sha256: result.sha256,
          hashFingerprint: {
            size: result.size ?? currentItem.location.size,
            modifiedAt: result.modifiedAt ?? currentItem.location.modifiedAt,
          },
        },
      };
      await updateItem(item);
      return item;
    } catch (hashError) {
      setError(hashError instanceof Error ? hashError.message : 'Unable to identify this model.');
      return null;
    } finally {
      setHashProgress(null);
    }
  };

  const fetchCivitai = async () => {
    if (!currentItem || !window.electronAPI) return;
    setIsFetchingCivitai(true);
    setError(null);
    try {
      const enrichedItem = await fetchCivitaiInfoWithIdentity({
        item: currentItem,
        ensureSha256: hashCurrent,
        fetchByHash: (sha256) => window.electronAPI!.modelLibraryFetchCivitai(sha256),
      });
      if (enrichedItem) await updateItem(enrichedItem);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Civitai is unavailable. Try again later.');
    } finally {
      setIsFetchingCivitai(false);
    }
  };

  const copyText = async (value: string, failureMessage: string) => {
    const result = await window.electronAPI?.copyTextToClipboard(value);
    if (!result?.success) setError(result?.error || failureMessage);
  };

  if (!snapshot) {
    return <div className="flex h-screen items-center justify-center bg-gray-950 text-sm text-gray-400">Opening Model Inspector…</div>;
  }
  if (!currentItem || !presentation) {
    return <div className="flex h-screen flex-col items-center justify-center bg-gray-950 px-8 text-center text-gray-300"><h1 className="text-lg font-semibold">No models in the current collection</h1><p className="mt-2 max-w-sm text-sm text-gray-500">The source or active Models filters changed. Choose a visible model in the main Models workspace to continue.</p><button type="button" onClick={() => void window.electronAPI?.modelInspectorWindowAction('close')} className="mt-5 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800">Close Inspector</button></div>;
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
          <div className="text-xs font-medium uppercase tracking-wider text-cyan-300">Model Inspector</div>
          <h1 className="mt-0.5 truncate text-lg font-semibold" title={presentation.name}>{presentation.name}</h1>
          <div className="mt-1 text-xs text-gray-400">{currentIndex + 1} of {snapshot.items.length} · {location.sourceKind === 'lora' ? 'LoRA' : 'Checkpoint'}</div>
        </div>
        <button type="button" onClick={() => void window.electronAPI?.modelInspectorWindowAction('toggle-always-on-top')} className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs ${snapshot.isAlwaysOnTop ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-100' : 'border-gray-700 text-gray-300 hover:bg-gray-800'}`} title="Keep this window above other applications"><Pin className="h-3.5 w-3.5" />Always on Top: {snapshot.isAlwaysOnTop ? 'On' : 'Off'}</button>
      </div>
      <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2">
        <button type="button" disabled={currentIndex <= 0} onClick={() => void window.electronAPI?.modelInspectorNavigate('previous')} className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-2.5 py-2 text-sm hover:bg-gray-800 disabled:text-gray-600"><ChevronLeft className="h-4 w-4" />Previous</button>
        <div className="min-w-0">
          <div className="relative mb-1"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-500" /><input value={selectorQuery} onChange={(event) => setSelectorQuery(event.target.value)} placeholder="Filter model selector" className="w-full rounded-md border border-gray-700 bg-gray-950 py-1.5 pl-8 pr-2 text-xs placeholder:text-gray-500" /></div>
          <select value={location.id} onChange={(event) => void window.electronAPI?.modelInspectorSelect(event.target.value)} className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-2 text-sm">
            {!filteredSelectorItems.some((item) => item.location.id === location.id) && <option value={location.id}>{presentation.name}</option>}
            {filteredSelectorItems.map((item) => <option key={item.location.id} value={item.location.id}>{getEffectiveModelPresentation(item.location, item.localMetadata).name}</option>)}
          </select>
        </div>
        <button type="button" disabled={currentIndex >= snapshot.items.length - 1} onClick={() => void window.electronAPI?.modelInspectorNavigate('next')} className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-2.5 py-2 text-sm hover:bg-gray-800 disabled:text-gray-600">Next<ChevronRight className="h-4 w-4" /></button>
      </div>
      <button type="button" onClick={() => void window.electronAPI?.modelInspectorSetFollowSelection(!snapshot.followSelection)} className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${snapshot.followSelection ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/15 text-amber-200'}`}><Lock className="h-3 w-3" />{snapshot.followSelection ? 'Follow selection in Models: On' : 'Locked — Follow selection: Off'}</button>
    </header>

    <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
      {error && <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
      <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.9fr)_minmax(320px,1.1fr)]">
        <section>
          <div className="flex min-h-72 items-center justify-center overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
            {presentation.preview ? <img src={presentation.preview} alt={`${presentation.name} preview`} className="max-h-[62vh] w-full object-contain" /> : <div className="px-8 text-center text-sm text-gray-500">No preview available.<br />Embedded or fetched cover art will appear here.</div>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-400">
            <span className="rounded-full bg-gray-800 px-2 py-1">{location.sourceKind === 'lora' ? 'LoRA' : 'Checkpoint'}</span>
            {presentation.baseModel && <span className="rounded-full bg-violet-500/15 px-2 py-1 text-violet-200">{presentation.baseModel}</span>}
            {presentation.previewSource && <span className="rounded-full bg-gray-800 px-2 py-1">Preview: {presentation.previewSource}</span>}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-500">Model</div>
            <div className="mt-1 text-xl font-semibold">{presentation.name}</div>
            {civitai && <div className="mt-1 text-sm text-gray-400">{civitai.modelName}{civitai.versionName && civitai.versionName !== presentation.name ? ` · ${civitai.versionName}` : ''}</div>}
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><Info label="Filename" value={location.fileName} /><Info label="Base model / architecture" value={presentation.baseModel || 'Unavailable'} /><Info label="Source" value={location.sourceName} /><Info label="File size" value={formatBytes(location.size)} /></div>
          </div>

          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <div className="flex items-center justify-between gap-3"><h2 className="inline-flex items-center gap-2 font-medium text-cyan-100"><Tag className="h-4 w-4" />Trigger words</h2>{presentation.triggerWords.length > 0 && <button type="button" onClick={() => void copyText(presentation.triggerWords.join(', '), 'Unable to copy trigger words.')} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 px-2.5 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/10"><Clipboard className="h-3.5 w-3.5" />Copy trigger words</button>}</div>
            {presentation.triggerWords.length ? <div className="mt-3 flex flex-wrap gap-2">{presentation.triggerWords.map((word) => <button type="button" key={word} onClick={() => void copyText(word, 'Unable to copy trigger word.')} className="rounded-full border border-cyan-500/25 bg-gray-950 px-2.5 py-1 text-xs text-cyan-100" title="Copy this trigger">{word}</button>)}</div> : <p className="mt-2 text-sm text-gray-500">No trigger words are available yet.</p>}
          </div>

          {location.sourceKind === 'lora' && <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-xs uppercase tracking-wider text-gray-500">LoRA syntax</div><code className="mt-1 block break-all text-sm text-emerald-200">{getDefaultLoraSyntax(location, currentItem.localMetadata)}</code></div><button type="button" onClick={() => void copyText(getDefaultLoraSyntax(location, currentItem.localMetadata), 'Unable to copy LoRA syntax.')} className="shrink-0 rounded-md border border-gray-700 px-2.5 py-2 text-xs hover:bg-gray-800">Copy LoRA syntax</button></div></div>}

          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-medium">Civitai</h2><p className="mt-1 text-xs text-gray-500">Network access happens only when you click fetch.</p></div><button type="button" onClick={() => void fetchCivitai()} disabled={isFetchingCivitai || Boolean(hashProgress)} className="inline-flex items-center gap-2 rounded-md border border-cyan-500/50 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15 disabled:text-gray-500"><RefreshCw className={`h-4 w-4 ${isFetchingCivitai || hashProgress ? 'animate-spin' : ''}`} />{isFetchingCivitai || hashProgress ? 'Fetching Info…' : civitai ? 'Refresh Info from Civitai' : 'Fetch Info from Civitai'}</button></div>
            {hashProgress && <div className="mt-3"><div className="flex justify-between text-xs text-gray-400"><span>Identifying model locally (SHA256)</span><span>{hashPercent}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded bg-gray-800"><div className="h-full bg-cyan-400" style={{ width: `${hashPercent}%` }} /></div><button type="button" onClick={() => void window.electronAPI?.modelLibraryCancelHash(hashProgress.requestId)} className="mt-2 text-xs text-amber-200">Cancel</button></div>}
            {civitai && <div className="mt-3 space-y-2 text-sm"><Info label="Model / version" value={`${civitai.modelName} · ${civitai.versionName}`} /><Info label="Base model" value={civitai.baseModel || 'Unavailable'} /><Info label="Last fetched" value={formatDate(civitai.fetchedAt)} /><button type="button" onClick={() => void window.electronAPI?.openExternalUrl(civitai.url)} className="inline-flex items-center gap-1.5 text-cyan-200 hover:text-cyan-100"><ExternalLink className="h-3.5 w-3.5" />Open on Civitai</button></div>}
            {civitaiNotFound && <p className="mt-3 text-sm text-gray-400">No matching Civitai version was found for this file. Last checked {formatDate(civitaiNotFound.fetchedAt)}.</p>}
          </div>
        </section>
      </div>

      {presentation.description && <section className="mt-5 rounded-xl border border-gray-800 bg-gray-900/70 p-4"><h2 className="font-medium">Description</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-300">{presentation.description}</p></section>}

      <LocalMetadataSection location={location} value={currentItem.localMetadata} onSave={saveLocal} />

      <details className="mt-5 rounded-xl border border-gray-800 bg-gray-900/70 p-4">
        <summary className="cursor-pointer font-medium">Technical details</summary>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><Info label="File location" value={location.absolutePath} /><Info label="Relative path" value={location.relativePath} /><Info label="Created" value={formatDate(location.createdAt)} /><Info label="Modified" value={formatDate(location.modifiedAt)} /><Info label="SHA256" value={location.sha256 || 'Not computed'} /><Info label="Embedded metadata" value={isReadingMetadata ? 'Reading local header…' : location.fileMetadata ? 'Available' : 'Unavailable'} /></div>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void window.electronAPI?.modelLibraryRevealLocation(location.absolutePath)} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800"><FolderOpen className="h-4 w-4" />Open location</button>{location.sha256 ? <button type="button" onClick={() => void copyText(location.sha256 || '', 'Unable to copy SHA256.')} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800"><Hash className="h-4 w-4" />Copy SHA256</button> : <button type="button" onClick={() => void hashCurrent()} disabled={Boolean(hashProgress)} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800 disabled:text-gray-600"><Hash className="h-4 w-4" />Compute SHA256</button>}</div>
        {location.fileMetadata?.raw && <details className="mt-4 rounded-md border border-gray-800 bg-gray-950 p-3"><summary className="cursor-pointer text-sm text-gray-300">Raw safetensors metadata</summary><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-400">{JSON.stringify(location.fileMetadata.raw, null, 2)}</pre></details>}
      </details>
    </div>
  </main>;
};

const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="min-w-0"><div className="text-xs uppercase tracking-wide text-gray-500">{label}</div><div className="mt-1 break-words text-gray-200">{value}</div></div>;

const LocalMetadataSection: React.FC<{
  location: ModelLocation;
  value?: ModelLocalMetadata;
  onSave: (value: Omit<ModelLocalMetadata, 'id' | 'sha256' | 'locationId' | 'updatedAt'>) => Promise<void>;
}> = ({ location, value, onSave }) => {
  const [displayName, setDisplayName] = useState(value?.displayName ?? '');
  const [notes, setNotes] = useState(value?.notes ?? '');
  const [tags, setTags] = useState(value?.tags.join(', ') ?? '');
  const [triggerWords, setTriggerWords] = useState(value?.triggerWords?.join(', ') ?? '');
  const [defaultStrength, setDefaultStrength] = useState(value?.defaultStrength ?? 1);
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    setDisplayName(value?.displayName ?? '');
    setNotes(value?.notes ?? '');
    setTags(value?.tags.join(', ') ?? '');
    setTriggerWords(value?.triggerWords?.join(', ') ?? '');
    setDefaultStrength(value?.defaultStrength ?? 1);
  }, [location.id, value]);
  return <section className="mt-5 rounded-xl border border-gray-800 bg-gray-900/70 p-4"><h2 className="font-medium">Your metadata</h2><p className="mt-1 text-xs text-gray-500">Local-only notes and overrides. Saving does not hash the model file.</p><form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); setIsSaving(true); void onSave({ displayName, notes, tags: tags.split(','), triggerWords: triggerWords.split(','), defaultStrength }).finally(() => setIsSaving(false)); }}><label className="text-xs text-gray-400">Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-2 text-sm text-gray-100" /></label><label className="text-xs text-gray-400">Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="style, portrait" className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-2 text-sm text-gray-100" /></label>{location.sourceKind === 'lora' && <><label className="text-xs text-gray-400">Trigger words override<input value={triggerWords} onChange={(event) => setTriggerWords(event.target.value)} placeholder="word, phrase" className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-2 text-sm text-gray-100" /></label><label className="text-xs text-gray-400">Default LoRA strength<input type="number" min="-10" max="10" step="0.05" value={defaultStrength} onChange={(event) => setDefaultStrength(Number(event.target.value))} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-2 text-sm text-gray-100" /></label></>}<label className="text-xs text-gray-400 sm:col-span-2">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-2 text-sm text-gray-100" /></label><div className="sm:col-span-2"><button type="submit" disabled={isSaving} className="rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:bg-gray-700">{isSaving ? 'Saving…' : 'Save local metadata'}</button></div></form></section>;
};

export default ModelInspectorApp;
