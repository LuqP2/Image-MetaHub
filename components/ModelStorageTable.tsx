import { useTranslation } from '../i18n/useTranslation';
import { modelKindText, translateModelMessage } from '../i18n/modelMessages';
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { managerMessage, refreshModelStorage, requestModelRemoval, scanModelSources, useModelManager, verifyModelDuplicates } from '../services/modelLibrary/manager';
import { formatModelBytes, storageSummary } from '../services/modelLibrary/storage';
import { buildStorageRows, filterStorageRows, nextStorageSort, selectStorageRange, sortStorageRows, storageWindow, STORAGE_HEADER_HEIGHT, STORAGE_ROW_HEIGHT } from '../services/modelLibrary/storageView';
import type { StorageRow, StorageSort, StorageSortColumn } from '../services/modelLibrary/storageView';
import type { ModelInspectorItem, ModelKind } from '../services/modelLibrary/types';
import { modelButton, modelInput } from './ModelManagerPanels';

interface Props {
  select: (id: string) => void;
  openInspector: (id: string) => void;
  active: boolean;
  folder: string;
  kind: ModelKind | 'all';
  selectedId: string | null;
  clearSharedFilters: () => void;
  onCollection: (items: ModelInspectorItem[]) => void;
  addFolder: () => void;
}
const interactive = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('button,input,select,textarea,a,[contenteditable="true"]'));

export default function ModelStorageTable({ select, openInspector, active, folder, kind, selectedId, clearSharedFilters, onCollection, addFolder }: Props) {
  const { t, language } = useTranslation();
  const columns: { key: StorageSortColumn; label: string }[] = [
  { key: 'name', label: t('modelLibrary.model') }, { key: 'type', label: t('promptLibrary.type') }, { key: 'path', label: t('modelLibrary.location') },
  { key: 'size', label: t('modelLibrary.size') }, { key: 'usage', label: t('modelLibrary.libraryUsage') }, { key: 'latest', label: t('modelLibrary.latestMatch') }, { key: 'copies', label: t('modelLibrary.copies') },
];
  const manager = useModelManager();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StorageSort>({ column: 'size', direction: 'desc' });
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(480);
  const [context, setContext] = useState<{ row: StorageRow; x: number; y: number } | null>(null);
  const tableScroll = useRef<HTMLDivElement>(null);
  const headerCheck = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const pendingFocus = useRef<string | null>(null);
  const instructions = useId();
  const files = manager.storage?.files ?? [];
  const busy = Boolean(manager.progress) || checking;
  const rows = useMemo(() => buildStorageRows(manager, folder, kind), [manager.storage, manager.catalog, manager.localMetadata, manager.usage, folder, kind]);
  const visible = useMemo(() => sortStorageRows(filterStorageRows(rows, { folder, kind, query, filter }), sort), [rows, folder, kind, query, filter, sort]);
  const collection = useMemo(() => visible.map((row) => row.item), [visible]);
  useEffect(() => { onCollection(collection); }, [collection, onCollection]);
  const summary = useMemo(() => storageSummary(files), [manager.storage]);
  const inventoryKey = manager.catalog.locations.map(({ id, size, modifiedAt }) => `${id}:${size}:${modifiedAt}`).join('|');
  useEffect(() => {
    if (!active || manager.loading || manager.progress) { setChecking(false); return; }
    let current = true;
    setChecking(true); setError('');
    void refreshModelStorage().catch((failure: Error) => { if (current) setError(failure.message); }).finally(() => { if (current) setChecking(false); });
    return () => { current = false; };
  }, [inventoryKey, active, manager.loading, Boolean(manager.progress)]);
  useEffect(() => {
    const eligible = new Set(rows.filter((row) => row.eligible).map((row) => row.file.key));
    setSelection((prior) => [...prior].every((key) => eligible.has(key)) ? prior : new Set([...prior].filter((key) => eligible.has(key))));
  }, [rows]);
  useEffect(() => { setScrollTop(0); if (tableScroll.current) tableScroll.current.scrollTop = 0; }, [filter, folder, kind, query, sort, density]);
  useLayoutEffect(() => {
    const element = tableScroll.current;
    if (!element || !active) return;
    const measure = () => { if (element.clientHeight > 0) setViewport(element.clientHeight); };
    measure();
    element.scrollTop = scrollTop;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  const rowHeight = STORAGE_ROW_HEIGHT[density];
  const renderWindow = storageWindow(visible.length, scrollTop, viewport, rowHeight);
  useLayoutEffect(() => {
    if (scrollTop !== renderWindow.top) { setScrollTop(renderWindow.top); if (tableScroll.current) tableScroll.current.scrollTop = renderWindow.top; }
  }, [renderWindow.top, scrollTop]);
  useLayoutEffect(() => {
    if (!active || !pendingFocus.current) return;
    const element = rowRefs.current.get(pendingFocus.current);
    if (element) { element.focus({ preventScroll: true }); pendingFocus.current = null; }
  }, [focused, renderWindow.first, renderWindow.last, active]);
  const eligible = visible.filter((row) => row.eligible);
  const checkedCount = eligible.filter((row) => selection.has(row.file.key)).length;
  useEffect(() => { if (headerCheck.current) headerCheck.current.indeterminate = checkedCount > 0 && checkedCount < eligible.length; }, [checkedCount, eligible.length]);
  const visibleKeys = new Set(visible.map((row) => row.file.key));
  const hiddenCount = [...selection].filter((key) => !visibleKeys.has(key)).length;
  const report = (action: Promise<unknown>) => { void action.catch((failure: Error) => managerMessage(failure.message)); };
  const activate = (row: StorageRow) => { setFocused(row.file.key); select(row.item.location.id); };
  const choose = (row: StorageRow, modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }, toggle = false) => {
    const additive = Boolean(modifiers.ctrlKey || modifiers.metaKey);
    setFocused(row.file.key);
    if (busy || !row.eligible) { activate(row); return; }
    if (modifiers.shiftKey) {
      setSelection((prior) => selectStorageRange(prior, visible, anchor, row.file.key, additive));
      if (!anchor || !visibleKeys.has(anchor)) setAnchor(row.file.key);
      activate(row);
    } else if (toggle || additive) {
      const adding = !selection.has(row.file.key);
      setSelection((prior) => { const next = new Set(prior); if (next.has(row.file.key)) next.delete(row.file.key); else next.add(row.file.key); return next; });
      setAnchor(row.file.key);
      if (adding) activate(row);
    } else { setSelection(new Set([row.file.key])); setAnchor(row.file.key); activate(row); }
  };
  const selectAll = (checked: boolean) => {
    if (busy) return;
    setSelection((prior) => { const next = new Set(prior); for (const row of eligible) { if (checked) next.add(row.file.key); else next.delete(row.file.key); } return next; });
  };
  const focusRow = (row: StorageRow, index: number) => {
    pendingFocus.current = row.file.key;
    setFocused(row.file.key);
    const element = tableScroll.current;
    if (element) {
      const top = index * rowHeight;
      const bottom = top + rowHeight;
      const visibleHeight = Math.max(rowHeight, viewport - STORAGE_HEADER_HEIGHT);
      const next = top < element.scrollTop ? top : bottom > element.scrollTop + visibleHeight ? bottom - visibleHeight : element.scrollTop;
      element.scrollTop = next; setScrollTop(next);
    }
    rowRefs.current.get(row.file.key)?.focus({ preventScroll: true });
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (interactive(event.target)) return;
    const additive = event.ctrlKey || event.metaKey;
    const index = visible.findIndex((row) => row.file.key === focused);
    if (event.key === 'Escape') { event.preventDefault(); if (context) setContext(null); else if (!busy) setSelection(new Set()); return; }
    if (additive && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(true); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = index < 0 ? 0 : Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      const row = visible[nextIndex]; if (!row) return;
      if (event.shiftKey) choose(row, event); else if (!additive) choose(row, {});
      focusRow(row, nextIndex); return;
    }
    const row = visible[index]; if (!row) return;
    if (event.key === ' ' && !busy) { event.preventDefault(); choose(row, {}, true); }
    if (event.key === 'Enter') { event.preventDefault(); openInspector(row.item.location.id); }
  };
  useEffect(() => {
    if (!context) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setContext(null); } };
    document.addEventListener('keydown', dismiss, true);
    return () => document.removeEventListener('keydown', dismiss, true);
  }, [context]);
  useEffect(() => { if (!active || context && !rows.some((row) => row.file.key === context.row.file.key)) setContext(null); }, [active, rows]);
  const filtered = Boolean(query.trim() || filter !== 'all' || folder !== 'all' || kind !== 'all');
  const clearFilters = () => { setQuery(''); setFilter('all'); clearSharedFilters(); };
  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="shrink-0"><h2 className="text-lg font-semibold">{t('modelLibrary.storageTitle')}</h2><p className="text-sm text-gray-400">{t('modelLibrary.storageTotals', { size: formatModelBytes(summary.totalBytes), models: summary.modelCount, files: summary.fileCount, paths: summary.pathCount })}</p>
      {manager.sources.filter((source) => manager.sourceStatus?.[source.id]?.error).map((source) => <p key={source.id} className="text-xs text-amber-400 light:text-amber-800">{t('modelLibrary.sourceUnavailableDetail', { name: source.name, error: manager.sourceStatus?.[source.id]?.error ?? '' })}</p>)}
    </div>
    <details className="ui-disclosure shrink-0 rounded border border-gray-800 p-2"><summary className="cursor-pointer text-xs text-gray-400">{t('modelLibrary.storageDetails')}</summary><div className="mt-2 max-h-48 space-y-2 overflow-auto text-xs text-gray-400">
      <p>{t('modelLibrary.storageSpaceHelp')}</p>
      {manager.sources.map((source) => {
        const capacity = manager.storage?.sources.find((entry) => entry.sourceId === source.id);
        const entries = rows.filter((row) => row.sourceIds.includes(source.id)).map((row) => row.file);
        const status = manager.sourceStatus?.[source.id];
        return <div key={source.id}><h3 className="font-medium text-gray-200">{source.name}</h3><p className="break-all">{source.path}</p><p>{t('modelLibrary.sourceStorage', { size: formatModelBytes(storageSummary(entries).totalBytes), paths: entries.length, capacity: capacity?.availableBytes !== undefined && capacity.totalBytes !== undefined ? t('modelLibrary.capacity', { available: formatModelBytes(capacity.availableBytes), total: formatModelBytes(capacity.totalBytes) }) : t('modelLibrary.capacityUnavailable') })}</p>{capacity?.error && <p className="text-amber-400 light:text-amber-800">{capacity.error}</p>}<p>{status ? t('modelLibrary.lastScan', { date: new Date(status.checkedAt).toLocaleString(language) }) : t('modelLibrary.notScanned')}</p></div>;
      })}
      <p>{Array.from(new Set(rows.flatMap((row) => row.kinds))).map((type) => `${modelKindText(type, t)}: ${formatModelBytes(storageSummary(rows.filter((row) => row.kinds.includes(type)).map((row) => row.file)).totalBytes)}`).join(' · ')}</p>
      <p>{t('modelLibrary.storageDuplicateHelp')}</p>
    </div></details>
    <div className="flex shrink-0 flex-wrap gap-2"><input aria-label={t('modelLibrary.searchStorage')} className={`${modelInput} min-w-40 flex-1`} style={{ width: 'auto' }} placeholder={t('modelLibrary.searchPaths')} value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label={t('modelLibrary.storageFilter')} className={modelButton} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">{t('modelLibrary.allFiles')}</option><option value="duplicates">{t('modelLibrary.confirmedDuplicates')}</option><option value="unmatched">{t('modelLibrary.noLibraryMatches')}</option></select><select aria-label={t('modelLibrary.density')} className={modelButton} value={density} onChange={(event) => setDensity(event.target.value as typeof density)}><option value="compact">{t('modelLibrary.compact')}</option><option value="comfortable">{t('modelLibrary.comfortable')}</option></select><button className={modelButton} disabled={busy || manager.loading} onClick={() => report(verifyModelDuplicates())}>{t('modelLibrary.verifyDuplicates')}</button><button className={modelButton} disabled={busy || manager.loading} onClick={() => report(scanModelSources())}>{t('modelLibrary.refreshFiles')}</button></div>
    {filtered && <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-gray-400">{folder !== 'all' && <span>{t('modelLibrary.folderValue', { value: manager.sources.find(source => source.id === folder)?.name ?? '' })}</span>}{kind !== 'all' && <span>{t('modelLibrary.typeValue', { value: modelKindText(kind, t) })}</span>}{query.trim() && <span>{t('modelLibrary.searchValue', { value: query.trim() })}</span>}{filter !== 'all' && <span>{filter === 'duplicates' ? t('modelLibrary.confirmedDuplicates') : t('modelLibrary.noLibraryMatches')}</span>}<button className={modelButton} onClick={clearFilters}>{t('promptLibrary.clearFilters')}</button></div>}
    <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-gray-400"><span>{t('modelLibrary.selectionCount', { files: visible.length, selected: selection.size })}{hiddenCount ? t('modelLibrary.selectionOutside', { count: hiddenCount }) : ''}</span><button className={modelButton} disabled={busy || !selection.size} onClick={() => setSelection(new Set())}>{t('promptLibrary.clearSelection')}</button><button className={`${modelButton} border-red-900 text-red-300 light:border-red-800/50 light:text-red-800 light:enabled:hover:bg-red-500/10 light:disabled:opacity-100 light:disabled:border-gray-700 light:disabled:text-gray-500`} disabled={busy || !selection.size} onClick={() => requestModelRemoval([...new Set(rows.filter((row) => row.eligible && selection.has(row.file.key)).flatMap((row) => row.file.locationIds))], true)}>{t('modelLibrary.removeSelectedCount', { count: selection.size })}</button></div>
    {error && <div role="alert" className="shrink-0 text-sm text-red-400 light:text-red-800">{translateModelMessage(error, t)} <button className={modelButton} disabled={busy} onClick={() => { setError(''); setChecking(true); void refreshModelStorage().catch((failure: Error) => setError(failure.message)).finally(() => setChecking(false)); }}>{t('promptLibrary.retry')}</button></div>}
    {files.some((file) => file.stale || file.error) && <p className="shrink-0 text-xs text-amber-400 light:text-amber-800">{t('modelLibrary.staleFiles')}</p>}
    {checking && <p role="status" className="shrink-0 text-xs text-gray-400">{t('modelLibrary.checkingStorage')}</p>}
    <p id={instructions} className="sr-only">{t('modelLibrary.storageKeyboardHelp')}</p>
    <div ref={tableScroll} tabIndex={0} aria-label={t('modelLibrary.storageTable')} aria-describedby={instructions} onKeyDown={onKeyDown} onScroll={(event) => { if (active) setScrollTop(event.currentTarget.scrollTop); }} className="min-h-0 flex-1 overflow-auto rounded border border-gray-800 focus-visible:outline focus-visible:outline-cyan-500">
      <table className="w-full table-fixed border-separate border-spacing-0 text-left text-xs" style={{ minWidth: 1100 }}>
        <colgroup>{[48, 208, 108, 260, 90, 130, 160, 96].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
        <thead className="sticky top-0 z-20 bg-gray-900 text-gray-400"><tr style={{ height: STORAGE_HEADER_HEIGHT }}><th className="sticky left-0 z-30 bg-gray-900 px-3"><input ref={headerCheck} type="checkbox" aria-label={t('modelLibrary.selectFiltered')} disabled={busy || !eligible.length} checked={eligible.length > 0 && checkedCount === eligible.length} onChange={(event) => selectAll(event.target.checked)} /></th>{columns.map((column) => <th key={column.key} aria-sort={sort.column === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'} className={`${column.key === 'name' ? 'sticky left-12 z-30 bg-gray-900' : ''} px-3`}><button className="whitespace-nowrap text-left hover:text-gray-100 focus-visible:outline focus-visible:outline-cyan-500" onClick={() => setSort((prior) => nextStorageSort(prior, column.key))}>{column.label}{sort.column === column.key && <span aria-hidden="true"> {sort.direction === 'asc' ? '↑' : '↓'}</span>}</button></th>)}</tr></thead>
        <tbody>{renderWindow.first > 0 && <tr aria-hidden="true"><td colSpan={8} style={{ height: renderWindow.first * rowHeight, padding: 0 }} /></tr>}{visible.slice(renderWindow.first, renderWindow.last).map((row) => {
          const selected = selection.has(row.file.key), current = selectedId !== null && row.file.locationIds.includes(selectedId);
          const background = selected ? 'bg-cyan-950 light:bg-gray-800' : 'bg-gray-950';
          const usage = row.item.usage;
          return <tr key={row.file.key} ref={(element) => { if (element) rowRefs.current.set(row.file.key, element); else rowRefs.current.delete(row.file.key); }} tabIndex={focused === row.file.key || !focused && visible[0] === row ? 0 : -1} aria-selected={selected} aria-current={current ? 'true' : undefined} onFocus={() => setFocused(row.file.key)} onClick={(event) => { if (event.detail > 1 || interactive(event.target)) return; choose(row, event); }} onDoubleClick={(event) => { if (!interactive(event.target)) openInspector(row.item.location.id); }} onContextMenu={(event) => { event.preventDefault(); setContext({ row, x: Math.max(8, Math.min(event.clientX, globalThis.innerWidth - 220)), y: Math.max(8, Math.min(event.clientY, globalThis.innerHeight - 150)) }); }} className={`${background} cursor-pointer hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400`} style={{ height: rowHeight }}>
            <td className={`sticky left-0 z-10 border-t border-gray-800 px-3 ${background} ${current ? 'border-l-2 border-l-cyan-400' : ''}`}><input type="checkbox" className="ui-checkbox" aria-label={t('promptLibrary.selectNamed', { title: row.file.path })} disabled={busy || !row.eligible} checked={selected} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={() => choose(row, {}, true)} /></td>
            <td className={`sticky left-12 z-10 border-t border-gray-800 px-3 ${background}`}><div className="truncate text-accent light:text-gray-100" title={row.name}>{row.name}</div></td>
            <td className="border-t border-gray-800 px-3"><div className="truncate" title={modelKindText(row.item.location.sourceKind, t)}>{row.type}</div></td>
            <td className="border-t border-gray-800 px-3"><div className="truncate" title={row.file.path}>{row.file.path}</div>{!row.eligible ? <div className="truncate text-amber-400 light:text-amber-800" title={row.file.error || t('modelLibrary.fileChanged')}>{row.file.error || t('modelLibrary.fileChanged')}</div> : row.file.linkCount && row.file.linkCount > 1 ? <div className="truncate text-gray-500">{t('modelLibrary.hardlinks', { count: row.file.linkCount })}</div> : null}</td>
            <td className="border-t border-gray-800 px-3">{formatModelBytes(row.file.size)}</td><td className="border-t border-gray-800 px-3"><div className="truncate">{!row.eligible ? t('modelLibrary.unavailable') : usage?.status === 'unsupported' ? t('modelLibrary.usageUnavailable') : usage?.status === 'ready' ? t('modelLibrary.fileCount', { count: usage.totalCount }) : usage?.status === 'partial' ? t('modelLibrary.partialFiles', { count: usage.totalCount }) : t('modelLibrary.loadingBare')}</div></td><td className="border-t border-gray-800 px-3" title={t('modelLibrary.latestDateHelp')}>{usage?.lastUsedAt ? new Date(usage.lastUsedAt).toLocaleDateString(language) : '—'}</td><td className="border-t border-gray-800 px-3">{row.copies}{row.file.sha256 && row.eligible ? '' : t('modelLibrary.unverifiedSuffix')}</td>
          </tr>;
        })}{renderWindow.last < visible.length && <tr aria-hidden="true"><td colSpan={8} style={{ height: (visible.length - renderWindow.last) * rowHeight, padding: 0 }} /></tr>}</tbody>
      </table>
      {!visible.length && <div className="p-5 text-sm text-gray-400">{manager.loading || !manager.storage && checking ? t('modelLibrary.loadingStorage') : !manager.sources.length ? t('modelLibrary.addFolderStart') : !files.length ? t('modelLibrary.noFilesFound') : t('modelLibrary.noStorageMatches')}{!manager.loading && !manager.sources.length && <button className={`${modelButton} ml-2`} onClick={addFolder}>{t('modelLibrary.addFolder')}</button>}{filtered && <button className={`${modelButton} ml-2`} onClick={clearFilters}>{t('promptLibrary.clearFilters')}</button>}</div>}
    </div>
    <p className="shrink-0 text-xs text-gray-500">{t('modelLibrary.storageChecked', { date: manager.storage ? new Date(manager.storage.checkedAt).toLocaleString(language) : t('modelLibrary.pending') })}</p>
    {context && createPortal(<div className="fixed inset-0 z-[100]" onClick={() => setContext(null)} onContextMenu={(event) => { event.preventDefault(); setContext(null); }}><div role="menu" aria-label={t('modelLibrary.storageActions')} className="absolute w-52 rounded border border-gray-700 bg-gray-900 p-2 shadow-xl" style={{ left: context.x, top: context.y }}>{[
      { label: t('modelLibrary.openInspector'), action: () => openInspector(context.row.item.location.id) },
      { label: t('modelLibrary.showFolder'), action: () => report(globalThis.window.electronAPI!.modelLibraryRevealLocation(context.row.file.path).then((result) => { if (!result.success) throw new Error(result.error || t('modelLibrary.revealFailed')); })) },
      { label: t('modelLibrary.copyPath'), action: () => report(globalThis.window.electronAPI!.copyTextToClipboard(context.row.file.path).then((result) => { if (!result.success) throw new Error(result.error || 'Unable to copy path.'); })) },
    ].map(({ label, action }) => <button role="menuitem" key={label} className="block w-full rounded p-2 text-left text-xs hover:bg-gray-800" onClick={() => { action(); setContext(null); }}>{label}</button>)}</div></div>, document.body)}
  </div>;
}
