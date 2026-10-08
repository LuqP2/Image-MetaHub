import { openPreferencesDatabase, PREFERENCES_STORE_NAMES } from '../preferencesDb';
import type { HuggingFaceWatchRecord } from './types';

async function database() {
  const db = await openPreferencesDatabase({ context: 'Hugging Face monitoring', disablePersistence: () => {}, allowReset: false });
  if (!db) throw new Error('Hugging Face monitoring preferences could not be saved.');
  return db;
}
export async function loadHuggingFaceWatches(): Promise<HuggingFaceWatchRecord[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PREFERENCES_STORE_NAMES.huggingFaceWatches, 'readonly');
    const read = tx.objectStore(PREFERENCES_STORE_NAMES.huggingFaceWatches).getAll();
    tx.oncomplete = () => { db.close(); resolve(read.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function saveHuggingFaceWatch(watch: HuggingFaceWatchRecord): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    // Snapshot, events and decisions are committed in the same record/transaction.
    const tx = db.transaction(PREFERENCES_STORE_NAMES.huggingFaceWatches, 'readwrite');
    tx.objectStore(PREFERENCES_STORE_NAMES.huggingFaceWatches).put(watch);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
