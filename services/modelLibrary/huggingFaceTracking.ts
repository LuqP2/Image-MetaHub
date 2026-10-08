import { validateHuggingFaceScope } from './huggingFaceLink.mjs';
import type { HuggingFaceBinding, HuggingFaceEvent, HuggingFaceRemoteSnapshot, HuggingFaceWatchRecord, ModelCatalog, ModelLocation, ModelWatchRecord } from './types';
import { huggingFaceConfig, huggingFaceWatchId } from './huggingFaceWatchIdentity.mjs';
export { huggingFaceConfig, huggingFaceWatchId, huggingFaceQueryKey } from './huggingFaceWatchIdentity.mjs';
import { unreadVersions } from './updateTracking';
import { buildManagedModels } from './catalog';

export function emptyHuggingFaceWatch(binding: HuggingFaceBinding): HuggingFaceWatchRecord {
  return { id: huggingFaceWatchId(binding), repoId: binding.repoId, filePath: binding.filePath, ...huggingFaceConfig(binding), events: [], seenEventIds: [], ignoredEventIds: [], notifiedEventIds: [] };
}
export function reconcileHuggingFaceWatch(previous: HuggingFaceWatchRecord | undefined, binding: HuggingFaceBinding, snapshot: HuggingFaceRemoteSnapshot): HuggingFaceWatchRecord {
  const config = huggingFaceConfig(binding), id = huggingFaceWatchId(binding);
  validateHuggingFaceScope(binding.repoId, config.trackedRevision, config.watchedDirectory, config.recursive);
  if (snapshot.repoId !== binding.repoId || snapshot.revision !== config.trackedRevision || snapshot.watchedDirectory !== config.watchedDirectory || snapshot.recursive !== config.recursive || !Object.hasOwn(snapshot.linkedFiles, binding.filePath)) throw new Error('Hugging Face snapshot does not match the monitored scope.');
  const current = previous?.id === id ? previous : emptyHuggingFaceWatch(binding);
  const events = new Map(current.events.map((event) => [event.id, event]));
  const add = (kind: HuggingFaceEvent['kind'], path: string, fingerprint: string) => {
    const eventId = JSON.stringify(['huggingFace', id, kind, path, fingerprint]);
    if (!events.has(eventId)) events.set(eventId, { id: eventId, source: 'huggingFace', kind, path, fingerprint, commit: snapshot.resolvedCommit, detectedAt: snapshot.fetchedAt });
  };
  if (current.snapshot) {
    const before = current.snapshot.linkedFiles[binding.filePath];
    const after = snapshot.linkedFiles[binding.filePath];
    if (before && !after) add('fileUnavailable', binding.filePath, 'missing');
    if (after && (!before || after.fingerprint !== before.fingerprint)) add('fileChanged', binding.filePath, after.fingerprint);
    const knownPaths = new Set(current.snapshot.files.map((file) => file.path));
    for (const file of snapshot.files) if (file.path !== binding.filePath && !knownPaths.has(file.path)) add('newModelFile', file.path, file.fingerprint);
  }
  return { ...current, snapshot, events: [...events.values()], lastSuccessAt: snapshot.fetchedAt, lastAttemptAt: snapshot.fetchedAt, retryAt: undefined, error: undefined };
}
export function unreadHuggingFaceEvents(watch: HuggingFaceWatchRecord | undefined): HuggingFaceEvent[] {
  if (!watch) return [];
  const excluded = new Set([...watch.seenEventIds, ...watch.ignoredEventIds]);
  return watch.events.filter((event) => !excluded.has(event.id));
}
export function modelUpdateCounts(catalog: ModelCatalog, watches: Record<string, ModelWatchRecord>, hfWatches: Record<string, HuggingFaceWatchRecord> = {}, installedCatalog = catalog): Record<string, number> {
  const result: Record<string, number> = {};
  const byId = new Map(catalog.locations.map((location) => [location.id, location]));
  const installedByModel = new Map<number, number[]>();
  for (const location of installedCatalog.locations) if (location.civitai && 'modelId' in location.civitai) {
    const installed = installedByModel.get(location.civitai.modelId) ?? [];
    installed.push(location.civitai.versionId); installedByModel.set(location.civitai.modelId, installed);
  }
  for (const model of buildManagedModels(catalog.locations)) {
    const copies = model.locationIds.map((id) => byId.get(id)!);
    const events = new Set<string>();
    for (const location of copies) {
      const link = location.civitai && 'modelId' in location.civitai ? location.civitai : undefined;
      if (link) {
        const installed = installedByModel.get(link.modelId) ?? [];
        for (const version of unreadVersions(watches[String(link.modelId)], installed)) events.add(`civitai:${link.modelId}:${version.id}`);
      }
      if (location.huggingFace) for (const event of unreadHuggingFaceEvents(hfWatches[huggingFaceWatchId(location.huggingFace)])) events.add(event.id);
    }
    result[model.id] = events.size;
  }
  return result;
}
export function linkedModelLocationIds(catalog: ModelCatalog, civitaiOnly = false): Set<string> {
  const byId = new Map(catalog.locations.map((location) => [location.id, location]));
  const ids = new Set<string>();
  for (const model of buildManagedModels(catalog.locations)) if (model.locationIds.some((id) => { const location = byId.get(id)!; return (location.civitai && 'modelId' in location.civitai) || (!civitaiOnly && location.huggingFace); })) model.locationIds.forEach((id) => ids.add(id));
  return ids;
}
export function isHuggingFaceWatchActive(watch: HuggingFaceWatchRecord, locations: ModelLocation[]): boolean {
  return locations.some((location) => location.huggingFace && huggingFaceWatchId(location.huggingFace) === watch.id);
}
