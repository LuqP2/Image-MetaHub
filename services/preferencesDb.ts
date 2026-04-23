/// <reference lib="dom" />

export const PREFERENCES_DB_NAME = 'image-metahub-preferences';
export const PREFERENCES_DB_VERSION = 7;

export const PREFERENCES_STORE_NAMES = {
  folderSelection: 'folderSelection',
  imageAnnotations: 'imageAnnotations',
  manualTags: 'manualTags',
  clusterPreferences: 'clusterPreferences',
  smartCollections: 'smartCollections',
  shadowMetadata: 'shadowMetadata',
  automationRules: 'automationRules',
} as const;

type DisablePersistenceFn = (error?: unknown) => void;

type OpenPreferencesDatabaseOptions = {
  context: string;
  disablePersistence: DisablePersistenceFn;
  allowReset?: boolean;
};

type ManualTagRecord = {
  name: string;
  createdAt: number;
  updatedAt: number;
};

let hasResetAttempted = false;

export function getIndexedDbErrorName(error: unknown): string | undefined {
  if (error instanceof DOMException) {
    return error.name;
  }

  if (typeof error === 'object' && error && 'name' in error) {
    return String((error as { name: unknown }).name);
  }

  return undefined;
}

function getIndexedDB(context: string, disablePersistence: DisablePersistenceFn): IDBFactory | null {
  if (typeof indexedDB === 'undefined') {
    console.warn(`IndexedDB is not available in this environment. ${context} persistence is disabled.`);
    disablePersistence();
    return null;
  }

  return indexedDB;
}

async function deletePreferencesDatabase(
  context: string,
  disablePersistence: DisablePersistenceFn,
): Promise<boolean> {
  const idb = getIndexedDB(context, disablePersistence);
  if (!idb) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const request = idb.deleteDatabase(PREFERENCES_DB_NAME);

    request.onsuccess = () => resolve(true);
    request.onerror = () => {
      console.error(`Failed to reset shared preferences database while handling ${context}`, request.error);
      resolve(false);
    };
    request.onblocked = () => {
      console.warn(`Shared preferences database reset is blocked while handling ${context}.`);
      resolve(false);
    };
  });
}

function getTransactionObjectStore(transaction: IDBTransaction | null, name: string): IDBObjectStore | null {
  if (!transaction) {
    return null;
  }

  try {
    return transaction.objectStore(name);
  } catch {
    return null;
  }
}

function ensureObjectStore(
  db: IDBDatabase,
  transaction: IDBTransaction | null,
  name: string,
  options: IDBObjectStoreParameters,
): IDBObjectStore {
  if (!db.objectStoreNames.contains(name)) {
    return db.createObjectStore(name, options);
  }

  const existingStore = getTransactionObjectStore(transaction, name);
  if (!existingStore) {
    throw new Error(`Object store "${name}" is not available during preferences DB upgrade.`);
  }

  return existingStore;
}

function ensureIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string | string[],
  options?: IDBIndexParameters,
): void {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

function normalizeManualTagName(tagName: string): string {
  return tagName.trim().toLowerCase();
}

function seedManualTagsFromAnnotations(
  annotationStore: IDBObjectStore,
  manualTagsStore: IDBObjectStore,
): void {
  const request = annotationStore.getAll();

  request.onsuccess = () => {
    const annotations = request.result as Array<{ tags?: unknown }>;
    const timestamp = Date.now();
    const uniqueTags = new Set<string>();

    for (const annotation of annotations) {
      const tags = Array.isArray(annotation.tags) ? annotation.tags : [];
      for (const tag of tags) {
        const normalizedTag = normalizeManualTagName(String(tag));
        if (normalizedTag) {
          uniqueTags.add(normalizedTag);
        }
      }
    }

    for (const tagName of uniqueTags) {
      manualTagsStore.put({
        name: tagName,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies ManualTagRecord);
    }
  };

  request.onerror = () => {
    console.error('Failed to seed manual tags from annotations during shared preferences DB migration', request.error);
  };
}

function upgradePreferencesDatabase(request: IDBOpenDBRequest, oldVersion: number): void {
  const db = request.result;
  const transaction = request.transaction;

  ensureObjectStore(db, transaction, PREFERENCES_STORE_NAMES.folderSelection, { keyPath: 'id' });

  const annotationStore = ensureObjectStore(db, transaction, PREFERENCES_STORE_NAMES.imageAnnotations, {
    keyPath: 'imageId',
  });
  ensureIndex(annotationStore, 'isFavorite', 'isFavorite', { unique: false });
  ensureIndex(annotationStore, 'tags', 'tags', { unique: false, multiEntry: true });

  ensureObjectStore(db, transaction, PREFERENCES_STORE_NAMES.clusterPreferences, { keyPath: 'clusterId' });

  const smartCollectionsStore = ensureObjectStore(db, transaction, PREFERENCES_STORE_NAMES.smartCollections, {
    keyPath: 'id',
  });
  ensureIndex(smartCollectionsStore, 'type', 'type', { unique: false });

  ensureObjectStore(db, transaction, PREFERENCES_STORE_NAMES.shadowMetadata, { keyPath: 'imageId' });
  ensureObjectStore(db, transaction, PREFERENCES_STORE_NAMES.automationRules, { keyPath: 'id' });

  const manualTagsStore = ensureObjectStore(db, transaction, PREFERENCES_STORE_NAMES.manualTags, { keyPath: 'name' });
  if (oldVersion < 5) {
    seedManualTagsFromAnnotations(annotationStore, manualTagsStore);
  }

  if (oldVersion < 7) {
    console.log('Shared preferences database upgraded to v7.');
  }
}

export async function resetPreferencesDatabase(
  context: string,
  disablePersistence: DisablePersistenceFn,
): Promise<boolean> {
  return deletePreferencesDatabase(context, disablePersistence);
}

export async function openPreferencesDatabase({
  context,
  disablePersistence,
  allowReset = true,
}: OpenPreferencesDatabaseOptions): Promise<IDBDatabase | null> {
  const idb = getIndexedDB(context, disablePersistence);
  if (!idb) {
    return null;
  }

  try {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open(PREFERENCES_DB_NAME, PREFERENCES_DB_VERSION);

      request.onupgradeneeded = (event) => {
        upgradePreferencesDatabase(request, event.oldVersion);
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          try {
            db.close();
          } catch (closeError) {
            console.warn(`Failed to close shared preferences database during version change for ${context}`, closeError);
          }
        };
        hasResetAttempted = false;
        resolve(db);
      };

      request.onerror = () => {
        console.warn(`Failed to open shared preferences database for ${context}`, request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    const errorName = getIndexedDbErrorName(error);

    if (
      allowReset
      && !hasResetAttempted
      && (errorName === 'VersionError' || errorName === 'UnknownError' || errorName === 'InvalidStateError')
    ) {
      console.warn(`Resetting shared preferences database due to IndexedDB error while handling ${context}:`, error);
      hasResetAttempted = true;
      const resetSuccessful = await deletePreferencesDatabase(context, disablePersistence);
      if (resetSuccessful) {
        return openPreferencesDatabase({ context, disablePersistence, allowReset: false });
      }
    }

    console.error(`Could not open shared preferences database for ${context}. Disabling persistence.`, error);
    disablePersistence(error);
    return null;
  }
}
