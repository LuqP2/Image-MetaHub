/// <reference lib="dom" />

import { openPreferencesDatabase, PREFERENCES_STORE_NAMES } from '../preferencesDb';
import type { ModelSource, ModelSourceKind } from './types';

const STORE_NAME = PREFERENCES_STORE_NAMES.modelSources;
const memory = new Map<string, ModelSource>();
let persistenceDisabled = false;

function normalizeKind(value: unknown): ModelSourceKind {
  return value === 'checkpoint' ? 'checkpoint' : 'lora';
}

export function normalizeModelSource(source: Partial<ModelSource> & Pick<ModelSource, 'id' | 'path'>): ModelSource {
  const now = Date.now();
  const path = source.path.trim();
  return {
    id: source.id,
    path,
    name: source.name?.trim() || path.split(/[\\/]/).filter(Boolean).pop() || 'Model source',
    kind: normalizeKind(source.kind),
    recursive: source.recursive !== false,
    createdAt: Number.isFinite(source.createdAt) ? Number(source.createdAt) : now,
    updatedAt: Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : now,
  };
}

async function getDb(): Promise<IDBDatabase | null> {
  if (persistenceDisabled) return null;
  return openPreferencesDatabase({
    context: 'model source storage',
    disablePersistence: () => { persistenceDisabled = true; },
  });
}

export async function getAllModelSources(): Promise<ModelSource[]> {
  const db = await getDb();
  if (!db) return [...memory.values()].sort((a, b) => a.createdAt - b.createdAt);
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    const close = () => db.close();
    tx.oncomplete = close; tx.onabort = close; tx.onerror = close;
    request.onsuccess = () => {
      const sources = (request.result as ModelSource[]).map(normalizeModelSource).sort((a, b) => a.createdAt - b.createdAt);
      memory.clear(); sources.forEach((source) => memory.set(source.id, source));
      resolve(sources);
    };
    request.onerror = () => resolve([...memory.values()].sort((a, b) => a.createdAt - b.createdAt));
  });
}

export async function saveModelSource(source: ModelSource): Promise<ModelSource> {
  const normalized = normalizeModelSource({ ...source, updatedAt: Date.now() });
  memory.set(normalized.id, normalized);
  const db = await getDb();
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

export async function deleteModelSource(id: string): Promise<void> {
  memory.delete(id);
  const db = await getDb();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
