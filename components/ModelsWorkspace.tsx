import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileBox, FolderOpen, FolderPlus, RefreshCw, Search, Trash2 } from 'lucide-react';
import {
  buildManagedModels,
  EMPTY_MODEL_CATALOG,
  getManagedModelPrimaryLocations,
  MODEL_CATALOG_CACHE_ID,
  reconcileModelCatalog,
  replaceCatalogLocation,
  validModelCatalog,
} from '../services/modelLibrary/catalog';
import { getAllModelSources, deleteModelSource, saveModelSource } from '../services/modelLibrary/modelSourceStorage';
import { getAllModelLocalMetadata } from '../services/modelLibrary/localMetadataStorage';
import {
  getEffectiveModelPresentation,
  getModelLocalMetadata,
  modelInspectorSearchText,
} from '../services/modelLibrary/presentation';
import type {
  ModelCatalog,
  ModelInspectorItem,
  ModelLocalMetadata,
  ModelSource,
  ModelSourceKind,
  ModelSourceScanResult,
} from '../services/modelLibrary/types';

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
};

const ModelsWorkspace: React.FC = () => {
  const [sources, setSources] = useState<ModelSource[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY_MODEL_CATALOG);
  const [localMetadata, setLocalMetadata] = useState<Record<string, ModelLocalMetadata>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<ModelSourceKind>('lora');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ModelSourceKind>('all');
  const [baseModelFilter, setBaseModelFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('name');
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isOpeningInspector, setIsOpeningInspector] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metadataRequests = useRef(new Set<string>());

  const persistCatalog = useCallback(async (next: ModelCatalog) => {
    setCatalog(next);
    await window.electronAPI?.writeJsonCacheData({ cacheId: MODEL_CATALOG_CACHE_ID, data: next });
  }, []);

  const scan = useCallback(async (nextSources: ModelSource[]) => {
    if (!window.electronAPI || nextSources.length === 0) return;
    setIsScanning(true);
    setError(null);
    try {
      await window.electronAPI.modelLibrarySetRoots(nextSources.map((source) => source.path));
      const response = await window.electronAPI.modelLibraryScan(nextSources.map(({ id, path, recursive }) => ({ id, path, recursive })));
      if (!response.success || !response.results) throw new Error(response.error || 'Unable to scan model sources.');
      await persistCatalog(reconcileModelCatalog(catalog, nextSources, response.results as ModelSourceScanResult[]));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Unable to scan model sources.');
    } finally {
      setIsScanning(false);
    }
  }, [catalog, persistCatalog]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [loadedSources, cacheResult, localEntries] = await Promise.all([
        getAllModelSources(),
        window.electronAPI?.getJsonCacheData(MODEL_CATALOG_CACHE_ID),
        getAllModelLocalMetadata(),
      ]);
      if (!active) return;
      const loadedCatalog = validModelCatalog(cacheResult?.success ? cacheResult.data : undefined);
      setSources(loadedSources);
      setCatalog(loadedCatalog);
      setLocalMetadata(Object.fromEntries(localEntries.map((entry) => [entry.id, entry])));
      setIsLoading(false);
      if (!loadedSources.length || !window.electronAPI) return;
      setIsScanning(true);
      try {
        await window.electronAPI.modelLibrarySetRoots(loadedSources.map((source) => source.path));
        const response = await window.electronAPI.modelLibraryScan(loadedSources.map(({ id, path, recursive }) => ({ id, path, recursive })));
        if (response.success && response.results && active) {
          await persistCatalog(reconcileModelCatalog(loadedCatalog, loadedSources, response.results as ModelSourceScanResult[]));
        }
      } catch {
        // A cached catalog remains useful if a removable/network model source is temporarily offline.
      } finally {
        if (active) setIsScanning(false);
      }
    })();
    return () => { active = false; };
  }, [persistCatalog]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    return api.onModelInspectorItemUpdated((item) => {
      setCatalog((current) => {
        const next = replaceCatalogLocation(current, item.location);
        if (next !== current) void api.writeJsonCacheData({ cacheId: MODEL_CATALOG_CACHE_ID, data: next });
        return next;
      });
      if (item.localMetadata) {
        setLocalMetadata((current) => ({ ...current, [item.localMetadata!.id]: item.localMetadata! }));
      }
    });
  }, []);

  const primaryLocations = useMemo(() => getManagedModelPrimaryLocations(catalog), [catalog]);
  const baseModelOptions = useMemo(() => Array.from(new Set(primaryLocations
    .map((location) => getEffectiveModelPresentation(location, getModelLocalMetadata(localMetadata, location)).baseModel)
    .filter((value): value is string => Boolean(value))))
    .sort((a, b) => a.localeCompare(b)), [localMetadata, primaryLocations]);
  const visibleLocations = useMemo(() => primaryLocations
    .map((location) => ({ location, localMetadata: getModelLocalMetadata(localMetadata, location) }))
    .filter((item) => {
      const typeMatches = typeFilter === 'all' || item.location.sourceKind === typeFilter;
      const baseModel = getEffectiveModelPresentation(item.location, item.localMetadata).baseModel;
      const baseModelMatches = baseModelFilter === 'all' || baseModel === baseModelFilter;
      return typeMatches && baseModelMatches && modelInspectorSearchText(item).includes(query.trim().toLocaleLowerCase());
    })
    .sort((a, b) => {
      if (sortBy === 'size') return b.location.size - a.location.size;
      if (sortBy === 'modified') return (b.location.modifiedAt ?? 0) - (a.location.modifiedAt ?? 0);
      return getEffectiveModelPresentation(a.location, a.localMetadata).name.localeCompare(
        getEffectiveModelPresentation(b.location, b.localMetadata).name,
      );
    }), [baseModelFilter, localMetadata, primaryLocations, query, sortBy, typeFilter]);

  const selectedItem = visibleLocations.find((item) => item.location.id === selectedId) ?? visibleLocations[0] ?? null;

  useEffect(() => {
    if (!selectedItem || selectedItem.location.fileMetadata || metadataRequests.current.has(selectedItem.location.id)) return;
    const api = window.electronAPI;
    if (!api) return;
    metadataRequests.current.add(selectedItem.location.id);
    void api.modelLibraryReadMetadata(selectedItem.location.absolutePath).then(async (result) => {
      if (!result.success || !result.metadata) return;
      const nextLocation = { ...selectedItem.location, fileMetadata: result.metadata };
      setCatalog((current) => {
        const next = replaceCatalogLocation(current, nextLocation);
        if (next !== current) void api.writeJsonCacheData({ cacheId: MODEL_CATALOG_CACHE_ID, data: next });
        return next;
      });
    });
  }, [selectedItem]);

  const inspectorItems = useMemo<ModelInspectorItem[]>(() => visibleLocations.map((item) => ({
    location: item.location,
    localMetadata: item.localMetadata,
  })), [visibleLocations]);

  useEffect(() => {
    void window.electronAPI?.modelInspectorSyncCollection({ items: inspectorItems });
  }, [inspectorItems]);

  const selectModel = (locationId: string) => {
    setSelectedId(locationId);
    void window.electronAPI?.modelInspectorSyncSelection(locationId);
  };

  const openInspector = async () => {
    if (!selectedItem || !window.electronAPI) return;
    setIsOpeningInspector(true);
    setError(null);
    try {
      const result = await window.electronAPI.modelInspectorOpen({ items: inspectorItems, selectedId: selectedItem.location.id });
      if (!result.success) throw new Error(result.error || 'Unable to open Model Inspector.');
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Unable to open Model Inspector.');
    } finally {
      setIsOpeningInspector(false);
    }
  };

  const addSource = async () => {
    const result = await window.electronAPI?.showDirectoryDialog();
    if (!result?.success || !result.path) return;
    const now = Date.now();
    const source = await saveModelSource({
      id: `model-source-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: result.name || 'Model source',
      path: result.path,
      kind: sourceKind,
      recursive: true,
      createdAt: now,
      updatedAt: now,
    });
    const nextSources = [...sources, source];
    setSources(nextSources);
    await scan(nextSources);
  };

  const removeSource = async (source: ModelSource) => {
    if (!window.confirm(`Remove ${source.name} from Models? Files will not be deleted.`)) return;
    await deleteModelSource(source.id);
    const nextSources = sources.filter((item) => item.id !== source.id);
    const locations = catalog.locations.filter((location) => location.sourceId !== source.id);
    setSources(nextSources);
    await persistCatalog({ ...catalog, locations, managedModels: buildManagedModels(locations), updatedAt: Date.now() });
    await window.electronAPI?.modelLibrarySetRoots(nextSources.map((item) => item.path));
    if (selectedItem?.location.sourceId === source.id) setSelectedId(null);
  };

  return <div className="flex h-full min-h-0 bg-gray-950 text-gray-100">
    <aside className="w-64 shrink-0 overflow-auto border-r border-gray-800 bg-gray-900/70 p-4">
      <h2 className="text-lg font-semibold">Models</h2>
      <p className="mt-1 text-xs text-gray-400">Local LoRA and checkpoint libraries.</p>
      <div className="mt-4 flex gap-2"><select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as ModelSourceKind)} className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-800 px-2 py-2 text-sm"><option value="lora">LoRA</option><option value="checkpoint">Checkpoint</option></select><button type="button" onClick={() => void addSource()} className="rounded-md bg-cyan-600 px-2 text-white hover:bg-cyan-500" title="Add folder"><FolderPlus className="h-4 w-4" /></button></div>
      <div className="mt-4 space-y-2">{sources.map((source) => <div key={source.id} className="rounded-md border border-gray-800 bg-gray-900 p-2"><div className="flex items-start gap-2"><FileBox className="mt-0.5 h-4 w-4 text-cyan-300" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium" title={source.name}>{source.name}</div><div className="text-xs text-gray-500">{source.kind === 'lora' ? 'LoRA' : 'Checkpoint'}</div></div><button type="button" onClick={() => void removeSource(source)} className="text-gray-500 hover:text-red-300" title="Remove source"><Trash2 className="h-3.5 w-3.5" /></button></div></div>)}</div>
    </aside>

    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-800 px-5 py-4"><div className="relative min-w-[180px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, base models, triggers, tags…" className="w-full rounded-md border border-gray-700 bg-gray-900 py-2 pl-9 pr-3 text-sm placeholder:text-gray-500" /></div><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | ModelSourceKind)} className="rounded-md border border-gray-700 bg-gray-900 px-2 py-2 text-sm"><option value="all">All types</option><option value="lora">LoRAs</option><option value="checkpoint">Checkpoints</option></select><select value={baseModelFilter} onChange={(event) => setBaseModelFilter(event.target.value)} className="max-w-48 rounded-md border border-gray-700 bg-gray-900 px-2 py-2 text-sm"><option value="all">All base models</option>{baseModelOptions.map((baseModel) => <option key={baseModel} value={baseModel}>{baseModel}</option>)}</select><select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'name' | 'size' | 'modified')} className="rounded-md border border-gray-700 bg-gray-900 px-2 py-2 text-sm"><option value="name">Name</option><option value="modified">Modified</option><option value="size">Size</option></select><button type="button" onClick={() => void scan(sources)} disabled={!sources.length || isScanning} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800 disabled:text-gray-600"><RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />Refresh</button></div>
      {error && <div className="mx-5 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
      <div className="min-h-0 flex-1 overflow-auto p-5">{isLoading ? <div className="text-sm text-gray-400">Loading model catalog…</div> : !sources.length ? <div className="flex h-full flex-col items-center justify-center text-center"><FolderOpen className="mb-3 h-10 w-10 text-gray-600" /><h3 className="font-semibold">Add a model folder</h3><p className="mt-1 max-w-sm text-sm text-gray-400">Choose a LoRA or checkpoint folder to build a local model catalog.</p></div> : !visibleLocations.length ? <div className="flex h-full items-center justify-center text-sm text-gray-400">{isScanning ? 'Scanning .safetensors files…' : 'No models match the current filters.'}</div> : <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">{visibleLocations.map((item) => <ModelCard key={item.location.id} item={item} isSelected={selectedItem?.location.id === item.location.id} onSelect={() => selectModel(item.location.id)} />)}</div>}</div>
    </section>

    <QuickModelDetails item={selectedItem} onOpenInspector={openInspector} isOpeningInspector={isOpeningInspector} />
  </div>;
};

const ModelCard: React.FC<{ item: ModelInspectorItem; isSelected: boolean; onSelect: () => void }> = ({ item, isSelected, onSelect }) => {
  const presentation = getEffectiveModelPresentation(item.location, item.localMetadata);
  return <button type="button" onClick={onSelect} className={`overflow-hidden rounded-lg border text-left transition-colors ${isSelected ? 'border-cyan-400/60 bg-cyan-500/10' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}><div className="flex h-32 items-center justify-center bg-gray-950">{presentation.preview ? <img src={presentation.preview} alt="" className="h-full w-full object-cover" /> : <FileBox className="h-8 w-8 text-gray-700" />}</div><div className="p-3"><div className="truncate font-medium" title={presentation.name}>{presentation.name}</div><div className="mt-1 flex items-center gap-2 text-xs"><span className="text-cyan-200">{item.location.sourceKind === 'lora' ? 'LoRA' : 'Checkpoint'}</span>{presentation.baseModel && <span className="truncate text-violet-300">{presentation.baseModel}</span>}</div>{presentation.triggerWords.length > 0 && <div className="mt-2 truncate text-xs text-gray-300" title={presentation.triggerWords.join(', ')}>{presentation.triggerWords.slice(0, 3).join(' · ')}</div>}<div className="mt-3 truncate text-xs text-gray-500">{formatBytes(item.location.size)} · {item.location.sourceName}</div></div></button>;
};

const QuickModelDetails: React.FC<{ item: ModelInspectorItem | null; onOpenInspector: () => Promise<void>; isOpeningInspector: boolean }> = ({ item, onOpenInspector, isOpeningInspector }) => {
  if (!item) return <aside className="w-80 shrink-0 border-l border-gray-800 bg-gray-900/70 p-5"><h3 className="font-semibold">Model</h3><p className="mt-3 text-sm text-gray-500">Select a model to inspect it.</p></aside>;
  const presentation = getEffectiveModelPresentation(item.location, item.localMetadata);
  const civitai = item.location.civitai && 'modelId' in item.location.civitai ? item.location.civitai : undefined;
  return <aside className="w-80 shrink-0 overflow-auto border-l border-gray-800 bg-gray-900/70 p-5"><h3 className="font-semibold">Selected model</h3><div className="mt-4 flex max-h-52 min-h-32 items-center justify-center overflow-hidden rounded-lg border border-gray-800 bg-gray-950">{presentation.preview ? <img src={presentation.preview} alt="" className="max-h-52 w-full object-contain" /> : <FileBox className="h-8 w-8 text-gray-700" />}</div><div className="mt-4 break-words text-lg font-semibold">{presentation.name}</div><div className="mt-1 text-sm text-cyan-200">{item.location.sourceKind === 'lora' ? 'LoRA' : 'Checkpoint'}{presentation.baseModel ? ` · ${presentation.baseModel}` : ''}</div>{presentation.triggerWords.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{presentation.triggerWords.slice(0, 5).map((word) => <span key={word} className="rounded-full bg-gray-800 px-2 py-1 text-xs text-gray-300">{word}</span>)}</div>}<button type="button" onClick={() => void onOpenInspector()} disabled={isOpeningInspector} className="mt-5 w-full rounded-md bg-cyan-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:bg-gray-700">{isOpeningInspector ? 'Opening…' : 'Open Inspector'}</button><button type="button" onClick={() => void window.electronAPI?.modelLibraryRevealLocation(item.location.absolutePath)} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-800"><FolderOpen className="h-4 w-4" />Open location</button>{civitai && <button type="button" onClick={() => void window.electronAPI?.openExternalUrl(civitai.url)} className="mt-3 inline-flex items-center gap-1.5 text-sm text-cyan-200"><ExternalLink className="h-3.5 w-3.5" />Open on Civitai</button>}<p className="mt-4 text-xs leading-5 text-gray-500">Use the floating Inspector for previews, navigation, trigger copying, Civitai enrichment, notes, and technical details.</p></aside>;
};

export default ModelsWorkspace;
