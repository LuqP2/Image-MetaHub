import React, { useEffect, useMemo, useRef, useState } from 'react';
import { closeModelRemoval, managerMessage, refreshModelStorage, removeModelFiles, requestModelRemoval, scanModelSources, useModelManager, verifyModelDuplicates } from '../services/modelLibrary/manager';
import { confirmedCopyCounts, confirmedCopies, formatModelBytes, storageSummary, storageUsage } from '../services/modelLibrary/storage';
import { getEffectiveModelPresentation, getModelLocalMetadata } from '../services/modelLibrary/presentation';
import type { ModelLocation } from '../services/modelLibrary/types';
import { modelKindLabel } from '../services/modelLibrary/modelKinds';
import { modelButton } from './ModelManagerPanels';

export default function ModelStoragePanel({ select, active }: { select: (id: string) => void; active: boolean }) {
  const manager = useModelManager();
  const [filter, setFilter] = useState('all');
  const [folder, setFolder] = useState('all');
  const [kind, setKind] = useState('all');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const files = manager.storage?.files ?? [];
  const locationsById = useMemo(() => new Map(manager.catalog.locations.map((location) => [location.id, location])), [manager.catalog]);
  const locationsFor = (ids: string[]) => ids.map((id) => locationsById.get(id)).filter((location): location is ModelLocation => Boolean(location));
  const [scrollTop, setScrollTop] = useState(0);
  const tableScroll = useRef<HTMLDivElement>(null);
  useEffect(() => { setScrollTop(0); if (tableScroll.current) tableScroll.current.scrollTop = 0; }, [filter, folder, kind]);
  const busy = Boolean(manager.progress) || checking;
  const inventoryKey = manager.catalog.locations.map(({ id, size, modifiedAt }) => `${id}:${size}:${modifiedAt}`).join('|');
  useEffect(() => {
    if (!active || manager.loading || manager.progress) { setChecking(false); return; }
    let current = true;
    setChecking(true); setError('');
    void refreshModelStorage().catch((failure) => { if (current) setError(failure.message); }).finally(() => { if (current) setChecking(false); });
    return () => { current = false; };
  }, [inventoryKey, active, manager.loading, Boolean(manager.progress)]);
  useEffect(() => { setSelection((prior) => new Set([...prior].filter((key) => files.some((file) => file.key === key && !file.error && !file.stale)))); }, [manager.storage]);
  const copyCounts = useMemo(() => confirmedCopyCounts(files), [manager.storage]);
  const summary = useMemo(() => storageSummary(files), [manager.storage]);
  const visible = useMemo(() => files.filter((file) => {
    const locations = locationsFor(file.locationIds);
    const usage = storageUsage(file, manager, locationsById);
    return (folder === 'all' || locations.some((location) => location.sourceId === folder)) && (kind === 'all' || locations.some((location) => location.sourceKind === kind)) &&
      (filter !== 'duplicates' || confirmedCopies(file, files, copyCounts) > 1) && (filter !== 'unmatched' || usage?.status === 'ready' && usage.totalCount === 0);
  }).sort((a, b) => b.size - a.size || a.path.localeCompare(b.path)), [manager.storage, manager.catalog, manager.usage, filter, folder, kind]);
  const firstRow = Math.max(0, Math.min(visible.length, Math.floor(scrollTop / 96) - 8));
  const lastRow = Math.min(visible.length, firstRow + 32);
  const report = (action: Promise<unknown>) => { void action.catch((failure) => managerMessage(failure.message)); };
  return <div className="space-y-4">
    <div><h2 className="text-lg font-semibold">Model storage</h2><p className="mt-1 text-sm text-gray-400">{formatModelBytes(summary.totalBytes)} managed · {summary.modelCount} logical models · {summary.fileCount} physical files · {summary.pathCount} file paths</p><p className="mt-1 text-xs text-gray-500">Overlapping folders count once. Hardlinks share physical storage when filesystem identity is available. File size is not an exact estimate of recoverable space.</p></div>
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">{manager.sources.map((source) => {
      const capacity = manager.storage?.sources.find((entry) => entry.sourceId === source.id);
      const entries = files.filter((file) => locationsFor(file.locationIds).some((location) => location.sourceId === source.id));
      const status = manager.sourceStatus?.[source.id];
      return <div key={source.id} className="rounded border border-gray-800 bg-gray-900 p-3"><h3 className="text-sm font-medium">{source.name}</h3><p className="break-all text-xs text-gray-500">{source.path}</p><p className="mt-2 text-xs text-gray-300">{formatModelBytes(storageSummary(entries).totalBytes)} managed · {entries.length} paths</p><p className="mt-1 text-xs text-gray-400">{capacity?.availableBytes !== undefined && capacity.totalBytes !== undefined ? `${formatModelBytes(capacity.availableBytes)} available of ${formatModelBytes(capacity.totalBytes)}` : 'Filesystem capacity unavailable'}</p>{status?.error && <p className="mt-1 text-xs text-amber-400">Source unavailable · {status.error}</p>}<p className="mt-1 text-xs text-gray-500">{status ? `Last scan: ${new Date(status.checkedAt).toLocaleString()}` : 'Not scanned this session'}</p></div>;
    })}</div>
    <p className="text-xs text-gray-400">{Array.from(new Set(manager.catalog.locations.map((location) => location.sourceKind))).map((type) => `${modelKindLabel(type)}: ${formatModelBytes(storageSummary(files.filter((file) => locationsFor(file.locationIds).some((location) => location.sourceKind === type))).totalBytes)}`).join(' · ')}<br />Folder and category totals can overlap. Capacity belongs to each folder's filesystem.</p>
    <div className="flex flex-wrap gap-2"><select aria-label="Storage filter" className={modelButton} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All files</option><option value="duplicates">Confirmed duplicates</option><option value="unmatched">No Library matches</option></select><select aria-label="Storage folder" className={modelButton} value={folder} onChange={(event) => setFolder(event.target.value)}><option value="all">All folders</option>{manager.sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select><select aria-label="Storage type" className={modelButton} value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All types</option>{Array.from(new Set(manager.catalog.locations.map((location) => location.sourceKind))).map((type) => <option key={type} value={type}>{modelKindLabel(type)}</option>)}</select><button className={modelButton} disabled={busy} onClick={() => report(verifyModelDuplicates())}>Verify duplicates</button><button className={modelButton} disabled={busy} onClick={() => report(scanModelSources())}>Refresh file list</button><button className={`${modelButton} border-red-900 text-red-300`} disabled={busy || !selection.size} onClick={() => requestModelRemoval(files.filter((file) => selection.has(file.key)).flatMap((file) => file.locationIds), true)}>Remove selected… · {selection.size}</button></div>
    <p className="text-xs text-gray-500">Largest files first. Matching names or sizes alone do not confirm duplicates. Verification hashes candidates of equal size only when requested.</p>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {files.some((file) => file.stale) && <p className="text-xs text-amber-400">Some files changed or are unavailable. Totals include their last known sizes; refresh the file list.</p>}
    {checking && <p role="status" className="text-xs text-gray-400">Checking file locations and filesystem capacity…</p>}
    <div ref={tableScroll} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} className="max-h-[60vh] overflow-auto rounded border border-gray-800"><table className="w-full text-left text-xs"><thead className="sticky top-0 z-10 bg-gray-900 text-gray-400"><tr>{['Select', 'Model', 'Type', 'Location', 'Size', 'Library usage', 'Latest matching file', 'Copies'].map((title) => <th className="whitespace-nowrap p-3" key={title}>{title}</th>)}</tr></thead><tbody>{firstRow > 0 && <tr aria-hidden="true"><td colSpan={8} style={{ height: firstRow * 96, padding: 0 }} /></tr>}{visible.slice(firstRow, lastRow).map((file) => {
      const location = locationsById.get(file.locationIds[0]);
      if (!location) return null;
      const usage = storageUsage(file, manager, locationsById);
      const presentation = getEffectiveModelPresentation(location, getModelLocalMetadata(manager.localMetadata, location));
      return <tr key={file.key} className="h-24 border-t border-gray-800 hover:bg-gray-900/60"><td className="p-3"><input type="checkbox" aria-label={`Select ${file.path}`} disabled={busy || file.stale} checked={selection.has(file.key)} onChange={(event) => setSelection((prior) => { const next = new Set(prior); if (event.target.checked) next.add(file.key); else next.delete(file.key); return next; })} /></td><td className="p-3"><button className="max-w-48 truncate text-left text-cyan-200" onClick={() => select(location.id)}>{presentation.name}</button></td><td className="p-3">{modelKindLabel(location.sourceKind)}</td><td className="min-w-48 max-w-sm break-all p-3"><div className="line-clamp-2" title={file.path}>{file.path}</div>{file.stale && <p className="mt-1 line-clamp-1 text-amber-400">{file.error || 'File changed; refresh the file list'}</p>}{file.linkCount && file.linkCount > 1 ? <p className="text-gray-500">{file.linkCount} hardlinks share this file</p> : null}</td><td className="whitespace-nowrap p-3">{formatModelBytes(file.size)}</td><td className="p-3">{usage?.status === 'unsupported' ? 'Usage unavailable' : usage?.status === 'ready' ? `${usage.totalCount} files` : usage ? `Partial · ${usage.totalCount} files` : 'Loading'}</td><td className="whitespace-nowrap p-3" title="Based on the latest matching file date in your indexed Library">{usage?.lastUsedAt ? new Date(usage.lastUsedAt).toLocaleDateString() : '—'}</td><td className="p-3">{confirmedCopies(file, files, copyCounts)}{file.sha256 ? '' : ' · unverified'}</td></tr>;
    })}{lastRow < visible.length && <tr aria-hidden="true"><td colSpan={8} style={{ height: (visible.length - lastRow) * 96, padding: 0 }} /></tr>}</tbody></table></div>
    {!visible.length && !checking && <p className="text-sm text-gray-400">No model files match these filters.</p>}
    <p className="text-xs text-gray-500">Storage checked: {manager.storage ? new Date(manager.storage.checkedAt).toLocaleString() : 'Pending'}</p>
  </div>;
}

export function ModelRemovalDialog() {
  const manager = useModelManager();
  const request = manager.removal;
  const files = useMemo(() => {
    const paths = new Map<string, { path: string; ids: string[]; size: number }>();
    for (const location of manager.catalog.locations) if (request?.locationIds.includes(location.id)) {
      const key = /^win/i.test(navigator.platform) ? location.absolutePath.toLowerCase() : location.absolutePath;
      const file = paths.get(key) ?? { path: location.absolutePath, ids: [], size: location.size };
      file.ids.push(location.id); paths.set(key, file);
    }
    return [...paths.values()];
  }, [request, manager.catalog]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  useEffect(() => { setSelected(new Set(request?.selected || files.length === 1 ? files.map((file) => file.path) : [])); setError(''); }, [request]);
  useEffect(() => { setSelected((prior) => new Set([...prior].filter((path) => files.some((file) => file.path === path)))); }, [files]);
  if (!request) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"><section role="dialog" aria-modal="true" aria-labelledby="model-removal-title" className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-5"><h2 id="model-removal-title" className="text-lg font-semibold">Choose model files to remove</h2><p className="mt-2 text-sm text-gray-400">Select the physical file paths to move to Trash. Images in your Library will not be removed. Notes, covers and examples will be kept.</p><div className="my-4 space-y-3">{files.map((file) => <label className="flex items-start gap-3 rounded border border-gray-800 p-3" key={file.path}><input type="checkbox" className="mt-1" disabled={Boolean(manager.progress)} checked={selected.has(file.path)} onChange={(event) => setSelected((prior) => { const next = new Set(prior); if (event.target.checked) next.add(file.path); else next.delete(file.path); return next; })} /><span className="break-all text-xs">{file.path}<span className="mt-1 block text-gray-400">{formatModelBytes(file.size)}</span></span></label>)}</div>{files.length > 1 && !request.selected && <button className={modelButton} disabled={Boolean(manager.progress)} onClick={() => setSelected(new Set(files.map((file) => file.path)))}>Remove all copies</button>}<p className="my-3 text-xs text-gray-500">The system confirmation will show the final paths, size and copies remaining. Free space may depend on emptying the Trash.</p>{error && <p role="alert" className="mb-3 text-xs text-red-400">{error}</p>}<div className="flex gap-2"><button className={`${modelButton} border-red-900 text-red-300`} disabled={!selected.size || Boolean(manager.progress)} onClick={() => { void removeModelFiles(files.filter((file) => selected.has(file.path)).flatMap((file) => file.ids)).catch((failure) => setError(failure.message)); }}>Review in system dialog…</button><button className={modelButton} disabled={Boolean(manager.progress)} onClick={() => { closeModelRemoval(); }}>Cancel</button></div></section></div>;
}
