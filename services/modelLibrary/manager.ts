import { externalizeModelMedia } from './mediaStorage';
import { mergeModelMetadata } from './mergeMetadata';
import { thumbnailManager } from '../thumbnailManager';
import { useSyncExternalStore } from 'react';
import { useImageStore } from '../../store/useImageStore';
import { EMPTY_MODEL_CATALOG, MODEL_CATALOG_CACHE_ID, buildManagedModels, reconcileModelCatalog, validModelCatalog } from './catalog';
import { getModelLocalMetadata, getModelLocalMetadataId } from './presentation';
import { getAllModelSources, saveModelSource, deleteModelSource } from './modelSourceStorage';
import { getAllModelLocalMetadata, createModelLocalMetadata, saveModelLocalMetadata, deleteModelLocalMetadata } from './localMetadataStorage';
import { loadWatchPreferences, saveWatchPreference } from './watchStorage';
import { isWatchDue, parseCivitaiVersionLink, reconcileWatch, unreadVersions } from './updateTracking';
import type { ModelInspectorItem, ModelLocalMetadata, ModelManagerCommand, ModelManagerSnapshot, ModelSource, ModelWatchRecord } from './types';

let state: ModelManagerSnapshot = { revision: 0, sources: [], catalog: EMPTY_MODEL_CATALOG, localMetadata: {}, watches: {}, intervalHours: 24, loading: true, progress: null, message: null, notification: null };
const listeners = new Set<() => void>();
let initialization: Promise<void> | undefined;
let managerRunning = false;
let writes = Promise.resolve();
let localWrites = Promise.resolve();
let watchWrites = Promise.resolve();
let cancelled = false;
let activeHash: string | undefined;
let activeRemote: string | undefined;
let rateLimitedUntil = 0;
let releaseWait: (() => void) | undefined;
let openImage: ((id: string) => void) | undefined;
let publishTimer: ReturnType<typeof setTimeout> | undefined;

export const getModelManagerState = () => state;
function publish(patch: Partial<ModelManagerSnapshot>) {
  state = { ...state, ...patch, revision: state.revision + 1 };
  listeners.forEach((listener) => listener());
  if (!publishTimer) publishTimer = setTimeout(() => { void flushModelState().catch((error) => {
    state = { ...state, message: error.message }; listeners.forEach((listener) => listener());
  }); }, 100);
}
async function flushModelState() {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = undefined;
  const result = await window.electronAPI?.modelManagerPublish(state);
  if (result && !result.success) throw new Error(result.error || 'Unable to save model preferences.');
}
export function useModelManager() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getModelManagerState);
}
export function setModelImageOpener(callback: (id: string) => void) { openImage = callback; }
export function managerMessage(message: string | null) { publish({ message }); }
export function dismissModelNotification() { publish({ notification: null }); }
export function showModelUpdates(showUpdates: boolean) { publish({ showUpdates }); }
export function closeModelPicker() { publish({ picker: null }); }
export function mirrorModelManager() {
  const apply = (next: ModelManagerSnapshot | null) => { if (next && next.revision >= state.revision) { state = next; listeners.forEach((listener) => listener()); } };
  const unsubscribe = window.electronAPI?.onModelManagerState(apply);
  void window.electronAPI?.modelManagerGetState().then(apply);
  return () => unsubscribe?.();
}

function persistCatalog() {
  const catalog = state.catalog;
  const write = writes.catch(() => {}).then(async () => {
    const result = await window.electronAPI?.writeJsonCacheData({ cacheId: MODEL_CATALOG_CACHE_ID, data: catalog });
    if (result && !result.success) throw new Error('Unable to save the model catalog.');
  });
  writes = write;
  return write;
}
export function modelItem(locationId: string): ModelInspectorItem {
  const location = state.catalog.locations.find((item) => item.id === locationId);
  if (!location) throw new Error('This model is no longer in the catalog.');
  return { location, localMetadata: getModelLocalMetadata(state.localMetadata, location) };
}
async function patchLocation(locationId: string, patch: Partial<ModelInspectorItem['location']>) {
  patch = await externalizeModelMedia(patch);
  const locations = state.catalog.locations.map((location) => location.id === locationId ? { ...location, ...patch } : location);
  publish({ catalog: { ...state.catalog, locations, managedModels: buildManagedModels(locations), updatedAt: Date.now() } });
  return persistCatalog();
}
export function saveModelPatch(locationId: string, patch: Partial<ModelLocalMetadata> | ((current: ModelLocalMetadata | undefined) => Partial<ModelLocalMetadata>)) {
  const save = localWrites.catch(() => {}).then(async () => {
    const item = modelItem(locationId);
    const values = await externalizeModelMedia(typeof patch === 'function' ? patch(item.localMetadata) : patch);
    const saved = await saveModelLocalMetadata(createModelLocalMetadata(item.location, { tags: [], ...item.localMetadata, ...values }));
    publish({ localMetadata: { ...state.localMetadata, [saved.id]: saved } });
    await flushModelState();
    if (values.watchUpdates === true && !state.progress) void scheduledCheck().catch((error) => managerMessage(error.message));
  });
  localWrites = save;
  return save;
}
export function isModelWatched(item: ModelInspectorItem): boolean {
  if (typeof item.localMetadata?.watchUpdates === 'boolean') return item.localMetadata.watchUpdates;
  return modelFolderWatchDefault(item);
}
export function modelFolderWatchDefault(item: ModelInspectorItem): boolean {
  const locations = item.location.sha256 ? state.catalog.locations.filter((location) => location.sha256 === item.location.sha256) : [item.location];
  return locations.some((location) => state.sources.find((source) => source.id === location.sourceId)?.watchUpdates);
}
export function installedVersions(modelId: number) {
  return state.catalog.locations.flatMap((location) => location.civitai && 'modelId' in location.civitai && location.civitai.modelId === modelId ? [location.civitai] : []);
}
export function unreadModelCount() {
  return Object.values(state.watches).reduce((count, watch) => {
    const installed = installedVersions(watch.modelId);
    return count + (installed.length && unreadVersions(watch, installed.map((item) => item.versionId)).length ? 1 : 0);
  }, 0);
}
function storeWatch(id: string, update: (current: ModelWatchRecord | undefined) => ModelWatchRecord) {
  const save = watchWrites.catch(() => {}).then(async () => {
    const watch = update(state.watches[id]);
    await saveWatchPreference(watch);
    publish({ watches: { ...state.watches, [watch.id]: watch } });
    await flushModelState();
    return watch;
  });
  watchWrites = save.then(() => {});
  return save;
}
export async function setModelInterval(intervalHours: number) {
  if (![6, 24, 168].includes(intervalHours)) return;
  await saveWatchPreference({ id: 'settings', intervalHours });
  publish({ intervalHours });
}
export async function markModelVersion(modelId: number, versionId: number, action: 'seen' | 'ignore' | 'restore') {
  if (!state.watches[String(modelId)]) return;
  await storeWatch(String(modelId), (watch) => ({ ...watch!,
    seenVersionIds: action === 'seen' ? Array.from(new Set([...watch!.seenVersionIds, versionId])) : watch!.seenVersionIds,
    ignoredVersionIds: action === 'ignore' ? Array.from(new Set([...watch!.ignoredVersionIds, versionId])) : action === 'restore' ? watch!.ignoredVersionIds.filter((id) => id !== versionId) : watch!.ignoredVersionIds,
  }));
}
export async function markModelVersionsSeen(modelId: number, versionIds: number[]) {
  const watch = state.watches[String(modelId)];
  if (!watch || !installedVersions(modelId).length) return;
  const valid = new Set(watch.versions.map((version) => version.id));
  const ids = versionIds.filter((id) => valid.has(id) && !watch.seenVersionIds.includes(id));
  if (!ids.length) return;
  await storeWatch(String(modelId), (latest) => ({ ...latest!, seenVersionIds: [...new Set([...latest!.seenVersionIds, ...ids])] }));
}
export async function stopWatchingModel(modelId: number) {
  for (const location of state.catalog.locations) if (location.civitai && 'modelId' in location.civitai && location.civitai.modelId === modelId) await saveModelPatch(location.id, { watchUpdates: false });
}
export function cancelModelJob() {
  cancelled = true;
  releaseWait?.();
  if (activeHash) void window.electronAPI?.modelLibraryCancelHash(activeHash);
  if (activeRemote) void window.electronAPI?.modelManagerCancelRemote(activeRemote);
}
function startJob(kind: NonNullable<ModelManagerSnapshot['progress']>['kind'], total: number) {
  if (state.progress) throw new Error('Another model job is running. Stop it or wait for it to finish.');
  cancelled = false;
  publish({ progress: { kind, current: 0, total, name: '' }, message: null });
}
function progress(current: number, name: string) { if (state.progress) publish({ progress: { ...state.progress, current, name } }); }

async function remote(kind: 'model' | 'version' | 'examples' | 'hash' | 'cover', id: number | string) {
  if (rateLimitedUntil > Date.now()) {
    publish({ message: 'Civitai rate limit: waiting before the next request. You can stop this job.' });
    await new Promise<void>((resolve) => { const timer = setTimeout(() => { releaseWait = undefined; resolve(); }, Math.min(rateLimitedUntil - Date.now(), 2147483647)); releaseWait = () => { clearTimeout(timer); releaseWait = undefined; resolve(); }; });
  }
  if (cancelled) throw new Error('Cancelled.');
  const requestId = crypto.randomUUID(); activeRemote = requestId;
  try {
    const result = await window.electronAPI!.modelManagerRemote({ kind, id, requestId });
    if (result.retryAfterMs) rateLimitedUntil = Date.now() + result.retryAfterMs;
    if (!result.success && !(kind === 'hash' && result.notFound)) throw Object.assign(new Error(result.error || 'Civitai is unavailable.'), { retryAt: result.retryAfterMs ? rateLimitedUntil : undefined, cancelled: result.cancelled });
    return result;
  } finally { activeRemote = undefined; }
}

async function hash(locationId: string) {
  const item = modelItem(locationId);
  if (item.location.sha256) return;
  const requestId = crypto.randomUUID(); activeHash = requestId;
  try {
    const result = await window.electronAPI!.modelLibraryHash({ filePath: item.location.absolutePath, requestId });
    if (result.cancelled || cancelled) return;
    if (!result.success || !result.sha256) throw new Error(result.error || 'Unable to identify this model.');
    const promote = localWrites.catch(() => {}).then(async () => {
    const oldId = getModelLocalMetadataId(modelItem(locationId).location);
    const newId = `sha256:${result.sha256}`;
    // Read current records after hashing; merge policy uses updatedAt and preserves divergent notes.
    const local = state.localMetadata[oldId];
    const existing = state.localMetadata[newId];
    if (local) {
      const merged = mergeModelMetadata(local, existing, result.sha256);
      const saved = await saveModelLocalMetadata(merged);
      if (oldId !== newId) await deleteModelLocalMetadata(oldId);
      const entries = { ...state.localMetadata, [newId]: saved }; if (oldId !== newId) delete entries[oldId];
      publish({ localMetadata: entries });
    }
    await patchLocation(locationId, { sha256: result.sha256, hashFingerprint: { size: result.size ?? item.location.size, modifiedAt: result.modifiedAt ?? item.location.modifiedAt } });
    await flushModelState();
    });
    localWrites = promote;
    await promote;
  } finally { activeHash = undefined; }
}
async function identify(locationId: string) {
  await patchLocation(locationId, { identificationAttemptAt: Date.now() });
  await hash(locationId);
  if (cancelled) return;
  const item = modelItem(locationId);
  if (!item.location.sha256) return;
  const matching = state.catalog.locations.find((location) => location.id !== locationId && location.sha256 === item.location.sha256 && location.civitai && 'binding' in location.civitai && location.civitai.binding === 'hash');
  if (matching?.civitai) { await patchLocation(locationId, { civitai: matching.civitai }); return; }
  const result = await remote('hash', item.location.sha256);
  if (cancelled) return;
  await patchLocation(locationId, { civitai: result.metadata ?? { status: 'notFound', fetchedAt: Date.now(), url: '' } });
}
export async function identifyModels(locationIds: string[]) {
  startJob('identify', locationIds.length);
  let failures = 0;
  try {
    for (const [index, id] of locationIds.entries()) {
      if (cancelled) break;
      progress(index + 1, modelItem(id).location.fileName);
      try { await identify(id); } catch { failures++; }
    }
  } finally { publish({ progress: null, message: `${cancelled ? 'Stopped. ' : ''}Identification finished: ${failures} failed.` }); }
  return !cancelled;
}

export async function checkModelUpdates(locationIds: string[], automatic = false, identifyMissing = true) {
  if (automatic && state.progress) return;
  startJob('updates', locationIds.length);
  const checked = new Set<number>(); let failures = 0; let updates = 0; let unchanged = 0; let notificationCount = 0;
  const failedLocationIds: string[] = [];
  try {
    for (const [index, id] of locationIds.entries()) {
      if (cancelled) break;
      const initial = modelItem(id); progress(index + 1, initial.location.fileName);
      if (!initial.location.civitai || !('modelId' in initial.location.civitai)) {
        if (!identifyMissing) { failures++; failedLocationIds.push(id); continue; }
        try { await identify(id); } catch { failures++; failedLocationIds.push(id); continue; }
      }
      if (cancelled) break;
      const item = modelItem(id);
      const link = item.location.civitai && 'modelId' in item.location.civitai ? item.location.civitai : undefined;
      if (!link) { failures++; failedLocationIds.push(id); continue; }
      if (checked.has(link.modelId)) continue;
      checked.add(link.modelId);
      const previous = state.watches[String(link.modelId)];
      if (automatic && !isWatchDue(previous, state.intervalHours, Date.now())) continue;
      try {
        const result = await remote('model', link.modelId);
        if (cancelled) break;
        // User may mark/ignore a version while the request is in flight.
        const watch = await storeWatch(String(link.modelId), (latest) => {
          const next = reconcileWatch(latest, link.modelId, result.modelName || link.modelName, result.versions || [], installedVersions(link.modelId), Date.now());
          const fresh = unreadVersions(next, installedVersions(link.modelId).map((version) => version.versionId)).filter((version) => !next.notifiedVersionIds.includes(version.id));
          if (fresh.length) {
            const stillWatched = state.catalog.locations.some((location) => location.civitai && 'modelId' in location.civitai && location.civitai.modelId === link.modelId && isModelWatched(modelItem(location.id)));
            if (automatic && stillWatched) notificationCount += fresh.length;
            next.notifiedVersionIds = Array.from(new Set([...next.notifiedVersionIds, ...fresh.map((version) => version.id)]));
          }
          return next;
        });
        const unread = unreadVersions(watch, installedVersions(link.modelId).map((version) => version.versionId));
        if (unread.length) updates++; else unchanged++;
      } catch (error) {
        if (cancelled) break;
        failures++;
        failedLocationIds.push(id);
        const failure = error as Error & { retryAt?: number };
        await storeWatch(String(link.modelId), (latest) => {
          const preserved = latest ?? reconcileWatch(undefined, link.modelId, link.modelName, [], installedVersions(link.modelId), Date.now());
          return { ...preserved, lastSuccessAt: latest?.lastSuccessAt, lastAttemptAt: Date.now(), error: failure.message, retryAt: failure.retryAt };
        });
      }
    }
  } finally {
    const message = locationIds.length === 1 ? `${modelItem(locationIds[0]).location.fileName}: ${cancelled ? 'check stopped' : failures ? 'check failed' : updates ? 'new versions available — see the Civitai links on this model' : 'no unread new versions'}.` : `${cancelled ? 'Stopped. ' : ''}${updates} model${updates === 1 ? '' : 's'} with unread releases · ${unchanged} caught up${failures ? ` · ${failures} could not be checked` : ''}.`;
    publish({ progress: null, showUpdates: !automatic && locationIds.length > 1 && updates > 0 ? true : state.showUpdates, message: automatic ? state.message : message, checkResult: automatic ? state.checkResult : { locationIds, failedLocationIds, message }, notification: notificationCount ? `${notificationCount} new model version${notificationCount === 1 ? '' : 's'} available.` : state.notification });
  }
}

export async function scanModelSources() {
  startJob('scan', state.sources.length);
  const pendingHeaders = new Map<string, Partial<ModelInspectorItem['location']>>();
  let lastHeaderFlush = Date.now();
  const flushHeaders = async () => {
    if (!pendingHeaders.size) return;
    const locations = state.catalog.locations.map((location) => pendingHeaders.has(location.id) ? { ...location, ...pendingHeaders.get(location.id) } : location);
    publish({ catalog: { ...state.catalog, locations, updatedAt: Date.now() } });
    pendingHeaders.clear();
    lastHeaderFlush = Date.now();
    // Header changes cannot affect identity: preserve the already-built groups.
    await persistCatalog();
  };
  try {
    const sources = [...state.sources];
    await window.electronAPI!.modelLibrarySetRoots(sources.map((source) => source.path));
    const result = await window.electronAPI!.modelLibraryScan(sources.map(({ id, path, recursive }) => ({ id, path, recursive })));
    if (!result.success || !result.results) throw new Error(result.error || 'Unable to scan models.');
    if (cancelled) return;
    publish({ catalog: reconcileModelCatalog(state.catalog, sources, result.results), message: result.results.filter((source) => source.error).map((source) => source.error).join(' · ') || null });
    await persistCatalog();
    const headers = state.catalog.locations.filter((location) => !location.fileMetadata);
    publish({ progress: { kind: 'headers', current: 0, total: headers.length, name: '' } });
    for (const [index, location] of headers.entries()) {
      if (cancelled) break;
      progress(index + 1, location.fileName);
      const metadata = await window.electronAPI!.modelLibraryReadMetadata(location.absolutePath);
      pendingHeaders.set(location.id, await externalizeModelMedia(metadata.success && metadata.metadata ? { fileMetadata: metadata.metadata, metadataError: undefined } : { metadataError: metadata.error || 'Header unavailable' }));
      if (pendingHeaders.size >= 50 || Date.now() - lastHeaderFlush >= 1000) await flushHeaders();
    }
  } catch (error) { managerMessage((error as Error).message); }
  finally { try { await flushHeaders(); } finally { publish({ progress: null }); } }
  if (cancelled) return;
  const toIdentify = state.catalog.locations.filter((location) => !location.civitai && (isModelWatched(modelItem(location.id)) || state.sources.find((source) => source.id === location.sourceId)?.identifyOnScan)).map((location) => location.id);
  if (toIdentify.length) await identifyModels(toIdentify);
  if (!cancelled) await scheduledCheck();
}
export async function addModelSource(source: ModelSource, onCommitted?: () => void) {
  const saved = await saveModelSource(source);
  publish({ sources: [...state.sources, saved] });
  await flushModelState();
  onCommitted?.();
  await scanModelSources();
}
export async function updateModelSource(source: ModelSource) {
  const saved = await saveModelSource(source);
  publish({ sources: state.sources.map((entry) => entry.id === saved.id ? saved : entry) });
  await flushModelState();
}
export async function removeModelSource(id: string) {
  if (state.progress) throw new Error('Stop the current job before removing a source.');
  await deleteModelSource(id);
  const locations = state.catalog.locations.filter((location) => location.sourceId !== id);
  publish({ sources: state.sources.filter((source) => source.id !== id), catalog: { ...state.catalog, locations, managedModels: buildManagedModels(locations) } });
  await window.electronAPI!.modelLibrarySetRoots(state.sources.map((source) => source.path));
  await persistCatalog();
}
async function scheduledCheck() {
  if (!managerRunning || state.loading || state.progress) return;
  const ids = state.catalog.locations.filter((location) => {
    const item = modelItem(location.id);
    if (!isModelWatched(item)) return false;
    const remoteId = location.civitai && 'modelId' in location.civitai ? location.civitai.modelId : undefined;
    return remoteId !== undefined ? isWatchDue(state.watches[String(remoteId)], state.intervalHours, Date.now()) : !location.identificationAttemptAt || Date.now() - location.identificationAttemptAt >= state.intervalHours * 3600000;
  }).map((location) => location.id);
  if (ids.length) await checkModelUpdates(ids, true);
}

async function libraryPreview(imageId: string): Promise<{ preview: string; name: string }> {
  const image = useImageStore.getState().images.find((image) => image.id === imageId);
  const thumbnailUrl = image ? thumbnailManager.getResolvedState(image)?.thumbnailUrl : undefined;
  if (!image || !thumbnailUrl) throw new Error('This indexed image has no available thumbnail.');
  const blob = await (await fetch(thumbnailUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  let preview: string;
  try {
    const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare the library cover.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    preview = canvas.toDataURL('image/jpeg', 0.85);
  } finally { bitmap.close(); }
  return { preview: await externalizeModelMedia(preview), name: image.name };
}
export async function runModelCommand(command: ModelManagerCommand) {
  if (!managerRunning) throw new Error('Model Manager requires Pro or an active trial.');
  switch (command.type) {
    case 'seen': await markModelVersionsSeen(command.modelId, command.versionIds); return;
    case 'versionAction': await markModelVersion(command.modelId, command.versionId, command.action); return;
    case 'cover': {
      const link = modelItem(command.locationId).location.civitai;
      if (!link || !('versionId' in link)) throw new Error('Identify or link this model on Civitai first.');
      if (link.coverImage) return;
      startJob('identify', 1);
      try {
        const result = await remote('cover', link.versionId);
        if (cancelled) return;
        if (!result.metadata?.coverImage) throw new Error('This Civitai version has no available cover.');
        result.metadata = await externalizeModelMedia(result.metadata);
        const locations = state.catalog.locations.map((location) => location.civitai && 'versionId' in location.civitai && location.civitai.versionId === link.versionId
          ? { ...location, civitai: { ...location.civitai, coverImage: result.metadata!.coverImage } } : location);
        publish({ catalog: { ...state.catalog, locations, updatedAt: Date.now() } });
        await persistCatalog();
        await flushModelState();
      } finally { publish({ progress: null }); }
      return;
    }
    case 'example': await saveModelPatch(command.locationId, (current) => ({ examples: (current?.examples ?? []).flatMap((example) => example.id !== command.exampleId ? [example] : command.remove ? [] : [{ ...example, caption: command.caption ?? example.caption }]) })); return;
    case 'unbind': await saveModelPatch(command.locationId, { watchUpdates: false }); await patchLocation(command.locationId, { civitai: undefined }); return;
    case 'chooseLibrary': publish({ picker: { locationId: command.locationId, cover: command.cover } }); return;
    case 'cancel': cancelModelJob(); return;
    case 'saveLocal': await saveModelPatch(command.locationId, command.patch); return;
    case 'openImage': {
      if (!useImageStore.getState().images.some((image) => image.id === command.imageId)) throw new Error('This image is unavailable.');
      openImage?.(command.imageId); return;
    }
    case 'identify': await identifyModels([command.locationId]); return;
    case 'check': await checkModelUpdates([command.locationId]); return;
    case 'hash': startJob('identify', 1); try { await hash(command.locationId); } finally { publish({ progress: null }); } return;
    case 'bind': {
      const versionId = parseCivitaiVersionLink(command.url);
      if (!versionId) throw new Error('Paste a Civitai model link containing modelVersionId.');
      startJob('identify', 1);
      try {
        const result = await remote('version', versionId);
        if (result.metadata && result.metadata.modelId !== Number(new URL(command.url).pathname.split('/')[2])) throw new Error('The version does not belong to the model in this link.');
        if (result.metadata && !cancelled) await patchLocation(command.locationId, { civitai: { ...result.metadata, binding: 'manual' } });
      }
      finally { publish({ progress: null }); }
      return;
    }
    case 'importMedia': case 'libraryMedia': {
      const result = command.type === 'importMedia' ? await window.electronAPI!.modelManagerImportMedia() : { success: true, ...await libraryPreview(command.imageId) };
      if (!result.success || !result.preview) { if ('cancelled' in result && result.cancelled) return; throw new Error('error' in result ? result.error : 'Unable to import image.'); }
      if (command.cover) await saveModelPatch(command.locationId, { previewImage: result.preview });
      else {
        const example = { id: crypto.randomUUID(), origin: command.type === 'libraryMedia' ? 'library' as const : 'imported' as const, imageId: command.type === 'libraryMedia' ? command.imageId : undefined, preview: result.preview, caption: result.name || '' };
        await saveModelPatch(command.locationId, (current) => ({ examples: (current?.examples ?? []).some((entry) => example.imageId && entry.imageId === example.imageId) ? current?.examples : [...(current?.examples ?? []), example] }));
      }
      return;
    }
    case 'examples': {
      const item = modelItem(command.locationId);
      if (!item.location.civitai || !('versionId' in item.location.civitai)) throw new Error('Identify or link this version first.');
      const versionId = item.location.civitai.versionId;
      startJob('identify', 1);
      try {
        const result = await remote('examples', versionId);
        if (cancelled) return;
        const currentLink = modelItem(command.locationId).location.civitai;
        if (result.examples?.[0]?.preview && currentLink && 'versionId' in currentLink && currentLink.versionId === versionId) {
          await patchLocation(command.locationId, { civitai: { ...currentLink, coverImage: currentLink.coverImage || result.examples[0].preview } });
        }
        await saveModelPatch(command.locationId, (current) => {
          const examples = new Map((current?.examples ?? []).map((example) => [example.id, example]));
          for (const example of result.examples ?? []) if (!examples.has(example.id)) examples.set(example.id, example);
          return { examples: [...examples.values()] };
        });
        managerMessage(result.examples?.length ? `${result.examples.length} Civitai examples loaded for ${item.location.fileName}.` : `No available Civitai images for ${item.location.fileName}.`);
      } finally { publish({ progress: null }); }
      return;
    }
  }
}

export function startModelManager() {
  managerRunning = true;
  if (!window.electronAPI) return () => {};
  const unsubscribe = window.electronAPI.onModelManagerCommand(({ requestId, command }) => {
    void runModelCommand(command).then(() => window.electronAPI!.modelManagerCommandResult(requestId, { success: true })).catch((error) => window.electronAPI!.modelManagerCommandResult(requestId, { success: false, error: error.message }));
  });
  if (!initialization) initialization = (async () => {
    try {
      const durable = await window.electronAPI!.modelManagerLoadPreferences();
      const [sources, catalog, metadata, preferences] = await Promise.all([getAllModelSources(), window.electronAPI!.getJsonCacheData(MODEL_CATALOG_CACHE_ID), getAllModelLocalMetadata(), loadWatchPreferences()]);
      const cached = validModelCatalog(catalog.success ? catalog.data : undefined);
      const restored = durable?.identities ? validModelCatalog(durable.identities) : cached;
      const cachedById = new Map(cached.locations.map((location) => [location.id, location]));
      restored.locations = restored.locations.map((location) => {
        const cachedLocation = cachedById.get(location.id);
        return cachedLocation?.size === location.size && cachedLocation?.modifiedAt === location.modifiedAt ? { ...location, fileMetadata: cachedLocation.fileMetadata } : location;
      });
      const migratedCatalog = await externalizeModelMedia(restored);
      const priorLocal = durable?.localMetadata ?? Object.fromEntries(metadata.map((item) => [item.id, item]));
      const migratedLocal = await externalizeModelMedia(priorLocal);
      for (const entry of Object.values(migratedLocal)) if (entry !== priorLocal[entry.id]) await saveModelLocalMetadata(entry);
      publish({ sources: durable?.sources ?? sources, catalog: migratedCatalog, localMetadata: migratedLocal, watches: durable?.watches ?? Object.fromEntries(preferences.watches.map((watch) => [watch.id, watch])), intervalHours: [6, 24, 168].includes(durable?.intervalHours) ? durable!.intervalHours : preferences.intervalHours, libraryIds: useImageStore.getState().images.map((image) => image.id), loading: false });
      if (migratedCatalog !== restored) await persistCatalog();
      await flushModelState();
      if (managerRunning && state.sources.length) await scanModelSources();
    } catch (error) { publish({ loading: false, message: (error as Error).message }); }
  })();
  const check = () => { void scheduledCheck().catch((error) => managerMessage(error.message)); };
  const timer = setInterval(check, 60000);
  const unsubscribeImages = useImageStore.subscribe((next, previous) => {
    if (next.images !== previous.images) publish({ libraryIds: next.images.map((image) => image.id) });
  });
  window.addEventListener('focus', check);
  return () => { managerRunning = false; cancelModelJob(); unsubscribe(); unsubscribeImages(); clearInterval(timer); if (publishTimer) { clearTimeout(publishTimer); publishTimer = undefined; } window.removeEventListener('focus', check); };
}
