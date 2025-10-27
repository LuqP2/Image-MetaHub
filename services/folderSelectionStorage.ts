/// <reference lib="dom" />

export type StoredSelectionState = 'checked' | 'unchecked';

const DB_NAME = 'image-metahub-preferences';
const DB_VERSION = 1;
const STORE_NAME = 'folderSelection';
const RECORD_KEY = 'selection';

const getIndexedDB = () => {
  if (typeof indexedDB === 'undefined') {
    console.warn('IndexedDB is not available in this environment. Folder selection persistence is disabled.');
    return null;
  }
  return indexedDB;
};

async function openDatabase(): Promise<IDBDatabase | null> {
  const idb = getIndexedDB();
  if (!idb) {
    return null;
  }

  try {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('Failed to open folder selection storage', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('IndexedDB open error for folder selection storage:', error);
    return null;
  }
}

export async function loadFolderSelection(): Promise<Record<string, StoredSelectionState>> {
  const db = await openDatabase();
  if (!db) {
    return {};
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.data) {
        resolve(result.data as Record<string, StoredSelectionState>);
      } else {
        resolve({});
      }
    };

    request.onerror = () => {
      console.error('Failed to load folder selection state', request.error);
      resolve({});
    };
  });
}

export async function saveFolderSelection(selection: Record<string, StoredSelectionState>): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ id: RECORD_KEY, data: selection });

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Failed to save folder selection state', request.error);
      reject(request.error);
    };
  }).catch((error) => {
    console.error('IndexedDB save error for folder selection state:', error);
  });
}

export async function clearFolderSelection(): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(RECORD_KEY);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Failed to clear folder selection state', request.error);
      reject(request.error);
    };
  }).catch((error) => {
    console.error('IndexedDB delete error for folder selection state:', error);
  });
}
