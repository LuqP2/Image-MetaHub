import React, { useEffect, useMemo, useState } from 'react';
import { closeModelRemoval, removeModelFiles, useModelManager } from '../services/modelLibrary/manager';
import { formatModelBytes } from '../services/modelLibrary/storage';
import { modelButton } from './ModelManagerPanels';
export { default } from './ModelStorageTable';

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
