/// <reference lib="dom" />

export type StoredSelectionState = 'checked' | 'unchecked';

const DB_NAME = 'image-metahub-preferences';
const DB_VERSION = 1;
const STORE_NAME = 'folderSelection';
const RECORD_KEY = 'selection';

let inMemorySelection: Record<string, StoredSelectionState> = {};
let isPersistenceDisabled = false;
let hasResetAttempted = false;

const getIndexedDB = () => {
  if (typeof indexedDB === 'undefined') {
    if (!isPersistenceDisabled) {
      console.warn('IndexedDB is not available in this environment. Folder selection persistence is disabled.');
      isPersistenceDisabled = true;
    }
    return null;
  }
  return indexedDB;
};

function disablePersistence(error?: unknown) {
  if (isPersistenceDisabled) {
    return;
  }

  console.error(
    'IndexedDB open error for folder selection storage. Folder selection persistence will be disabled for this session.',
    error,
  );
  isPersistenceDisabled = true;
}

async function deleteDatabase(): Promise<boolean> {
  const idb = getIndexedDB();
  if (!idb) {
    return false;
  }

  const deleteResult = await new Promise<boolean>((resolve) => {
    const request = idb.deleteDatabase(DB_NAME);

    request.onsuccess = () => resolve(true);
    request.onerror = () => {
      console.error('Failed to reset folder selection storage', request.error);
      resolve(false);
    };
    request.onblocked = () => {
      console.warn('Folder selection storage reset is blocked by an open connection.');
      resolve(false);
    };
  });

  return deleteResult;
}

function getErrorName(error: unknown): string | undefined {
  if (error instanceof DOMException) {
    return error.name;
  }

  if (typeof error === 'object' && error && 'name' in error) {
    return String((error as { name: unknown }).name);
  }

  return undefined;
}

async function openDatabase({ allowReset = true }: { allowReset?: boolean } = {}): Promise<IDBDatabase | null> {
  if (isPersistenceDisabled) {
    return null;
  }

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
        const db = request.result;
        db.onversionchange = () => {
          try {
            db.close();
          } catch (closeError) {
            console.warn('Failed to close folder selection storage during version change', closeError);
          }
        };
        hasResetAttempted = false;
        resolve(db);
      };

      request.onerror = () => {
        console.warn('Failed to open folder selection storage', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    const errorName = getErrorName(error);

    // Auto-reset on version errors, unknown errors, or invalid state
    if (allowReset && !hasResetAttempted && (errorName === 'VersionError' || errorName === 'UnknownError' || errorName === 'InvalidStateError')) {
      console.warn('Resetting folder selection storage due to IndexedDB error:', error);
      hasResetAttempted = true;
      const resetSuccessful = await deleteDatabase();
      if (resetSuccessful) {
        return openDatabase({ allowReset: false });
      }
    }

    disablePersistence(error);
    return null;
  }
}

export async function loadFolderSelection(): Promise<Record<string, StoredSelectionState>> {
  if (isPersistenceDisabled) {
    return { ...inMemorySelection };
  }

  const db = await openDatabase();
  if (!db) {
    return { ...inMemorySelection };
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close folder selection storage after load', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.data) {
        inMemorySelection = { ...(result.data as Record<string, StoredSelectionState>) };
      } else {
        inMemorySelection = {};
      }
      resolve({ ...inMemorySelection });
    };

    request.onerror = () => {
      console.error('Failed to load folder selection state', request.error);
      resolve({ ...inMemorySelection });
    };
  });
}

export async function saveFolderSelection(selection: Record<string, StoredSelectionState>): Promise<void> {
  inMemorySelection = { ...selection };

  if (isPersistenceDisabled) {
    return;
  }

  const db = await openDatabase();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ id: RECORD_KEY, data: selection });

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close folder selection storage after save', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Failed to save folder selection state', request.error);
      reject(request.error);
    };
  }).catch((error) => {
    console.error('IndexedDB save error for folder selection state:', error);
    disablePersistence(error);
  });
}

export async function clearFolderSelection(): Promise<void> {
  inMemorySelection = {};

  if (isPersistenceDisabled) {
    return;
  }

  const db = await openDatabase();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(RECORD_KEY);

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close folder selection storage after clear', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Failed to clear folder selection state', request.error);
      reject(request.error);
    };
  }).catch((error) => {
    console.error('IndexedDB delete error for folder selection state:', error);
    disablePersistence(error);
  });
}
