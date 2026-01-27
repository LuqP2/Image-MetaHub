/// <reference lib="dom" />

import type { PromptPreset } from '../types';

const DB_NAME = 'image-metahub-preferences';
const DB_VERSION = 4; // Phase 4: Prompt Library
const STORE_NAME = 'promptLibrary';

const inMemoryPresets: Map<string, PromptPreset> = new Map();
let isPersistenceDisabled = false;

const getIndexedDB = () => {
  if (typeof indexedDB === 'undefined') {
    if (!isPersistenceDisabled) {
      console.warn('IndexedDB is not available. Prompt Library persistence is disabled.');
      isPersistenceDisabled = true;
    }
    return null;
  }
  return indexedDB;
};

// ... Helper functions (disablePersistence, getErrorName) consistent with other storage modules

function disablePersistence(error?: unknown) {
  if (isPersistenceDisabled) return;
  console.error('IndexedDB error for Prompt Library. Persistence disabled.', error);
  isPersistenceDisabled = true;
}

function getErrorName(error: unknown): string | undefined {
  if (error instanceof DOMException) return error.name;
  if (typeof error === 'object' && error && 'name' in error) return String((error as { name: unknown }).name);
  return undefined;
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (isPersistenceDisabled) return null;
  const idb = getIndexedDB();
  if (!idb) return null;

  try {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      // note: we rely on other modules or this one to trigger upgrade if needed. 
      // Since we updated version in all files, the first one to acquire lock upgrades it.
      const request = idb.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        // Ensure store exists (redundant safety check if imageAnnotationsStorage ran first, but good for isolation)
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    disablePersistence(error);
    return null;
  }
}

export async function savePreset(preset: PromptPreset): Promise<void> {
  inMemoryPresets.set(preset.id, preset);
  if (isPersistenceDisabled) return;

  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(preset);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
        db.close();
        reject(tx.error);
    };
    req.onerror = () => {
        // tx.onerror will catch this too, but good practice
        console.error('Error saving preset', req.error);
    };
  });
}

export async function loadPresets(): Promise<PromptPreset[]> {
  if (isPersistenceDisabled) return Array.from(inMemoryPresets.values());

  const db = await openDatabase();
  if (!db) return Array.from(inMemoryPresets.values());

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    tx.oncomplete = () => {
      const results = req.result as PromptPreset[];
      inMemoryPresets.clear();
      results.forEach(p => inMemoryPresets.set(p.id, p));
      db.close();
      resolve(results);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function deletePreset(id: string): Promise<void> {
  inMemoryPresets.delete(id);
  if (isPersistenceDisabled) return;

  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
        db.close();
        reject(tx.error);
    };
  });
}
