import { openPreferencesDatabase, PREFERENCES_STORE_NAMES } from '../preferencesDb';
import type { HuggingFaceWatchRecord } from './types';
import { packHuggingFaceWatches, unpackHuggingFaceWatches } from './huggingFaceWatchState.mjs';

const STATE_ID = 'hf-watch-state-v1';

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
    tx.oncomplete = () => {
      db.close();
      try {
        const packed = read.result.find((record) => record.id === STATE_ID);
        resolve(packed ? Object.values(unpackHuggingFaceWatches(packed.state)) : read.result);
      } catch (error) { reject(error); }
    };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function saveHuggingFaceWatches(watches: Record<string, HuggingFaceWatchRecord>): Promise<void> {
  const state = packHuggingFaceWatches(watches);
  const db = await database();
  return new Promise((resolve, reject) => {
    // Shared baselines, events and decisions are committed together, replacing legacy records.
    const tx = db.transaction(PREFERENCES_STORE_NAMES.huggingFaceWatches, 'readwrite');
    const store = tx.objectStore(PREFERENCES_STORE_NAMES.huggingFaceWatches);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    try {
      store.clear();
      store.put({ id: STATE_ID, state });
    } catch (error) { tx.abort(); db.close(); reject(error); }
  });
}
