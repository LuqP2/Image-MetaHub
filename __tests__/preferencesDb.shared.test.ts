import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeStoreState = {
  keyPath: string;
  records: Map<string, any>;
  indexes: Map<string, { keyPath: string | string[]; options?: IDBIndexParameters }>;
};

type FakeDbState = {
  version: number;
  stores: Map<string, FakeStoreState>;
};

const createDomStringList = (values: () => string[]): DOMStringList =>
  ({
    contains: (name: string) => values().includes(name),
    item: (index: number) => values()[index] ?? null,
    get length() {
      return values().length;
    },
    [Symbol.iterator]: function* iterator() {
      yield* values();
    },
  }) as unknown as DOMStringList;

const cloneValue = <T>(value: T): T =>
  value == null ? value : JSON.parse(JSON.stringify(value));

const createFakeIndexedDb = () => {
  const databases = new Map<string, FakeDbState>();

  const makeRequest = <T>() => {
    const request = {
      result: undefined as T | undefined,
      error: null as unknown,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
      transaction: null as IDBTransaction | null,
      readyState: 'pending' as IDBRequestReadyState,
    };

    return request as unknown as IDBOpenDBRequest & IDBRequest<T>;
  };

  const completeTransaction = (transaction: any) => {
    queueMicrotask(() => {
      transaction.oncomplete?.(new Event('complete'));
    });
  };

  const makeStore = (dbState: FakeDbState, transaction: any, storeName: string) => {
    const storeState = dbState.stores.get(storeName);
    if (!storeState) {
      throw new Error(`Store ${storeName} not found`);
    }

    const makeStoreRequest = <T>(executor: () => T) => {
      const request = makeRequest<T>();
      queueMicrotask(() => {
        try {
          request.result = executor();
          request.readyState = 'done';
          request.onsuccess?.(new Event('success'));
          completeTransaction(transaction);
        } catch (error) {
          request.error = error;
          request.readyState = 'done';
          request.onerror?.(new Event('error'));
        }
      });
      return request;
    };

    const makeIndex = (indexName: string) => {
      const definition = storeState.indexes.get(indexName);
      if (!definition) {
        throw new Error(`Index ${indexName} not found`);
      }

      return {
        getAll: (query?: unknown) =>
          makeStoreRequest(() => {
            const results = Array.from(storeState.records.values()).filter((record) => {
              const value = (record as Record<string, any>)[definition.keyPath as string];
              if (definition.options?.multiEntry && Array.isArray(value)) {
                return query === undefined || value.includes(query);
              }
              return query === undefined || value === query;
            });

            return cloneValue(results);
          }),
      } as unknown as IDBIndex;
    };

    return {
      keyPath: storeState.keyPath,
      indexNames: createDomStringList(() => Array.from(storeState.indexes.keys())),
      createIndex: (name: string, keyPath: string | string[], options?: IDBIndexParameters) => {
        storeState.indexes.set(name, { keyPath, options });
        return makeIndex(name);
      },
      index: (name: string) => makeIndex(name),
      get: (key: string) => makeStoreRequest(() => cloneValue(storeState.records.get(key))),
      getAll: () => makeStoreRequest(() => cloneValue(Array.from(storeState.records.values()))),
      getAllKeys: () => makeStoreRequest(() => Array.from(storeState.records.keys())),
      put: (value: Record<string, any>) =>
        makeStoreRequest(() => {
          const key = String(value[storeState.keyPath]);
          storeState.records.set(key, cloneValue(value));
          return key;
        }),
      delete: (key: string) =>
        makeStoreRequest(() => {
          storeState.records.delete(String(key));
          return undefined;
        }),
      clear: () =>
        makeStoreRequest(() => {
          storeState.records.clear();
          return undefined;
        }),
    } as unknown as IDBObjectStore;
  };

  const makeTransaction = (dbState: FakeDbState, storeNames: string | string[]) =>
    ({
      error: null,
      oncomplete: null,
      onabort: null,
      onerror: null,
      objectStore: (name: string) => {
        const allowedStores = Array.isArray(storeNames) ? storeNames : [storeNames];
        if (!allowedStores.includes(name)) {
          throw new Error(`Store ${name} not in transaction scope`);
        }
        return makeStore(dbState, transaction, name);
      },
    } as unknown as IDBTransaction);

  let transaction: IDBTransaction;

  const makeDatabase = (dbState: FakeDbState) =>
    ({
      objectStoreNames: createDomStringList(() => Array.from(dbState.stores.keys())),
      createObjectStore: (name: string, options?: IDBObjectStoreParameters) => {
        const keyPath = typeof options?.keyPath === 'string' ? options.keyPath : 'id';
        const storeState: FakeStoreState = {
          keyPath,
          records: new Map(),
          indexes: new Map(),
        };
        dbState.stores.set(name, storeState);
        return makeStore(dbState, { oncomplete: null, onabort: null, onerror: null }, name);
      },
      transaction: (storeNames: string | string[]) => {
        transaction = makeTransaction(dbState, storeNames);
        return transaction;
      },
      close: () => undefined,
      onversionchange: null,
      get version() {
        return dbState.version;
      },
      get name() {
        return 'image-metahub-preferences';
      },
    }) as unknown as IDBDatabase;

  return {
    open: (name: string, version?: number) => {
      const request = makeRequest<IDBDatabase>();

      queueMicrotask(() => {
        const existing = databases.get(name) ?? { version: 0, stores: new Map<string, FakeStoreState>() };
        const requestedVersion = version ?? existing.version ?? 1;

        if (requestedVersion < existing.version) {
          const error = new Error(
            `The requested version (${requestedVersion}) is less than the existing version (${existing.version}).`,
          ) as Error & { name: string };
          error.name = 'VersionError';
          request.error = error;
          request.readyState = 'done';
          request.onerror?.(new Event('error'));
          return;
        }

        databases.set(name, existing);
        const db = makeDatabase(existing);
        request.result = db;

        if (requestedVersion > existing.version) {
          const oldVersion = existing.version;
          existing.version = requestedVersion;
          request.transaction = makeTransaction(existing, Array.from(existing.stores.keys()));
          request.onupgradeneeded?.({ oldVersion } as IDBVersionChangeEvent);
        }

        request.readyState = 'done';
        request.onsuccess?.(new Event('success'));
      });

      return request;
    },
    deleteDatabase: (name: string) => {
      const request = makeRequest<undefined>();
      queueMicrotask(() => {
        databases.delete(name);
        request.result = undefined;
        request.readyState = 'done';
        request.onsuccess?.(new Event('success'));
      });
      return request;
    },
  } as unknown as IDBFactory;
};

const installFakeIndexedDb = () => {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: createFakeIndexedDb(),
    configurable: true,
    writable: true,
  });
};

describe('shared preferences IndexedDB', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeIndexedDb();
  });

  it('allows annotations and folder selection to share the same database version', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const imageStorage = await import('../services/imageAnnotationsStorage');
    const folderStorage = await import('../services/folderSelectionStorage');

    await imageStorage.saveAnnotation({
      imageId: 'img-1',
      isFavorite: true,
      tags: ['portrait'],
      rating: 5,
      addedAt: 1,
      updatedAt: 1,
    });

    await folderStorage.saveSelectedFolders(['D:/images', 'D:/images/subfolder']);
    await folderStorage.saveExcludedFolders(['D:/images/excluded']);

    await expect(folderStorage.loadSelectedFolders()).resolves.toEqual(['D:/images', 'D:/images/subfolder']);
    await expect(folderStorage.loadExcludedFolders()).resolves.toEqual(['D:/images/excluded']);

    const annotations = await imageStorage.loadAllAnnotations();
    expect(annotations.get('img-1')).toMatchObject({
      isFavorite: true,
      tags: ['portrait'],
      rating: 5,
    });

    const loggedMessages = [
      ...consoleErrorSpy.mock.calls.flat().map(String),
      ...consoleWarnSpy.mock.calls.flat().map(String),
    ];
    expect(loggedMessages.some((message) => message.includes('VersionError'))).toBe(false);

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('upgrades a legacy v4 database without losing folder selection or annotations', async () => {
    const indexedDb = globalThis.indexedDB as IDBFactory;

    await new Promise<void>((resolve, reject) => {
      const request = indexedDb.open('image-metahub-preferences', 4);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('folderSelection')) {
          db.createObjectStore('folderSelection', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('imageAnnotations')) {
          const store = db.createObjectStore('imageAnnotations', { keyPath: 'imageId' });
          store.createIndex('isFavorite', 'isFavorite', { unique: false });
          store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        }
        if (!db.objectStoreNames.contains('clusterPreferences')) {
          db.createObjectStore('clusterPreferences', { keyPath: 'clusterId' });
        }
        if (!db.objectStoreNames.contains('smartCollections')) {
          const store = db.createObjectStore('smartCollections', { keyPath: 'id' });
          store.createIndex('type', 'type', { unique: false });
        }
        if (!db.objectStoreNames.contains('shadowMetadata')) {
          db.createObjectStore('shadowMetadata', { keyPath: 'imageId' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        const selectionTx = db.transaction('folderSelection', 'readwrite');
        selectionTx.objectStore('folderSelection').put({ id: 'selection', data: ['D:/legacy-library'] });
        selectionTx.objectStore('folderSelection').put({ id: 'excluded-folders', data: ['D:/legacy-library/excluded'] });

        const annotationsTx = db.transaction('imageAnnotations', 'readwrite');
        annotationsTx.objectStore('imageAnnotations').put({
          imageId: 'legacy-image',
          isFavorite: false,
          tags: ['legacy'],
          addedAt: 1,
          updatedAt: 1,
        });

        queueMicrotask(() => {
          db.close();
          resolve();
        });
      };
      request.onerror = () => reject(request.error);
    });

    const imageStorage = await import('../services/imageAnnotationsStorage');
    const folderStorage = await import('../services/folderSelectionStorage');

    await expect(folderStorage.loadSelectedFolders()).resolves.toEqual(['D:/legacy-library']);
    await expect(folderStorage.loadExcludedFolders()).resolves.toEqual(['D:/legacy-library/excluded']);

    const annotations = await imageStorage.loadAllAnnotations();
    expect(annotations.get('legacy-image')).toMatchObject({
      isFavorite: false,
      tags: ['legacy'],
    });
  });

  it('creates the manualTags store during upgrade and seeds it from legacy annotations', async () => {
    const indexedDb = globalThis.indexedDB as IDBFactory;

    await new Promise<void>((resolve, reject) => {
      const request = indexedDb.open('image-metahub-preferences', 4);

      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.createObjectStore('imageAnnotations', { keyPath: 'imageId' });
        store.createIndex('isFavorite', 'isFavorite', { unique: false });
        store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        db.createObjectStore('folderSelection', { keyPath: 'id' });
        db.createObjectStore('clusterPreferences', { keyPath: 'clusterId' });
        const smartCollections = db.createObjectStore('smartCollections', { keyPath: 'id' });
        smartCollections.createIndex('type', 'type', { unique: false });
        db.createObjectStore('shadowMetadata', { keyPath: 'imageId' });
      };

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('imageAnnotations', 'readwrite');
        transaction.objectStore('imageAnnotations').put({
          imageId: 'img-manual-tags',
          isFavorite: false,
          tags: ['seed-me'],
          addedAt: 1,
          updatedAt: 1,
        });

        queueMicrotask(() => {
          db.close();
          resolve();
        });
      };
      request.onerror = () => reject(request.error);
    });

    const imageStorage = await import('../services/imageAnnotationsStorage');

    const manualTags = await imageStorage.getAllManualTagNames();
    expect(manualTags).toEqual(['seed-me']);
  });
});
