import { openPreferencesDatabase, PREFERENCES_STORE_NAMES } from '../preferencesDb';
import type { ModelWatchRecord } from './types';

async function database() {
  const db = await openPreferencesDatabase({ context: 'model watch preferences', disablePersistence: () => {}, allowReset: false });
  if (!db) throw new Error('Model preferences could not be saved.');
  return db;
}

export async function loadWatchPreferences(): Promise<{ watches: ModelWatchRecord[]; intervalHours: number }> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PREFERENCES_STORE_NAMES.modelWatches, PREFERENCES_STORE_NAMES.modelManagerSettings], 'readonly');
    const watches = tx.objectStore(PREFERENCES_STORE_NAMES.modelWatches).getAll();
    const settings = tx.objectStore(PREFERENCES_STORE_NAMES.modelManagerSettings).get('settings');
    tx.oncomplete = () => { db.close(); resolve({ watches: watches.result, intervalHours: [6, 24, 168].includes(settings.result?.intervalHours) ? settings.result.intervalHours : 24 }); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function saveWatchPreference(value: ModelWatchRecord | { id: 'settings'; intervalHours: number }): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const store = value.id === 'settings' ? PREFERENCES_STORE_NAMES.modelManagerSettings : PREFERENCES_STORE_NAMES.modelWatches;
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
