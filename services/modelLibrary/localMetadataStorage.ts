/// <reference lib="dom" />

import { openPreferencesDatabase, PREFERENCES_STORE_NAMES } from '../preferencesDb';
import type { ModelLocalMetadata } from './types';

const STORE_NAME = PREFERENCES_STORE_NAMES.modelLocalMetadata;
const memory = new Map<string, ModelLocalMetadata>();
let disabled = false;

export function normalizeModelLocalMetadata(value: Partial<ModelLocalMetadata> & Pick<ModelLocalMetadata, 'sha256'>): ModelLocalMetadata {
  return {
    sha256: value.sha256.toLowerCase(),
    displayName: value.displayName?.trim() || undefined,
    notes: value.notes?.trim() || undefined,
    tags: Array.from(new Set((value.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))),
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
  };
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
    request.onsuccess = () => { const entries = (request.result as ModelLocalMetadata[]).map(normalizeModelLocalMetadata); memory.clear(); entries.forEach((entry) => memory.set(entry.sha256, entry)); resolve(entries); };
    request.onerror = () => resolve([...memory.values()]);
  });
}

export async function saveModelLocalMetadata(value: ModelLocalMetadata): Promise<ModelLocalMetadata> {
  const normalized = normalizeModelLocalMetadata({ ...value, updatedAt: Date.now() });
  memory.set(normalized.sha256, normalized);
  const db = await database();
  if (!db) return normalized;
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).put(normalized); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; tx.onerror = () => { db.close(); reject(tx.error); }; });
  return normalized;
}
