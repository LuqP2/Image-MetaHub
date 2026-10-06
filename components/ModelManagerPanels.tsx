import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import { thumbnailManager } from '../services/thumbnailManager';
import type { IndexedImage } from '../types';
import React, { useEffect, useMemo, useState } from 'react';
import { useImageStore } from '../store/useImageStore';
import { closeModelPicker, modelFolderWatchDefault, markModelVersion, runModelCommand, stopWatchingModel, useModelManager, installedVersions } from '../services/modelLibrary/manager';
import { modelFamily, unreadVersions, versionDate } from '../services/modelLibrary/updateTracking';
import { getDefaultLoraSyntax } from '../services/modelLibrary/presentation';
import { modelImageAssociation } from '../services/modelLibrary/imageAssociations';
import type { ModelInspectorItem, ModelManagerCommand, ModelLocalMetadata } from '../services/modelLibrary/types';

export const modelButton = 'rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-100 hover:bg-gray-800 disabled:opacity-50';
export const modelInput = 'w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100';

export async function executeModelCommand(command: ModelManagerCommand) {
  if (new URLSearchParams(window.location.search).get('window') === 'model-inspector') {
    const result = await window.electronAPI!.modelManagerCommand(command);
    if (!result.success) throw new Error(result.error || 'Model action failed.');
  } else await runModelCommand(command);
}

export function ModelLocalEditor({ item }: { item: ModelInspectorItem }) {
  const [draft, setDraft] = useState({ name: '', notes: '', tags: '', triggers: '', strength: '1' });
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  useEffect(() => {
    const value = item.localMetadata;
    setDraft({ name: value?.displayName ?? '', notes: value?.notes ?? '', tags: value?.tags.join(', ') ?? '', triggers: value?.triggerWords?.join(', ') ?? '', strength: String(value?.defaultStrength ?? 1) });
    setError('');
  }, [item.location.id, item.localMetadata?.displayName, item.localMetadata?.notes, item.localMetadata?.tags.join(','), item.localMetadata?.triggerWords?.join(','), item.localMetadata?.defaultStrength]);
  return <form className="space-y-3 rounded-lg border border-gray-800 p-3" onSubmit={(event) => {
    event.preventDefault(); setSaving(true); setError('');
    const patch: Partial<ModelLocalMetadata> = { displayName: draft.name, notes: draft.notes, tags: draft.tags.split(','), triggerWords: draft.triggers.split(','), defaultStrength: Number(draft.strength) };
    void executeModelCommand({ type: 'saveLocal', locationId: item.location.id, patch }).catch((error) => setError(error.message)).finally(() => setSaving(false));
  }}>
    <h3 className="font-medium">Your metadata</h3>
    <label className="block text-xs text-gray-400">Display name<input className={modelInput} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label className="block text-xs text-gray-400">Tags, separated by commas<input className={modelInput} value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></label>
    {item.location.sourceKind === 'lora' && <><label className="block text-xs text-gray-400">Trigger words override<input className={modelInput} value={draft.triggers} onChange={(event) => setDraft({ ...draft, triggers: event.target.value })} /></label><label className="block text-xs text-gray-400">Default strength<input type="number" min="-10" max="10" step="0.05" className={modelInput} value={draft.strength} onChange={(event) => setDraft({ ...draft, strength: event.target.value })} /></label><button type="button" className={modelButton} onClick={() => void window.electronAPI?.copyTextToClipboard(getDefaultLoraSyntax(item.location, item.localMetadata))}>Copy LoRA syntax</button></>}
    <label className="block text-xs text-gray-400">Notes<textarea rows={3} className={modelInput} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    <button className={modelButton} disabled={saving}>{saving ? 'Saving…' : 'Save metadata'}</button>
  </form>;
}

export function ModelActionsPanel({ item }: { item: ModelInspectorItem }) {
  const manager = useModelManager(); const [link, setLink] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const civitai = item.location.civitai && 'modelId' in item.location.civitai ? item.location.civitai : undefined;
  const watch = civitai ? manager.watches[String(civitai.modelId)] : undefined;
  const locations = item.location.sha256 ? manager.catalog.locations.filter((location) => location.sha256 === item.location.sha256) : [item.location];
  useEffect(() => { setError(''); setLink(''); }, [item.location.id]);
  const execute = async (command: ModelManagerCommand) => { setError(''); setBusy(true); try { await executeModelCommand(command); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  const folderDefault = modelFolderWatchDefault(item);
  return <section className="space-y-3 rounded-lg border border-gray-800 p-3">
    <div className="flex flex-wrap gap-2"><button className={modelButton} disabled={busy || Boolean(manager.progress)} onClick={() => void execute({ type: 'check', locationId: item.location.id })}>Check updates</button><button className={modelButton} onClick={() => void execute({ type: 'saveLocal', locationId: item.location.id, patch: { favorite: !item.localMetadata?.favorite } })}>{item.localMetadata?.favorite ? '★ Favorited' : '☆ Favorite'}</button></div>
    <label className="block text-xs text-gray-400">Update monitoring<select className={modelInput} value={typeof item.localMetadata?.watchUpdates === 'boolean' ? String(item.localMetadata.watchUpdates) : 'inherit'} onChange={(event) => void execute({ type: 'saveLocal', locationId: item.location.id, patch: { watchUpdates: event.target.value === 'inherit' ? undefined : event.target.value === 'true' } })}><option value="inherit">Folder default ({folderDefault ? 'on' : 'off'})</option><option value="true">On</option><option value="false">Off</option></select></label>
    <p className="text-xs text-gray-400">Monitoring authorizes hash identification and Civitai checks while the app is open.</p>
    {civitai && <><p className="text-sm">{civitai.versionName} · {civitai.baseModel || 'Unknown base model'} <span className="text-xs text-gray-400">({civitai.binding || 'hash'} link)</span></p><button className={modelButton} onClick={() => void window.electronAPI?.openExternalUrl(civitai.url)}>Open version on Civitai</button></>}
    <details><summary className="cursor-pointer text-xs text-gray-400">{civitai ? 'Change or remove version link' : 'Link a Civitai version manually'}</summary><p className="my-2 text-xs text-gray-400">Paste the version link containing modelVersionId. A model-only link cannot identify your installed version.</p><input className={modelInput} value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://civitai.com/models/…?modelVersionId=…" /><button className={`${modelButton} mt-2`} disabled={busy || Boolean(manager.progress)} onClick={() => void execute({ type: 'bind', locationId: item.location.id, url: link })}>Validate and link version</button>{civitai && <button className={`${modelButton} ml-2`} onClick={() => void execute({ type: 'unbind', locationId: item.location.id })}>Remove link and stop monitoring</button>}</details>
    <ModelVersionLinks item={item} />
    {watch && <><p className="text-xs text-gray-400">Last successful check: {watch.lastSuccessAt ? new Date(watch.lastSuccessAt).toLocaleString() : 'Never'}</p>{watch.error && <p className="text-xs text-amber-400">{watch.error}</p>}{watch.chronologyUnknown && <p className="text-xs text-amber-400">Some version dates are unavailable; chronology is indeterminate.</p>}</>}
    {item.location.metadataError && <p className="text-xs text-amber-400">Embedded metadata: {item.location.metadataError}</p>}
    <details><summary className="cursor-pointer text-xs text-gray-400">{locations.length} file location{locations.length === 1 ? '' : 's'}</summary>{locations.map((location) => <button className="mt-2 block break-all text-left text-xs text-gray-300" key={location.id} onClick={() => void window.electronAPI?.modelLibraryRevealLocation(location.absolutePath)}>{location.absolutePath}</button>)}</details>
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
  </section>;
}

export function ModelMediaPanel({ item }: { item: ModelInspectorItem }) {
  const manager = useModelManager(); const [limit, setLimit] = useState(12); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const linked = Boolean(item.location.civitai && 'versionId' in item.location.civitai);
  const examples = (item.localMetadata?.examples ?? []);
  useEffect(() => { setLimit(12); setError(''); }, [item.location.id]);
  const execute = async (command: ModelManagerCommand) => { setBusy(true); setError(''); try { await executeModelCommand(command); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  return <section className="space-y-3 rounded-lg border border-gray-800 p-3">
    <h3 className="font-medium">Cover and examples</h3>
    <div className="flex flex-wrap gap-2"><button className={modelButton} disabled={busy} onClick={() => void execute({ type: 'chooseLibrary', locationId: item.location.id, cover: true })}>Choose cover from library</button>{item.localMetadata?.previewImage && <button className={modelButton} onClick={() => void execute({ type: 'saveLocal', locationId: item.location.id, patch: { previewImage: undefined } })}>Restore default cover</button>}</div>
    {linked && !(item.location.civitai && 'coverImage' in item.location.civitai && item.location.civitai.coverImage) && <button className={modelButton} disabled={busy || Boolean(manager.progress)} onClick={() => void execute({ type: 'cover', locationId: item.location.id })}>Load Civitai cover</button>}
    <button className={modelButton} disabled={busy} onClick={() => void execute({ type: 'chooseLibrary', locationId: item.location.id, cover: false })}>Add examples from library</button>
    <button className={modelButton} disabled={busy || Boolean(manager.progress) || !linked} onClick={() => void execute({ type: 'examples', locationId: item.location.id })}>{busy ? 'Loading…' : 'Load examples from Civitai'}</button>
    <p className="text-xs text-gray-400">{linked ? 'Load the default cover on demand; it is saved locally for reuse. Your chosen cover takes priority.' : 'Identify or link this model on Civitai to get its default cover and load examples.'}</p>
    {!examples.length && <p className="text-xs text-gray-500">No examples linked yet.</p>}
    <div className="grid grid-cols-2 gap-3">{examples.slice(0, limit).map((example) => {
      const available = !example.imageId || manager.libraryIds?.includes(example.imageId);
      return <div key={example.id} className="min-w-0 rounded border border-gray-800 p-2"><button disabled={!example.imageId || !available} onClick={() => example.imageId && void execute({ type: 'openImage', imageId: example.imageId })}><img src={example.preview} alt={example.caption || 'Model example'} className="h-28 w-full object-contain" /></button>{!available && <p className="text-xs text-amber-400">Library image unavailable</p>}{example.versionId && <p className="text-xs text-gray-500">Version {example.versionId}</p>}<input aria-label="Example caption" className={`${modelInput} mt-2`} defaultValue={example.caption} onBlur={(event) => { if (event.target.value !== example.caption) void execute({ type: 'example', locationId: item.location.id, exampleId: example.id, caption: event.target.value }); }} /><div className="mt-2 flex flex-wrap gap-2"><button className={modelButton} onClick={() => void execute({ type: 'saveLocal', locationId: item.location.id, patch: { previewImage: example.preview } })}>Use as cover</button><button className={modelButton} onClick={() => void execute({ type: 'example', locationId: item.location.id, exampleId: example.id, remove: true })}>Unlink</button></div></div>;
    })}</div>
    {examples.length > limit && <button className={modelButton} onClick={() => setLimit(limit + 12)}>Show more</button>}
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
  </section>;
}

export function ModelVersionLinks({ item }: { item: ModelInspectorItem }) {
  const manager = useModelManager();
  const link = item.location.civitai && 'modelId' in item.location.civitai ? item.location.civitai : undefined;
  const watch = link ? manager.watches[String(link.modelId)] : undefined;
  if (!watch) return null;
  const local = installedVersions(watch.modelId).map((version) => version.versionId);
  const versions = watch.versions.filter((version) => watch.novelVersionIds.includes(version.id) && !watch.ignoredVersionIds.includes(version.id) && !local.includes(version.id));
  return <div className="space-y-2">{versions.length > 0 && <p className="text-xs font-medium text-cyan-300">{versions.length} new version{versions.length === 1 ? '' : 's'}</p>}{versions.map((version) => <button key={version.id} className="block w-full rounded border border-cyan-900 px-2 py-2 text-left text-xs text-cyan-200 hover:bg-cyan-950" onClick={() => void window.electronAPI?.openExternalUrl(version.url)}>{version.name} · {version.baseModel || 'Unknown base'}<span aria-hidden="true" className="ml-1">↗</span></button>)}</div>;
}

export function ModelUpdatesPanel({ modelIds }: { modelIds?: number[] } = {}) {
  const manager = useModelManager(); const [history, setHistory] = useState(false); const [error, setError] = useState('');
  const action = (promise: Promise<void>) => { void promise.catch((error) => setError(error.message)); };
  const groups = Object.values(manager.watches).filter((watch) => installedVersions(watch.modelId).length > 0 && (!modelIds || modelIds.includes(watch.modelId)));
  return <section className="space-y-4"><label className="text-sm"><input type="checkbox" checked={history} onChange={(event) => setHistory(event.target.checked)} /> Show history and ignored versions</label>{error && <p role="alert" className="text-red-400">{error}</p>}
    {!groups.length && <p className="text-gray-400">Check a model to see its versions here.</p>}
    {groups.map((watch) => {
      const local = installedVersions(watch.modelId); const unread = unreadVersions(watch, local.map((version) => version.versionId));
      const versions = history ? watch.versions : watch.versions.filter((version) => watch.novelVersionIds.includes(version.id) && !watch.ignoredVersionIds.includes(version.id) && !local.some((item) => item.versionId === version.id));
      const bases = local.map((version) => version.baseModel).filter((base): base is string => Boolean(base));
      return <article key={watch.id} className="rounded-lg border border-gray-800 bg-gray-900 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{watch.modelName} <span className="text-sm text-cyan-300">{unread.length} unread</span></h3><p className="mt-1 text-xs text-gray-400">Installed: {Array.from(new Set(local.map((version) => `${version.versionName} (${version.baseModel || 'unknown base'})`))).join(' · ')}</p><p className="mt-1 text-xs text-gray-500">Last successful check: {watch.lastSuccessAt ? new Date(watch.lastSuccessAt).toLocaleString() : 'Never'}</p></div><button className={modelButton} onClick={() => action(stopWatchingModel(watch.modelId))}>Stop monitoring</button></div>{watch.error && <p className="mt-2 text-sm text-amber-400">{watch.error}</p>}{watch.chronologyUnknown && <p className="mt-2 text-xs text-amber-400">Chronology indeterminate for versions without dates.</p>}{!versions.length && <p className="mt-3 text-sm text-gray-400">{watch.error ? 'No new result is available.' : 'No pending new versions.'}</p>}
        {versions.map((version) => <div key={version.id} className="mt-3 rounded border border-gray-800 bg-gray-950 p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{version.name}</strong><span className="text-xs text-gray-400">{versionDate(version) !== null ? new Date(versionDate(version)!).toLocaleDateString() : 'Date unavailable'}</span></div><p className="mt-1 text-xs text-gray-400">{version.baseModel || 'Unknown base'} · {modelFamily(version, bases)}{local.some((item) => item.versionId === version.id) ? ' · Installed' : ''}{watch.ignoredVersionIds.includes(version.id) ? ' · Ignored' : watch.seenVersionIds.includes(version.id) ? ' · Seen' : ''}</p><p className="mt-2 whitespace-pre-wrap text-sm text-gray-300">{version.description || 'No description provided.'}</p><div className="mt-3 flex flex-wrap gap-2"><button className={modelButton} onClick={() => void window.electronAPI?.openExternalUrl(version.url)}>Civitai ↗</button><button className={modelButton} onClick={() => action(markModelVersion(watch.modelId, version.id, 'seen'))}>Mark seen</button><button className={modelButton} onClick={() => action(markModelVersion(watch.modelId, version.id, watch.ignoredVersionIds.includes(version.id) ? 'restore' : 'ignore'))}>{watch.ignoredVersionIds.includes(version.id) ? 'Restore ignored version' : 'Ignore this version'}</button></div></div>)}
      </article>;
    })}
  </section>;
}

function ModelLibraryImage({ image, association, onChoose }: { image: IndexedImage; association: 'confirmed' | 'suggested' | null; onChoose: () => void }) {
  const thumbnail = useResolvedThumbnail(image);
  useEffect(() => { void thumbnailManager.loadIndexedThumbnail(image).catch(() => {}); }, [image.id, image.lastModified]);
  return <button disabled={!thumbnail?.thumbnailUrl} className="overflow-hidden rounded border border-gray-800 p-2 text-left disabled:opacity-50" onClick={onChoose}>{thumbnail?.thumbnailUrl ? <img src={thumbnail.thumbnailUrl} alt="" className="h-28 w-full object-contain" /> : <div className="flex h-28 items-center justify-center text-xs text-gray-500">Thumbnail unavailable</div>}<p className="truncate text-xs">{image.name}</p>{association && <p className="text-xs text-cyan-300">{association === 'confirmed' ? 'Hash confirmed' : 'Name suggestion'}</p>}</button>;
}

export function ModelLibraryPicker() {
  const manager = useModelManager(); const images = useImageStore((state) => state.images); const [query, setQuery] = useState(''); const [suggestions, setSuggestions] = useState(true); const [limit, setLimit] = useState(60); const [error, setError] = useState('');
  const location = manager.picker ? manager.catalog.locations.find((item) => item.id === manager.picker!.locationId) : undefined;
  useEffect(() => { setQuery(''); setSuggestions(true); setLimit(60); setError(''); }, [manager.picker]);
  const available = useMemo(() => images.filter((image) => !['video', 'audio', 'model3d'].includes(image.metadata.normalizedMetadata?.media_type ?? '')).map((image) => ({ image, association: location ? modelImageAssociation(image, location) : null })).filter(({ image, association }) => image.name.toLowerCase().includes(query.toLowerCase()) && (!suggestions || association)), [images, location, query, suggestions]);
  if (!manager.picker || !location) return null;
  const picker = manager.picker;
  return <div role="dialog" aria-modal="true" aria-label="Choose model image" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-5"><section className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-gray-700 bg-gray-950 p-5 text-gray-100"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{picker.cover ? 'Choose library cover' : 'Link library examples'}</h2><button className={modelButton} onClick={closeModelPicker}>Close</button></div><p className="my-2 text-xs text-gray-400">Uses indexed thumbnails only. Name matches are suggestions; only matching full hashes confirm the model/version.</p><input className={modelInput} placeholder="Search indexed image names" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(60); }} /><label className="my-3 text-sm"><input type="checkbox" checked={suggestions} onChange={(event) => setSuggestions(event.target.checked)} /> Only images matching this model</label>{error && <p role="alert" className="text-sm text-red-400">{error}</p>}<div className="min-h-0 overflow-auto"><div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">{available.slice(0, limit).map(({ image, association }) => <ModelLibraryImage key={image.id} image={image} association={association} onChoose={() => { void runModelCommand({ type: 'libraryMedia', locationId: picker.locationId, imageId: image.id, cover: picker.cover }).then(() => { if (picker.cover) closeModelPicker(); }).catch((error) => setError(error.message)); }} />)}</div>{!available.length && <p className="py-4 text-gray-400">No indexed images match. Uncheck the model filter to browse your whole library.</p>}{available.length > limit && <button className={`${modelButton} mt-3`} onClick={() => setLimit(limit + 60)}>Show more</button>}</div></section></div>;
}
