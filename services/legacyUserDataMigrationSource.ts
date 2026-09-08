/// <reference lib="dom" />

import type { ImageAnnotations, ShadowMetadata, UserDataSemanticPatch } from '../types';
import { openPreferencesDatabase, PREFERENCES_STORE_NAMES } from './preferencesDb';

export type LegacyUserDataDomain = 'annotation' | 'shadow';

export interface LegacyUserDataSnapshot {
  domain: LegacyUserDataDomain;
  legacyImageId: string;
  payload: Record<string, unknown> | null;
  tombstone: boolean;
  sourceVersion: number;
  mutationId?: string;
  patch?: UserDataSemanticPatch;
}

type MigrationOutboxRecord = LegacyUserDataSnapshot & { key: string };

const OUTBOX_STORE = PREFERENCES_STORE_NAMES.userDataMigrationOutbox;

const outboxKey = (domain: LegacyUserDataDomain, imageId: string) => `${domain}\0${imageId}`;

async function openMigrationDatabase(): Promise<IDBDatabase> {
  let openError: unknown = null;
  const db = await openPreferencesDatabase({
    context: 'stable identity user-data migration',
    allowReset: false,
    disablePersistence: (error) => { openError = error ?? new Error('IndexedDB is unavailable.'); },
  });
  if (!db) {
    throw openError instanceof Error ? openError : new Error('Legacy user-data source is unavailable.');
  }
  return db;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function stripRendererKeys(domain: LegacyUserDataDomain, value: ImageAnnotations | ShadowMetadata): Record<string, unknown> {
  const payload = structuredClone(value) as unknown as Record<string, unknown>;
  delete payload.imageId;
  delete payload.assetId;
  delete payload.persistenceVersion;
  if (domain === 'annotation') {
    const annotation = payload as Omit<ImageAnnotations, 'imageId'>;
    return {
      isFavorite: annotation.isFavorite,
      tags: [...annotation.tags],
      ...(annotation.rating === undefined ? {} : { rating: annotation.rating }),
      addedAt: annotation.addedAt,
      updatedAt: annotation.updatedAt,
      ...(annotation.suppressedMetadataTags ? { suppressedMetadataTags: [...annotation.suppressedMetadataTags] } : {}),
    };
  }
  return structuredClone(payload) as Record<string, unknown>;
}

export async function readAllLegacyUserDataSnapshots(): Promise<LegacyUserDataSnapshot[]> {
  const db = await openMigrationDatabase();
  try {
    const transaction = db.transaction([
      PREFERENCES_STORE_NAMES.imageAnnotations,
      PREFERENCES_STORE_NAMES.shadowMetadata,
      OUTBOX_STORE,
    ], 'readonly');
    const completed = transactionComplete(transaction);
    const [annotations, shadows, outbox] = await Promise.all([
      requestResult(transaction.objectStore(PREFERENCES_STORE_NAMES.imageAnnotations).getAll()),
      requestResult(transaction.objectStore(PREFERENCES_STORE_NAMES.shadowMetadata).getAll()),
      requestResult(transaction.objectStore(OUTBOX_STORE).getAll()),
    ]);
    await completed;
    const snapshots = new Map<string, LegacyUserDataSnapshot>();
    for (const annotation of annotations as ImageAnnotations[]) {
      snapshots.set(outboxKey('annotation', annotation.imageId), {
        domain: 'annotation',
        legacyImageId: annotation.imageId,
        payload: stripRendererKeys('annotation', annotation),
        tombstone: false,
        sourceVersion: 0,
      });
    }
    for (const shadow of shadows as ShadowMetadata[]) {
      snapshots.set(outboxKey('shadow', shadow.imageId), {
        domain: 'shadow',
        legacyImageId: shadow.imageId,
        payload: stripRendererKeys('shadow', shadow),
        tombstone: false,
        sourceVersion: 0,
      });
    }
    for (const rawRecord of outbox as MigrationOutboxRecord[]) {
      const record = rawRecord as MigrationOutboxRecord;
      snapshots.set(outboxKey(record.domain, record.legacyImageId), {
        domain: record.domain,
        legacyImageId: record.legacyImageId,
        payload: record.tombstone ? null : structuredClone(record.payload),
        tombstone: record.tombstone,
        sourceVersion: record.sourceVersion,
        mutationId: record.mutationId,
        patch: record.patch ? structuredClone(record.patch) : undefined,
      });
    }
    return [...snapshots.values()];
  } finally {
    db.close();
  }
}

function applyPatch(
  domain: LegacyUserDataDomain,
  current: Record<string, unknown> | null,
  patch: UserDataSemanticPatch,
): Record<string, unknown> | null {
  if (patch.deleteRecord) return null;
  const timestamp = Number(patch.set?.updatedAt ?? patch.set?.addedAt ?? Date.now());
  const next: Record<string, unknown> = current
    ? structuredClone(current)
    : domain === 'annotation'
      ? { isFavorite: false, tags: [], addedAt: timestamp, updatedAt: timestamp, suppressedMetadataTags: [] }
      : { updatedAt: timestamp };
  for (const [key, value] of Object.entries(patch.set ?? {})) next[key] = structuredClone(value);
  for (const key of patch.remove ?? []) delete next[key];
  if (domain === 'annotation') {
    const removed = new Set(patch.removeTags ?? []);
    const tags = new Set((Array.isArray(next.tags) ? next.tags : []).filter((tag): tag is string => typeof tag === 'string' && !removed.has(tag)));
    for (const tag of patch.addTags ?? []) tags.add(tag);
    const unsuppressed = new Set(patch.unsuppressTags ?? []);
    const suppressed = new Set((Array.isArray(next.suppressedMetadataTags) ? next.suppressedMetadataTags : [])
      .filter((tag): tag is string => typeof tag === 'string' && !unsuppressed.has(tag)));
    for (const tag of patch.suppressTags ?? []) suppressed.add(tag);
    for (const tag of patch.importTags ?? []) {
      if (!suppressed.has(tag)) tags.add(tag);
    }
    next.tags = [...tags];
    next.suppressedMetadataTags = [...suppressed];
  }
  return next;
}

export async function readLegacyUserDataSnapshot(
  domain: LegacyUserDataDomain,
  imageId: string,
): Promise<LegacyUserDataSnapshot | null> {
  const db = await openMigrationDatabase();
  try {
    const sourceStoreName = domain === 'annotation'
      ? PREFERENCES_STORE_NAMES.imageAnnotations
      : PREFERENCES_STORE_NAMES.shadowMetadata;
    const transaction = db.transaction([sourceStoreName, OUTBOX_STORE], 'readonly');
    const completed = transactionComplete(transaction);
    const outboxPromise = requestResult(transaction.objectStore(OUTBOX_STORE).get(outboxKey(domain, imageId)));
    const sourcePromise = requestResult(transaction.objectStore(sourceStoreName).get(imageId));
    const [outbox, source] = await Promise.all([outboxPromise, sourcePromise]);
    await completed;
    if (outbox) {
      const record = outbox as MigrationOutboxRecord;
      return {
        domain,
        legacyImageId: imageId,
        payload: record.tombstone ? null : structuredClone(record.payload),
        tombstone: record.tombstone,
        sourceVersion: record.sourceVersion,
        mutationId: record.mutationId,
        patch: record.patch ? structuredClone(record.patch) : undefined,
      };
    }
    if (!source) return null;
    return {
      domain,
      legacyImageId: imageId,
      payload: stripRendererKeys(domain, source as ImageAnnotations | ShadowMetadata),
      tombstone: false,
      sourceVersion: 0,
    };
  } finally {
    db.close();
  }
}

export async function commitLegacyUserDataPatch(
  domain: LegacyUserDataDomain,
  imageId: string,
  patch: UserDataSemanticPatch,
  mutationId: string,
): Promise<LegacyUserDataSnapshot> {
  const db = await openMigrationDatabase();
  try {
    const sourceStoreName = domain === 'annotation'
      ? PREFERENCES_STORE_NAMES.imageAnnotations
      : PREFERENCES_STORE_NAMES.shadowMetadata;
    const transaction = db.transaction([sourceStoreName, OUTBOX_STORE], 'readwrite');
    const completed = transactionComplete(transaction);
    const sourceStore = transaction.objectStore(sourceStoreName);
    const outboxStore = transaction.objectStore(OUTBOX_STORE);
    const outboxRequest = outboxStore.get(outboxKey(domain, imageId));
    const sourceRequest = sourceStore.get(imageId);
    let result: LegacyUserDataSnapshot | null = null;
    let outboxValue: MigrationOutboxRecord | undefined;
    let sourceValue: ImageAnnotations | ShadowMetadata | undefined;
    let readFailure: unknown = null;

    // Queue dependent writes synchronously from the second read callback. An
    // IndexedDB transaction may become inactive before an awaited Promise.all
    // continuation runs, even though both individual requests succeeded.
    const queueCommittedSnapshot = () => {
      if (outboxRequest.readyState !== 'done' || sourceRequest.readyState !== 'done' || result || readFailure) return;
      const currentPayload = outboxValue
        ? outboxValue.payload
        : sourceValue
          ? stripRendererKeys(domain, sourceValue)
          : null;
      const payload = applyPatch(domain, currentPayload, patch);
      const sourceVersion = Number(outboxValue?.sourceVersion ?? 0) + 1;
      result = {
        domain,
        legacyImageId: imageId,
        payload,
        tombstone: payload === null,
        sourceVersion,
        mutationId,
        patch: structuredClone(patch),
      };
      if (payload === null) sourceStore.delete(imageId);
      else sourceStore.put({ ...structuredClone(payload), imageId });
      outboxStore.put({ ...result, key: outboxKey(domain, imageId) } satisfies MigrationOutboxRecord);
    };

    outboxRequest.onsuccess = () => {
      outboxValue = outboxRequest.result as MigrationOutboxRecord | undefined;
      queueCommittedSnapshot();
    };
    sourceRequest.onsuccess = () => {
      sourceValue = sourceRequest.result as ImageAnnotations | ShadowMetadata | undefined;
      queueCommittedSnapshot();
    };
    const failRead = (request: IDBRequest) => {
      readFailure = request.error ?? new Error('IndexedDB migration source read failed.');
      try { transaction.abort(); } catch { /* completion rejects with the original read failure below */ }
    };
    outboxRequest.onerror = () => failRead(outboxRequest);
    sourceRequest.onerror = () => failRead(sourceRequest);
    await completed;
    if (readFailure) throw readFailure;
    if (!result) throw new Error('Legacy user-data transaction completed without a committed snapshot.');
    return result;
  } finally {
    db.close();
  }
}
