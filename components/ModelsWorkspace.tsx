import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileBox, FolderOpen, FolderPlus, Hash, RefreshCw, Search, Square, Trash2 } from 'lucide-react';
import { buildManagedModels, reconcileModelCatalog, EMPTY_MODEL_CATALOG } from '../services/modelLibrary/catalog';
import { deleteModelSource, getAllModelSources, saveModelSource } from '../services/modelLibrary/modelSourceStorage';
import { getAllModelLocalMetadata, saveModelLocalMetadata } from '../services/modelLibrary/localMetadataStorage';
import type { ModelCatalog, ModelLocalMetadata, ModelLocation, ModelSource, ModelSourceKind, ModelSourceScanResult } from '../services/modelLibrary/types';

const CATALOG_CACHE_ID = 'model-library-catalog-v1';

function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function formatDate(value: number | null): string {
  return value ? new Date(value).toLocaleString() : 'Unavailable';
}

function validCatalog(value: unknown): ModelCatalog {
  if (!value || typeof value !== 'object' || !Array.isArray((value as ModelCatalog).locations)) return EMPTY_MODEL_CATALOG;
  return { version: 1, locations: (value as ModelCatalog).locations, updatedAt: (value as ModelCatalog).updatedAt || 0 };
}

const ModelsWorkspace: React.FC = () => {
  const [sources, setSources] = useState<ModelSource[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY_MODEL_CATALOG);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<ModelSourceKind>('lora');
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReadingMetadata, setIsReadingMetadata] = useState(false);
  const [hashProgress, setHashProgress] = useState<{ requestId: string; bytesProcessed: number; totalBytes: number } | null>(null);
  const [isFetchingCivitai, setIsFetchingCivitai] = useState(false);
  const [localMetadata, setLocalMetadata] = useState<Record<string, ModelLocalMetadata>>({});
  const [typeFilter, setTypeFilter] = useState<'all' | ModelSourceKind>('all');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('name');

  const persistCatalog = useCallback(async (next: ModelCatalog) => {
    setCatalog(next);
    await window.electronAPI?.writeJsonCacheData({ cacheId: CATALOG_CACHE_ID, data: next });
  }, []);

  const scan = useCallback(async (nextSources: ModelSource[]) => {
    if (!window.electronAPI || nextSources.length === 0) return;
    setIsScanning(true); setError(null);
    try {
      await window.electronAPI.modelLibrarySetRoots(nextSources.map((source) => source.path));
      const response = await window.electronAPI.modelLibraryScan(nextSources.map(({ id, path, recursive }) => ({ id, path, recursive })));
      if (!response.success || !response.results) throw new Error(response.error || 'Unable to scan model sources.');
      const next = reconcileModelCatalog(catalog, nextSources, response.results as ModelSourceScanResult[]);
      await persistCatalog(next);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Unable to scan model sources.');
    } finally { setIsScanning(false); }
  }, [catalog, persistCatalog]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [loadedSources, cacheResult] = await Promise.all([
        getAllModelSources(),
        window.electronAPI?.getJsonCacheData(CATALOG_CACHE_ID),
      ]);
      if (!active) return;
      const loadedCatalog = validCatalog(cacheResult?.success ? cacheResult.data : undefined);
      setSources(loadedSources); setCatalog(loadedCatalog); setIsLoading(false);
      if (loadedSources.length > 0 && window.electronAPI) {
        setIsScanning(true);
        try {
          await window.electronAPI.modelLibrarySetRoots(loadedSources.map((source) => source.path));
          const response = await window.electronAPI.modelLibraryScan(loadedSources.map(({ id, path, recursive }) => ({ id, path, recursive })));
          if (response.success && response.results && active) {
            const next = reconcileModelCatalog(loadedCatalog, loadedSources, response.results as ModelSourceScanResult[]);
            await persistCatalog(next);
          }
        } catch { /* Cached catalog remains available when a scan cannot run. */ }
        finally { if (active) setIsScanning(false); }
      }
    })();
    return () => { active = false; };
  }, [persistCatalog]);

  useEffect(() => window.electronAPI?.onModelLibraryHashProgress((progress) => setHashProgress(progress)), []);

  useEffect(() => { void getAllModelLocalMetadata().then((entries) => setLocalMetadata(Object.fromEntries(entries.map((entry) => [entry.sha256, entry])))); }, []);

  const addSource = async () => {
    const result = await window.electronAPI?.showDirectoryDialog();
    if (!result?.success || !result.path) return;
    const now = Date.now();
    const source = await saveModelSource({ id: `model-source-${now}-${Math.random().toString(36).slice(2, 8)}`, name: result.name || 'Model source', path: result.path, kind: sourceKind, recursive: true, createdAt: now, updatedAt: now });
    const nextSources = [...sources, source];
    setSources(nextSources);
    await scan(nextSources);
  };

  const removeSource = async (source: ModelSource) => {
    if (!window.confirm(`Remove ${source.name} from Models? Files will not be deleted.`)) return;
    await deleteModelSource(source.id);
    const nextSources = sources.filter((item) => item.id !== source.id);
    setSources(nextSources);
    await persistCatalog({ ...catalog, locations: catalog.locations.filter((location) => location.sourceId !== source.id), updatedAt: Date.now() });
    await window.electronAPI?.modelLibrarySetRoots(nextSources.map((item) => item.path));
    if (selectedId && catalog.locations.find((location) => location.id === selectedId)?.sourceId === source.id) setSelectedId(null);
  };

  const locations = useMemo(() => catalog.locations.filter((location) => {
    const local = location.sha256 ? localMetadata[location.sha256] : undefined;
    const haystack = `${location.fileName} ${location.relativePath} ${location.sourceName} ${local?.displayName ?? ''} ${local?.notes ?? ''} ${(local?.tags ?? []).join(' ')}`.toLowerCase();
    return (typeFilter === 'all' || location.sourceKind === typeFilter) && haystack.includes(query.trim().toLowerCase());
  }).sort((a, b) => sortBy === 'size' ? b.size - a.size : sortBy === 'modified' ? (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) : a.fileName.localeCompare(b.fileName)), [catalog.locations, localMetadata, query, sortBy, typeFilter]);
  const selected = catalog.locations.find((location) => location.id === selectedId) ?? locations[0] ?? null;

  const updateSelectedLocation = async (update: (location: ModelLocation) => ModelLocation) => {
    if (!selected) return;
    const locations = catalog.locations.map((location) => location.id === selected.id ? update(location) : location);
    await persistCatalog({ ...catalog, locations, managedModels: buildManagedModels(locations), updatedAt: Date.now() });
  };
  const readMetadata = async () => {
    if (!selected || !window.electronAPI) return;
    setIsReadingMetadata(true); setError(null);
    try {
      const result = await window.electronAPI.modelLibraryReadMetadata(selected.absolutePath);
      if (!result.success || !result.metadata) throw new Error(result.error || 'Unable to read safetensors metadata.');
      await updateSelectedLocation((location) => ({ ...location, fileMetadata: result.metadata }));
    } catch (readError) { setError(readError instanceof Error ? readError.message : 'Unable to read safetensors metadata.'); }
    finally { setIsReadingMetadata(false); }
  };
  const hashSelected = async (): Promise<string | undefined> => {
    if (!selected || !window.electronAPI) return;
    const requestId = `model-hash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setHashProgress({ requestId, bytesProcessed: 0, totalBytes: selected.size }); setError(null);
    try {
      const result = await window.electronAPI.modelLibraryHash({ filePath: selected.absolutePath, requestId });
      if (!result.success) throw new Error(result.error || 'Unable to hash model file.');
      if (!result.cancelled && result.sha256) {
        await updateSelectedLocation((location) => ({ ...location, sha256: result.sha256, hashFingerprint: { size: result.size ?? location.size, modifiedAt: result.modifiedAt ?? location.modifiedAt } }));
        return result.sha256;
      }
    } catch (hashError) { setError(hashError instanceof Error ? hashError.message : 'Unable to hash model file.'); }
    finally { setHashProgress(null); }
  };
  const fetchCivitai = async () => {
    if (!selected?.sha256 || !window.electronAPI) return;
    setIsFetchingCivitai(true); setError(null);
    try {
      const result = await window.electronAPI.modelLibraryFetchCivitai(selected.sha256);
      if (result.status === 'unavailable') throw new Error('Civitai is unavailable. Try again later.');
      const locations = catalog.locations.map((location) => location.sha256 === selected.sha256
        ? { ...location, civitai: result.status === 'found' ? result.metadata : { status: 'notFound' as const, fetchedAt: Date.now(), url: '' } }
        : location);
      await persistCatalog({ ...catalog, locations, managedModels: buildManagedModels(locations), updatedAt: Date.now() });
    } catch (fetchError) { setError(fetchError instanceof Error ? fetchError.message : 'Civitai is unavailable. Try again later.'); }
    finally { setIsFetchingCivitai(false); }
  };
  const clearCivitaiCover = async () => {
    if (!selected?.sha256 || !('modelId' in (selected.civitai ?? {}))) return;
    const locations = catalog.locations.map((location) => location.sha256 === selected.sha256 && location.civitai && 'modelId' in location.civitai
      ? { ...location, civitai: { ...location.civitai, coverImage: undefined } }
      : location);
    await persistCatalog({ ...catalog, locations, managedModels: buildManagedModels(locations), updatedAt: Date.now() });
  };
  const saveLocalMetadata = async (value: Omit<ModelLocalMetadata, 'sha256' | 'updatedAt'>) => {
    if (!selected) return;
    const sha256 = selected.sha256 ?? await hashSelected();
    if (!sha256) return;
    const saved = await saveModelLocalMetadata({ sha256, ...value, updatedAt: Date.now() });
    setLocalMetadata((current) => ({ ...current, [saved.sha256]: saved }));
  };

  return <div className="flex h-full min-h-0 bg-gray-950 text-gray-100">
    <aside className="w-64 shrink-0 border-r border-gray-800 bg-gray-900/70 p-4">
      <h2 className="text-lg font-semibold">Models</h2>
      <p className="mt-1 text-xs text-gray-400">Standalone LoRA and checkpoint folders.</p>
      <div className="mt-4 flex gap-2">
        <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as ModelSourceKind)} className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-800 px-2 py-2 text-sm text-gray-100">
          <option value="lora">LoRA</option><option value="checkpoint">Checkpoint</option>
        </select>
        <button type="button" onClick={addSource} className="rounded-md bg-cyan-600 px-2 text-white hover:bg-cyan-500" title="Add folder"><FolderPlus className="h-4 w-4" /></button>
      </div>
      <div className="mt-4 space-y-2">
        {sources.map((source) => <div key={source.id} className="rounded-md border border-gray-800 bg-gray-900 p-2">
          <div className="flex items-start gap-2"><FileBox className="mt-0.5 h-4 w-4 text-cyan-300" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium" title={source.name}>{source.name}</div><div className="text-xs text-gray-500">{source.kind === 'lora' ? 'LoRA' : 'Checkpoint'}</div></div><button type="button" onClick={() => void removeSource(source)} className="text-gray-500 hover:text-red-300" title="Remove source"><Trash2 className="h-3.5 w-3.5" /></button></div>
        </div>)}
      </div>
    </aside>
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-800 px-5 py-4"><div className="relative min-w-[180px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" className="w-full rounded-md border border-gray-700 bg-gray-900 py-2 pl-9 pr-3 text-sm text-gray-100 placeholder:text-gray-500" /></div><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | ModelSourceKind)} className="rounded-md border border-gray-700 bg-gray-900 px-2 py-2 text-sm"><option value="all">All types</option><option value="lora">LoRAs</option><option value="checkpoint">Checkpoints</option></select><select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'name' | 'size' | 'modified')} className="rounded-md border border-gray-700 bg-gray-900 px-2 py-2 text-sm"><option value="name">Name</option><option value="modified">Modified</option><option value="size">Size</option></select><button type="button" onClick={() => void scan(sources)} disabled={!sources.length || isScanning} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800 disabled:text-gray-600"><RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />Refresh</button></div>
      {error && <div className="mx-5 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {isLoading ? <div className="text-sm text-gray-400">Loading model catalog…</div> : !sources.length ? <div className="flex h-full flex-col items-center justify-center text-center"><FolderOpen className="mb-3 h-10 w-10 text-gray-600" /><h3 className="font-semibold">Add a model folder</h3><p className="mt-1 max-w-sm text-sm text-gray-400">Choose a LoRA or checkpoint folder to build a local model catalog.</p></div> : !locations.length ? <div className="flex h-full items-center justify-center text-sm text-gray-400">{isScanning ? 'Scanning .safetensors files…' : 'No .safetensors files found in these sources.'}</div> : <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">{locations.map((location) => <button type="button" key={location.id} onClick={() => setSelectedId(location.id)} className={`rounded-lg border p-3 text-left transition-colors ${selected?.id === location.id ? 'border-cyan-400/60 bg-cyan-500/10' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}><div className="truncate font-medium" title={location.fileName}>{location.fileName}</div><div className="mt-1 text-xs text-cyan-200">{location.sourceKind === 'lora' ? 'LoRA' : 'Checkpoint'}</div><div className="mt-3 text-xs text-gray-400">{formatBytes(location.size)} · {location.sourceName}</div></button>)}</div>}
      </div>
    </section>
    <ModelDetails location={selected} localMetadata={selected?.sha256 ? localMetadata[selected.sha256] : undefined} onSaveLocalMetadata={saveLocalMetadata} isReadingMetadata={isReadingMetadata} isFetchingCivitai={isFetchingCivitai} hashProgress={hashProgress} onReadMetadata={readMetadata} onHash={hashSelected} onFetchCivitai={fetchCivitai} onClearCivitaiCover={clearCivitaiCover} onCancelHash={() => hashProgress && void window.electronAPI?.modelLibraryCancelHash(hashProgress.requestId)} />
  </div>;
};

const ModelDetails: React.FC<{ location: ModelLocation | null; localMetadata?: ModelLocalMetadata; onSaveLocalMetadata: (value: Omit<ModelLocalMetadata, 'sha256' | 'updatedAt'>) => Promise<void>; isReadingMetadata: boolean; isFetchingCivitai: boolean; hashProgress: { requestId: string; bytesProcessed: number; totalBytes: number } | null; onReadMetadata: () => void; onHash: () => void; onFetchCivitai: () => void; onClearCivitaiCover: () => void; onCancelHash: () => void }> = ({ location, localMetadata, onSaveLocalMetadata, isReadingMetadata, isFetchingCivitai, hashProgress, onReadMetadata, onHash, onFetchCivitai, onClearCivitaiCover, onCancelHash }) => <aside className="w-80 shrink-0 overflow-auto border-l border-gray-800 bg-gray-900/70 p-5">
  <h3 className="font-semibold">Model details</h3>
  {location && <LocalMetadataEditor value={localMetadata} onSave={onSaveLocalMetadata} />}
  {!location ? <p className="mt-3 text-sm text-gray-500">Select a model to inspect its file information.</p> : <div className="mt-4 space-y-4 text-sm"><div><div className="break-words font-medium text-gray-100">{location.fileName}</div><div className="mt-1 text-cyan-200">{location.sourceKind === 'lora' ? 'LoRA' : 'Checkpoint'}</div></div>{location.fileMetadata?.embeddedPreview && <img src={location.fileMetadata.embeddedPreview} alt="Embedded model preview" className="max-h-52 w-full rounded-md border border-gray-800 object-cover" />}{location.civitai && 'modelId' in location.civitai && <><img src={location.civitai.coverImage || location.fileMetadata?.embeddedPreview} alt="Civitai cover" className="max-h-52 w-full rounded-md border border-gray-800 object-cover" /><Detail label="Civitai" value={`${location.civitai.modelName} · ${location.civitai.versionName}`} /><Detail label="Civitai base model" value={location.civitai.baseModel || 'Unavailable'} />{location.civitai.trainedWords.length ? <Detail label="Civitai trained words" value={location.civitai.trainedWords.join(', ')} /> : null}<div className="flex gap-2"><button type="button" onClick={() => void window.electronAPI?.openExternalUrl(location.civitai.url)} className="inline-flex items-center gap-1 text-sm text-cyan-200 hover:text-cyan-100"><ExternalLink className="h-3.5 w-3.5" />Open on Civitai</button>{location.civitai.coverImage && <button type="button" onClick={onClearCivitaiCover} className="text-sm text-gray-400 hover:text-gray-200">Clear cover</button>}</div></>} {location.civitai && 'status' in location.civitai && <p className="text-sm text-gray-500">Not found on Civitai when last checked.</p>}<Detail label="Source" value={location.sourceName} /><Detail label="Path" value={location.absolutePath} /><Detail label="Size" value={formatBytes(location.size)} /><Detail label="Created" value={formatDate(location.createdAt)} /><Detail label="Modified" value={formatDate(location.modifiedAt)} />{location.sha256 ? <Detail label="SHA256" value={location.sha256} /> : null}{location.fileMetadata && <><Detail label="Model name" value={location.fileMetadata.modelName || 'Unavailable'} /><Detail label="Base model" value={location.fileMetadata.baseModel || location.fileMetadata.architecture || 'Unavailable'} />{location.fileMetadata.triggerWords?.length ? <Detail label="Trigger words" value={location.fileMetadata.triggerWords.join(', ')} /> : null}</>}<div className="flex flex-wrap gap-2"><button type="button" onClick={onReadMetadata} disabled={isReadingMetadata} className="rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800 disabled:text-gray-600">{isReadingMetadata ? 'Reading…' : 'Read embedded metadata'}</button>{hashProgress ? <button type="button" onClick={onCancelHash} className="inline-flex items-center gap-2 rounded-md border border-amber-500/50 px-3 py-2 text-sm text-amber-100"><Square className="h-3.5 w-3.5" />Stop {Math.round((hashProgress.bytesProcessed / Math.max(1, hashProgress.totalBytes)) * 100)}%</button> : <button type="button" onClick={onHash} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800"><Hash className="h-4 w-4" />Compute SHA256</button>}{location.sha256 && <button type="button" onClick={onFetchCivitai} disabled={isFetchingCivitai} className="rounded-md border border-cyan-500/50 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/10 disabled:text-gray-600">{isFetchingCivitai ? 'Fetching Civitai…' : location.civitai && 'modelId' in location.civitai ? 'Refresh Civitai info' : 'Fetch Info from Civitai'}</button>}<button type="button" onClick={() => void window.electronAPI?.modelLibraryRevealLocation(location.absolutePath)} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800"><FolderOpen className="h-4 w-4" />Open location</button></div></div>}
</aside>;

const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => <div><div className="text-xs uppercase tracking-wide text-gray-500">{label}</div><div className="mt-1 break-words text-gray-200">{value}</div></div>;

const LocalMetadataEditor: React.FC<{ value?: ModelLocalMetadata; onSave: (value: Omit<ModelLocalMetadata, 'sha256' | 'updatedAt'>) => Promise<void> }> = ({ value, onSave }) => {
  const [displayName, setDisplayName] = useState(value?.displayName ?? '');
  const [notes, setNotes] = useState(value?.notes ?? '');
  const [tags, setTags] = useState(value?.tags.join(', ') ?? '');
  useEffect(() => { setDisplayName(value?.displayName ?? ''); setNotes(value?.notes ?? ''); setTags(value?.tags.join(', ') ?? ''); }, [value]);
  return <form className="mt-3 space-y-2 rounded-md border border-gray-800 bg-gray-950/50 p-3" onSubmit={(event) => { event.preventDefault(); void onSave({ displayName, notes, tags: tags.split(',') }); }}>
    <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Local metadata</div>
    <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm" />
    <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags, comma separated" className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm" />
    <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Local notes" rows={3} className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm" />
    <button type="submit" className="rounded border border-gray-700 px-2 py-1 text-xs hover:bg-gray-800">Save local metadata</button>
  </form>;
};

export default ModelsWorkspace;
