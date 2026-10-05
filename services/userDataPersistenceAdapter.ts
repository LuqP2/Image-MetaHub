/// <reference lib="dom" />

import type {
  ImageAnnotations,
  IndexedImage,
  ShadowMetadata,
  StableUserDataDomain,
  StableUserDataRecord,
  StableUserDataReference,
  StableUserDataStatus,
  TagInfo,
  UserDataSemanticPatch,
} from '../types';
import {
  patchLegacyUserData,
  ensureManualTagExists,
  getAllManualTagNames,
  getAnnotation as getLegacyAnnotation,
  getShadowMetadata as getLegacyShadow,
  loadAllAnnotations as loadAllLegacyAnnotations,
} from './imageAnnotationsStorage';
import {
  commitLegacyUserDataPatch,
  readAllLegacyUserDataSnapshots,
  readLegacyUserDataSnapshot,
  type LegacyUserDataSnapshot,
} from './legacyUserDataMigrationSource';

const MAX_SYNC_BATCH = 200;
const referencesByImageId = new Map<string, StableUserDataReference>();
const imagesByAssetId = new Map<string, Set<string>>();
const recordsByAssetDomain = new Map<string, StableUserDataRecord>();
const localPendingByImageDomain = new Map<string, LegacyUserDataSnapshot>();
const listeners = new Set<(records: StableUserDataRecord[]) => void>();
let statusPromise: Promise<StableUserDataStatus> | null = null;
let legacyFullScanPromise: Promise<void> | null = null;
let mainUnsubscribe: (() => void) | null = null;

const cacheKey = (assetId: string, domain: StableUserDataDomain) => `${assetId}\0${domain}`;
const localKey = (imageId: string, domain: StableUserDataDomain) => `${imageId}\0${domain}`;

class UserDataPersistenceError extends Error {
  code: string;
  current?: StableUserDataRecord;

  constructor(code: string, message: string, current?: StableUserDataRecord) {
    super(message);
    this.name = 'UserDataPersistenceError';
    this.code = code;
    this.current = current;
  }
}

export class UserDataBatchPersistenceError extends Error {
  persisted: ImageAnnotations[];
  failures: unknown[];

  constructor(persisted: ImageAnnotations[], failures: unknown[]) {
    super(`${failures.length} user-data record${failures.length === 1 ? '' : 's'} could not be persisted.`);
    this.name = 'UserDataBatchPersistenceError';
    this.persisted = persisted;
    this.failures = failures;
  }
}

const hasDesktopBridge = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.electronAPI?.stableUserDataStatus);

const legacyStatus = (): StableUserDataStatus => ({
  initialized: true,
  authority: 'legacy',
  available: true,
  migrationEnabled: false,
  indexingEnabled: false,
  error: null,
});

export async function getUserDataPersistenceStatus(force = false): Promise<StableUserDataStatus> {
  if (!hasDesktopBridge()) return legacyStatus();
  if (force || !statusPromise) {
    statusPromise = window.electronAPI.stableUserDataStatus().catch((error) => ({
      initialized: false,
      authority: 'sqlite' as const,
      available: false,
      migrationEnabled: false,
      indexingEnabled: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    }));
  }
  return statusPromise;
}

function referenceForImage(image: Pick<IndexedImage, 'assetId' | 'revisionId' | 'provenanceLocationId'>): StableUserDataReference | null {
  if (!image.assetId || !image.revisionId || !image.provenanceLocationId) return null;
  return {
    assetId: image.assetId,
    revisionId: image.revisionId,
    locationId: image.provenanceLocationId,
  };
}

const statusErrorMessage = (status: StableUserDataStatus): string =>
  typeof status.error === 'object' && status.error?.message
    ? status.error.message
    : 'Stable user-data catalog is unavailable.';

export function registerStableUserDataImages(images: IndexedImage[]): void {
  for (const image of images) {
    const reference = referenceForImage(image);
    const previous = referencesByImageId.get(image.id);
    if (previous && (!reference || previous.assetId !== reference.assetId)) {
      imagesByAssetId.get(previous.assetId)?.delete(image.id);
      localPendingByImageDomain.delete(localKey(image.id, 'annotation'));
      localPendingByImageDomain.delete(localKey(image.id, 'shadow'));
    }
    if (!reference) {
      referencesByImageId.delete(image.id);
      continue;
    }
    referencesByImageId.set(image.id, reference);
    const imageIds = imagesByAssetId.get(reference.assetId) ?? new Set<string>();
    imageIds.add(image.id);
    imagesByAssetId.set(reference.assetId, imageIds);
  }
  ensureMainSubscription();
}

function cacheAndPublish(records: StableUserDataRecord[]): void {
  const accepted: StableUserDataRecord[] = [];
  for (const record of records) {
    const key = cacheKey(record.assetId, record.domain);
    const current = recordsByAssetDomain.get(key);
    if (current && current.version >= record.version) continue;
    recordsByAssetDomain.set(key, structuredClone(record));
    accepted.push(record);
    for (const imageId of imagesByAssetId.get(record.assetId) ?? []) {
      localPendingByImageDomain.delete(localKey(imageId, record.domain));
    }
  }
  if (accepted.length > 0) {
    for (const listener of listeners) listener(accepted.map((record) => structuredClone(record)));
  }
}

function ensureMainSubscription(): void {
  if (mainUnsubscribe || !hasDesktopBridge() || !window.electronAPI.onStableUserDataChanged) return;
  mainUnsubscribe = window.electronAPI.onStableUserDataChanged(({ records }) => cacheAndPublish(records));
}

export function subscribeStableUserDataChanges(
  listener: (records: StableUserDataRecord[]) => void,
): () => void {
  listeners.add(listener);
  ensureMainSubscription();
  return () => listeners.delete(listener);
}

function unwrap<T>(result: { success: boolean; value?: T; error?: string; code?: string; details?: { current?: StableUserDataRecord } | null }): T {
  if (result.success) return result.value as T;
  const current = result.details?.current;
  if (current) cacheAndPublish([current]);
  throw new UserDataPersistenceError(
    result.code ?? 'USER_DATA_OPERATION_FAILED',
    result.error ?? 'User data could not be persisted.',
    current,
  );
}

function annotationFromPayload(
  imageId: string,
  payload: Record<string, unknown>,
  record?: StableUserDataRecord,
): ImageAnnotations {
  return {
    imageId,
    isFavorite: payload.isFavorite === true,
    tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    ...(Object.prototype.hasOwnProperty.call(payload, 'rating') ? { rating: payload.rating as ImageAnnotations['rating'] } : {}),
    addedAt: Number(payload.addedAt ?? 0),
    updatedAt: Number(payload.updatedAt ?? 0),
    ...(Array.isArray(payload.suppressedMetadataTags)
      ? { suppressedMetadataTags: payload.suppressedMetadataTags.filter((tag): tag is string => typeof tag === 'string') }
      : {}),
    ...(record ? { assetId: record.assetId, persistenceVersion: record.version } : {}),
  };
}

function shadowFromPayload(
  imageId: string,
  payload: Record<string, unknown>,
  record?: StableUserDataRecord,
): ShadowMetadata {
  return {
    ...(structuredClone(payload) as Omit<ShadowMetadata, 'imageId'>),
    imageId,
    updatedAt: Number(payload.updatedAt ?? 0),
    ...(record ? { assetId: record.assetId, persistenceVersion: record.version } : {}),
  };
}

function recordForImage(imageId: string, domain: StableUserDataDomain): StableUserDataRecord | null {
  const reference = referencesByImageId.get(imageId);
  return reference ? recordsByAssetDomain.get(cacheKey(reference.assetId, domain)) ?? null : null;
}

async function finalizeOutbox(snapshot: LegacyUserDataSnapshot): Promise<void> {
  if (!snapshot.mutationId || !hasDesktopBridge()) return;
  const result = unwrap(await window.electronAPI.stableUserDataFinalizeLegacyMutation({
    mutationId: snapshot.mutationId,
    sourceVersion: snapshot.sourceVersion,
    payload: snapshot.payload,
    tombstone: snapshot.tombstone,
  }));
  if (result.record) cacheAndPublish([result.record]);
}

async function stageAllLegacyUserDataIfNeeded(status: StableUserDataStatus): Promise<void> {
  if (
    status.authority !== 'sqlite'
    || !status.available
    || !status.migrationEnabled
    || status.legacyScanComplete
  ) return;
  if (!legacyFullScanPromise) {
    legacyFullScanPromise = (async () => {
      const snapshots = await readAllLegacyUserDataSnapshots();
      for (const snapshot of snapshots) {
        if (snapshot.mutationId) await finalizeOutbox(snapshot);
      }
      for (let offset = 0; offset < snapshots.length; offset += MAX_SYNC_BATCH) {
        const batch = snapshots.slice(offset, offset + MAX_SYNC_BATCH);
        const synced = unwrap(await window.electronAPI.stableUserDataSync({
          entries: batch.map((snapshot) => ({
            domain: snapshot.domain,
            legacyImageId: snapshot.legacyImageId,
            payload: snapshot.payload,
            tombstone: snapshot.tombstone,
            sourceVersion: snapshot.sourceVersion,
          })),
        }));
        for (const outcome of synced) {
          if (outcome.record) cacheAndPublish([outcome.record]);
        }
      }
      const completedStatus = unwrap(await window.electronAPI.stableUserDataCompleteLegacyScan());
      statusPromise = Promise.resolve(completedStatus);
    })().catch((error) => {
      legacyFullScanPromise = null;
      throw error;
    });
  }
  await legacyFullScanPromise;
}

async function syncImageDomains(
  imageIds: string[],
  domains: StableUserDataDomain[],
): Promise<Map<string, StableUserDataRecord | LegacyUserDataSnapshot | null>> {
  const status = await getUserDataPersistenceStatus();
  const results = new Map<string, StableUserDataRecord | LegacyUserDataSnapshot | null>();
  if (status.authority !== 'sqlite') return results;
  if (!status.available) {
    throw new UserDataPersistenceError('USER_DATA_UNAVAILABLE', statusErrorMessage(status));
  }
  await stageAllLegacyUserDataIfNeeded(status);
  const effectiveStatus = await getUserDataPersistenceStatus();
  const probes = imageIds.flatMap((imageId) => domains.map((domain) => ({
    domain,
    legacyImageId: imageId,
    ...(referencesByImageId.get(imageId) ? { reference: referencesByImageId.get(imageId) } : {}),
  })));
  const sourceRequired: typeof probes = [];
  for (let offset = 0; offset < probes.length; offset += MAX_SYNC_BATCH) {
    const batch = probes.slice(offset, offset + MAX_SYNC_BATCH);
    const synced = unwrap(await window.electronAPI.stableUserDataSync({ entries: batch }));
    for (let index = 0; index < synced.length; index += 1) {
      const outcome = synced[index];
      const entry = batch[index];
      if (outcome.record) cacheAndPublish([outcome.record]);
      if (outcome.record && outcome.status !== 'source_ack_required') {
        results.set(localKey(entry.legacyImageId, entry.domain), outcome.record);
      } else if (outcome.pending && outcome.status !== 'source_ack_required') {
        localPendingByImageDomain.set(localKey(entry.legacyImageId, entry.domain), outcome.pending);
        results.set(localKey(entry.legacyImageId, entry.domain), outcome.pending);
      } else if (outcome.status !== 'source_ack_required' && effectiveStatus.legacyScanComplete) {
        results.set(localKey(entry.legacyImageId, entry.domain), null);
      } else {
        sourceRequired.push(entry);
      }
    }
  }

  const sourceEntries = await Promise.all(sourceRequired.map(async (entry) => {
    const snapshot = await readLegacyUserDataSnapshot(entry.domain, entry.legacyImageId);
    if (snapshot?.mutationId) await finalizeOutbox(snapshot);
    return { entry, snapshot };
  }));
  const snapshotsToSync = sourceEntries.filter(
    (candidate): candidate is typeof candidate & { snapshot: LegacyUserDataSnapshot } => Boolean(candidate.snapshot),
  );
  for (const { entry, snapshot } of sourceEntries) {
    if (!snapshot) results.set(localKey(entry.legacyImageId, entry.domain), recordForImage(entry.legacyImageId, entry.domain));
  }
  for (let offset = 0; offset < snapshotsToSync.length; offset += MAX_SYNC_BATCH) {
    const batch = snapshotsToSync.slice(offset, offset + MAX_SYNC_BATCH);
    const synced = unwrap(await window.electronAPI.stableUserDataSync({
      entries: batch.map(({ entry, snapshot }) => ({
        ...entry,
        payload: snapshot.payload,
        tombstone: snapshot.tombstone,
        sourceVersion: snapshot.sourceVersion,
      })),
    }));
    for (let index = 0; index < synced.length; index += 1) {
      const outcome = synced[index];
      const { entry, snapshot } = batch[index];
      if (outcome.record) cacheAndPublish([outcome.record]);
      if (!outcome.record && ['unmapped', 'pending'].includes(outcome.status)) {
        localPendingByImageDomain.set(localKey(entry.legacyImageId, entry.domain), outcome.pending ?? snapshot);
      }
      results.set(
        localKey(entry.legacyImageId, entry.domain),
        outcome.record ?? outcome.pending ?? (['unmapped', 'pending'].includes(outcome.status) ? snapshot : null),
      );
    }
  }
  return results;
}

export async function loadAnnotationsForImages(images: IndexedImage[]): Promise<Map<string, ImageAnnotations>> {
  registerStableUserDataImages(images);
  const status = await getUserDataPersistenceStatus();
  if (status.authority !== 'sqlite') return loadAllLegacyAnnotations();
  const values = await syncImageDomains(images.map((image) => image.id), ['annotation']);
  const annotations = new Map<string, ImageAnnotations>();
  for (const image of images) {
    const value = values.get(localKey(image.id, 'annotation'));
    if (!value || value.tombstone || !value.payload) continue;
    annotations.set(image.id, annotationFromPayload(image.id, value.payload, 'version' in value ? value : undefined));
  }
  return annotations;
}

export async function hydrateUserDataForImages(images: IndexedImage[]): Promise<{
  annotations: Map<string, ImageAnnotations>;
  shadows: Map<string, ShadowMetadata>;
}> {
  registerStableUserDataImages(images);
  const status = await getUserDataPersistenceStatus();
  if (status.authority !== 'sqlite') {
    const annotations = new Map<string, ImageAnnotations>();
    const shadows = new Map<string, ShadowMetadata>();
    await Promise.all(images.map(async (image) => {
      const [annotation, shadow] = await Promise.all([getLegacyAnnotation(image.id), getLegacyShadow(image.id)]);
      if (annotation) annotations.set(image.id, annotation);
      if (shadow) shadows.set(image.id, shadow);
    }));
    return { annotations, shadows };
  }
  const values = await syncImageDomains(images.map((image) => image.id), ['annotation', 'shadow']);
  const annotations = new Map<string, ImageAnnotations>();
  const shadows = new Map<string, ShadowMetadata>();
  for (const image of images) {
    const annotation = values.get(localKey(image.id, 'annotation'));
    if (annotation && !annotation.tombstone && annotation.payload) {
      annotations.set(image.id, annotationFromPayload(image.id, annotation.payload, 'version' in annotation ? annotation : undefined));
    }
    const shadow = values.get(localKey(image.id, 'shadow'));
    if (shadow && !shadow.tombstone && shadow.payload) {
      shadows.set(image.id, shadowFromPayload(image.id, shadow.payload, 'version' in shadow ? shadow : undefined));
    }
  }
  return { annotations, shadows };
}

async function persistUnmappedPatch(
  domain: StableUserDataDomain,
  imageId: string,
  patch: UserDataSemanticPatch,
): Promise<StableUserDataRecord | LegacyUserDataSnapshot> {
  const mutationId = crypto.randomUUID();
  unwrap(await window.electronAPI.stableUserDataReserveLegacyMutation({ mutationId, domain, legacyImageId: imageId, patch }));
  const committed = await commitLegacyUserDataPatch(domain, imageId, patch, mutationId);
  localPendingByImageDomain.set(localKey(imageId, domain), committed);
  await finalizeOutbox(committed);
  // A global tag operation can live in the SQLite journal without changing the
  // retained IndexedDB source. Confirm the projected result, not that raw source.
  const [outcome] = unwrap(await window.electronAPI.stableUserDataSync({
    entries: [{ domain, legacyImageId: imageId, reference: referencesByImageId.get(imageId) }],
  }));
  if (outcome.record) {
    cacheAndPublish([outcome.record]);
    return outcome.record;
  }
  if (outcome.pending) {
    localPendingByImageDomain.set(localKey(imageId, domain), outcome.pending);
    return outcome.pending;
  }
  throw new UserDataPersistenceError('USER_DATA_MAPPING_STALE', 'The committed user data could not be resolved to this image.');
}

async function mutateDomain(
  domain: StableUserDataDomain,
  imageId: string,
  patch: UserDataSemanticPatch,
): Promise<StableUserDataRecord | LegacyUserDataSnapshot> {
  const status = await getUserDataPersistenceStatus();
  if (status.authority !== 'sqlite') return patchLegacyUserData(domain, imageId, patch);
  if (!status.available) {
    throw new UserDataPersistenceError('USER_DATA_UNAVAILABLE', statusErrorMessage(status));
  }
  const reference = referencesByImageId.get(imageId);
  if (!reference) return persistUnmappedPatch(domain, imageId, patch);
  if (!recordForImage(imageId, domain)) await syncImageDomains([imageId], [domain]);
  const current = recordForImage(imageId, domain);
  const record = unwrap(await window.electronAPI.stableUserDataMutate({
    domain,
    legacyImageId: imageId,
    reference,
    expectedVersion: current?.version ?? 0,
    patch,
  }));
  cacheAndPublish([record]);
  return record;
}

export async function patchAnnotation(imageId: string, patch: UserDataSemanticPatch): Promise<ImageAnnotations | null> {
  const timestamp = Date.now();
  const result = await mutateDomain('annotation', imageId, {
    ...patch,
    set: { ...patch.set, updatedAt: patch.set?.updatedAt ?? timestamp },
  });
  if (result.tombstone || !result.payload) return null;
  return annotationFromPayload(imageId, result.payload, 'version' in result ? result : undefined);
}

export async function patchShadowMetadata(image: IndexedImage | string, patch: UserDataSemanticPatch): Promise<ShadowMetadata | null> {
  const imageId = typeof image === 'string' ? image : image.id;
  if (typeof image !== 'string') registerStableUserDataImages([image]);
  const result = await mutateDomain('shadow', imageId, {
    ...patch,
    set: { ...patch.set, updatedAt: patch.set?.updatedAt ?? Date.now() },
  });
  if (result.tombstone || !result.payload) return null;
  return shadowFromPayload(imageId, result.payload, 'version' in result ? result : undefined);
}

export async function getPersistedShadowMetadata(image: IndexedImage | string): Promise<ShadowMetadata | null> {
  const imageId = typeof image === 'string' ? image : image.id;
  if (typeof image !== 'string') registerStableUserDataImages([image]);
  const status = await getUserDataPersistenceStatus();
  if (status.authority !== 'sqlite') return getLegacyShadow(imageId);
  const values = await syncImageDomains([imageId], ['shadow']);
  const value = values.get(localKey(imageId, 'shadow'));
  return value && !value.tombstone && value.payload
    ? shadowFromPayload(imageId, value.payload, 'version' in value ? value : undefined)
    : null;
}

export async function saveAnnotations(records: ImageAnnotations[]): Promise<ImageAnnotations[]> {
  const persisted: ImageAnnotations[] = [];
  const failures: unknown[] = [];
  for (const annotation of records) {
    try {
      const current = recordForImage(annotation.imageId, 'annotation')?.payload
        ?? localPendingByImageDomain.get(localKey(annotation.imageId, 'annotation'))?.payload
        ?? null;
      const set: Record<string, unknown> = {};
      const remove: string[] = [];
      for (const key of ['isFavorite', 'tags', 'rating', 'addedAt', 'updatedAt', 'suppressedMetadataTags'] as const) {
        if (Object.prototype.hasOwnProperty.call(annotation, key)) {
          const value = annotation[key];
          if (value === undefined) {
            if (current && Object.prototype.hasOwnProperty.call(current, key)) remove.push(key);
          } else if (!current || !Object.is(current[key], value)) {
            set[key] = structuredClone(value);
          }
        } else if (current && Object.prototype.hasOwnProperty.call(current, key)) {
          remove.push(key);
        }
      }
      const saved = await patchAnnotation(annotation.imageId, { set, remove });
      if (saved) persisted.push(saved);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new UserDataBatchPersistenceError(persisted, failures);
  return persisted;
}

export async function saveShadows(records: ShadowMetadata[], imagesById?: Map<string, IndexedImage>): Promise<ShadowMetadata[]> {
  const persisted: ShadowMetadata[] = [];
  for (const shadow of records) {
    const image = imagesById?.get(shadow.imageId) ?? shadow.imageId;
    const current = await getPersistedShadowMetadata(image);
    const payload = structuredClone(shadow) as unknown as Record<string, unknown>;
    delete payload.imageId;
    delete payload.assetId;
    delete payload.persistenceVersion;
    const set: Record<string, unknown> = {};
    const remove = new Set(current
      ? Object.keys(current).filter((key) => (
          !['imageId', 'assetId', 'persistenceVersion'].includes(key)
          && !Object.prototype.hasOwnProperty.call(payload, key)
        ))
      : []);
    for (const [key, value] of Object.entries(payload)) {
      if (value === null || value === undefined) remove.add(key);
      else set[key] = value;
    }
    const saved = await patchShadowMetadata(image, { set, remove: [...remove] });
    if (saved) persisted.push(saved);
  }
  return persisted;
}

export async function prepareUserDataForImages(images: IndexedImage[]): Promise<void> {
  registerStableUserDataImages(images);
  const status = await getUserDataPersistenceStatus();
  if (status.authority === 'sqlite') await syncImageDomains(images.map((image) => image.id), ['annotation', 'shadow']);
}

export async function mutateAnnotationTagGlobally(
  action: 'rename' | 'remove',
  sourceTag: string,
  targetTag?: string,
): Promise<StableUserDataRecord[] | null> {
  const status = await getUserDataPersistenceStatus();
  if (status.authority !== 'sqlite') return null;
  if (!status.available) throw new UserDataPersistenceError('USER_DATA_UNAVAILABLE', statusErrorMessage(status));
  await stageAllLegacyUserDataIfNeeded(status);
  const records = unwrap(await window.electronAPI.stableUserDataGlobalTagMutation({
    action,
    sourceTag,
    targetTag,
    updatedAt: Date.now(),
  }));
  cacheAndPublish(records);
  return records;
}

export async function getAllAuthoritativeTags(): Promise<TagInfo[]> {
  const manualTags = await getAllManualTagNames();
  const status = await getUserDataPersistenceStatus();
  if (status.authority !== 'sqlite') {
    const annotations = await loadAllLegacyAnnotations();
    const counts = new Map(manualTags.map((name) => [name, 0]));
    for (const annotation of annotations.values()) {
      for (const tag of annotation.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }
  if (!status.available) throw new UserDataPersistenceError('USER_DATA_UNAVAILABLE', statusErrorMessage(status));
  const stableTags = unwrap(await window.electronAPI.stableUserDataTagCounts());
  const counts = new Map(manualTags.map((name) => [name, 0]));
  for (const tag of stableTags) counts.set(tag.name, tag.count);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function ensureAuthoritativeManualTags(tags: string[]): Promise<void> {
  await Promise.all([...new Set(tags)].map((tag) => ensureManualTagExists(tag)));
}

export function annotationFromStableRecord(record: StableUserDataRecord, imageId: string): ImageAnnotations | null {
  return record.domain === 'annotation' && !record.tombstone && record.payload
    ? annotationFromPayload(imageId, record.payload, record)
    : null;
}

export function shadowFromStableRecord(record: StableUserDataRecord, imageId: string): ShadowMetadata | null {
  return record.domain === 'shadow' && !record.tombstone && record.payload
    ? shadowFromPayload(imageId, record.payload, record)
    : null;
}

export function __resetUserDataPersistenceAdapterForTests(): void {
  referencesByImageId.clear();
  imagesByAssetId.clear();
  recordsByAssetDomain.clear();
  localPendingByImageDomain.clear();
  statusPromise = null;
  legacyFullScanPromise = null;
  mainUnsubscribe?.();
  mainUnsubscribe = null;
  listeners.clear();
}

export { UserDataPersistenceError };
