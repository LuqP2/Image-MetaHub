import { useTranslation } from '../i18n/useTranslation';
import { modelKindText, translateModelMessage } from '../i18n/modelMessages';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ModelUsagePanel from './ModelUsagePanel';
import ModelStoragePanel from './ModelStoragePanel';
import { FileBox, FolderPlus, MoreHorizontal, Search, Settings, Star, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
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
const modelSelect = 'ui-select w-full';
const selectionButton = (active: boolean) => `ui-segmented-item ${active ? 'ui-segmented-item-active' : ''}`;

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
    {sourcesOpen && <aside className="flex w-52 shrink-0 flex-col overflow-auto border-r border-gray-700/50 bg-gray-900/90 p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('modelLibrary.models')}</h2>
        <button className="ui-icon-btn h-7 w-7" disabled={busy} title={t('modelLibrary.addFolder')} aria-label={t('modelLibrary.addFolder')} onClick={() => report(addFolder())}><FolderPlus size={14} /></button>
      </div>
      <select aria-label={t('modelLibrary.modelFolder')} className={modelSelect} value={sourceId} onChange={(event) => { setSourceId(event.target.value); setIssuesOnly(false); }}><option value="all">{t('modelLibrary.allFolders')}</option>{manager.sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>
      <nav aria-label={t('modelLibrary.categories')} className="mt-3 space-y-0.5"><button className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${kind === 'all' ? 'bg-accent/15 text-accent' : 'text-gray-300 hover:bg-gray-800/80 hover:text-gray-100'}`} onClick={() => { setKind('all'); }}><span>{t('modelLibrary.allTypesCount', { count: folderItems.length })}</span></button>{categories.map((entry) => <button key={entry.value} className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${kind === entry.value ? 'bg-accent/15 font-medium text-accent' : 'text-gray-300 hover:bg-gray-800/80 hover:text-gray-100'}`} onClick={() => { setKind(entry.value); }}><span className="truncate">{entry.label}</span><span className="shrink-0 tabular-nums text-[11px] opacity-70">{entry.count}</span></button>)}</nav>
    </aside>}
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-700/50 bg-gray-900/60 px-3 py-2">
        <button className="ui-icon-btn" aria-label={sourcesOpen ? t('modelLibrary.hideCategories') : t('modelLibrary.showCategories')} title={sourcesOpen ? t('modelLibrary.hideCategories') : t('modelLibrary.showCategories')} onClick={() => setSourcesOpen(!sourcesOpen)}>{sourcesOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button>
        <div className="ui-segmented">
          <button className={selectionButton(!storageOpen && !manager.showUpdates)} aria-pressed={!storageOpen && !manager.showUpdates} onClick={() => { setStorageOpen(false); showModelUpdates(false); }}>{t('modelLibrary.catalog')}</button>
          <button className={selectionButton(!storageOpen && Boolean(manager.showUpdates))} aria-pressed={!storageOpen && Boolean(manager.showUpdates)} onClick={() => { setStorageOpen(false); showModelUpdates(true); }}>{t('modelLibrary.whatsNew')}{count > 0 ? ` · ${count}` : ''}</button>
          <button className={selectionButton(storageOpen)} aria-pressed={storageOpen} onClick={() => { setStorageOpen(true); setStorageVisited(true); }}>{t('modelLibrary.storage')}</button>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {!storageOpen && !manager.showUpdates && <>
            <button className="ui-btn" disabled={busy || !visible.length} onClick={() => requestCheck(visibleIds)}>{t('modelLibrary.checkCount', { count: visible.length })}</button>
            <details ref={libraryActions} className="relative"><summary aria-label={t('modelLibrary.libraryActions')} className="ui-icon-btn cursor-pointer list-none"><MoreHorizontal size={15} /></summary><div className="ui-menu absolute right-0 z-20 mt-1.5 w-56 space-y-0.5"><button className="ui-menu-item" disabled={busy || !visible.some((item) => !civitaiIds.has(item.location.id))} onClick={() => setPendingCheck({ ids: visibleIds, identifyOnly: true })}>{t('modelLibrary.identifyModelsMenu')}</button><button className="ui-menu-item" disabled={busy} onClick={() => report(scanModelSources())}>{t('modelLibrary.refreshFiles')}</button>{selectedSource && <button className="ui-menu-item" disabled={busy} onClick={() => { setEditingSource(true); setPendingSource({ ...selectedSource }); }}>{t('modelLibrary.configureFolder')}</button>}{selectedSource && <button className="ui-menu-item text-red-400 hover:bg-red-500/10 hover:text-red-300" disabled={busy} onClick={() => { if (window.confirm(t('modelLibrary.removeSourceConfirm', { name: selectedSource.name }))) { report(removeModelSource(selectedSource.id)); setSourceId('all'); setKind('all'); } }}>{t('modelLibrary.removeFolder')}</button>}</div></details>
          </>}
          <div className="relative"><button className="ui-icon-btn" aria-label={t('modelLibrary.monitoringSettings')} title={t('modelLibrary.monitoringSettings')} onClick={() => setSettingsOpen(!settingsOpen)}><Settings size={15} /></button>{settingsOpen && <div className="ui-dialog absolute right-0 z-20 mt-1.5 w-64 space-y-3 p-4"><h3 className="text-xs font-semibold text-gray-100">{t('modelLibrary.automaticMonitoring')}</h3><p className="text-xs text-gray-400">{t('modelLibrary.monitoringHelp')}</p><label className="block text-xs text-gray-400">{t('modelLibrary.checkInterval')}<select className={`${modelSelect} mt-1.5`} value={manager.intervalHours} onChange={(event) => report(setModelInterval(Number(event.target.value)))}><option value={6}>{t('modelLibrary.every6Hours')}</option><option value={24}>{t('modelLibrary.every24Hours')}</option><option value={168}>{t('modelLibrary.every7Days')}</option></select></label><button className={modelButton} onClick={() => setSettingsOpen(false)}>{t('modelLibrary.done')}</button></div>}</div>
          <button className="ui-icon-btn" aria-label={detailsOpen ? t('modelLibrary.hideDetails') : t('modelLibrary.showDetails')} title={detailsOpen ? t('modelLibrary.hideDetails') : t('modelLibrary.showDetails')} onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}</button>
        </div>
      </div>
      {!storageOpen && !manager.showUpdates && <div className="space-y-2 border-b border-gray-700/50 bg-gray-900/35 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-44 flex-1"><Search size={14} className="pointer-events-none absolute left-2.5 top-2 text-gray-500" /><input className={`${modelInput} pl-8`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('modelLibrary.searchModels')} /></div>
          <div className="ui-segmented">{(['all', 'new', 'favorites', 'hidden'] as const).map((value) => <button className={selectionButton(view === value)} aria-pressed={view === value} key={value} onClick={() => { setView(value); setIssuesOnly(false); }}>{value === 'all' ? t('libraryGallery.all') : value === 'new' ? t('modelLibrary.withUpdates') : value === 'hidden' ? t('modelLibrary.hidden') : t('promptLibrary.favorites')}</button>)}</div>
          <button className={`ui-btn ${filtersOpen ? 'border-accent/60 bg-accent/15 text-accent' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)}>{t('promptLibrary.filters')}{base !== 'all' || tag !== 'all' ? ' •' : ''}</button>
          <select aria-label={t('modelLibrary.sortModels')} className="ui-select" value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">{t('modelLibrary.name')}</option><option value="usage">{t('modelLibrary.mostMatches')}</option><option value="recentUsage">{t('modelLibrary.latestMatch')}</option><option value="size">{t('modelLibrary.largest')}</option><option value="modified">{t('modelLibrary.recentModified')}</option></select>
          {base !== 'all' && <button className="ui-btn-sm" onClick={() => setBase('all')}>{base} ×</button>}
          {tag !== 'all' && <button className="ui-btn-sm" onClick={() => setTag('all')}>{tag} ×</button>}
          {issuesOnly && <button className="ui-btn-sm" onClick={() => setIssuesOnly(false)}>{t('modelLibrary.issuesFilter')}</button>}
          {catalogFiltered && <button className="ui-btn-ghost h-7 px-2 text-xs text-gray-400" onClick={clearCatalogFilters}>{t('promptLibrary.clearFilters')}</button>}
        </div>
        {filtersOpen && <div className="flex flex-wrap gap-3 rounded-md border border-gray-700/50 bg-gray-900/70 p-2.5"><label className="text-xs text-gray-400">{t('modelLibrary.baseModel')}<select aria-label={t('modelLibrary.baseModel')} className={`${modelSelect} mt-1`} value={base} onChange={(event) => setBase(event.target.value)}><option value="all">{t('modelLibrary.anyBase')}</option>{bases.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs text-gray-400">{t('modelLibrary.tag')}<select aria-label={t('modelLibrary.modelTag')} className={`${modelSelect} mt-1`} value={tag} onChange={(event) => setTag(event.target.value)}><option value="all">{t('modelLibrary.anyTag')}</option>{tags.map((value) => <option key={value}>{value}</option>)}</select></label></div>}
      </div>}
      {busy && <div role="status" className="flex items-center gap-3 border-b border-gray-700/50 bg-gray-900/60 px-4 py-2 text-xs text-gray-400"><span>{manager.progress!.kind === 'updates' ? t('modelLibrary.checkingUpdates') : manager.progress!.kind === 'headers' ? t('modelLibrary.readingInfo') : manager.progress!.kind === 'scan' ? t('modelLibrary.findingFiles') : manager.progress!.kind === 'duplicates' ? t('modelLibrary.verifyingDuplicates') : manager.progress!.kind === 'removal' ? t('modelLibrary.removingFiles') : t('modelLibrary.identifyingModels')} · {manager.progress!.current}/{manager.progress!.total} · {manager.progress!.name}</span>{manager.progress!.kind !== 'removal' && <button className={`${modelButton} ml-auto`} onClick={cancelModelJob}>{t('modelLibrary.stop')}</button>}</div>}
      {manager.message && !individualMessage && <div role="status" className="flex flex-wrap items-center gap-2 border-b border-gray-700/50 bg-gray-900/50 px-4 py-2 text-xs text-gray-300"><span className="flex-1">{translateModelMessage(manager.message, t)}</span>{manager.message === manager.checkResult?.message && manager.checkResult?.failedLocationIds.length ? <button className="text-xs font-medium text-accent hover:underline" onClick={() => { showModelUpdates(false); setView('all'); setQuery(''); setKind('all'); setBase('all'); setTag('all'); setSourceId('all'); setIssuesOnly(true); }}>{t('modelLibrary.viewIssues')}</button> : null}<button className="ui-icon-btn h-6 w-6" aria-label={t('modelLibrary.dismissMessage')} onClick={() => managerMessage(null)}>×</button></div>}
      {storageVisited && <div className={`min-h-0 flex-1 p-4 ${storageOpen ? '' : 'hidden'}`}><ModelStoragePanel select={select} openInspector={openInspector} active={storageOpen} folder={sourceId} kind={kind} selectedId={selectedId} clearSharedFilters={() => { setSourceId('all'); setKind('all'); }} onCollection={setStorageItems} addFolder={() => report(addFolder())} /></div>}
      <div className={`min-h-0 flex-1 overflow-auto p-4 ${storageOpen ? 'hidden' : ''}`}>{manager.loading ? <p className="text-xs text-gray-400">{t('modelLibrary.loadingCatalog')}</p> : manager.showUpdates ? <ModelUpdatesPanel locationIds={updateLocationIds} /> : !manager.sources.length ? <div className="flex h-full flex-col items-center justify-center gap-3 text-center"><FileBox size={36} className="text-gray-500" /><h3 className="text-sm font-semibold">{t('modelLibrary.addModelFolder')}</h3><button className="ui-btn-primary" onClick={() => report(addFolder())}>{t('modelLibrary.addFolder')}</button></div> : !visible.length ? <div className="space-y-3 text-xs text-gray-400"><p>{!allItems.length ? t('modelLibrary.noFilesFound') : view === 'new' ? t('modelLibrary.noUnreadMatches') : t('modelLibrary.noModelsMatch')}</p>{catalogFiltered && <button className={modelButton} onClick={clearCatalogFilters}>{t('promptLibrary.clearFilters')}</button>}{!allItems.length && <button className={modelButton} disabled={busy} onClick={() => report(scanModelSources())}>{t('modelLibrary.refreshFiles')}</button>}</div> : <div className="grid grid-cols-[repeat(auto-fill,minmax(204px,1fr))] gap-3">{visible.map((item) => {
        const presentation = getEffectiveModelPresentation(item.location, item.localMetadata); const remote = item.location.civitai && 'versionName' in item.location.civitai ? item.location.civitai : undefined; const updates = newCount(item);
        return <article key={item.location.id} className={`group overflow-hidden rounded-lg border bg-gray-900/90 transition-colors ${selectedId === item.location.id ? 'border-accent ring-1 ring-accent/35' : 'border-gray-700/50 hover:border-gray-600/80'}`} onContextMenu={(event) => { event.preventDefault(); setContext({ id: item.location.id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 216)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 176)) }); }}>
          <div className="relative flex h-36 items-center justify-center bg-gray-950"><button className="flex h-full w-full items-center justify-center" aria-label={t('promptLibrary.selectNamed', { title: presentation.name })} onClick={() => select(item.location.id)} onDoubleClick={() => openInspector(item.location.id)}>{presentation.preview ? <img src={presentation.preview} alt="" className="h-full w-full object-cover" /> : <FileBox size={28} className="text-gray-600" />}</button>{remote && !presentation.preview && <button className="ui-btn-sm absolute bottom-2 bg-gray-900/90 backdrop-blur-sm" disabled={busy} onClick={() => report(executeModelCommand({ type: 'cover', locationId: item.location.id }))}>{t('modelLibrary.loadCoverShort')}</button>}<button className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-gray-950/75 text-gray-400 backdrop-blur-sm transition-colors hover:bg-gray-900 hover:text-gray-100" aria-label={item.localMetadata?.favorite ? t('modelLibrary.removeFavorite') : t('modelLibrary.addFavorite')} aria-pressed={Boolean(item.localMetadata?.favorite)} onClick={() => report(executeModelCommand({ type: 'saveLocal', locationId: item.location.id, patch: { favorite: !item.localMetadata?.favorite } }))}><Star size={14} className={item.localMetadata?.favorite ? 'fill-amber-400 text-amber-400' : 'text-gray-400'} /></button></div>
          <button className="w-full px-3 pb-2 pt-2.5 text-left" onClick={() => select(item.location.id)} onDoubleClick={() => openInspector(item.location.id)}><h3 className="truncate text-xs font-semibold text-gray-100" title={presentation.name}>{presentation.name}</h3><p className="mt-0.5 truncate text-[11px] text-gray-400">{remote?.versionName || t('modelLibrary.localModel')}</p><p className="mt-0.5 truncate text-[11px] text-gray-500">{presentation.baseModel || modelKindText(item.location.sourceKind, t)} · {formatBytes(item.location.size)}</p></button>
          <ModelUsagePanel item={item} compact />
          {updates > 0 && <button className="mx-3 mb-2.5 text-[11px] font-medium text-accent hover:underline" onClick={() => select(item.location.id, true)}>{t('modelLibrary.newUpdateCount', { count: updates })}</button>}
        </article>;
      })}</div>}</div>
    </section>
    {detailsOpen && <div role="separator" aria-label={t('modelLibrary.resizeDetails')} aria-controls="model-details-sidebar" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={480} aria-valuenow={detailsWidth} tabIndex={0} className="w-1 shrink-0 cursor-col-resize touch-none bg-gray-700/40 transition-colors hover:bg-accent/60 focus-visible:bg-accent" onPointerDown={(event) => { resizeStart.current = { x: event.clientX, width: detailsWidth }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (resizeStart.current) setDetailsWidth(Math.max(320, Math.min(480, resizeStart.current.width + resizeStart.current.x - event.clientX))); }} onPointerUp={() => { resizeStart.current = null; }} onPointerCancel={() => { resizeStart.current = null; }} onLostPointerCapture={() => { resizeStart.current = null; }} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setDetailsWidth((width) => Math.max(320, Math.min(480, width + (event.key === 'ArrowLeft' ? 16 : -16)))); } }} />}
    {detailsOpen && <aside id="model-details-sidebar" style={{ width: detailsWidth }} className="shrink-0 space-y-4 overflow-auto border-l border-gray-700/50 bg-gray-900/90 p-4">{selected ? <>{selectedOutsideFilters && <p className="text-xs text-amber-300 light:text-amber-800">{t('modelLibrary.outsideFilters')}</p>}<div><h2 className="break-words text-sm font-semibold text-gray-100">{getEffectiveModelPresentation(selected.location, selected.localMetadata).name}</h2><p className="mt-1 text-xs text-gray-400">{modelKindText(selected.location.sourceKind, t)} · {formatBytes(selected.location.size)}</p><p className="mt-1 truncate text-xs text-gray-500" title={selected.location.absolutePath}>{selected.location.absolutePath}</p><button className={`${modelButton} mt-2.5`} onClick={() => openInspector(selected.location.id)}>{t('modelLibrary.openInspector')}</button></div>{getEffectiveModelPresentation(selected.location, selected.localMetadata).preview && <img src={getEffectiveModelPresentation(selected.location, selected.localMetadata).preview} alt={t('modelLibrary.modelCover')} className="max-h-48 w-full rounded-md border border-gray-700/40 bg-gray-950 object-contain" />}{selected.location.sourceKind === 'lora' && <section className="space-y-2 rounded-lg border border-accent/25 bg-accent/5 p-3"><h3 className="text-xs font-semibold text-accent">{t('modelLibrary.triggers')}</h3>{getEffectiveModelPresentation(selected.location, selected.localMetadata).triggerWords.length ? <div className="flex flex-wrap gap-1.5">{getEffectiveModelPresentation(selected.location, selected.localMetadata).triggerWords.map((word) => <button type="button" key={word} title={t('modelLibrary.copyTrigger')} className="rounded-md border border-accent/30 bg-gray-950/80 px-2 py-0.5 text-xs text-gray-100 transition-colors hover:border-accent/70 hover:text-accent" onClick={() => report(window.electronAPI!.copyTextToClipboard(word).then((result) => { if (!result.success) throw new Error(result.error || t('modelLibrary.copyTriggerFailed')); }))}>{word}</button>)}</div> : <p className="text-xs text-gray-500">{t('modelLibrary.noTriggers')}</p>}</section>}<ModelDetailsPanels item={selected} revealUpdates={revealUpdates} /></> : <p className="text-xs text-gray-500">{t('modelLibrary.selectDetails')}</p>}</aside>}
    {context && createPortal(<div className="fixed inset-0 z-[100]" onClick={() => setContext(null)} onContextMenu={(event) => { event.preventDefault(); setContext(null); }}><div className="ui-menu absolute w-52 space-y-0.5" style={{ left: context.x, top: context.y }}><button className="ui-menu-item" onClick={() => openInspector(context.id)}>{t('modelLibrary.openInspector')}</button><button className="ui-menu-item" disabled={busy} onClick={() => requestCheck([context.id])}>{t('modelLibrary.checkUpdates')}</button><button className="ui-menu-item" onClick={() => { const item = allItems.find((entry) => entry.location.id === context.id); if (item) report(executeModelCommand({ type: 'saveLocal', locationId: context.id, patch: { hidden: !item.localMetadata?.hidden } })); setContext(null); }}>{allItems.find((item) => item.location.id === context.id)?.localMetadata?.hidden ? t('modelLibrary.unhide') : t('modelLibrary.hide')}</button><button className="ui-menu-item text-red-400 hover:bg-red-500/10 hover:text-red-300" disabled={busy} onClick={() => report(executeModelCommand({ type: 'remove', locationId: context.id }))}>{t('modelLibrary.removeFiles')}</button></div></div>, document.body)}
    {pendingCheck && <div role="dialog" aria-modal="true" aria-label={t('modelLibrary.identifyBeforeCheck')} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"><section className="ui-dialog w-full max-w-md space-y-4 p-5"><h2 className="text-sm font-semibold">{t('modelLibrary.needIdentification', { count: pendingCheck.ids.filter(id => !(pendingCheck.identifyOnly ? civitaiIds : linkedIds).has(id)).length })}</h2><p className="text-xs leading-relaxed text-gray-400">{t('modelLibrary.identifyHashHelp')}</p><div className="flex flex-wrap justify-end gap-2"><button className="ui-btn-ghost" onClick={() => setPendingCheck(null)}>{t('modelLibrary.cancel')}</button>{!pendingCheck.identifyOnly && pendingCheck.ids.some((id) => linkedIds.has(id)) && <button className={modelButton} disabled={busy} onClick={() => report(confirmCheck(false))}>{t('modelLibrary.checkIdentified')}</button>}<button className="ui-btn-primary" disabled={busy} onClick={() => report(confirmCheck(true))}>{pendingCheck.identifyOnly ? t('modelLibrary.identifyModels') : t('modelLibrary.identifyAndCheck')}</button></div></section></div>}
    {pendingSource && <div role="dialog" aria-modal="true" aria-label={t('modelLibrary.configureModelFolder')} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"><form className="ui-dialog w-full max-w-lg space-y-4 p-5" onSubmit={(event) => { event.preventDefault(); setSavingSource(true); const source = pendingSource; void (editingSource ? updateModelSource(source).then(() => { setPendingSource(null); return scanModelSources(); }) : addModelSource(source, () => setPendingSource(null))).then(() => setPendingSource(null)).catch((error) => managerMessage(error.message)).finally(() => setSavingSource(false)); }}><h2 className="text-sm font-semibold">{editingSource ? t('modelLibrary.configureFolder') : t('modelLibrary.newModelFolder')}</h2><p className="break-all text-xs text-gray-400">{pendingSource.path}</p><label className="block space-y-1 text-xs text-gray-300"><span>{t('modelLibrary.name')}</span><input className={modelInput} value={pendingSource.name} onChange={(event) => setPendingSource({ ...pendingSource, name: event.target.value })} /></label><label className="block space-y-1 text-xs text-gray-300"><span>{t('promptLibrary.type')}</span><select className={modelSelect} value={pendingSource.kind} onChange={(event) => setPendingSource({ ...pendingSource, kind: event.target.value as ModelSource['kind'] })}><option value="auto">{t('modelLibrary.kindAuto')}</option>{Object.keys(MODEL_KIND_LABELS).map(value => <option key={value} value={value}>{modelKindText(value as ModelKind, t)}</option>)}</select></label>{pendingSource.kind === 'auto' && <p className="text-xs leading-relaxed text-gray-400">{t('modelLibrary.recognizeTypesHelp', { folders: 'loras, checkpoints, unet, diffusion_models, vae, text_encoders, clip, clip_vision, controlnet, upscale_models and embeddings' })}</p>}<div className="space-y-2"><label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300"><input type="checkbox" className="ui-checkbox" checked={pendingSource.recursive} onChange={(event) => setPendingSource({ ...pendingSource, recursive: event.target.checked })} /> {t('modelLibrary.includeSubfolders')}</label><label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300"><input type="checkbox" className="ui-checkbox" checked={pendingSource.identifyOnScan ?? false} onChange={(event) => setPendingSource({ ...pendingSource, identifyOnScan: event.target.checked })} /> {t('modelLibrary.identifyOnCivitai')}</label><label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300"><input type="checkbox" className="ui-checkbox" checked={pendingSource.watchUpdates ?? false} onChange={(event) => setPendingSource({ ...pendingSource, watchUpdates: event.target.checked })} /> {t('modelLibrary.notifyVersions')}</label></div><p className="text-xs leading-relaxed text-gray-500">{t('modelLibrary.sourcePrivacyHelp')}</p><div className="flex justify-end gap-2">{savingSource && busy && <button type="button" className="ui-btn-danger mr-auto" onClick={cancelModelJob}>{t('modelLibrary.stopJob')}</button>}<button type="button" className="ui-btn-ghost" disabled={savingSource} onClick={() => setPendingSource(null)}>{t('modelLibrary.cancel')}</button><button className="ui-btn-primary" disabled={savingSource}>{t('modelLibrary.saveFolder')}</button></div></form></div>}
  </div>;
}
