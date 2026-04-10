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

const cloneValue = <T,>(value: T): T =>
  value == null ? value : JSON.parse(JSON.stringify(value));

const createFakeIndexedDb = () => {
  const databases = new Map<string, FakeDbState>();
  let transaction: IDBTransaction;

  const makeRequest = <T,>() =>
    ({
      result: undefined as T | undefined,
      error: null as unknown,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
      transaction: null as IDBTransaction | null,
      readyState: 'pending' as IDBRequestReadyState,
    }) as unknown as IDBOpenDBRequest & IDBRequest<T>;

  const completeTransaction = (activeTransaction: any) => {
    queueMicrotask(() => {
      activeTransaction.oncomplete?.(new Event('complete'));
    });
  };

  const makeStore = (dbState: FakeDbState, activeTransaction: any, storeName: string) => {
    const storeState = dbState.stores.get(storeName);
    if (!storeState) {
      throw new Error(`Store ${storeName} not found`);
    }

    const makeStoreRequest = <T,>(executor: () => T) => {
      const request = makeRequest<T>();
      queueMicrotask(() => {
        try {
          request.result = executor();
          request.readyState = 'done';
          request.onsuccess?.(new Event('success'));
          completeTransaction(activeTransaction);
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

describe('smart collection storage', () => {
  beforeEach(async () => {
    vi.resetModules();
    installFakeIndexedDb();
  });

  it('round-trips manual and tag_rule collections through IndexedDB', async () => {
    const {
      getAllSmartCollections,
      getSmartCollection,
      saveSmartCollection,
    } = await import('../services/imageAnnotationsStorage');

    await saveSmartCollection({
      id: 'manual-1',
      kind: 'manual',
      name: 'Motos',
      sortIndex: 1,
      imageIds: ['img-1', 'img-2', 'img-2'],
      imageCount: 2,
      createdAt: 1,
      updatedAt: 1,
    });

    await saveSmartCollection({
      id: 'tag-1',
      kind: 'tag_rule',
      name: 'Carros',
      sortIndex: 0,
      sourceTag: 'carros',
      autoUpdate: true,
      snapshotImageIds: ['img-3'],
      imageCount: 99,
      createdAt: 2,
      updatedAt: 2,
    });

    const collections = await getAllSmartCollections();
    const tagRuleCollection = await getSmartCollection('tag-1');

    expect(collections.map((collection) => collection.id)).toEqual(['tag-1', 'manual-1']);
    expect(collections[1]?.imageIds).toEqual(['img-1', 'img-2']);
    expect(tagRuleCollection).toMatchObject({
      id: 'tag-1',
      kind: 'tag_rule',
      sourceTag: 'carros',
      autoUpdate: true,
    });
  });

  it('normalizes legacy smart-collection records with safe defaults', async () => {
    const { normalizeSmartCollection } = await import('../services/imageAnnotationsStorage');

    const normalized = normalizeSmartCollection({
      id: 'legacy-1',
      name: 'Legacy Collection',
      type: 'custom',
      query: { userTags: ['carros'] },
      createdAt: 10,
      updatedAt: 20,
      imageCount: 0,
    });

    expect(normalized).toMatchObject({
      id: 'legacy-1',
      kind: 'manual',
      sortIndex: 0,
      imageIds: [],
      snapshotImageIds: [],
      excludedImageIds: [],
      query: { userTags: ['carros'] },
      type: 'custom',
    });
  });

  it('resolves live and frozen tag-rule memberships from the current image set', async () => {
    const { resolveSmartCollectionImageIds } = await import('../services/imageAnnotationsStorage');

    const images = [
      { id: 'img-1', tags: ['carros'] },
      { id: 'img-2', tags: ['carros', 'motos'] },
      { id: 'img-3', tags: ['motos'] },
    ] as any;

    expect(
      resolveSmartCollectionImageIds(
        {
          id: 'tag-live',
          kind: 'tag_rule',
          name: 'Carros',
          sortIndex: 0,
          sourceTag: 'carros',
          autoUpdate: true,
          imageIds: ['img-3'],
          excludedImageIds: ['img-2'],
          imageCount: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        images,
      ),
    ).toEqual(['img-3', 'img-1']);

    expect(
      resolveSmartCollectionImageIds(
        {
          id: 'tag-frozen',
          kind: 'tag_rule',
          name: 'Carros',
          sortIndex: 0,
          sourceTag: 'carros',
          autoUpdate: false,
          imageIds: ['img-1'],
          snapshotImageIds: ['img-2'],
          imageCount: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        images,
      ),
    ).toEqual(['img-1', 'img-2']);
  });

  it('removes images from both manual and frozen snapshot membership sources', async () => {
    const { removeImagesFromSmartCollection } = await import('../services/imageAnnotationsStorage');

    const updated = await removeImagesFromSmartCollection(
      {
        id: 'tag-frozen',
        kind: 'tag_rule',
        name: 'Carros',
        sortIndex: 0,
        sourceTag: 'carros',
        autoUpdate: false,
        imageIds: ['img-1', 'img-2'],
        snapshotImageIds: ['img-2', 'img-3'],
        imageCount: 3,
        createdAt: 1,
        updatedAt: 1,
      },
      ['img-2', 'img-3'],
    );

    expect(updated.imageIds).toEqual(['img-1']);
    expect(updated.snapshotImageIds).toEqual([]);
    expect(updated.imageCount).toBe(1);
  });

  it('persists exclusions when removing matching images from live tag-rule collections', async () => {
    const {
      addImagesToSmartCollection,
      removeImagesFromSmartCollection,
      resolveSmartCollectionImageIds,
    } = await import('../services/imageAnnotationsStorage');

    const images = [
      { id: 'img-1', tags: ['carros'] },
      { id: 'img-2', tags: ['carros'] },
      { id: 'img-3', tags: ['motos'] },
    ] as any;

    const removed = await removeImagesFromSmartCollection(
      {
        id: 'tag-live',
        kind: 'tag_rule',
        name: 'Carros',
        sortIndex: 0,
        sourceTag: 'carros',
        autoUpdate: true,
        imageIds: ['img-3'],
        snapshotImageIds: [],
        excludedImageIds: [],
        imageCount: 3,
        createdAt: 1,
        updatedAt: 1,
      },
      ['img-2', 'img-3'],
    );

    expect(removed.imageIds).toEqual([]);
    expect(removed.excludedImageIds).toEqual(['img-2', 'img-3']);
    expect(resolveSmartCollectionImageIds(removed, images)).toEqual(['img-1']);

    const readded = await addImagesToSmartCollection(removed, ['img-2']);

    expect(readded.excludedImageIds).toEqual(['img-3']);
    expect(resolveSmartCollectionImageIds(readded, images)).toEqual(['img-2', 'img-1']);
  });
});
