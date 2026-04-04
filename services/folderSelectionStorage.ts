/// <reference lib="dom" />

import { openPreferencesDatabase, PREFERENCES_STORE_NAMES } from './preferencesDb';

export type StoredSelectionState = 'checked' | 'unchecked'; // Legacy type for migration

const STORE_NAME = PREFERENCES_STORE_NAMES.folderSelection;
const RECORD_KEY = 'selection';
const EXCLUDED_FOLDERS_KEY = 'excluded-folders';

let inMemorySelection: string[] = [];
let inMemoryExcludedFolders: string[] = [];
let isPersistenceDisabled = false;

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

async function openDatabase({ allowReset = true }: { allowReset?: boolean } = {}): Promise<IDBDatabase | null> {
  return openPreferencesDatabase({
    context: 'folder selection storage',
    disablePersistence,
    allowReset,
  });
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
    return [...inMemoryExcludedFolders];
  }

  const db = await openDatabase();
  if (!db) {
    return [...inMemoryExcludedFolders];
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
        inMemoryExcludedFolders = [];
        resolve([]);
        return;
      }
      inMemoryExcludedFolders = [...result.data];
      resolve([...result.data]);
    };

    request.onerror = () => {
      console.error('Failed to load excluded folders', request.error);
      resolve([...inMemoryExcludedFolders]);
    };
  });
}

export async function saveExcludedFolders(excludedPaths: string[]): Promise<void> {
  inMemoryExcludedFolders = [...excludedPaths];

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
