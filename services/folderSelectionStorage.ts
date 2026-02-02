/// <reference lib="dom" />

export type StoredSelectionState = 'checked' | 'unchecked'; // Legacy type for migration

const DB_NAME = 'image-metahub-preferences';
const DB_VERSION = 3; // Updated to match imageAnnotationsStorage.ts (Smart Clustering Phase 1)
const STORE_NAME = 'folderSelection';
const RECORD_KEY = 'selection';
const EXCLUDED_FOLDERS_KEY = 'excluded-folders';
const STORAGE_VERSION_KEY = 'folder-selection-version';
const CURRENT_VERSION = 2; // Version 2: Array-based selection (v1 was Map-based)

let inMemorySelection: string[] = [];
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
        const error = request.error;
        console.warn('Failed to open folder selection storage', error);

        // Check for VersionError immediately and reject with proper error
        if (error && (error.name === 'VersionError' || (error as any).constructor?.name === 'VersionError')) {
          const versionError = new Error('VersionError');
          versionError.name = 'VersionError';
          reject(versionError);
        } else {
          reject(error);
        }
      };
    });
  } catch (error) {
    const errorName = getErrorName(error);

    console.log('🔍 IndexedDB Error caught:', { errorName, allowReset, hasResetAttempted });

    // Auto-reset on version errors, unknown errors, or invalid state
    if (allowReset && !hasResetAttempted && (errorName === 'VersionError' || errorName === 'UnknownError' || errorName === 'InvalidStateError')) {
      console.warn('🔄 Resetting folder selection storage due to IndexedDB error:', error);
      hasResetAttempted = true;
      const resetSuccessful = await deleteDatabase();
      console.log('🗑️ Database deletion result:', resetSuccessful);
      if (resetSuccessful) {
        console.log('♻️ Attempting to reopen database with version 1...');
        return openDatabase({ allowReset: false });
      }
    }

    console.error('❌ Could not recover from IndexedDB error. Disabling persistence.');
    disablePersistence(error);
    return null;
  }
}

export async function loadSelectedFolders(): Promise<string[]> {
  if (isPersistenceDisabled) {
    return [...inMemorySelection];
  }

  const db = await openDatabase();
  if (!db) {
    return [...inMemorySelection];
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
      if (!result || !result.data) {
        // No stored selection - default to empty array
        inMemorySelection = [];
        resolve([]);
        return;
      }

      // Check if old format (version 1) - Map/Record format
      if (typeof result.data === 'object' && !Array.isArray(result.data)) {
        // Migrate from Map format to Array format
        console.log('🔄 Migrating folder selection from v1 (Map) to v2 (Array) format');
        const selectedPaths: string[] = [];
        const oldData = result.data as Record<string, StoredSelectionState>;

        Object.entries(oldData).forEach(([path, state]) => {
          if (state === 'checked') {
            selectedPaths.push(path);
          }
        });

        inMemorySelection = selectedPaths;

        // Save in new format asynchronously (don't wait for it)
        saveSelectedFolders(selectedPaths).then(() => {
          console.log('✅ Migration complete - folder selection saved in new format');
        }).catch((error) => {
          console.error('❌ Failed to save migrated folder selection:', error);
        });

        resolve(selectedPaths);
      } else {
        // Already in new format (version 2) - Array format
        inMemorySelection = [...result.data];
        resolve([...result.data]);
      }
    };

    request.onerror = () => {
      console.error('Failed to load folder selection state', request.error);
      resolve([...inMemorySelection]);
    };
  });
}

// Legacy function name for backward compatibility
export async function loadFolderSelection(): Promise<Record<string, StoredSelectionState>> {
  console.warn('loadFolderSelection() is deprecated. Use loadSelectedFolders() instead.');
  const selectedPaths = await loadSelectedFolders();
  // Convert array back to old format for backward compatibility
  const legacyFormat: Record<string, StoredSelectionState> = {};
  selectedPaths.forEach(path => {
    legacyFormat[path] = 'checked';
  });
  return legacyFormat;
}

export async function saveSelectedFolders(selectedPaths: string[]): Promise<void> {
  inMemorySelection = [...selectedPaths];

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
    const request = store.put({ id: RECORD_KEY, data: selectedPaths });

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

// Legacy function name for backward compatibility
export async function saveFolderSelection(selection: Record<string, StoredSelectionState>): Promise<void> {
  console.warn('saveFolderSelection() is deprecated. Use saveSelectedFolders() instead.');
  // Convert old format to new format
  const selectedPaths: string[] = [];
  Object.entries(selection).forEach(([path, state]) => {
    if (state === 'checked') {
      selectedPaths.push(path);
    }
  });
  await saveSelectedFolders(selectedPaths);
}

export async function loadExcludedFolders(): Promise<string[]> {
  if (isPersistenceDisabled) {
    return []; // No in-memory fallback for exclusion yet, but could add if needed
  }

  const db = await openDatabase();
  if (!db) {
    return [];
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(EXCLUDED_FOLDERS_KEY);

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close folder selection storage after load excluded', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => {
      const result = request.result;
      if (!result || !result.data) {
        resolve([]);
        return;
      }
      resolve([...result.data]);
    };

    request.onerror = () => {
      console.error('Failed to load excluded folders', request.error);
      resolve([]);
    };
  });
}

export async function saveExcludedFolders(excludedPaths: string[]): Promise<void> {
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
    const request = store.put({ id: EXCLUDED_FOLDERS_KEY, data: excludedPaths });

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close folder selection storage after save excluded', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Failed to save excluded folders', request.error);
      reject(request.error);
    };
  }).catch((error) => {
    console.error('IndexedDB save error for excluded folders:', error);
    disablePersistence(error);
  });
}

export async function clearSelectedFolders(): Promise<void> {
  inMemorySelection = [];

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

// Legacy function name for backward compatibility
export async function clearFolderSelection(): Promise<void> {
  console.warn('clearFolderSelection() is deprecated. Use clearSelectedFolders() instead.');
  await clearSelectedFolders();
}
