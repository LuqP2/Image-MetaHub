import { formatMessage } from '../i18n/messages.mjs';
import { useTranslation } from '../i18n/useTranslation';
import { translateModelMessage } from '../i18n/modelMessages';
import { useResolvedThumbnail } from '../hooks/useResolvedThumbnail';
import { thumbnailManager } from '../services/thumbnailManager';
import type { IndexedImage } from '../types';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useImageStore } from '../store/useImageStore';
import { closeModelPicker, modelFolderWatchDefault, runModelCommand, useModelManager, installedVersions } from '../services/modelLibrary/manager';
import { modelFamily, unreadVersions, versionDate } from '../services/modelLibrary/updateTracking';
import { associateReferences, buildModelDescriptors, imageModelReferences } from '../services/modelLibrary/imageAssociations';
import type { ModelInspectorItem, ModelManagerCommand, RemoteModelVersion, ModelWatchRecord } from '../services/modelLibrary/types';

export const modelButton = 'ui-btn';
export const modelInput = 'ui-input';
export const modelSelect = 'ui-select w-full';

export async function executeModelCommand(command: ModelManagerCommand) {
  if (new URLSearchParams(window.location.search).get('window') === 'model-inspector') {
    const result = await window.electronAPI!.modelManagerCommand(command);
    if (!result.success) throw new Error(result.error || formatMessage('en', 'modelLibrary.actionFailed'));
    return result.lookup;
  } else return runModelCommand(command);
}

export { default as ModelLocalEditor } from './ModelMetadataEditor';

export function ModelQuickActions({ item }: { item: ModelInspectorItem }) {
  const { t } = useTranslation();
  const manager = useModelManager();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = useRef(item.location.id); selected.current = item.location.id;
  useEffect(() => { setError(''); }, [item.location.id]);
  const locations = item.location.sha256 ? manager.catalog.locations.filter((location) => location.sha256?.toLowerCase() === item.location.sha256?.toLowerCase()) : [item.location];
  const linked = locations.some((location) => location.huggingFace || location.civitai && 'modelId' in location.civitai);
  const execute = async (command: ModelManagerCommand) => {
    const id = item.location.id; setBusy(true); setError('');
    try { await executeModelCommand(command); } catch (failure) { if (selected.current === id) setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2"><div className="flex flex-wrap gap-2"><button className={modelButton} disabled={busy || Boolean(manager.progress)} onClick={() => void execute({ type: linked ? 'check' : 'identify', locationId: item.location.id })}>{linked ? t('modelLibrary.checkUpdates') : t('modelLibrary.identifyCivitai')}</button><button className={modelButton} disabled={busy} onClick={() => void execute({ type: 'saveLocal', locationId: item.location.id, patch: { favorite: !item.localMetadata?.favorite } })}>{item.localMetadata?.favorite ? t('modelLibrary.favorited') : t('modelLibrary.favorite')}</button><button className={modelButton} onClick={() => { const id = item.location.id; void window.electronAPI?.modelLibraryRevealLocation(item.location.absolutePath).then((result) => { if (!result.success) throw new Error(result.error || 'modelLibrary.revealFailed'); }).catch((failure: Error) => { if (selected.current === id) setError(failure.message); }); }}>{t('modelLibrary.showFolder')}</button><button className={modelButton} disabled={busy} onClick={() => void execute({ type: 'saveLocal', locationId: item.location.id, patch: { hidden: !item.localMetadata?.hidden } })}>{item.localMetadata?.hidden ? t('modelLibrary.unhide') : t('modelLibrary.hide')}</button></div>{manager.checkResult?.locationIds.length === 1 && manager.checkResult.locationIds[0] === item.location.id && <p role="status" className="text-xs text-gray-400">{translateModelMessage(manager.checkResult.message, t)}</p>}{error && <p role="alert" className="text-xs text-red-400 light:text-red-800">{translateModelMessage(error, t)}</p>}</div>;
}

export function ModelFilesPanel({ item }: { item: ModelInspectorItem }) {
  const { t } = useTranslation();
  const manager = useModelManager();
  const [error, setError] = useState('');
  const selected = useRef(item.location.id); selected.current = item.location.id;
  useEffect(() => { setError(''); }, [item.location.id]);
  const locations = item.location.sha256 ? manager.catalog.locations.filter((location) => location.sha256?.toLowerCase() === item.location.sha256?.toLowerCase()) : [item.location];
  const paths = [...new Set(locations.map((location) => location.absolutePath))];
  return <section className="space-y-3 rounded-lg border border-gray-800 p-3"><p className="text-xs text-gray-400">{t('modelLibrary.fileLocations', { count: paths.length })}</p>{paths.map((path) => <button className="block break-all text-left text-xs text-gray-300" key={path} onClick={() => { void window.electronAPI?.modelLibraryRevealLocation(path).catch((failure: Error) => setError(failure.message)); }}>{path}</button>)}<button className={`${modelButton} border-red-900 text-red-300 light:border-red-800/50 light:text-red-800 light:enabled:hover:bg-red-500/10 light:disabled:opacity-100 light:disabled:border-gray-700 light:disabled:text-gray-500`} disabled={Boolean(manager.progress)} onClick={() => { const id = item.location.id; void executeModelCommand({ type: 'remove', locationId: id }).catch((failure: Error) => { if (selected.current === id) setError(failure.message); }); }}>{t('modelLibrary.removeFiles')}</button>{error && <p role="alert" className="text-xs text-red-400 light:text-red-800">{translateModelMessage(error, t)}</p>}</section>;
}

export function ModelActionsPanel({ item, revealUpdates = 0, grouped = false }: { item: ModelInspectorItem; revealUpdates?: number; grouped?: boolean }) {
  const { t, language } = useTranslation();
  const manager = useModelManager(); const [link, setLink] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const civitai = item.location.civitai && 'modelId' in item.location.civitai ? item.location.civitai : undefined;
  const watch = civitai ? manager.watches[String(civitai.modelId)] : undefined;
  useEffect(() => { setError(''); setLink(''); }, [item.location.id]);
  const execute = async (command: ModelManagerCommand) => { setError(''); setBusy(true); try { await executeModelCommand(command); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  const folderDefault = modelFolderWatchDefault(item);
  return <section className="space-y-3 rounded-lg border border-gray-700/50 bg-gray-900/60 p-3">
    <h3 className="text-xs font-semibold text-gray-200">Civitai</h3>
    {!grouped && <ModelQuickActions item={item} />}
    <details className="ui-disclosure"><summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-200">{t('modelLibrary.autoCivitai')}</summary><label className="mt-2 block text-xs text-gray-400">{t('modelLibrary.followModel')}<select className={`${modelSelect} mt-1`} value={typeof item.localMetadata?.watchUpdates === 'boolean' ? String(item.localMetadata.watchUpdates) : 'inherit'} onChange={(event) => void execute({ type: 'saveLocal', locationId: item.location.id, patch: { watchUpdates: event.target.value === 'inherit' ? undefined : event.target.value === 'true' } })}><option value="inherit">{t(folderDefault ? 'modelLibrary.folderDefaultOn' : 'modelLibrary.folderDefaultOff')}</option><option value="true">{t('modelLibrary.on')}</option><option value="false">{t('modelLibrary.off')}</option></select></label><p className="mt-2 text-xs text-gray-400">{t('modelLibrary.monitorHelp')}</p></details>
    {!civitai && <p className="text-xs text-gray-400">{t('modelLibrary.identifyHelp')}</p>}
    {civitai && <><p className="text-xs text-gray-200">{civitai.versionName} · {civitai.baseModel || t('modelLibrary.unknownBase')} <span className="text-xs text-gray-400">{t('modelLibrary.bindingLink', { binding: civitai.binding || 'hash' })}</span></p><button className={modelButton} onClick={() => void window.electronAPI?.openExternalUrl(civitai.url)}>{t('modelLibrary.openVersion')}</button></>}
    <details className="ui-disclosure"><summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-200">{civitai ? t('modelLibrary.changeLink') : t('modelLibrary.manualLink')}</summary><p className="my-2 text-xs text-gray-400">{t('modelLibrary.versionLinkHelp')}</p><input className={modelInput} value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://civitai.com/models/…?modelVersionId=…" /><button className={`${modelButton} mt-2`} disabled={busy || Boolean(manager.progress)} onClick={() => void execute({ type: 'bind', locationId: item.location.id, url: link })}>{t('modelLibrary.validateLink')}</button>{civitai && <button className={`${modelButton} ml-2`} onClick={() => void execute({ type: 'unbind', locationId: item.location.id })}>{t('modelLibrary.removeLink')}</button>}</details>
    <ModelVersionLinks item={item} reveal={revealUpdates} />
    {civitai && !watch?.lastSuccessAt && <p className="text-xs text-gray-400">{t('modelLibrary.noCheck')}</p>}
    {watch && <><p className="text-xs text-gray-400">{t('modelLibrary.lastCheck', { date: watch.lastSuccessAt ? new Date(watch.lastSuccessAt).toLocaleString(language) : t('modelLibrary.never') })}</p>{watch.error && <p className="text-xs text-amber-400 light:text-amber-800">{t('modelLibrary.modelCheckFailed', { error: translateModelMessage(watch.error, t) })}</p>}{watch.chronologyUnknown && <p className="text-xs text-amber-400 light:text-amber-800">{t('modelLibrary.chronologyUnknown')}</p>}</>}
    {item.location.metadataError && <p className="text-xs text-amber-400 light:text-amber-800">{t('modelLibrary.metadataError', { error: item.location.metadataError })}</p>}
    {!grouped && <ModelFilesPanel item={item} />}
    {error && <p role="alert" className="text-xs text-red-400 light:text-red-800">{translateModelMessage(error, t)}</p>}
  </section>;
}

export function ModelMediaPanel({ item }: { item: ModelInspectorItem }) {
  const { t } = useTranslation();
  const manager = useModelManager(); const [limit, setLimit] = useState(12); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const linked = Boolean(item.location.civitai && 'versionId' in item.location.civitai);
  const examples = (item.localMetadata?.examples ?? []);
  useEffect(() => { setLimit(12); setError(''); }, [item.location.id]);
  const execute = async (command: ModelManagerCommand) => { setBusy(true); setError(''); try { await executeModelCommand(command); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  return <section className="space-y-3 rounded-lg border border-gray-800 p-3">
    <h3 className="font-medium">{t('modelLibrary.coverExamplesTitle')}</h3>
    <div className="flex flex-wrap gap-2"><button className={modelButton} disabled={busy} onClick={() => void execute({ type: 'chooseLibrary', locationId: item.location.id, cover: true })}>{t('modelLibrary.chooseCover')}</button>{item.localMetadata?.previewImage && <button className={modelButton} onClick={() => void execute({ type: 'saveLocal', locationId: item.location.id, patch: { previewImage: undefined } })}>{t('modelLibrary.restoreCover')}</button>}</div>
    {linked && !(item.location.civitai && 'coverImage' in item.location.civitai && item.location.civitai.coverImage) && <button className={modelButton} disabled={busy || Boolean(manager.progress)} onClick={() => void execute({ type: 'cover', locationId: item.location.id })}>{t('modelLibrary.loadCover')}</button>}
    <button className={modelButton} disabled={busy} onClick={() => void execute({ type: 'chooseLibrary', locationId: item.location.id, cover: false })}>{t('modelLibrary.addExamples')}</button>
    <button className={modelButton} disabled={busy || Boolean(manager.progress) || !linked} onClick={() => void execute({ type: 'examples', locationId: item.location.id })}>{busy ? t('modelLibrary.loading') : t('modelLibrary.loadExamples')}</button>
    <p className="text-xs text-gray-400">{linked ? t('modelLibrary.coverDemandHelp') : t('modelLibrary.coverIdentifyHelp')}</p>
    {!examples.length && <p className="text-xs text-gray-500">{t('modelLibrary.noExamples')}</p>}
    <div className="grid grid-cols-2 gap-3">{examples.slice(0, limit).map((example) => {
      const available = !example.imageId || manager.libraryIds?.includes(example.imageId);
      return <div key={example.id} className="min-w-0 rounded border border-gray-800 p-2"><button disabled={!example.imageId || !available} onClick={() => example.imageId && void execute({ type: 'openImage', imageId: example.imageId })}><img src={example.preview} alt={example.caption || t('modelLibrary.modelExample')} className="h-28 w-full object-contain" /></button>{!available && <p className="text-xs text-amber-400 light:text-amber-800">{t('modelLibrary.libraryUnavailable')}</p>}{example.versionId && <p className="text-xs text-gray-500">{t('modelLibrary.versionNumber', { version: example.versionId })}</p>}<input aria-label={t('modelLibrary.exampleCaption')} className={`${modelInput} mt-2`} defaultValue={example.caption} onBlur={(event) => { if (event.target.value !== example.caption) void execute({ type: 'example', locationId: item.location.id, exampleId: example.id, caption: event.target.value }); }} /><div className="mt-2 flex flex-wrap gap-2"><button className={modelButton} onClick={() => void execute({ type: 'saveLocal', locationId: item.location.id, patch: { previewImage: example.preview } })}>{t('modelLibrary.useCover')}</button><button className={modelButton} onClick={() => void execute({ type: 'example', locationId: item.location.id, exampleId: example.id, remove: true })}>{t('modelLibrary.unlink')}</button></div></div>;
    })}</div>
    {examples.length > limit && <button className={modelButton} onClick={() => setLimit(limit + 12)}>{t('modelLibrary.showMore')}</button>}
    {error && <p role="alert" className="text-xs text-red-400 light:text-red-800">{translateModelMessage(error, t)}</p>}
  </section>;
}

function ReleaseRow({ version, watch, local, compact = false }: { version: RemoteModelVersion; watch: ModelWatchRecord; local: ReturnType<typeof installedVersions>; compact?: boolean }) {
  const { t, language } = useTranslation();
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
  return <div className="mt-2 rounded-md border border-gray-700/50 bg-gray-950/70 p-3"><div ref={reference} className="flex items-start justify-between gap-2"><button className="text-left text-xs font-medium text-accent hover:underline" onClick={() => void window.electronAPI?.openExternalUrl(version.url)}>{version.name} ↗</button><details className="relative shrink-0"><summary aria-label={t('modelLibrary.actionsNamed', { name: version.name })} className="ui-icon-btn h-6 w-6 cursor-pointer list-none">⋯</summary><div className="ui-menu absolute right-0 z-10 w-44"><button className="ui-menu-item" onClick={() => void executeModelCommand({ type: 'versionAction', modelId: watch.modelId, versionId: version.id, action: ignored ? 'restore' : 'ignore' }).catch((failure) => setError(failure.message))}>{ignored ? t('modelLibrary.restoreRelease') : t('modelLibrary.ignoreRelease')}</button></div></details></div><p className="mt-1 text-xs text-gray-400">{version.baseModel || t('modelLibrary.unknownBaseShort')} · {translateModelMessage(modelFamily(version, bases), t)}{installed ? t('modelLibrary.installedSuffix') : ignored ? t('modelLibrary.ignoredSuffix') : seen ? t('modelLibrary.viewedSuffix') : ''}</p>{!compact && <><p className="mt-1 text-xs text-gray-500">{versionDate(version) === null ? t('modelLibrary.dateUnavailable') : new Date(versionDate(version)!).toLocaleDateString(language)}</p>{version.description && <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-gray-300">{version.description}</p>}</>}{error && <p role="alert" className="text-xs text-red-400 light:text-red-800">{translateModelMessage(error, t)}</p>}</div>;
}

export function ModelVersionLinks({ item, reveal = 0 }: { item: ModelInspectorItem; reveal?: number }) {
  const { t } = useTranslation();
  const manager = useModelManager(); const [expanded, setExpanded] = useState(reveal > 0); const [history, setHistory] = useState(false);
  useEffect(() => { setExpanded(reveal > 0); setHistory(false); }, [item.location.id, reveal]);
  const link = item.location.civitai && 'modelId' in item.location.civitai ? item.location.civitai : undefined;
  const watch = link ? manager.watches[String(link.modelId)] : undefined;
  if (!watch) return null;
  const local = installedVersions(watch.modelId);
  const versions = history ? watch.versions : watch.versions.filter((version) => watch.novelVersionIds.includes(version.id) && !watch.ignoredVersionIds.includes(version.id) && !local.some((entry) => entry.versionId === version.id));
  const unread = unreadVersions(watch, local.map((entry) => entry.versionId)).length;
  return <details className="ui-disclosure" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}><summary className="cursor-pointer text-xs font-medium text-accent">{t('modelLibrary.whatsNew')}{unread > 0 ? t('modelLibrary.unreadSuffix', { count: unread }) : ''}</summary>{expanded && <div className="mt-2">{!versions.length && <p className="text-xs text-gray-400">{t('modelLibrary.noReleases')}</p>}{versions.map((version) => <ReleaseRow key={version.id} version={version} watch={watch} local={local} compact />)}<button className="mt-3 text-xs text-gray-400 hover:text-gray-200" onClick={() => setHistory(!history)}>{history ? t('modelLibrary.hideHistory') : t('modelLibrary.showHistory')}</button></div>}</details>;
}

export function ReleaseGroup({ watch, history, onOpen }: { watch: ModelWatchRecord; history: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const local = installedVersions(watch.modelId);
  const unread = unreadVersions(watch, local.map((entry) => entry.versionId)).length;
  const versions = history ? watch.versions : watch.versions.filter((version) => watch.novelVersionIds.includes(version.id) && !watch.ignoredVersionIds.includes(version.id) && !local.some((entry) => entry.versionId === version.id));
  return <details open={expanded} className="ui-disclosure ui-card p-3.5" onToggle={(event) => { setExpanded(event.currentTarget.open); if (event.currentTarget.open) onOpen(); }}><summary className="cursor-pointer"><span className="text-sm font-semibold text-gray-100">{'Civitai'} · {watch.modelName}</span>{unread > 0 && <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">{t('modelLibrary.unreadReleases', { count: unread })}</span>}<p className="mt-1 pl-[18px] text-xs text-gray-400">{t('modelLibrary.installedVersions', { versions: Array.from(new Set(local.map((entry) => `${entry.versionName} (${entry.baseModel || t('modelLibrary.unknownBaseShort')})`))).join(' · ') })}</p></summary>{expanded && <div className="mt-3">{watch.error && <p className="text-xs text-amber-400 light:text-amber-800">{t('modelLibrary.updatesError', { error: translateModelMessage(watch.error, t) })}</p>}{!versions.length && <p className="text-xs text-gray-400">{t('modelLibrary.noReleases')}</p>}{versions.map((version) => <ReleaseRow key={version.id} version={version} watch={watch} local={local} />)}</div>}</details>;
}

function ModelLibraryImage({ image, association, onChoose }: { image: IndexedImage; association: 'confirmed' | 'suggested' | 'ambiguous' | null; onChoose: () => void }) {
  const { t } = useTranslation();
  const thumbnail = useResolvedThumbnail(image);
  useEffect(() => { void thumbnailManager.loadIndexedThumbnail(image).catch(() => {}); }, [image.id, image.lastModified]);
  return <button disabled={!thumbnail?.thumbnailUrl} className="overflow-hidden rounded-md border border-gray-700/50 bg-gray-900/70 p-2 text-left transition-colors hover:border-gray-600 disabled:opacity-50" onClick={onChoose}>{thumbnail?.thumbnailUrl ? <img src={thumbnail.thumbnailUrl} alt="" className="h-28 w-full object-contain" /> : <div className="flex h-28 items-center justify-center text-xs text-gray-500">{t('modelLibrary.thumbnailUnavailable')}</div>}<p className="mt-1 truncate text-xs text-gray-200">{image.name}</p>{association && <p className="text-[11px] text-accent">{association === 'confirmed' ? t('modelLibrary.hashConfirmed') : association === 'ambiguous' ? t('modelLibrary.ambiguousName') : t('modelLibrary.nameMatch')}</p>}</button>;
}

export function ModelLibraryPicker() {
  const { t } = useTranslation();
  const manager = useModelManager(); const images = useImageStore((state) => state.images); const [query, setQuery] = useState(''); const [suggestions, setSuggestions] = useState(true); const [limit, setLimit] = useState(60); const [error, setError] = useState('');
  const location = manager.picker ? manager.catalog.locations.find((item) => item.id === manager.picker!.locationId) : undefined;
  useEffect(() => { setQuery(''); setSuggestions(true); setLimit(60); setError(''); }, [manager.picker]);
  const descriptor = useMemo(() => buildModelDescriptors(manager.catalog).find((model) => location && model.locationIds.includes(location.id)), [manager.catalog, location]);
  const available = useMemo(() => images.filter((image) => !['video', 'audio', 'model3d'].includes(image.metadata.normalizedMetadata?.media_type ?? '')).map((image) => ({ image, association: descriptor ? associateReferences(imageModelReferences(image), descriptor) : null })).filter(({ image, association }) => image.name.toLowerCase().includes(query.toLowerCase()) && (!suggestions || association === 'confirmed' || association === 'suggested')), [images, descriptor, query, suggestions]);
  if (!manager.picker || !location) return null;
  const picker = manager.picker;
  return <div role="dialog" aria-modal="true" aria-label={t('modelLibrary.chooseModelImage')} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"><section className="ui-dialog flex max-h-[85vh] w-full max-w-4xl flex-col p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{picker.cover ? t('modelLibrary.chooseLibraryCover') : t('modelLibrary.linkExamples')}</h2><button className="ui-btn-ghost" onClick={closeModelPicker}>{t('modelLibrary.close')}</button></div><p className="my-2 text-xs text-gray-400">{t('modelLibrary.thumbnailHelp')}</p><input className={modelInput} placeholder={t('modelLibrary.searchImages')} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(60); }} /><label className="my-3 inline-flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" className="ui-checkbox" checked={suggestions} onChange={(event) => setSuggestions(event.target.checked)} /> {t('modelLibrary.onlyMatchingImages')}</label>{error && <p role="alert" className="text-xs text-red-400 light:text-red-800">{translateModelMessage(error, t)}</p>}<div className="min-h-0 overflow-auto"><div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">{available.slice(0, limit).map(({ image, association }) => <ModelLibraryImage key={image.id} image={image} association={association} onChoose={() => { void runModelCommand({ type: 'libraryMedia', locationId: picker.locationId, imageId: image.id, cover: picker.cover }).then(() => { if (picker.cover) closeModelPicker(); }).catch((error) => setError(error.message)); }} />)}</div>{!available.length && <p className="py-4 text-xs text-gray-400">{t('modelLibrary.noIndexedMatches')}</p>}{available.length > limit && <button className={`${modelButton} mt-3`} onClick={() => setLimit(limit + 60)}>{t('modelLibrary.showMore')}</button>}</div></section></div>;
}
