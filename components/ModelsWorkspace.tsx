import { useTranslation } from '../i18n/useTranslation';
import { modelKindText, translateModelMessage } from '../i18n/modelMessages';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ModelUsagePanel from './ModelUsagePanel';
import ModelStoragePanel from './ModelStoragePanel';
import { FileBox, FolderPlus, Search, Settings, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { MODEL_KIND_LABELS } from '../services/modelLibrary/modelKinds';
import { buildManagedModels, getManagedModelPrimaryLocations } from '../services/modelLibrary/catalog';
import { getEffectiveModelPresentation, getModelLocalMetadata, modelInspectorSearchText } from '../services/modelLibrary/presentation';
import { getModelManagerState, addModelSource, cancelModelJob, checkModelUpdates, identifyModels, managerMessage, removeModelSource, scanModelSources, setModelInterval, showModelUpdates, updateModelSource, useModelManager } from '../services/modelLibrary/manager';
import { linkedModelLocationIds, modelUpdateCounts } from '../services/modelLibrary/huggingFaceTracking';
import { ModelUpdatesPanel } from './UnifiedModelUpdatesPanel';
import { executeModelCommand, modelButton, modelInput } from './ModelManagerPanels';
import ModelDetailsPanels from './ModelDetailsPanels';
import type { ModelInspectorItem, ModelKind, ModelLocation, ModelSource } from '../services/modelLibrary/types';
import { areFilesystemPathsEqual } from '../utils/filesystemPath';
import { createInspectorSyncQueue } from '../services/modelLibrary/storageView';

const formatBytes = (size: number) => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(1)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
const selectionButton = (active: boolean) => active
  ? 'rounded-md border border-cyan-400 bg-cyan-500/20 px-3 py-2 text-xs font-semibold text-cyan-100 ring-1 ring-cyan-400/30 hover:bg-cyan-500/25 light:border-accent/60 light:bg-accent/10 light:text-gray-50 light:ring-accent/30 light:hover:bg-accent/15'
  : modelButton;

export default function ModelsWorkspace() {
  const { t } = useTranslation();
  const manager = useModelManager();
  const [storageOpen, setStorageOpen] = useState(false);
  const [storageVisited, setStorageVisited] = useState(false);
  const [storageItems, setStorageItems] = useState<ModelInspectorItem[]>([]);
  const inspectorQueue = useRef(createInspectorSyncQueue());
  const [detailsWidth, setDetailsWidth] = useState(360);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const previousSelection = useRef<ModelLocation | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [retainedInspectorId, setRetainedInspectorId] = useState<string | null>(null);
  const [query, setQuery] = useState(''); const [kind, setKind] = useState<ModelKind | 'all'>('all'); const [base, setBase] = useState('all'); const [sourceId, setSourceId] = useState('all');
  const [tag, setTag] = useState('all'); const [view, setView] = useState<'all' | 'new' | 'favorites' | 'hidden'>('all'); const [sort, setSort] = useState('name');
  const [filtersOpen, setFiltersOpen] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [issuesOnly, setIssuesOnly] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(true); const [detailsOpen, setDetailsOpen] = useState(true); const [revealUpdates, setRevealUpdates] = useState(0);
  const [pendingSource, setPendingSource] = useState<ModelSource | null>(null); const [editingSource, setEditingSource] = useState(false); const [savingSource, setSavingSource] = useState(false);
  const [pendingCheck, setPendingCheck] = useState<{ ids: string[]; identifyOnly?: boolean } | null>(null);
  const [context, setContext] = useState<{ id: string; x: number; y: number } | null>(null);
  const libraryActions = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (libraryActions.current?.open && !libraryActions.current.contains(event.target as Node)) libraryActions.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (libraryActions.current) libraryActions.current.open = false;
        setContext(null);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, []);
  const busy = Boolean(manager.progress);
  const allItems = useMemo<ModelInspectorItem[]>(() => getManagedModelPrimaryLocations(manager.catalog).map((location) => ({ location, localMetadata: getModelLocalMetadata(manager.localMetadata, location), usage: manager.usage?.[location.sha256 ? `sha256:${location.sha256.toLowerCase()}` : `location:${location.id}`] })), [manager.catalog, manager.localMetadata, manager.usage]);
  const bases = Array.from(new Set(allItems.map((item) => getEffectiveModelPresentation(item.location, item.localMetadata).baseModel).filter((value): value is string => Boolean(value)))).sort();
  const tags = Array.from(new Set(allItems.flatMap((item) => item.localMetadata?.tags ?? []))).sort();
  const counts = useMemo(() => modelUpdateCounts(manager.catalog, manager.watches, manager.hfWatches), [manager.catalog, manager.watches, manager.hfWatches]);
  const linkedIds = useMemo(() => linkedModelLocationIds(manager.catalog), [manager.catalog]);
  const civitaiIds = useMemo(() => linkedModelLocationIds(manager.catalog, true), [manager.catalog]);
  const newCount = (item: ModelInspectorItem) => counts[item.location.sha256 ? `sha256:${item.location.sha256.toLowerCase()}` : `location:${item.location.id}`] ?? 0;
  const relatedLocations = useMemo(() => {
    const groups = new Map<string, ModelLocation[]>();
    for (const location of manager.catalog.locations) {
      const identity = location.sha256 ? `sha256:${location.sha256.toLowerCase()}` : `location:${location.id}`;
      const entries = groups.get(identity) ?? []; entries.push(location); groups.set(identity, entries);
    }
    return groups;
  }, [manager.catalog]);
  const matchesLocation = (item: ModelInspectorItem, folder: string, type: string) => (relatedLocations.get(item.location.sha256 ? `sha256:${item.location.sha256.toLowerCase()}` : `location:${item.location.id}`) ?? []).some((location) => (folder === 'all' || location.sourceId === folder) && (type === 'all' || location.sourceKind === type));
  const folderItems = allItems.filter((item) => matchesLocation(item, sourceId, 'all') && (view === 'hidden' ? item.localMetadata?.hidden === true : !item.localMetadata?.hidden));
  const updateLocationIds = useMemo(() => {
    const locations = manager.catalog.locations.filter(location => !getModelLocalMetadata(manager.localMetadata, location)?.hidden);
    if (sourceId === 'all' && kind === 'all') return locations.map((location) => location.id);
    const sourceLocationIds = new Set(locations.filter((location) => (sourceId === 'all' || location.sourceId === sourceId) && (kind === 'all' || location.sourceKind === kind)).map((location) => location.id));
    return buildManagedModels(locations)
      .filter((model) => model.locationIds.some((id) => sourceLocationIds.has(id)))
      .flatMap((model) => model.locationIds);
  }, [manager.catalog, manager.localMetadata, sourceId, kind]);
  const categories = (Object.keys(MODEL_KIND_LABELS) as ModelKind[]).map((value) => ({ value, label: value === 'lora' ? 'LoRAs' : modelKindText(value, t), count: folderItems.filter((item) => matchesLocation(item, sourceId, value)).length })).filter((entry) => entry.count > 0).sort((a, b) => a.label.localeCompare(b.label));
  const selectedSource = manager.sources.find((source) => source.id === sourceId);
  useEffect(() => { if (sourceId !== 'all' && !manager.sources.some((source) => source.id === sourceId)) setSourceId('all'); }, [manager.sources, sourceId]);
  const visible = useMemo(() => folderItems.filter((item) => {
    const presentation = getEffectiveModelPresentation(item.location, item.localMetadata);
    return matchesLocation(item, sourceId, kind) && (base === 'all' || presentation.baseModel === base) && (tag === 'all' || item.localMetadata?.tags.includes(tag)) && (view !== 'favorites' || item.localMetadata?.favorite) && (view !== 'new' || newCount(item) > 0) && (!issuesOnly || manager.checkResult?.failedLocationIds.includes(item.location.id)) && modelInspectorSearchText(item).includes(query.trim().toLowerCase());
  }).sort((a, b) => sort === 'usage' ? (b.usage?.totalCount ?? -1) - (a.usage?.totalCount ?? -1) : sort === 'recentUsage' ? (b.usage?.lastUsedAt ?? 0) - (a.usage?.lastUsedAt ?? 0) : sort === 'size' ? b.location.size - a.location.size : sort === 'modified' ? (b.location.modifiedAt ?? 0) - (a.location.modifiedAt ?? 0) : getEffectiveModelPresentation(a.location, a.localMetadata).name.localeCompare(getEffectiveModelPresentation(b.location, b.localMetadata).name)), [allItems, manager.catalog, sourceId, kind, base, tag, view, sort, issuesOnly, manager.checkResult, query, counts]);
  // Retain the selected detail when viewing releases removes its card from the unread filter.
  const selectedLocation = manager.catalog.locations.find((location) => location.id === selectedId);
  const selected = allItems.find((item) => item.location.id === selectedId) ?? (selectedLocation ? { location: selectedLocation, localMetadata: getModelLocalMetadata(manager.localMetadata, selectedLocation), usage: manager.usage?.[selectedLocation.sha256 ? `sha256:${selectedLocation.sha256.toLowerCase()}` : `location:${selectedLocation.id}`] } : undefined);
  useEffect(() => {
    if (!storageOpen && view !== 'hidden' && selected?.localMetadata?.hidden) {
      setSelectedId(null); setRetainedInspectorId(null);
    }
  }, [storageOpen, view, selected?.localMetadata?.hidden]);
  const count = allItems.filter(item => !item.localMetadata?.hidden && newCount(item) > 0).length;
  const catalogFiltered = Boolean(query.trim() || sourceId !== 'all' || kind !== 'all' || base !== 'all' || tag !== 'all' || view !== 'all' || issuesOnly);
  const clearCatalogFilters = () => { setQuery(''); setSourceId('all'); setKind('all'); setBase('all'); setTag('all'); setView('all'); setIssuesOnly(false); };
  const report = (action: Promise<unknown>) => { void action.catch((error) => managerMessage(error.message)); };
  const inspectorItems = storageOpen ? storageItems : visible;
  const selectedOutsideFilters = Boolean(selected && !inspectorItems.some((item) => item.location.id === selected.location.id || storageOpen && areFilesystemPathsEqual(item.location.absolutePath, selected.location.absolutePath)));
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    void inspectorQueue.current(async (current) => {
      const items = retainedInspectorId === selectedId && selected && !inspectorItems.some((item) => item.location.id === selectedId) ? [...inspectorItems, selected] : inspectorItems;
      await api.modelInspectorSyncCollection({ items });
      const inspectorSelectionId = storageOpen && selected ? inspectorItems.find((item) => areFilesystemPathsEqual(item.location.absolutePath, selected.location.absolutePath))?.location.id ?? selectedId : selectedId;
      if (current() && inspectorSelectionId) await api.modelInspectorSyncSelection(inspectorSelectionId);
    }).catch((error: Error) => managerMessage(error.message));
  }, [inspectorItems, selectedId, retainedInspectorId, manager.revision]);
  const select = (id: string, reveal = false) => { setSelectedId(id); setRetainedInspectorId(null); setRevealUpdates((current) => reveal ? current + 1 : 0); setDetailsOpen(true); };
  useEffect(() => {
    if (selectedLocation) { previousSelection.current = selectedLocation; return; }
    const hash = previousSelection.current?.sha256;
    const surviving = hash ? manager.catalog.locations.find((location) => location.sha256?.toLowerCase() === hash.toLowerCase()) : undefined;
    previousSelection.current = surviving ?? null;
    if (surviving) select(surviving.id);
    else if (selectedId) setSelectedId(null);
  }, [manager.catalog, selectedId]);
  const openInspector = (id: string) => {
    const requested = manager.catalog.locations.find((entry) => entry.id === id);
    const represented = requested && inspectorItems.find((entry) => entry.location.id === id || storageOpen && areFilesystemPathsEqual(entry.location.absolutePath, requested.absolutePath));
    const location = represented?.location ?? requested;
    if (!location) { managerMessage('This model file is no longer available. Refresh the file list.'); return; }
    const targetId = location.id;
    const item: ModelInspectorItem = { location, localMetadata: getModelLocalMetadata(manager.localMetadata, location), usage: manager.usage?.[location.sha256 ? `sha256:${location.sha256.toLowerCase()}` : `location:${location.id}`] };
    const items = represented ? inspectorItems : [...inspectorItems, item];
    setSelectedId(targetId); setDetailsOpen(true);
    setRetainedInspectorId(represented ? null : targetId);
    report(inspectorQueue.current(async () => {
      const result = await window.electronAPI!.modelInspectorOpen({ items, selectedId: targetId });
      if (!result.success) throw new Error(result.error || 'Unable to open Model Inspector.');
    }, true));
  };
  const addFolder = async () => {
    const folder = await window.electronAPI?.showDirectoryDialog();
    if (!folder?.success || !folder.path) return;
    if (manager.sources.some((source) => areFilesystemPathsEqual(source.path, folder.path!))) { managerMessage('modelLibrary.sourceExists'); return; }
    const now = Date.now(); setEditingSource(false);
    setPendingSource({ id: crypto.randomUUID(), path: folder.path, name: folder.name || t('modelLibrary.models'), kind: 'auto', recursive: true, identifyOnScan: false, watchUpdates: false, createdAt: now, updatedAt: now });
  };
  const requestCheck = (ids: string[]) => {
    if (ids.some((id) => !linkedIds.has(id))) setPendingCheck({ ids });
    else report(checkModelUpdates(ids));
    setContext(null);
  };
  const confirmCheck = async (identify: boolean) => {
    const request = pendingCheck!; setPendingCheck(null);
    if (identify && !await identifyModels(request.ids.filter((id) => !(request.identifyOnly ? civitaiIds : linkedIds).has(id)))) return;
    if (request.identifyOnly) return;
    // Failed identification stays unlinked and is not retried implicitly by checking.
    const state = getModelManagerState();
    const currentLinked = linkedModelLocationIds(state.catalog);
    const ids = request.ids.filter((id) => currentLinked.has(id));
    if (identify) await checkModelUpdates(request.ids, false, false);
    else if (ids.length) await checkModelUpdates(ids);
  };
  const visibleIds = visible.map((item) => item.location.id);
  const individualMessage = manager.checkResult?.locationIds.length === 1 && manager.message === manager.checkResult.message;

  return <div className="flex h-full min-h-0 bg-gray-950 text-gray-100">
    {sourcesOpen && <aside className="w-48 shrink-0 overflow-auto border-r border-gray-800 bg-gray-900/70 p-3">
      <h2 className="mb-3 text-lg font-semibold">{t('modelLibrary.models')}</h2>
      <select aria-label={t('modelLibrary.modelFolder')} className={modelInput} value={sourceId} onChange={(event) => { setSourceId(event.target.value); setIssuesOnly(false); }}><option value="all">{t('modelLibrary.allFolders')}</option>{manager.sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>
      <button className={`${modelButton} mt-3`} disabled={busy} onClick={() => report(addFolder())}><FolderPlus size={14} className="mr-1 inline" />{t('modelLibrary.addFolder')}</button>
      <nav aria-label={t('modelLibrary.categories')} className="mt-5 space-y-1"><button className={`w-full rounded px-2 py-2 text-left text-sm ${kind === 'all' ? 'bg-cyan-900/40 text-cyan-200 light:bg-accent/10 light:text-gray-50' : 'hover:bg-gray-800'}`} onClick={() => { setKind('all'); }}>{t('modelLibrary.allTypesCount', { count: folderItems.length })}</button>{categories.map((entry) => <button key={entry.value} className={`w-full rounded px-2 py-2 text-left text-sm ${kind === entry.value ? 'bg-cyan-900/40 text-cyan-200 light:bg-accent/10 light:text-gray-50' : 'hover:bg-gray-800'}`} onClick={() => { setKind(entry.value); }}>{entry.label} ({entry.count})</button>)}</nav>
    </aside>}
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-gray-800 p-3">
        <button className={modelButton} aria-label={sourcesOpen ? t('modelLibrary.hideCategories') : t('modelLibrary.showCategories')} title={sourcesOpen ? t('modelLibrary.hideCategories') : t('modelLibrary.showCategories')} onClick={() => setSourcesOpen(!sourcesOpen)}>{sourcesOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button>
        <button className={selectionButton(!storageOpen && !manager.showUpdates)} aria-pressed={!storageOpen && !manager.showUpdates} onClick={() => { setStorageOpen(false); showModelUpdates(false); }}>{t('modelLibrary.catalog')}</button>
        <button className={selectionButton(!storageOpen && Boolean(manager.showUpdates))} aria-pressed={!storageOpen && Boolean(manager.showUpdates)} onClick={() => { setStorageOpen(false); showModelUpdates(true); }}>{t('modelLibrary.whatsNew')}{count > 0 ? ` · ${count}` : ''}</button>
        <button className={selectionButton(storageOpen)} aria-pressed={storageOpen} onClick={() => { setStorageOpen(true); setStorageVisited(true); }}>{t('modelLibrary.storage')}</button>
        <div className="relative ml-auto"><button className={modelButton} aria-label={t('modelLibrary.monitoringSettings')} title={t('modelLibrary.monitoringSettings')} onClick={() => setSettingsOpen(!settingsOpen)}><Settings size={16} /></button>{settingsOpen && <div className="absolute right-0 z-20 mt-2 w-64 space-y-3 rounded-lg border border-gray-700 bg-gray-900 p-4"><h3 className="text-sm font-medium">{t('modelLibrary.automaticMonitoring')}</h3><p className="text-xs text-gray-400">{t('modelLibrary.monitoringHelp')}</p><label className="block text-xs text-gray-400">{t('modelLibrary.checkInterval')}<select className={`${modelInput} mt-2`} value={manager.intervalHours} onChange={(event) => report(setModelInterval(Number(event.target.value)))}><option value={6}>{t('modelLibrary.every6Hours')}</option><option value={24}>{t('modelLibrary.every24Hours')}</option><option value={168}>{t('modelLibrary.every7Days')}</option></select></label><button className={modelButton} onClick={() => setSettingsOpen(false)}>{t('modelLibrary.done')}</button></div>}</div>
        <button className={modelButton} aria-label={detailsOpen ? t('modelLibrary.hideDetails') : t('modelLibrary.showDetails')} title={detailsOpen ? t('modelLibrary.hideDetails') : t('modelLibrary.showDetails')} onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</button>
      </div>
      {!storageOpen && !manager.showUpdates && <div className="space-y-3 border-b border-gray-800 p-3">
        <div className="flex flex-wrap gap-2"><div className="relative min-w-40 flex-1"><Search size={16} className="absolute left-2 top-3 text-gray-500" /><input className={`${modelInput} pl-8`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('modelLibrary.searchModels')} /></div><button className={`${modelButton} ${filtersOpen ? 'border-cyan-500' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)}>{t('promptLibrary.filters')}{base !== 'all' || tag !== 'all' ? ' •' : ''}</button><select aria-label={t('modelLibrary.sortModels')} className={modelButton} value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">{t('modelLibrary.name')}</option><option value="usage">{t('modelLibrary.mostMatches')}</option><option value="recentUsage">{t('modelLibrary.latestMatch')}</option><option value="size">{t('modelLibrary.largest')}</option><option value="modified">{t('modelLibrary.recentModified')}</option></select></div>
        {filtersOpen && <div className="flex flex-wrap gap-3 rounded border border-gray-800 p-3"><label className="text-xs text-gray-400">{t('modelLibrary.baseModel')}<select aria-label={t('modelLibrary.baseModel')} className={`${modelInput} mt-1`} value={base} onChange={(event) => setBase(event.target.value)}><option value="all">{t('modelLibrary.anyBase')}</option>{bases.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs text-gray-400">{t('modelLibrary.tag')}<select aria-label={t('modelLibrary.modelTag')} className={`${modelInput} mt-1`} value={tag} onChange={(event) => setTag(event.target.value)}><option value="all">{t('modelLibrary.anyTag')}</option>{tags.map((value) => <option key={value}>{value}</option>)}</select></label></div>}
        <div className="flex flex-wrap items-center gap-2">{(['all', 'new', 'favorites', 'hidden'] as const).map((value) => <button className={selectionButton(view === value)} aria-pressed={view === value} key={value} onClick={() => { setView(value); setIssuesOnly(false); }}>{value === 'all' ? t('libraryGallery.all') : value === 'new' ? t('modelLibrary.withUpdates') : value === 'hidden' ? t('modelLibrary.hidden') : t('promptLibrary.favorites')}</button>)}{base !== 'all' && <button className={modelButton} onClick={() => setBase('all')}>{base} ×</button>}{tag !== 'all' && <button className={modelButton} onClick={() => setTag('all')}>{tag} ×</button>}{issuesOnly && <button className={modelButton} onClick={() => setIssuesOnly(false)}>{t('modelLibrary.issuesFilter')}</button>}{catalogFiltered && <button className={modelButton} onClick={clearCatalogFilters}>{t('promptLibrary.clearFilters')}</button>}</div>
        <div className="flex items-center gap-2"><button className={`${modelButton} border-cyan-800`} disabled={busy || !visible.length} onClick={() => requestCheck(visibleIds)}>{t('modelLibrary.checkCount', { count: visible.length })}</button><details ref={libraryActions} className="relative"><summary aria-label={t('modelLibrary.libraryActions')} className={`${modelButton} cursor-pointer list-none`}>⋯</summary><div className="absolute left-0 z-20 mt-2 w-64 space-y-1 rounded-lg border border-gray-700 bg-gray-900 p-2"><button className="w-full p-2 text-left text-xs hover:bg-gray-800 disabled:opacity-50" disabled={busy || !visible.some((item) => !civitaiIds.has(item.location.id))} onClick={() => setPendingCheck({ ids: visibleIds, identifyOnly: true })}>{t('modelLibrary.identifyModelsMenu')}</button><button className="w-full p-2 text-left text-xs hover:bg-gray-800" disabled={busy} onClick={() => report(scanModelSources())}>{t('modelLibrary.refreshFiles')}</button>{selectedSource && <button className="w-full p-2 text-left text-xs hover:bg-gray-800" disabled={busy} onClick={() => { setEditingSource(true); setPendingSource({ ...selectedSource }); }}>{t('modelLibrary.configureFolder')}</button>}{selectedSource && <button className="w-full p-2 text-left text-xs text-red-400 hover:bg-gray-800" disabled={busy} onClick={() => { if (window.confirm(t('modelLibrary.removeSourceConfirm', { name: selectedSource.name }))) { report(removeModelSource(selectedSource.id)); setSourceId('all'); setKind('all'); } }}>{t('modelLibrary.removeFolder')}</button>}</div></details></div>
      </div>}
      {busy && <div role="status" className="flex items-center gap-3 border-b border-gray-800 px-4 py-2 text-xs text-gray-400"><span>{manager.progress!.kind === 'updates' ? t('modelLibrary.checkingUpdates') : manager.progress!.kind === 'headers' ? t('modelLibrary.readingInfo') : manager.progress!.kind === 'scan' ? t('modelLibrary.findingFiles') : manager.progress!.kind === 'duplicates' ? t('modelLibrary.verifyingDuplicates') : manager.progress!.kind === 'removal' ? t('modelLibrary.removingFiles') : t('modelLibrary.identifyingModels')} · {manager.progress!.current}/{manager.progress!.total} · {manager.progress!.name}</span>{manager.progress!.kind !== 'removal' && <button className={`${modelButton} ml-auto`} onClick={cancelModelJob}>{t('modelLibrary.stop')}</button>}</div>}
      {manager.message && !individualMessage && <div role="status" className="flex flex-wrap items-center gap-2 border-b border-gray-800 px-4 py-2 text-sm text-gray-300"><span className="flex-1">{translateModelMessage(manager.message, t)}</span>{manager.message === manager.checkResult?.message && manager.checkResult?.failedLocationIds.length ? <button className="text-xs text-cyan-300 light:text-accent" onClick={() => { showModelUpdates(false); setView('all'); setQuery(''); setKind('all'); setBase('all'); setTag('all'); setSourceId('all'); setIssuesOnly(true); }}>{t('modelLibrary.viewIssues')}</button> : null}<button aria-label={t('modelLibrary.dismissMessage')} onClick={() => managerMessage(null)}>×</button></div>}
      {storageVisited && <div className={`min-h-0 flex-1 p-4 ${storageOpen ? '' : 'hidden'}`}><ModelStoragePanel select={select} openInspector={openInspector} active={storageOpen} folder={sourceId} kind={kind} selectedId={selectedId} clearSharedFilters={() => { setSourceId('all'); setKind('all'); }} onCollection={setStorageItems} addFolder={() => report(addFolder())} /></div>}
      <div className={`min-h-0 flex-1 overflow-auto p-4 ${storageOpen ? 'hidden' : ''}`}>{manager.loading ? <p className="text-gray-400">{t('modelLibrary.loadingCatalog')}</p> : manager.showUpdates ? <ModelUpdatesPanel locationIds={updateLocationIds} /> : !manager.sources.length ? <div className="flex h-full flex-col items-center justify-center gap-3 text-center"><FileBox size={40} className="text-gray-500" /><h3 className="font-semibold">{t('modelLibrary.addModelFolder')}</h3><button className={modelButton} onClick={() => report(addFolder())}>{t('modelLibrary.addFolder')}</button></div> : !visible.length ? <div className="space-y-3 text-gray-400"><p>{!allItems.length ? t('modelLibrary.noFilesFound') : view === 'new' ? t('modelLibrary.noUnreadMatches') : t('modelLibrary.noModelsMatch')}</p>{catalogFiltered && <button className={modelButton} onClick={clearCatalogFilters}>{t('promptLibrary.clearFilters')}</button>}{!allItems.length && <button className={modelButton} disabled={busy} onClick={() => report(scanModelSources())}>{t('modelLibrary.refreshFiles')}</button>}</div> : <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">{visible.map((item) => {
        const presentation = getEffectiveModelPresentation(item.location, item.localMetadata); const remote = item.location.civitai && 'versionName' in item.location.civitai ? item.location.civitai : undefined; const updates = newCount(item);
        return <article key={item.location.id} className={`overflow-hidden rounded-lg border bg-gray-900 ${selectedId === item.location.id ? 'border-cyan-500' : 'border-gray-800'}`} onContextMenu={(event) => { event.preventDefault(); setContext({ id: item.location.id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 216)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 176)) }); }}>
          <div className="relative flex h-36 items-center justify-center bg-gray-950"><button className="flex h-full w-full items-center justify-center" aria-label={t('promptLibrary.selectNamed', { title: presentation.name })} onClick={() => select(item.location.id)} onDoubleClick={() => openInspector(item.location.id)}>{presentation.preview ? <img src={presentation.preview} alt="" className="h-full w-full object-cover" /> : <FileBox size={32} className="text-gray-600" />}</button>{remote && !presentation.preview && <button className="absolute bottom-2 rounded bg-gray-900/90 px-3 py-1.5 text-xs text-gray-300 hover:text-white disabled:opacity-50" disabled={busy} onClick={() => report(executeModelCommand({ type: 'cover', locationId: item.location.id }))}>{t('modelLibrary.loadCoverShort')}</button>}<button className="absolute right-2 top-2 rounded bg-gray-950/80 px-2 py-1 text-lg" aria-label={item.localMetadata?.favorite ? t('modelLibrary.removeFavorite') : t('modelLibrary.addFavorite')} aria-pressed={Boolean(item.localMetadata?.favorite)} onClick={() => report(executeModelCommand({ type: 'saveLocal', locationId: item.location.id, patch: { favorite: !item.localMetadata?.favorite } }))}>{item.localMetadata?.favorite ? <span className="text-amber-300 light:text-amber-800">★</span> : <span className="text-gray-400">☆</span>}</button></div>
          <button className="w-full p-3 text-left" onClick={() => select(item.location.id)} onDoubleClick={() => openInspector(item.location.id)}><h3 className="truncate font-medium" title={presentation.name}>{presentation.name}</h3><p className="mt-1 truncate text-xs text-gray-300">{remote?.versionName || t('modelLibrary.localModel')}</p><p className="mt-1 truncate text-xs text-gray-500">{presentation.baseModel || modelKindText(item.location.sourceKind, t)} · {formatBytes(item.location.size)}</p></button>
          <ModelUsagePanel item={item} compact />
          {updates > 0 && <button className="mx-3 mb-3 text-xs text-cyan-300 light:text-accent hover:underline" onClick={() => select(item.location.id, true)}>{t('modelLibrary.newUpdateCount', { count: updates })}</button>}
        </article>;
      })}</div>}</div>
    </section>
    {detailsOpen && <div role="separator" aria-label={t('modelLibrary.resizeDetails')} aria-controls="model-details-sidebar" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={480} aria-valuenow={detailsWidth} tabIndex={0} className="w-1 shrink-0 cursor-col-resize touch-none bg-gray-800 hover:bg-cyan-600 focus-visible:bg-cyan-500" onPointerDown={(event) => { resizeStart.current = { x: event.clientX, width: detailsWidth }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (resizeStart.current) setDetailsWidth(Math.max(320, Math.min(480, resizeStart.current.width + resizeStart.current.x - event.clientX))); }} onPointerUp={() => { resizeStart.current = null; }} onPointerCancel={() => { resizeStart.current = null; }} onLostPointerCapture={() => { resizeStart.current = null; }} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setDetailsWidth((width) => Math.max(320, Math.min(480, width + (event.key === 'ArrowLeft' ? 16 : -16)))); } }} />}
    {detailsOpen && <aside id="model-details-sidebar" style={{ width: detailsWidth }} className="shrink-0 space-y-4 overflow-auto border-l border-gray-800 bg-gray-900/70 p-4">{selected ? <>{selectedOutsideFilters && <p className="text-xs text-amber-300 light:text-amber-800">{t('modelLibrary.outsideFilters')}</p>}<div><h2 className="break-words text-lg font-semibold">{getEffectiveModelPresentation(selected.location, selected.localMetadata).name}</h2><p className="mt-1 text-xs text-gray-400">{modelKindText(selected.location.sourceKind, t)} · {formatBytes(selected.location.size)}</p><p className="mt-1 truncate text-xs text-gray-500" title={selected.location.absolutePath}>{selected.location.absolutePath}</p><button className={`${modelButton} mt-2`} onClick={() => openInspector(selected.location.id)}>{t('modelLibrary.openInspector')}</button></div>{getEffectiveModelPresentation(selected.location, selected.localMetadata).preview && <img src={getEffectiveModelPresentation(selected.location, selected.localMetadata).preview} alt={t('modelLibrary.modelCover')} className="max-h-48 w-full rounded object-contain" />}{selected.location.sourceKind === 'lora' && <section className="space-y-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 light:border-accent/25 light:bg-gray-950"><h3 className="font-medium text-cyan-100 light:text-accent">{t('modelLibrary.triggers')}</h3>{getEffectiveModelPresentation(selected.location, selected.localMetadata).triggerWords.length ? <div className="flex flex-wrap gap-2">{getEffectiveModelPresentation(selected.location, selected.localMetadata).triggerWords.map((word) => <button type="button" key={word} title={t('modelLibrary.copyTrigger')} className="rounded-full border border-cyan-500/25 bg-gray-950 px-2.5 py-1 text-xs text-cyan-100 light:text-accent hover:border-cyan-400/60 light:border-accent/25 light:hover:border-accent/60" onClick={() => report(window.electronAPI!.copyTextToClipboard(word).then((result) => { if (!result.success) throw new Error(result.error || t('modelLibrary.copyTriggerFailed')); }))}>{word}</button>)}</div> : <p className="text-xs text-gray-500">{t('modelLibrary.noTriggers')}</p>}</section>}<ModelDetailsPanels item={selected} revealUpdates={revealUpdates} /></> : <p className="text-sm text-gray-400">{t('modelLibrary.selectDetails')}</p>}</aside>}
    {context && createPortal(<div className="fixed inset-0 z-[100]" onClick={() => setContext(null)} onContextMenu={(event) => { event.preventDefault(); setContext(null); }}><div className="absolute w-52 rounded-lg border border-gray-700 bg-gray-900 p-2 shadow-xl" style={{ left: context.x, top: context.y }}><button className="w-full p-2 text-left text-xs hover:bg-gray-800" onClick={() => openInspector(context.id)}>{t('modelLibrary.openInspector')}</button><button className="w-full p-2 text-left text-xs hover:bg-gray-800 disabled:opacity-50" disabled={busy} onClick={() => requestCheck([context.id])}>{t('modelLibrary.checkUpdates')}</button><button className="w-full p-2 text-left text-xs hover:bg-gray-800" onClick={() => { const item = allItems.find((entry) => entry.location.id === context.id); if (item) report(executeModelCommand({ type: 'saveLocal', locationId: context.id, patch: { hidden: !item.localMetadata?.hidden } })); setContext(null); }}>{allItems.find((item) => item.location.id === context.id)?.localMetadata?.hidden ? t('modelLibrary.unhide') : t('modelLibrary.hide')}</button><button className="w-full p-2 text-left text-xs text-red-300 hover:bg-gray-800 disabled:opacity-50 light:text-red-800 light:disabled:opacity-100 light:disabled:text-gray-500" disabled={busy} onClick={() => report(executeModelCommand({ type: 'remove', locationId: context.id }))}>{t('modelLibrary.removeFiles')}</button></div></div>, document.body)}
    {pendingCheck && <div role="dialog" aria-modal="true" aria-label={t('modelLibrary.identifyBeforeCheck')} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-5"><section className="w-full max-w-md space-y-4 rounded-xl border border-gray-700 bg-gray-950 p-6"><h2 className="text-lg font-semibold">{t('modelLibrary.needIdentification', { count: pendingCheck.ids.filter(id => !(pendingCheck.identifyOnly ? civitaiIds : linkedIds).has(id)).length })}</h2><p className="text-sm text-gray-400">{t('modelLibrary.identifyHashHelp')}</p><div className="flex flex-wrap gap-2"><button className={modelButton} disabled={busy} onClick={() => report(confirmCheck(true))}>{pendingCheck.identifyOnly ? t('modelLibrary.identifyModels') : t('modelLibrary.identifyAndCheck')}</button>{!pendingCheck.identifyOnly && pendingCheck.ids.some((id) => linkedIds.has(id)) && <button className={modelButton} disabled={busy} onClick={() => report(confirmCheck(false))}>{t('modelLibrary.checkIdentified')}</button>}<button className={modelButton} onClick={() => setPendingCheck(null)}>{t('modelLibrary.cancel')}</button></div></section></div>}
    {pendingSource && <div role="dialog" aria-modal="true" aria-label={t('modelLibrary.configureModelFolder')} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-5"><form className="w-full max-w-lg space-y-4 rounded-xl border border-gray-700 bg-gray-950 p-6" onSubmit={(event) => { event.preventDefault(); setSavingSource(true); const source = pendingSource; void (editingSource ? updateModelSource(source).then(() => { setPendingSource(null); return scanModelSources(); }) : addModelSource(source, () => setPendingSource(null))).then(() => setPendingSource(null)).catch((error) => managerMessage(error.message)).finally(() => setSavingSource(false)); }}><h2 className="text-lg font-semibold">{editingSource ? t('modelLibrary.configureFolder') : t('modelLibrary.newModelFolder')}</h2><p className="break-all text-xs text-gray-400">{pendingSource.path}</p><label className="block text-sm">{t('modelLibrary.name')}<input className={modelInput} value={pendingSource.name} onChange={(event) => setPendingSource({ ...pendingSource, name: event.target.value })} /></label><label className="block text-sm">{t('promptLibrary.type')}<select className={modelInput} value={pendingSource.kind} onChange={(event) => setPendingSource({ ...pendingSource, kind: event.target.value as ModelSource['kind'] })}><option value="auto">{t('modelLibrary.kindAuto')}</option>{Object.keys(MODEL_KIND_LABELS).map(value => <option key={value} value={value}>{modelKindText(value as ModelKind, t)}</option>)}</select></label>{pendingSource.kind === 'auto' && <p className="text-xs leading-relaxed text-gray-400">{t('modelLibrary.recognizeTypesHelp', { folders: 'loras, checkpoints, unet, diffusion_models, vae, text_encoders, clip, clip_vision, controlnet, upscale_models and embeddings' })}</p>}<label className="block text-sm"><input type="checkbox" checked={pendingSource.recursive} onChange={(event) => setPendingSource({ ...pendingSource, recursive: event.target.checked })} /> {t('modelLibrary.includeSubfolders')}</label><label className="block text-sm"><input type="checkbox" checked={pendingSource.identifyOnScan ?? false} onChange={(event) => setPendingSource({ ...pendingSource, identifyOnScan: event.target.checked })} /> {t('modelLibrary.identifyOnCivitai')}</label><label className="block text-sm"><input type="checkbox" checked={pendingSource.watchUpdates ?? false} onChange={(event) => setPendingSource({ ...pendingSource, watchUpdates: event.target.checked })} /> {t('modelLibrary.notifyVersions')}</label><p className="text-xs leading-relaxed text-gray-400">{t('modelLibrary.sourcePrivacyHelp')}</p><div className="flex gap-2"><button className={modelButton} disabled={savingSource}>{t('modelLibrary.saveFolder')}</button><button type="button" className={modelButton} disabled={savingSource} onClick={() => setPendingSource(null)}>{t('modelLibrary.cancel')}</button>{savingSource && busy && <button type="button" className={modelButton} onClick={cancelModelJob}>{t('modelLibrary.stopJob')}</button>}</div></form></div>}
  </div>;
}
