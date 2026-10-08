import type { CivitaiModelMetadata, ModelWatchRecord, RemoteModelVersion } from './types';

export function versionDate(version: { publishedAt?: string; createdAt?: string }): number | null {
  for (const date of [version.publishedAt, version.createdAt]) {
    const parsed = date ? Date.parse(date) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function reconcileWatch(
  previous: ModelWatchRecord | undefined,
  modelId: number,
  modelName: string,
  versions: RemoteModelVersion[],
  installed: CivitaiModelMetadata[],
  now: number,
): ModelWatchRecord {
  const localIds = new Set(installed.map((item) => item.versionId));
  const dates = installed.map((item) => versionDate(versions.find((version) => version.id === item.versionId) ?? item));
  const dated = dates.filter((date): date is number => date !== null);
  // Never silently compare against an incomplete installed chronology.
  const baseline = dates.length && dated.length === dates.length ? Math.max(...dated) : null;
  const known = new Set(previous?.knownVersionIds ?? []);
  const priorNovel = new Set(previous?.novelVersionIds ?? []);
  const novelVersionIds = versions.filter((version) => {
    if (localIds.has(version.id)) return false;
    const date = versionDate(version);
    if (date !== null && baseline !== null) return date > baseline;
    return priorNovel.has(version.id) || Boolean(previous?.lastSuccessAt !== undefined && !known.has(version.id));
  }).map((version) => version.id);
  return {
    id: String(modelId), modelId, modelName, versions,
    knownVersionIds: Array.from(new Set([...(previous?.knownVersionIds ?? []), ...versions.map((item) => item.id)])),
    novelVersionIds,
    seenVersionIds: previous?.seenVersionIds ?? [],
    ignoredVersionIds: previous?.ignoredVersionIds ?? [],
    notifiedVersionIds: previous?.notifiedVersionIds ?? [],
    lastSuccessAt: now, lastAttemptAt: now,
    chronologyUnknown: baseline === null || versions.some((version) => versionDate(version) === null),
  };
}

export function unreadVersions(watch: ModelWatchRecord | undefined, installedIds: number[] = []): RemoteModelVersion[] {
  if (!watch) return [];
  const excluded = new Set([...watch.seenVersionIds, ...watch.ignoredVersionIds, ...installedIds]);
  return watch.versions.filter((version) => watch.novelVersionIds.includes(version.id) && !excluded.has(version.id));
}

export function isWatchDue(watch: Pick<ModelWatchRecord, 'retryAt' | 'lastAttemptAt'> | undefined, hours: number, now: number): boolean {
  if (watch?.retryAt && watch.retryAt > now) return false;
  return !watch?.lastAttemptAt || now - watch.lastAttemptAt >= hours * 3600000;
}

export function parseCivitaiVersionLink(input: string): number | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !['civitai.com', 'www.civitai.com'].includes(url.hostname)) return null;
    if (!/^\/models\/\d+\/?$/.test(url.pathname)) return null;
    const id = Number(url.searchParams.get('modelVersionId'));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch { return null; }
}

export function modelFamily(version: RemoteModelVersion, localBaseModels: string[]): string {
  if (!version.baseModel || !localBaseModels.length) return 'Base model not provided';
  return localBaseModels.some((base) => base.toLowerCase() === version.baseModel!.toLowerCase()) ? 'Same family' : 'Other base model';
}
