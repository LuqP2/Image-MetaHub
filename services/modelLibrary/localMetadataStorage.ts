/// <reference lib="dom" />

import { openPreferencesDatabase, PREFERENCES_STORE_NAMES } from '../preferencesDb';
import type { ModelLocalMetadata, ModelLocation } from './types';
import { getModelLocalMetadataId } from './presentation';

const STORE_NAME = PREFERENCES_STORE_NAMES.modelLocalMetadata;
const memory = new Map<string, ModelLocalMetadata>();
let disabled = false;

export function normalizeModelLocalMetadata(
  value: Partial<ModelLocalMetadata> & Pick<ModelLocalMetadata, 'id'>,
): ModelLocalMetadata {
  const sha256 = typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(value.sha256)
    ? value.sha256.toLowerCase()
    : undefined;
  const defaultStrength = Number.isFinite(value.defaultStrength)
    ? Math.min(10, Math.max(-10, Number(value.defaultStrength)))
    : undefined;
  return {
    id: value.id.trim(),
    sha256,
    locationId: value.locationId?.trim() || undefined,
    displayName: value.displayName?.trim() || undefined,
    notes: value.notes?.trim() || undefined,
    tags: Array.from(new Set((value.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))),
    triggerWords: Array.from(new Set((value.triggerWords ?? []).map((word) => word.trim()).filter(Boolean))),
    defaultStrength,
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
  };
}

export function createModelLocalMetadata(
  location: Pick<ModelLocation, 'id' | 'sha256'>,
  value: Omit<ModelLocalMetadata, 'id' | 'sha256' | 'locationId' | 'updatedAt'>,
): ModelLocalMetadata {
  return normalizeModelLocalMetadata({
    ...value,
    id: getModelLocalMetadataId(location),
    sha256: location.sha256,
    locationId: location.sha256 ? undefined : location.id,
    updatedAt: Date.now(),
  });
}

export function promoteModelLocalMetadata(
  value: ModelLocalMetadata,
  sha256: string,
): ModelLocalMetadata {
  const normalizedHash = sha256.toLowerCase();
  return normalizeModelLocalMetadata({
    ...value,
    id: `sha256:${normalizedHash}`,
    sha256: normalizedHash,
    locationId: undefined,
    updatedAt: Date.now(),
  });
}

async function database(): Promise<IDBDatabase | null> {
  if (disabled) return null;
  return openPreferencesDatabase({ context: 'model local metadata storage', disablePersistence: () => { disabled = true; } });
}

export async function getAllModelLocalMetadata(): Promise<ModelLocalMetadata[]> {
  const db = await database();
  if (!db) return [...memory.values()];
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    const close = () => db.close(); tx.oncomplete = close; tx.onabort = close; tx.onerror = close;
    request.onsuccess = () => {
      const entries = (request.result as ModelLocalMetadata[])
        .filter((entry) => typeof entry?.id === 'string' && entry.id.trim())
        .map(normalizeModelLocalMetadata);
      memory.clear(); entries.forEach((entry) => memory.set(entry.id, entry)); resolve(entries);
    };
    request.onerror = () => resolve([...memory.values()]);
  });
}

export async function saveModelLocalMetadata(value: ModelLocalMetadata): Promise<ModelLocalMetadata> {
  const normalized = normalizeModelLocalMetadata({ ...value, updatedAt: Date.now() });
  memory.set(normalized.id, normalized);
  const db = await database();
  if (!db) return normalized;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(normalized);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
  return normalized;
}

export async function deleteModelLocalMetadata(id: string): Promise<void> {
  memory.delete(id);
  const db = await database();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
