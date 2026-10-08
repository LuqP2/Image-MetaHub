import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import { thumbnailManager } from '../services/thumbnailManager';
import type { IndexedImage } from '../types';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useImageStore } from '../store/useImageStore';
import { closeModelPicker, modelFolderWatchDefault, runModelCommand, useModelManager, installedVersions } from '../services/modelLibrary/manager';
import { modelFamily, unreadVersions, versionDate } from '../services/modelLibrary/updateTracking';
import { getDefaultLoraSyntax } from '../services/modelLibrary/presentation';
import { associateReferences, buildModelDescriptors, imageModelReferences } from '../services/modelLibrary/imageAssociations';
import type { ModelInspectorItem, ModelManagerCommand, ModelLocalMetadata, RemoteModelVersion, ModelWatchRecord } from '../services/modelLibrary/types';

export const modelButton = 'rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-100 hover:bg-gray-800 disabled:opacity-50';
export const modelInput = 'w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100';

export async function executeModelCommand(command: ModelManagerCommand) {
  if (new URLSearchParams(window.location.search).get('window') === 'model-inspector') {
    const result = await window.electronAPI!.modelManagerCommand(command);
    if (!result.success) throw new Error(result.error || 'Model action failed.');
    return result.lookup;
  } else return runModelCommand(command);
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

export function ModelActionsPanel({ item, revealUpdates = 0 }: { item: ModelInspectorItem; revealUpdates?: number }) {
  const manager = useModelManager(); const [link, setLink] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const civitai = item.location.civitai && 'modelId' in item.location.civitai ? item.location.civitai : undefined;
  const watch = civitai ? manager.watches[String(civitai.modelId)] : undefined;
  const locations = item.location.sha256 ? manager.catalog.locations.filter((location) => location.sha256 === item.location.sha256) : [item.location];
  const hasHF = locations.some((location) => location.huggingFace);
  const hasCivitai = locations.some((location) => location.civitai && 'modelId' in location.civitai);
  useEffect(() => { setError(''); setLink(''); }, [item.location.id]);
  const execute = async (command: ModelManagerCommand) => { setError(''); setBusy(true); try { await executeModelCommand(command); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  const folderDefault = modelFolderWatchDefault(item);
  return <section className="space-y-3 rounded-lg border border-gray-800 p-3">
    <div className="flex flex-wrap gap-2"><button className={modelButton} disabled={busy || Boolean(manager.progress)} onClick={() => void execute({ type: hasCivitai || hasHF ? 'check' : 'identify', locationId: item.location.id })}>{hasCivitai || hasHF ? watch?.error ? 'Try again' : 'Check for updates' : 'Identify on Civitai'}</button><button className={modelButton} onClick={() => void execute({ type: 'saveLocal', locationId: item.location.id, patch: { favorite: !item.localMetadata?.favorite } })}>{item.localMetadata?.favorite ? '★ Favorited' : '☆ Favorite'}</button></div>
    <details><summary className="cursor-pointer text-xs text-gray-400">Automatic Civitai monitoring</summary><label className="mt-2 block text-xs text-gray-400">Follow this model<select className={modelInput} value={typeof item.localMetadata?.watchUpdates === 'boolean' ? String(item.localMetadata.watchUpdates) : 'inherit'} onChange={(event) => void execute({ type: 'saveLocal', locationId: item.location.id, patch: { watchUpdates: event.target.value === 'inherit' ? undefined : event.target.value === 'true' } })}><option value="inherit">Folder default ({folderDefault ? 'on' : 'off'})</option><option value="true">On</option><option value="false">Off</option></select></label><p className="mt-2 text-xs text-gray-400">Identifies unlinked files and checks Civitai while the app is open.</p></details>
    {!civitai && <p className="text-xs text-gray-400">Not identified on Civitai yet. Identification calculates this file's hash and sends it to Civitai.</p>}
    {civitai && <><p className="text-sm">{civitai.versionName} · {civitai.baseModel || 'Unknown base model'} <span className="text-xs text-gray-400">({civitai.binding || 'hash'} link)</span></p><button className={modelButton} onClick={() => void window.electronAPI?.openExternalUrl(civitai.url)}>Open version on Civitai</button></>}
    <details><summary className="cursor-pointer text-xs text-gray-400">{civitai ? 'Change or remove version link' : 'Link a Civitai version manually'}</summary><p className="my-2 text-xs text-gray-400">Paste the version link containing modelVersionId. A model-only link cannot identify your installed version.</p><input className={modelInput} value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://civitai.com/models/…?modelVersionId=…" /><button className={`${modelButton} mt-2`} disabled={busy || Boolean(manager.progress)} onClick={() => void execute({ type: 'bind', locationId: item.location.id, url: link })}>Validate and link version</button>{civitai && <button className={`${modelButton} ml-2`} onClick={() => void execute({ type: 'unbind', locationId: item.location.id })}>Remove link and stop monitoring</button>}</details>
    {manager.checkResult?.locationIds.length === 1 && manager.checkResult.locationIds[0] === item.location.id && <p role="status" className="text-xs text-gray-400">{manager.checkResult.message}</p>}
    <ModelVersionLinks item={item} reveal={revealUpdates} />
    {civitai && !watch?.lastSuccessAt && <p className="text-xs text-gray-400">No update check completed yet.</p>}
    {watch && <><p className="text-xs text-gray-400">Last successful check: {watch.lastSuccessAt ? new Date(watch.lastSuccessAt).toLocaleString() : 'Never'}</p>{watch.error && <p className="text-xs text-amber-400">Could not check this model: {watch.error}</p>}{watch.chronologyUnknown && <p className="text-xs text-amber-400">Some version dates are unavailable; chronology is indeterminate.</p>}</>}
    {item.location.metadataError && <p className="text-xs text-amber-400">Embedded metadata: {item.location.metadataError}</p>}
    <details><summary className="cursor-pointer text-xs text-gray-400">{locations.length} file location{locations.length === 1 ? '' : 's'}</summary>{locations.map((location) => <button className="mt-2 block break-all text-left text-xs text-gray-300" key={location.id} onClick={() => void window.electronAPI?.modelLibraryRevealLocation(location.absolutePath)}>{location.absolutePath}</button>)}</details>
    <button className={`${modelButton} border-red-900 text-red-300`} disabled={busy || Boolean(manager.progress)} onClick={() => void execute({ type: 'remove', locationId: item.location.id })}>Remove files…</button>
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

function ReleaseRow({ version, watch, local, compact = false }: { version: RemoteModelVersion; watch: ModelWatchRecord; local: ReturnType<typeof installedVersions>; compact?: boolean }) {
  const reference = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const seen = watch.seenVersionIds.includes(version.id);
  const ignored = watch.ignoredVersionIds.includes(version.id);
  const installed = local.some((item) => item.versionId === version.id);
  useEffect(() => {
    if (seen || ignored || installed || !watch.novelVersionIds.includes(version.id) || !reference.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (timer) clearTimeout(timer);
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) timer = setTimeout(() => {
        observer.disconnect();
        void executeModelCommand({ type: 'seen', modelId: watch.modelId, versionIds: [version.id] }).catch((failure) => setError(failure.message));
      }, 250);
    }, { threshold: 0.5 });
    observer.observe(reference.current);
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
  }, [watch.modelId, version.id, seen, ignored, installed]);
  const bases = local.map((item) => item.baseModel).filter((base): base is string => Boolean(base));
  return <div className="mt-2 rounded border border-gray-800 bg-gray-950 p-3"><div ref={reference} className="flex items-start justify-between gap-2"><button className="text-left text-sm font-medium text-cyan-200 hover:underline" onClick={() => void window.electronAPI?.openExternalUrl(version.url)}>{version.name} ↗</button><details className="relative shrink-0"><summary aria-label={`Actions for ${version.name}`} className="cursor-pointer list-none px-2 text-gray-400">⋯</summary><div className="absolute right-0 z-10 w-44 rounded border border-gray-700 bg-gray-900 p-2"><button className="w-full p-2 text-left text-xs hover:bg-gray-800" onClick={() => void executeModelCommand({ type: 'versionAction', modelId: watch.modelId, versionId: version.id, action: ignored ? 'restore' : 'ignore' }).catch((failure) => setError(failure.message))}>{ignored ? 'Restore release' : 'Ignore this release'}</button></div></details></div><p className="mt-1 text-xs text-gray-400">{version.baseModel || 'Unknown base'} · {modelFamily(version, bases)}{installed ? ' · Installed' : ignored ? ' · Ignored' : seen ? ' · Viewed' : ''}</p>{!compact && <><p className="mt-1 text-xs text-gray-500">{versionDate(version) === null ? 'Date unavailable' : new Date(versionDate(version)!).toLocaleDateString()}</p>{version.description && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300">{version.description}</p>}</>}{error && <p role="alert" className="text-xs text-red-400">{error}</p>}</div>;
}

export function ModelVersionLinks({ item, reveal = 0 }: { item: ModelInspectorItem; reveal?: number }) {
  const manager = useModelManager(); const [expanded, setExpanded] = useState(reveal > 0); const [history, setHistory] = useState(false);
  useEffect(() => { setExpanded(reveal > 0); setHistory(false); }, [item.location.id, reveal]);
  const link = item.location.civitai && 'modelId' in item.location.civitai ? item.location.civitai : undefined;
  const watch = link ? manager.watches[String(link.modelId)] : undefined;
  if (!watch) return null;
  const local = installedVersions(watch.modelId);
  const versions = history ? watch.versions : watch.versions.filter((version) => watch.novelVersionIds.includes(version.id) && !watch.ignoredVersionIds.includes(version.id) && !local.some((entry) => entry.versionId === version.id));
  const unread = unreadVersions(watch, local.map((entry) => entry.versionId)).length;
  return <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}><summary className="cursor-pointer text-sm text-cyan-200">What's new{unread > 0 ? ` · ${unread} unread` : ''}</summary>{expanded && <div className="mt-2">{!versions.length && <p className="text-xs text-gray-400">No new releases found.</p>}{versions.map((version) => <ReleaseRow key={version.id} version={version} watch={watch} local={local} compact />)}<button className="mt-3 text-xs text-gray-400 hover:text-gray-200" onClick={() => setHistory(!history)}>{history ? 'Hide release history' : 'Show release history'}</button></div>}</details>;
}

export function ReleaseGroup({ watch, history, onOpen }: { watch: ModelWatchRecord; history: boolean; onOpen: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const local = installedVersions(watch.modelId);
  const unread = unreadVersions(watch, local.map((entry) => entry.versionId)).length;
  const versions = history ? watch.versions : watch.versions.filter((version) => watch.novelVersionIds.includes(version.id) && !watch.ignoredVersionIds.includes(version.id) && !local.some((entry) => entry.versionId === version.id));
  return <details open={expanded} className="rounded-lg border border-gray-800 bg-gray-900 p-4" onToggle={(event) => { setExpanded(event.currentTarget.open); if (event.currentTarget.open) onOpen(); }}><summary className="cursor-pointer"><span className="font-semibold">Civitai · {watch.modelName}</span>{unread > 0 && <span className="ml-2 text-xs text-cyan-300">{unread} unread release{unread === 1 ? '' : 's'}</span>}<p className="mt-1 text-xs text-gray-400">Installed: {Array.from(new Set(local.map((entry) => `${entry.versionName} (${entry.baseModel || 'unknown base'})`))).join(' · ')}</p></summary>{expanded && <div className="mt-3">{watch.error && <p className="text-xs text-amber-400">Could not check for updates: {watch.error}</p>}{!versions.length && <p className="text-sm text-gray-400">No new releases found.</p>}{versions.map((version) => <ReleaseRow key={version.id} version={version} watch={watch} local={local} />)}</div>}</details>;
}

function ModelLibraryImage({ image, association, onChoose }: { image: IndexedImage; association: 'confirmed' | 'suggested' | 'ambiguous' | null; onChoose: () => void }) {
  const thumbnail = useResolvedThumbnail(image);
  useEffect(() => { void thumbnailManager.loadIndexedThumbnail(image).catch(() => {}); }, [image.id, image.lastModified]);
  return <button disabled={!thumbnail?.thumbnailUrl} className="overflow-hidden rounded border border-gray-800 p-2 text-left disabled:opacity-50" onClick={onChoose}>{thumbnail?.thumbnailUrl ? <img src={thumbnail.thumbnailUrl} alt="" className="h-28 w-full object-contain" /> : <div className="flex h-28 items-center justify-center text-xs text-gray-500">Thumbnail unavailable</div>}<p className="truncate text-xs">{image.name}</p>{association && <p className="text-xs text-cyan-300">{association === 'confirmed' ? 'Hash confirmed' : association === 'ambiguous' ? 'Ambiguous name match' : 'Name match'}</p>}</button>;
}

export function ModelLibraryPicker() {
  const manager = useModelManager(); const images = useImageStore((state) => state.images); const [query, setQuery] = useState(''); const [suggestions, setSuggestions] = useState(true); const [limit, setLimit] = useState(60); const [error, setError] = useState('');
  const location = manager.picker ? manager.catalog.locations.find((item) => item.id === manager.picker!.locationId) : undefined;
  useEffect(() => { setQuery(''); setSuggestions(true); setLimit(60); setError(''); }, [manager.picker]);
  const descriptor = useMemo(() => buildModelDescriptors(manager.catalog).find((model) => location && model.locationIds.includes(location.id)), [manager.catalog, location]);
  const available = useMemo(() => images.filter((image) => !['video', 'audio', 'model3d'].includes(image.metadata.normalizedMetadata?.media_type ?? '')).map((image) => ({ image, association: descriptor ? associateReferences(imageModelReferences(image), descriptor) : null })).filter(({ image, association }) => image.name.toLowerCase().includes(query.toLowerCase()) && (!suggestions || association === 'confirmed' || association === 'suggested')), [images, descriptor, query, suggestions]);
  if (!manager.picker || !location) return null;
  const picker = manager.picker;
  return <div role="dialog" aria-modal="true" aria-label="Choose model image" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-5"><section className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-gray-700 bg-gray-950 p-5 text-gray-100"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{picker.cover ? 'Choose library cover' : 'Link library examples'}</h2><button className={modelButton} onClick={closeModelPicker}>Close</button></div><p className="my-2 text-xs text-gray-400">Uses indexed thumbnails only. Name matches are suggestions; only matching full hashes confirm the model/version.</p><input className={modelInput} placeholder="Search indexed image names" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(60); }} /><label className="my-3 text-sm"><input type="checkbox" checked={suggestions} onChange={(event) => setSuggestions(event.target.checked)} /> Only images matching this model</label>{error && <p role="alert" className="text-sm text-red-400">{error}</p>}<div className="min-h-0 overflow-auto"><div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">{available.slice(0, limit).map(({ image, association }) => <ModelLibraryImage key={image.id} image={image} association={association} onChoose={() => { void runModelCommand({ type: 'libraryMedia', locationId: picker.locationId, imageId: image.id, cover: picker.cover }).then(() => { if (picker.cover) closeModelPicker(); }).catch((error) => setError(error.message)); }} />)}</div>{!available.length && <p className="py-4 text-gray-400">No indexed images match. Uncheck the model filter to browse your whole library.</p>}{available.length > limit && <button className={`${modelButton} mt-3`} onClick={() => setLimit(limit + 60)}>Show more</button>}</div></section></div>;
}
