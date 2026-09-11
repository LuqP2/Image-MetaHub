type FakeStoreState = {
  keyPath: string;
  records: Map<string, unknown>;
  indexes: Map<string, { keyPath: string | string[]; options?: IDBIndexParameters }>;
};

type FakeDatabaseState = {
  version: number;
  stores: Map<string, FakeStoreState>;
  transactionTail?: Promise<void>;
};

type FakeTransaction = IDBTransaction & {
  __requestStarted: () => void;
  __requestFinished: () => void;
  __whenComplete: (callback: () => void) => void;
  __enqueue: (callback: () => void) => void;
};

const cloneValue = <T>(value: T): T => (
  value == null ? value : structuredClone(value)
);

const createDomStringList = (values: () => string[]): DOMStringList => ({
  contains: (name: string) => values().includes(name),
  item: (index: number) => values()[index] ?? null,
  get length() { return values().length; },
  [Symbol.iterator]: function* iterator() { yield* values(); },
} as unknown as DOMStringList);

const makeRequest = <T>(): IDBRequest<T> & { result: T; error: DOMException | null; readyState: IDBRequestReadyState } => ({
  result: undefined as T,
  error: null,
  source: null,
  transaction: null,
  readyState: 'pending',
  onsuccess: null,
  onerror: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
} as unknown as IDBRequest<T> & { result: T; error: DOMException | null; readyState: IDBRequestReadyState });

function createTransaction(
  state: FakeDatabaseState,
  storeNames: string[] | null,
  mode: IDBTransactionMode,
): FakeTransaction {
  let pending = 0;
  let completed = false;
  let completionScheduled = false;
  const internalCompletionHandlers: Array<() => void> = [];
  const allowed = storeNames ? new Set(storeNames) : null;
  const transaction = {} as FakeTransaction;
  // Serialize database transactions, including connections opened by different
  // callers. Real IndexedDB serializes overlapping read/write scopes.
  const ready = state.transactionTail ?? Promise.resolve();
  let release: () => void;
  state.transactionTail = new Promise<void>((resolve) => { release = resolve; });
  const enqueue = (callback: () => void) => { void ready.then(callback); };

  const scheduleCompletion = () => {
    if (completionScheduled || completed) return;
    completionScheduled = true;
    enqueue(() => {
      completionScheduled = false;
      if (completed || pending !== 0) return;
      completed = true;
      release();
      transaction.oncomplete?.(new Event('complete'));
      for (const handler of internalCompletionHandlers) handler();
    });
  };

  Object.assign(transaction, {
    db: undefined as unknown as IDBDatabase,
    durability: 'default',
    error: null,
    mode,
    objectStoreNames: createDomStringList(() => allowed ? [...allowed] : [...state.stores.keys()]),
    onabort: null,
    oncomplete: null,
    onerror: null,
    abort: () => {
      if (completed) return;
      completed = true;
      release();
      transaction.onabort?.(new Event('abort'));
    },
    commit: () => scheduleCompletion(),
    objectStore: (name: string) => {
      if (allowed && !allowed.has(name)) throw new DOMException(`Store ${name} is outside the transaction scope.`, 'NotFoundError');
      const store = state.stores.get(name);
      if (!store) throw new DOMException(`Store ${name} does not exist.`, 'NotFoundError');
      return createObjectStore(state, transaction, name);
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    __requestStarted: () => {
      if (completed) throw new DOMException('Transaction is inactive.', 'TransactionInactiveError');
      pending += 1;
    },
    __requestFinished: () => {
      pending -= 1;
      scheduleCompletion();
    },
    __whenComplete: (callback: () => void) => internalCompletionHandlers.push(callback),
    __enqueue: enqueue,
  } as unknown as FakeTransaction);

  scheduleCompletion();
  return transaction;
}

function createObjectStore(
  state: FakeDatabaseState,
  transaction: FakeTransaction,
  storeName: string,
): IDBObjectStore {
  const store = state.stores.get(storeName);
  if (!store) throw new DOMException(`Store ${storeName} does not exist.`, 'NotFoundError');

  const request = <T>(operation: () => T): IDBRequest<T> => {
    transaction.__requestStarted();
    const result = makeRequest<T>();
    transaction.__enqueue(() => {
      try {
        result.result = cloneValue(operation());
        result.readyState = 'done';
        result.onsuccess?.(new Event('success'));
      } catch (error) {
        result.error = error instanceof DOMException
          ? error
          : new DOMException(error instanceof Error ? error.message : String(error), 'UnknownError');
        result.readyState = 'done';
        result.onerror?.(new Event('error'));
      } finally {
        transaction.__requestFinished();
      }
    });
    return result;
  };

  const index = (indexName: string): IDBIndex => {
    const definition = store.indexes.get(indexName);
    if (!definition) throw new DOMException(`Index ${indexName} does not exist.`, 'NotFoundError');
    return {
      getAll: (query?: IDBValidKey | IDBKeyRange | null) => request(() => {
        const exactQuery = query && typeof query === 'object' && '__only' in query
          ? (query as IDBKeyRange & { __only: IDBValidKey }).__only
          : query;
        return [...store.records.values()].filter((value) => {
          const indexed = (value as Record<string, unknown>)[definition.keyPath as string];
          if (exactQuery == null) return true;
          return definition.options?.multiEntry && Array.isArray(indexed)
            ? indexed.includes(exactQuery)
            : indexed === exactQuery;
        });
      }),
    } as unknown as IDBIndex;
  };

  return {
    keyPath: store.keyPath,
    indexNames: createDomStringList(() => [...store.indexes.keys()]),
    transaction,
    createIndex: (name: string, keyPath: string | string[], options?: IDBIndexParameters) => {
      store.indexes.set(name, { keyPath, options });
      return index(name);
    },
    index,
    get: (key: IDBValidKey | IDBKeyRange) => request(() => store.records.get(String(key))),
    getKey: (key: IDBValidKey | IDBKeyRange) => request(() => (
      store.records.has(String(key)) ? String(key) : undefined
    )),
    getAll: () => request(() => [...store.records.values()]),
    getAllKeys: () => request(() => [...store.records.keys()]),
    add: (value: unknown) => request(() => {
      const key = String((value as Record<string, unknown>)[store.keyPath]);
      if (store.records.has(key)) throw new DOMException(`Key ${key} already exists.`, 'ConstraintError');
      store.records.set(key, cloneValue(value));
      return key;
    }),
    put: (value: unknown) => request(() => {
      const key = String((value as Record<string, unknown>)[store.keyPath]);
      store.records.set(key, cloneValue(value));
      return key;
    }),
    delete: (key: IDBValidKey | IDBKeyRange) => request(() => {
      store.records.delete(String(key));
      return undefined;
    }),
    clear: () => request(() => {
      store.records.clear();
      return undefined;
    }),
  } as unknown as IDBObjectStore;
}

export function createFakeIndexedDb(): IDBFactory {
  const databases = new Map<string, FakeDatabaseState>();

  return {
    open: (name: string, version?: number) => {
      const request = makeRequest<IDBDatabase>() as IDBOpenDBRequest & ReturnType<typeof makeRequest<IDBDatabase>>;
      request.onupgradeneeded = null;
      request.onblocked = null;
      queueMicrotask(() => {
        const state = databases.get(name) ?? { version: 0, stores: new Map<string, FakeStoreState>() };
        const requestedVersion = version ?? Math.max(1, state.version);
        if (requestedVersion < state.version) {
          request.error = new DOMException('Requested version is older than the current database.', 'VersionError');
          request.readyState = 'done';
          request.onerror?.(new Event('error'));
          return;
        }
        databases.set(name, state);
        let upgradeTransaction: FakeTransaction | null = null;
        const database = {
          name,
          objectStoreNames: createDomStringList(() => [...state.stores.keys()]),
          onabort: null,
          onclose: null,
          onerror: null,
          onversionchange: null,
          createObjectStore: (storeName: string, options?: IDBObjectStoreParameters) => {
            if (state.stores.has(storeName)) throw new DOMException(`Store ${storeName} already exists.`, 'ConstraintError');
            state.stores.set(storeName, {
              keyPath: typeof options?.keyPath === 'string' ? options.keyPath : 'id',
              records: new Map(),
              indexes: new Map(),
            });
            if (!upgradeTransaction) throw new DOMException('No upgrade transaction is active.', 'InvalidStateError');
            return createObjectStore(state, upgradeTransaction, storeName);
          },
          transaction: (storeNames: string | string[], mode: IDBTransactionMode = 'readonly') => {
            const names = Array.isArray(storeNames) ? storeNames : [storeNames];
            const tx = createTransaction(state, names, mode);
            tx.db = database as unknown as IDBDatabase;
            return tx;
          },
          close: () => undefined,
          get version() { return state.version; },
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => true,
        } as unknown as IDBDatabase;
        request.result = database;

        const succeed = () => {
          request.transaction = null;
          request.readyState = 'done';
          request.onsuccess?.(new Event('success'));
        };
        if (requestedVersion > state.version) {
          const oldVersion = state.version;
          state.version = requestedVersion;
          upgradeTransaction = createTransaction(state, null, 'versionchange');
          upgradeTransaction.db = database;
          request.transaction = upgradeTransaction;
          request.onupgradeneeded?.({ oldVersion, newVersion: requestedVersion } as IDBVersionChangeEvent);
          upgradeTransaction.__whenComplete(succeed);
        } else {
          succeed();
        }
      });
      return request;
    },
    deleteDatabase: (name: string) => {
      const request = makeRequest<undefined>() as IDBOpenDBRequest & ReturnType<typeof makeRequest<undefined>>;
      request.onblocked = null;
      request.onupgradeneeded = null;
      queueMicrotask(() => {
        databases.delete(name);
        request.readyState = 'done';
        request.onsuccess?.(new Event('success'));
      });
      return request;
    },
  } as unknown as IDBFactory;
}

export function installFakeIndexedDb(): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: createFakeIndexedDb(),
    configurable: true,
    writable: true,
  });
  if (typeof globalThis.IDBKeyRange === 'undefined') {
    Object.defineProperty(globalThis, 'IDBKeyRange', {
      value: { only: (value: IDBValidKey) => ({ __only: value }) },
      configurable: true,
      writable: true,
    });
  }
}
