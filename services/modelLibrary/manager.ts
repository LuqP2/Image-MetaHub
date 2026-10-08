import { externalizeModelMedia } from './mediaStorage';
import { buildModelDescriptors } from './imageAssociations';
import { deriveModelUsage, emptyModelUsage } from './usage';
import { duplicateCandidates } from './storage';
import { validateHuggingFaceScope, validateHuggingFaceTarget } from './huggingFaceLink.mjs';
import { huggingFaceConfig, huggingFaceQueryKey, huggingFaceWatchId, emptyHuggingFaceWatch, reconcileHuggingFaceWatch, unreadHuggingFaceEvents, modelUpdateCounts, isHuggingFaceWatchActive, linkedModelLocationIds } from './huggingFaceTracking';
import { loadHuggingFaceWatches, saveHuggingFaceWatches } from './huggingFaceWatchStorage';
import { packHuggingFaceWatches } from './huggingFaceWatchState.mjs';
import type { ImageScope } from '../../types';
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
import type { HuggingFaceBinding, HuggingFaceLookup, HuggingFaceRemoteSnapshot, HuggingFaceWatchConfig, HuggingFaceWatchRecord, ModelInspectorItem, ModelLocalMetadata, ModelManagerCommand, ModelManagerSnapshot, ModelSource, ModelWatchRecord } from './types';

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
const bindingRevisions = new Map<string, number>();
const hfBindingRevisions = new Map<string, number>();
let hfRateLimitedUntil = 0;
let rateLimitedUntil = 0;
let releaseWait: (() => void) | undefined;
let openImage: ((id: string) => void) | undefined;
let publishTimer: ReturnType<typeof setTimeout> | undefined;
let usageTimer: ReturnType<typeof setTimeout> | undefined;
let usageRevision = 0;
let openLibrary: ((scope: ImageScope) => void) | undefined;

export function setModelLibraryOpener(callback: (scope: ImageScope) => void) { openLibrary = callback; }
function scheduleUsage() {
  if (!managerRunning) return;
  const revision = ++usageRevision;
  if (usageTimer) clearTimeout(usageTimer);
  const descriptors = buildModelDescriptors(state.catalog);
  const scope = useImageStore.getState().activeImageScope;
  if (scope?.type === 'managedModel' && scope.managedModel) {
    const current = descriptors.find((model) => model.identity === scope.managedModel!.identity)
      ?? descriptors.find((model) => model.locationIds.some((id) => scope.managedModel!.locationIds.includes(id)));
    if (current) useImageStore.getState().setActiveImageScope({ ...scope, id: current.identity, managedModel: { ...current, mode: scope.managedModel.mode } });
    else if (!state.loading) useImageStore.getState().setActiveImageScope(null);
  }
  publish({ usage: Object.fromEntries(descriptors.map((model) => [model.identity, model.supported ? { ...(state.usage?.[model.identity] ?? emptyModelUsage('loading')), status: state.usage?.[model.identity] ? 'partial' : 'loading' } : emptyModelUsage('unsupported')])) });
  usageTimer = setTimeout(() => {
    usageTimer = undefined;
    const library = useImageStore.getState();
    void deriveModelUsage(library.images, state.catalog, Boolean(state.loading || library.isLoading || library.enrichmentProgress), () => revision !== usageRevision || !managerRunning).then((usage) => { if (usage) publish({ usage }); });
  }, 100);
}

export const getModelManagerState = () => state;
function publish(patch: Partial<ModelManagerSnapshot>) {
  state = { ...state, ...patch, revision: state.revision + 1 };
  if (patch.catalog || patch.loading !== undefined) scheduleUsage();
  listeners.forEach((listener) => listener());
  if (!publishTimer) publishTimer = setTimeout(() => { void flushModelState().catch((error) => {
    state = { ...state, message: error.message }; listeners.forEach((listener) => listener());
  }); }, 100);
}
async function flushModelState() {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = undefined;
  const result = await window.electronAPI?.modelManagerPublish({ ...state, hfWatches: undefined, hfWatchState: packHuggingFaceWatches(state.hfWatches ?? {}) });
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
export function closeModelRemoval() { publish({ removal: null }); }
export function requestModelRemoval(locationIds: string[], selected = false) {
  if (state.progress || state.loading) throw new Error('Wait for the current model job to finish.');
  if (!locationIds.length || locationIds.some((id) => !state.catalog.locations.some((location) => location.id === id))) throw new Error('Choose files from the current model catalog.');
  publish({ removal: { locationIds, selected } });
}
export async function refreshModelStorage() {
  const catalog = state.catalog;
  await flushModelState();
  const result = await window.electronAPI!.modelStorageOverview();
  if (!result.success || !result.data) throw new Error(result.error || 'Unable to check model storage.');
  if (catalog !== state.catalog) return;
  publish({ storage: result.data });
}
export async function verifyModelDuplicates() {
  await refreshModelStorage();
  const candidates = duplicateCandidates(state.storage!.files);
  const equivalentIds = new Map<string, string[]>();
  for (const file of state.storage!.files) {
    const key = file.physicalId ?? file.key;
    const ids = equivalentIds.get(key) ?? [];
    ids.push(...file.locationIds); equivalentIds.set(key, ids);
  }
  startJob('duplicates', candidates.length);
  let failures = 0;
  try {
    for (const [index, file] of candidates.entries()) {
      if (cancelled) break;
      progress(index + 1, modelItem(file.locationIds[0]).location.fileName);
      try {
        await hash(file.locationIds[0]);
        if (cancelled) break;
        const primary = modelItem(file.locationIds[0]).location;
        // Overlapping sources describe the same path; never hash it twice.
        const equivalent = equivalentIds.get(file.physicalId ?? file.key)!;
        if (primary.sha256) for (const id of equivalent.filter((id) => id !== primary.id)) await promoteModelHash(id, { sha256: primary.sha256, size: primary.size, modifiedAt: primary.modifiedAt });
      } catch { failures++; }
    }
  } finally { publish({ progress: null, message: `${cancelled ? 'Stopped. ' : ''}Duplicate verification finished: ${failures} failed.` }); }
  await refreshModelStorage();
}
export async function removeModelFiles(locationIds: string[]) {
  startJob('removal', locationIds.length);
  try {
    await Promise.all([localWrites, writes, watchWrites]);
    await flushModelState();
    const prepared = await window.electronAPI!.prepareModelRemoval({ locationIds });
    if (!prepared.success || !prepared.plan) throw new Error(prepared.error || 'Unable to prepare file removal.');
    const executed = await window.electronAPI!.executeModelRemoval({ planId: prepared.plan.planId });
    if (!executed.success || !executed.result) throw new Error(executed.error || 'Unable to remove model files.');
    const { removedLocationIds, failures, cancelled: declined } = executed.result;
    const removed = new Set(removedLocationIds);
    const locations = state.catalog.locations.filter((location) => !removed.has(location.id));
    publish({ catalog: { ...state.catalog, locations, managedModels: buildManagedModels(locations), updatedAt: Date.now() }, removal: null,
      message: declined ? 'Removal cancelled.' : `${prepared.plan.files.filter((file) => file.locationIds.some((id) => removed.has(id))).length} files moved to Trash${failures.length ? ` · ${failures.length} failed: ${failures.map((failure) => `${failure.path}: ${failure.error}`).join(' · ')}` : '.'}` });
    await persistCatalog();
    await flushModelState();
  } finally { publish({ progress: null }); }
  await refreshModelStorage();
}
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
  return { location, localMetadata: getModelLocalMetadata(state.localMetadata, location), usage: state.usage?.[location.sha256 ? `sha256:${location.sha256.toLowerCase()}` : `location:${location.id}`] };
}
async function patchLocation(locationId: string, patch: Partial<ModelInspectorItem['location']>, bindingRevision?: number) {
  patch = await externalizeModelMedia(patch);
  if (bindingRevision !== undefined && bindingRevision !== (bindingRevisions.get(locationId) ?? 0)) return;
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
export function unreadModelCount() { return Object.values(modelUpdateCounts(state.catalog, state.watches, state.hfWatches)).filter((count) => count > 0).length; }
type HFWatchUpdate = { id: string; update: (current: HuggingFaceWatchRecord | undefined) => HuggingFaceWatchRecord | undefined };
function storeHFWatches(updates: HFWatchUpdate[]) {
  const save = watchWrites.catch(() => {}).then(async () => {
    const watches = { ...state.hfWatches };
    let changed = false;
    for (const { id, update } of updates) {
      const watch = update(watches[id]);
      if (watch) { watches[watch.id] = watch; changed = true; }
    }
    if (!changed) return;
    await saveHuggingFaceWatches(watches);
    publish({ hfWatches: watches });
    await flushModelState();
  });
  watchWrites = save.then(() => {}); return save;
}
function storeHFWatch(id: string, update: HFWatchUpdate['update']) { return storeHFWatches([{ id, update }]); }
async function configureHF(locationId: string, config: HuggingFaceWatchConfig) {
  const location = modelItem(locationId).location;
  if (!location.huggingFace) throw new Error('Link a Hugging Face file first.');
  validateHuggingFaceScope(location.huggingFace.repoId, config.trackedRevision, config.watchedDirectory, config.recursive);
  if (typeof config.monitoringEnabled !== 'boolean') throw new Error('Choose whether to enable Hugging Face monitoring.');
  const locations = state.catalog.locations.map((copy) => {
    if (copy.id !== locationId && !(location.sha256 && copy.sha256?.toLowerCase() === location.sha256.toLowerCase() && sameHF(copy.huggingFace, location.huggingFace!))) return copy;
    hfBindingRevisions.set(copy.id, (hfBindingRevisions.get(copy.id) ?? 0) + 1);
    return { ...copy, huggingFace: { ...copy.huggingFace!, ...config } };
  });
  publish({ catalog: { ...state.catalog, locations, updatedAt: Date.now() } });
  await persistCatalog(); await flushModelState();
}
async function markHFEvents(watchId: string, eventIds: string[], action: 'seen' | 'ignore' | 'restore') {
  if (!['seen', 'ignore', 'restore'].includes(action) || !Array.isArray(eventIds)) throw new Error('Unknown Hugging Face event action.');
  const watch = state.hfWatches?.[watchId];
  if (!watch || !isHuggingFaceWatchActive(watch, state.catalog.locations)) return;
  const valid = new Set(watch.events.map((event) => event.id));
  const ids = eventIds.filter((id) => valid.has(id));
  await storeHFWatch(watchId, (current) => current ? { ...current,
    seenEventIds: action === 'seen' ? [...new Set([...current.seenEventIds, ...ids])] : current.seenEventIds,
    ignoredEventIds: action === 'ignore' ? [...new Set([...current.ignoredEventIds, ...ids])] : action === 'restore' ? current.ignoredEventIds.filter((id) => !ids.includes(id)) : current.ignoredEventIds,
  } : undefined);
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

async function remoteHF(target: { repoId: string; revision: string; filePath?: string }): Promise<HuggingFaceLookup> {
  validateHuggingFaceTarget(target.repoId, target.revision, target.filePath);
  if (hfRateLimitedUntil > Date.now()) throw new Error('Hugging Face rate limit. Try again later.');
  const requestId = crypto.randomUUID(); activeRemote = requestId;
  try {
    const result = await window.electronAPI!.modelManagerHuggingFace({ ...target, requestId });
    if (result.retryAfterMs) hfRateLimitedUntil = Date.now() + result.retryAfterMs;
    if (!result.success || !result.lookup) throw new Error(result.error || 'Hugging Face is unavailable.');
    return result.lookup;
  } finally { activeRemote = undefined; }
}
async function remoteHFWatch(binding: HuggingFaceBinding, linkedPaths: string[]): Promise<HuggingFaceRemoteSnapshot> {
  const config = huggingFaceConfig(binding);
  if (hfRateLimitedUntil > Date.now()) throw Object.assign(new Error('Hugging Face rate limit. Try again later.'), { retryAt: hfRateLimitedUntil });
  const requestId = crypto.randomUUID(); activeRemote = requestId;
  try {
    const result = await window.electronAPI!.modelManagerHuggingFaceWatch({ repoId: binding.repoId, revision: config.trackedRevision, watchedDirectory: config.watchedDirectory, recursive: config.recursive, linkedPaths, requestId });
    if (result.retryAfterMs) hfRateLimitedUntil = Date.now() + result.retryAfterMs;
    if (!result.success || !result.snapshot) throw Object.assign(new Error(result.error || 'Hugging Face is unavailable.'), { retryAt: result.retryAfterMs ? hfRateLimitedUntil : undefined });
    return result.snapshot;
  } finally { activeRemote = undefined; }
}
function sameHF(a: HuggingFaceBinding | undefined, b: HuggingFaceBinding) {
  return a?.repoId === b.repoId && a.filePath === b.filePath && a.linkedRevision === b.linkedRevision;
}
function currentHFOperation(locationId: string, revision: number) {
  return !cancelled && managerRunning && revision === (hfBindingRevisions.get(locationId) ?? 0) && state.catalog.locations.some((location) => location.id === locationId);
}
async function bindHF(locationId: string, binding: HuggingFaceBinding, revision: number) {
  // No await between the generation check and catalog mutation: unlink always wins over late I/O.
  if (!currentHFOperation(locationId, revision)) return;
  let conflicts = 0;
  const locations = state.catalog.locations.map((location) => {
    if (location.id === locationId) return { ...location, huggingFace: binding };
    if (binding.verification !== 'sha256' || location.sha256?.toLowerCase() !== binding.verifiedLocalSha256) return location;
    if (location.huggingFace && !sameHF(location.huggingFace, binding)) { conflicts++; return location; }
    return { ...location, huggingFace: { ...binding, ...huggingFaceConfig(location.huggingFace ?? { ...binding, monitoringEnabled: false }) } };
  });
  publish({ catalog: { ...state.catalog, locations, updatedAt: Date.now() }, message: conflicts ? `File match verified. ${conflicts} different copy link${conflicts === 1 ? ' was' : 's were'} preserved; choose its file location to review it.` : binding.verification === 'sha256' ? 'Hugging Face file match verified by SHA-256.' : 'Hugging Face manual link saved.' });
  await persistCatalog();
  await flushModelState();
}

async function withdrawRemoteHFVerification(locationId: string, original: HuggingFaceBinding, revision: number) {
  if (!currentHFOperation(locationId, revision)) return;
  const locations = state.catalog.locations.map((location) => {
    const binding = location.huggingFace;
    if (binding?.verification !== 'sha256' || !sameHF(binding, original) || binding.linkedRemoteFingerprint !== original.linkedRemoteFingerprint) return location;
    return { ...location, huggingFace: { ...binding, verification: 'manual' as const, verifiedLocalSha256: undefined } };
  });
  publish({ catalog: { ...state.catalog, locations, updatedAt: Date.now() } });
  await persistCatalog();
  await flushModelState();
}

async function runHFCommand(command: Extract<ModelManagerCommand, { type: 'lookupHF' | 'bindHF' | 'verifyHF' }>): Promise<HuggingFaceLookup | undefined> {
  const original = modelItem(command.locationId).location.huggingFace;
  if (command.type === 'verifyHF' && !original) throw new Error('Link a public Hugging Face file first.');
  startJob('huggingFace', 1);
  const revision = (hfBindingRevisions.get(command.locationId) ?? 0) + 1;
  hfBindingRevisions.set(command.locationId, revision);
  try {
    const target = command.type === 'verifyHF' ? { repoId: original!.repoId, revision: original!.linkedRevision, filePath: original!.filePath } : command;
    const lookup = await remoteHF(target);
    if (!currentHFOperation(command.locationId, revision)) return;
    if (command.type === 'lookupHF') return lookup;
    const file = lookup.files.find((entry) => entry.path === target.filePath);
    // Only a successful lookup can invalidate remote evidence; offline errors preserve it.
    if (command.type === 'verifyHF' && original!.verification === 'sha256' && (!file || file.fingerprint !== original!.linkedRemoteFingerprint)) {
      await withdrawRemoteHFVerification(command.locationId, original!, revision);
    }
    if (!file) throw new Error('Public .safetensors file unavailable at this revision.');
    if (command.type === 'bindHF' && file.fingerprint !== command.fingerprint) throw new Error('The remote file changed. Look it up again before confirming.');
    const binding: HuggingFaceBinding = { repoId: lookup.repoId, filePath: file.path, linkedRevision: lookup.revision, linkedRemoteFingerprint: file.fingerprint, verification: 'manual', resolvedCommit: lookup.resolvedCommit, size: file.size, fetchedAt: lookup.fetchedAt };
    Object.assign(binding, huggingFaceConfig(sameHF(original, binding) ? original! : binding));
    if (command.type === 'verifyHF') {
      if (!file.lfsSha256) throw new Error('This file has no LFS SHA-256. Its Git or Xet identity cannot verify your local file.');
      if (file.fingerprint !== original!.linkedRemoteFingerprint) throw new Error('The linked remote file changed. Look it up and confirm the new link before verifying.');
      // An explicit verification reads the file even when an earlier Civitai/duplicate hash is cached.
      await hash(command.locationId, true);
      if (!currentHFOperation(command.locationId, revision)) return;
      const location = modelItem(command.locationId).location;
      if (location.sha256?.toLowerCase() !== file.lfsSha256 || location.size !== file.size) {
        // A failed recheck must withdraw a prior verification without discarding the manual link.
        if (original!.verification === 'sha256') await bindHF(command.locationId, { ...original!, verification: 'manual', verifiedLocalSha256: undefined }, revision);
        throw new Error('The local file does not match the Hugging Face LFS SHA-256 and size. The link remains manual.');
      }
      binding.verification = 'sha256'; binding.verifiedLocalSha256 = file.lfsSha256;
    }
    await bindHF(command.locationId, binding, revision);
  } catch (error) {
    if ((error as { localFileChanged?: boolean }).localFileChanged && original?.verification === 'sha256') await bindHF(command.locationId, { ...original, verification: 'manual', verifiedLocalSha256: undefined }, revision);
    if (!cancelled) throw error;
  }
  finally { publish({ progress: null }); }
}

async function unbindHF(locationId: string) {
  const binding = modelItem(locationId).location.huggingFace;
  const locations = state.catalog.locations.map((location) => {
    const shared = binding?.verification === 'sha256' && location.huggingFace?.verification === 'sha256' && sameHF(location.huggingFace, binding) && location.huggingFace.verifiedLocalSha256 === binding.verifiedLocalSha256;
    if (location.id !== locationId && !shared) return location;
    hfBindingRevisions.set(location.id, (hfBindingRevisions.get(location.id) ?? 0) + 1);
    return { ...location, huggingFace: undefined };
  });
  publish({ catalog: { ...state.catalog, locations, updatedAt: Date.now() } });
  await persistCatalog();
  await flushModelState();
}

async function promoteModelHash(locationId: string, result: { sha256: string; size?: number; modifiedAt?: number | null }, hfRevision = hfBindingRevisions.get(locationId) ?? 0) {
  const promote = localWrites.catch(() => {}).then(async () => {
    const item = modelItem(locationId);
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
    // Only verified byte identity permits inheriting a binding from another copy.
    const current = modelItem(locationId).location;
    const candidates = state.catalog.locations.filter((location) => location.id !== locationId && location.sha256?.toLowerCase() === result.sha256.toLowerCase() && location.huggingFace?.verification === 'sha256' && location.huggingFace.verifiedLocalSha256 === result.sha256.toLowerCase()).map((location) => location.huggingFace!);
    if (!current.huggingFace && hfRevision === (hfBindingRevisions.get(locationId) ?? 0) && candidates.length && candidates.every((binding) => sameHF(binding, candidates[0]))) {
      const locations = state.catalog.locations.map((location) => location.id === locationId ? { ...location, huggingFace: candidates[0] } : location);
      publish({ catalog: { ...state.catalog, locations, updatedAt: Date.now() } });
      await persistCatalog();
    }
    await flushModelState();
  });
  localWrites = promote;
  await promote;
}
async function hash(locationId: string, verifyCurrentBytes = false) {
  const item = modelItem(locationId);
  const hfRevision = hfBindingRevisions.get(locationId) ?? 0;
  if (item.location.sha256 && !verifyCurrentBytes) return;
  const requestId = crypto.randomUUID(); activeHash = requestId;
  try {
    const result = await window.electronAPI!.modelLibraryHash({ filePath: item.location.absolutePath, requestId });
    if (result.cancelled || cancelled) return;
    if (!result.success || !result.sha256) throw new Error(result.error || 'Unable to identify this model.');
    if (verifyCurrentBytes && ((item.location.sha256 && item.location.sha256.toLowerCase() !== result.sha256.toLowerCase()) || (result.size !== undefined && result.size !== item.location.size))) throw Object.assign(new Error('The local file changed since it was cataloged. Refresh the model folders before verifying again.'), { localFileChanged: true });
    if (item.location.sha256) return;
    await promoteModelHash(locationId, { sha256: result.sha256, size: result.size, modifiedAt: result.modifiedAt }, hfRevision);
  } finally { activeHash = undefined; }
}
async function identify(locationId: string) {
  const bindingRevision = bindingRevisions.get(locationId) ?? 0;
  await patchLocation(locationId, { identificationAttemptAt: Date.now() });
  await hash(locationId);
  if (cancelled || bindingRevision !== (bindingRevisions.get(locationId) ?? 0)) return;
  const item = modelItem(locationId);
  if (!item.location.sha256) return;
  const matching = state.catalog.locations.find((location) => location.id !== locationId && location.sha256 === item.location.sha256 && location.civitai && 'binding' in location.civitai && location.civitai.binding === 'hash');
  const metadata = matching?.civitai ?? (await remote('hash', item.location.sha256)).metadata;
  if (cancelled) return;
  const current = modelItem(locationId).location.civitai;
  // Metadata refreshes do not fetch covers. Reuse the saved cover only for the same version.
  const civitai = metadata && 'modelId' in metadata && current && 'modelId' in current
    && metadata.modelId === current.modelId && metadata.versionId === current.versionId
    ? { ...metadata, coverImage: metadata.coverImage ?? current.coverImage }
    : metadata ?? { status: 'notFound' as const, fetchedAt: Date.now(), url: '' };
  await patchLocation(locationId, { civitai }, bindingRevision);
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
  const initialName = state.catalog.locations.find((location) => location.id === locationIds[0])?.fileName ?? 'Model';
  const requested = new Set(locationIds);
  const selectedModels = buildManagedModels(state.catalog.locations).filter((model) => model.locationIds.some((id) => requested.has(id)));
  const selectedIds = selectedModels.flatMap((model) => model.locationIds);
  const linkedIds = linkedModelLocationIds(state.catalog);
  startJob('updates', selectedIds.length);
  const failed = new Set<string>(), checked = new Set<number>();
  let notificationCount = 0;
  const hfNotices = new Map<string, number>();
  const fail = (ids: string[]) => ids.forEach((id) => failed.add(id));
  try {
    for (const [index, id] of selectedIds.entries()) {
      if (cancelled) break;
      if (!state.catalog.locations.some((location) => location.id === id)) continue;
      let item = modelItem(id); progress(index + 1, item.location.fileName);
      if (automatic && !isModelWatched(item)) continue;
      if (!item.location.civitai || !('modelId' in item.location.civitai)) {
        // A manually linked HF model never requires implicit Civitai identification.
        if (linkedIds.has(id)) continue;
        if (!identifyMissing) { fail([id]); continue; }
        try { await identify(id); } catch { if (!cancelled) fail([id]); continue; }
        if (cancelled) break;
        item = modelItem(id);
      }
      const link = item.location.civitai && 'modelId' in item.location.civitai ? item.location.civitai : undefined;
      if (!link) { fail([id]); continue; }
      if (checked.has(link.modelId)) continue;
      checked.add(link.modelId);
      if (automatic && !isWatchDue(state.watches[String(link.modelId)], state.intervalHours, Date.now())) continue;
      const boundIds = () => selectedIds.filter((id) => state.catalog.locations.some((location) => location.id === id && location.civitai && 'modelId' in location.civitai && location.civitai.modelId === link.modelId));
      try {
        // Backoff for one provider must not hold up the other provider's queries.
        if (rateLimitedUntil > Date.now()) throw Object.assign(new Error('Civitai rate limit: try again later.'), { retryAt: rateLimitedUntil });
        const result = await remote('model', link.modelId);
        if (cancelled) break;
        if (!installedVersions(link.modelId).length) continue;
        await storeWatch(String(link.modelId), (latest) => {
          const next = reconcileWatch(latest, link.modelId, result.modelName || link.modelName, result.versions || [], installedVersions(link.modelId), Date.now());
          const fresh = unreadVersions(next, installedVersions(link.modelId).map((version) => version.versionId)).filter((version) => !next.notifiedVersionIds.includes(version.id));
          const stillWatched = state.catalog.locations.some((location) => location.civitai && 'modelId' in location.civitai && location.civitai.modelId === link.modelId && isModelWatched(modelItem(location.id)));
          if (automatic && stillWatched) notificationCount += fresh.length;
          next.notifiedVersionIds = [...new Set([...next.notifiedVersionIds, ...fresh.map((version) => version.id)])];
          return next;
        });
      } catch (error) {
        if (cancelled) break;
        fail(boundIds());
        if (!installedVersions(link.modelId).length) continue;
        const failure = error as Error & { retryAt?: number };
        await storeWatch(String(link.modelId), (latest) => ({ ...(latest ?? reconcileWatch(undefined, link.modelId, link.modelName, [], installedVersions(link.modelId), Date.now())), lastSuccessAt: latest?.lastSuccessAt, lastAttemptAt: Date.now(), error: failure.message, retryAt: failure.retryAt }));
      }
    }
    const groups = new Map<string, { id: string; binding: HuggingFaceBinding; revision: number }[]>();
    for (const id of selectedIds) {
      const binding = state.catalog.locations.find((location) => location.id === id)?.huggingFace;
      if (!binding || (automatic && (!huggingFaceConfig(binding).monitoringEnabled || !isWatchDue(state.hfWatches?.[huggingFaceWatchId(binding)], state.intervalHours, Date.now())))) continue;
      const key = huggingFaceQueryKey(binding), targets = groups.get(key) ?? [];
      targets.push({ id, binding, revision: hfBindingRevisions.get(id) ?? 0 }); groups.set(key, targets);
    }
    for (const targets of groups.values()) {
      if (cancelled) break;
      const active = (target: typeof targets[number]) => {
        const binding = state.catalog.locations.find((location) => location.id === target.id)?.huggingFace;
        return Boolean(binding && currentHFOperation(target.id, target.revision) && huggingFaceWatchId(binding) === huggingFaceWatchId(target.binding));
      };
      const valid = targets.filter(active);
      if (!valid.length) continue;
      const binding = valid[0].binding;
      try {
        const snapshot = await remoteHFWatch(binding, [...new Set(valid.map((target) => target.binding.filePath))]);
        if (cancelled) break;
        const watchIds = new Set(valid.filter(active).map((target) => huggingFaceWatchId(target.binding)));
        await storeHFWatches([...watchIds].map((watchId) => {
          const target = valid.find((target) => huggingFaceWatchId(target.binding) === watchId)!;
          return { id: watchId, update: (latest) => {
            const current = valid.filter((target) => active(target) && huggingFaceWatchId(target.binding) === watchId);
            if (!current.length) return;
            const next = reconcileHuggingFaceWatch(latest, target.binding, snapshot);
            const fresh = unreadHuggingFaceEvents(next).filter((event) => !next.notifiedEventIds.includes(event.id));
            if (automatic && current.some((target) => huggingFaceConfig(modelItem(target.id).location.huggingFace!).monitoringEnabled)) hfNotices.set(watchId, fresh.length);
            next.notifiedEventIds = [...new Set([...next.notifiedEventIds, ...fresh.map((event) => event.id)])];
            return next;
          } };
        }));
      } catch (error) {
        if (cancelled) break;
        const failure = error as Error & { retryAt?: number };
        const current = valid.filter(active); fail(current.map((target) => target.id));
        await storeHFWatches([...new Set(current.map((target) => huggingFaceWatchId(target.binding)))].map((watchId) => {
          const target = current.find((target) => huggingFaceWatchId(target.binding) === watchId)!;
          return { id: watchId, update: (latest) => current.some((entry) => active(entry) && huggingFaceWatchId(entry.binding) === watchId) ? { ...(latest ?? emptyHuggingFaceWatch(target.binding)), lastAttemptAt: Date.now(), error: failure.message, retryAt: failure.retryAt } : undefined };
        }));
      }
    }
  } finally {
    const hfNotifications = cancelled ? 0 : [...hfNotices].reduce((total, [watchId, count]) => total + (state.catalog.locations.some((location) => location.huggingFace && huggingFaceWatchId(location.huggingFace) === watchId && huggingFaceConfig(location.huggingFace).monitoringEnabled) ? count : 0), 0);
    const counts = modelUpdateCounts(state.catalog, state.watches, state.hfWatches);
    const updated = selectedModels.filter((model) => counts[model.id] > 0).length;
    const failures = selectedModels.filter((model) => model.locationIds.some((id) => failed.has(id))).length;
    const failedLocationIds = locationIds.filter((id) => selectedModels.some((model) => model.locationIds.includes(id) && model.locationIds.some((copyId) => failed.has(copyId))));
    const hasHF = selectedIds.some((id) => state.catalog.locations.find((location) => location.id === id)?.huggingFace);
    const message = locationIds.length === 1 ? `${initialName}: ${cancelled ? 'check stopped' : failures ? 'check failed' : updated ? hasHF ? 'new updates available — see the provider links on this model' : 'new versions available — see the Civitai links on this model' : hasHF ? 'no unread new updates' : 'no unread new versions'}.` : `${cancelled ? 'Stopped. ' : ''}${updated} model${updated === 1 ? '' : 's'} with unread updates · ${selectedModels.length - updated} caught up${failures ? ` · ${failures} could not be checked` : ''}.`;
    publish({ progress: null, showUpdates: !automatic && locationIds.length > 1 && updated > 0 ? true : state.showUpdates, message: automatic ? state.message : message, checkResult: automatic ? state.checkResult : { locationIds, failedLocationIds, message }, notification: hfNotifications ? `${notificationCount + hfNotifications} new model update${notificationCount + hfNotifications === 1 ? '' : 's'} available (Hugging Face${notificationCount ? ' and Civitai' : ''}).` : notificationCount ? `${notificationCount} new model version${notificationCount === 1 ? '' : 's'} available (Civitai).` : state.notification });
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
    publish({ catalog: reconcileModelCatalog(state.catalog, sources, result.results), sourceStatus: Object.fromEntries(result.results.map((source) => [source.sourceId, { checkedAt: Date.now(), error: source.error }])), message: result.results.filter((source) => source.error).map((source) => source.error).join(' · ') || null });
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
  const linkedIds = linkedModelLocationIds(state.catalog);
  const toIdentify = state.catalog.locations.filter((location) => !location.civitai && (state.sources.find((source) => source.id === location.sourceId)?.identifyOnScan || (!linkedIds.has(location.id) && isModelWatched(modelItem(location.id))))).map((location) => location.id);
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
    if (location.huggingFace && huggingFaceConfig(location.huggingFace).monitoringEnabled && isWatchDue(state.hfWatches?.[huggingFaceWatchId(location.huggingFace)], state.intervalHours, Date.now())) return true;
    if (!isModelWatched(item)) return false;
    const remoteId = location.civitai && 'modelId' in location.civitai ? location.civitai.modelId : undefined;
    if (remoteId === undefined && location.huggingFace) return false;
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
    case 'configureHF': await configureHF(command.locationId, command.config); return;
    case 'hfEventAction': await markHFEvents(command.watchId, command.eventIds, command.action); return;
    case 'lookupHF': case 'bindHF': case 'verifyHF': return runHFCommand(command);
    case 'unbindHF': await unbindHF(command.locationId); return;
    case 'remove': {
      const item = modelItem(command.locationId);
      const descriptor = buildModelDescriptors(state.catalog).find((model) => model.locationIds.includes(item.location.id));
      requestModelRemoval(descriptor?.locationIds ?? [item.location.id]);
      return;
    }
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
    case 'unbind':
      // Invalidate pending identification before waiting for local preference writes.
      bindingRevisions.set(command.locationId, (bindingRevisions.get(command.locationId) ?? 0) + 1);
      await saveModelPatch(command.locationId, { watchUpdates: false });
      await patchLocation(command.locationId, { civitai: undefined }); return;
    case 'chooseLibrary': publish({ picker: { locationId: command.locationId, cover: command.cover } }); return;
    case 'viewLibrary': {
      if (!['total', 'confirmed', 'ambiguous'].includes(command.mode)) throw new Error('Unknown Library usage mode.');
      const item = modelItem(command.locationId);
      const descriptor = buildModelDescriptors(state.catalog).find((model) => model.locationIds.includes(command.locationId));
      if (!descriptor?.supported) throw new Error('Library usage is unavailable for this category.');
      openLibrary?.({ type: 'managedModel', id: descriptor.identity, label: item.location.fileName, managedModel: { ...descriptor, mode: command.mode } });
      return;
    }
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
    void runModelCommand(command).then((lookup) => window.electronAPI!.modelManagerCommandResult(requestId, { success: true, ...(lookup ? { lookup } : {}) })).catch((error) => window.electronAPI!.modelManagerCommandResult(requestId, { success: false, error: error.message }));
  });
  if (!initialization) initialization = (async () => {
    try {
      const durable = await window.electronAPI!.modelManagerLoadPreferences();
      const [sources, catalog, metadata, preferences, hfWatches] = await Promise.all([getAllModelSources(), window.electronAPI!.getJsonCacheData(MODEL_CATALOG_CACHE_ID), getAllModelLocalMetadata(), loadWatchPreferences(), loadHuggingFaceWatches()]);
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
      publish({ sources: durable?.sources ?? sources, catalog: migratedCatalog, localMetadata: migratedLocal, watches: durable?.watches ?? Object.fromEntries(preferences.watches.map((watch) => [watch.id, watch])), hfWatches: durable?.hfWatches ?? Object.fromEntries(hfWatches.map((watch) => [watch.id, watch])), intervalHours: [6, 24, 168].includes(durable?.intervalHours) ? durable!.intervalHours : preferences.intervalHours, libraryIds: useImageStore.getState().images.map((image) => image.id), loading: false });
      if (migratedCatalog !== restored) await persistCatalog();
      await flushModelState();
      if (managerRunning && state.sources.length) await scanModelSources();
    } catch (error) { publish({ loading: false, message: (error as Error).message }); }
  })();
  const check = () => { void scheduledCheck().catch((error) => managerMessage(error.message)); };
  const timer = setInterval(check, 60000);
  const unsubscribeImages = useImageStore.subscribe((next, previous) => {
    if (next.images !== previous.images) publish({ libraryIds: next.images.map((image) => image.id) });
    if (next.images !== previous.images || next.isLoading !== previous.isLoading || next.enrichmentProgress !== previous.enrichmentProgress) scheduleUsage();
  });
  window.addEventListener('focus', check);
  scheduleUsage();
  return () => { managerRunning = false; usageRevision++; if (usageTimer) clearTimeout(usageTimer); cancelModelJob(); unsubscribe(); unsubscribeImages(); clearInterval(timer); if (publishTimer) { clearTimeout(publishTimer); publishTimer = undefined; } window.removeEventListener('focus', check); };
}
