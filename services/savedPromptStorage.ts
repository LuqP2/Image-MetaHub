import type { SavedPrompt, SavedPromptSaveResult, SavePromptInput } from '../types';

export const SAVED_PROMPTS_DATABASE_NAME = 'image-metahub-saved-prompts';
const STORE_NAME = 'saved_prompts';
const DATABASE_VERSION = 1;

type StoredPrompt = SavedPrompt & { promptDigest: string };

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Saved-prompt database request failed.'));
});

const transactionComplete = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error('Saved-prompt transaction was aborted.'));
  transaction.onerror = () => reject(transaction.error ?? new Error('Saved-prompt transaction failed.'));
});

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(SAVED_PROMPTS_DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (database.objectStoreNames.contains(STORE_NAME)) return;
    const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    store.createIndex('promptDigest', 'promptDigest', { unique: false });
    store.createIndex('createdAt', 'createdAt', { unique: false });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Could not open saved-prompt storage.'));
  request.onblocked = () => reject(new Error('Saved-prompt storage is blocked by another window.'));
});

export const savedPromptDigest = (positivePrompt: string, negativePrompt: string): string => {
  let hash = 0x811c9dc5;
  const value = `${positivePrompt}\u0000${negativePrompt}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const withoutDigest = ({ promptDigest: _promptDigest, ...prompt }: StoredPrompt): SavedPrompt => prompt;

export async function listBrowserSavedPrompts(): Promise<SavedPrompt[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const records = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as StoredPrompt[];
    await transactionComplete(transaction);
    return records
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
      .map(withoutDigest);
  } finally {
    database.close();
  }
}

export async function saveBrowserPrompt(input: SavePromptInput): Promise<SavedPromptSaveResult> {
  const positivePrompt = typeof input.positivePrompt === 'string' ? input.positivePrompt : '';
  const negativePrompt = typeof input.negativePrompt === 'string' ? input.negativePrompt : '';
  if (!positivePrompt.trim()) throw new Error('A non-empty positive prompt is required.');
  const promptDigest = savedPromptDigest(positivePrompt, negativePrompt);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const candidates = await requestResult(store.index('promptDigest').getAll(promptDigest)) as StoredPrompt[];
    const duplicate = candidates.find((record) => (
      record.positivePrompt === positivePrompt && record.negativePrompt === negativePrompt
    ));
    if (duplicate) {
      await transactionComplete(transaction);
      return { status: 'already-saved', prompt: withoutDigest(duplicate) };
    }
    const prompt: StoredPrompt = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      positivePrompt,
      negativePrompt,
      textBasis: input.textBasis === 'original' ? 'original' : 'effective',
      source: null,
      promptDigest,
    };
    store.add(prompt);
    await transactionComplete(transaction);
    return { status: 'saved', prompt: withoutDigest(prompt) };
  } finally {
    database.close();
  }
}

export async function removeBrowserSavedPrompt(id: string): Promise<{ id: string; removed: boolean }> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const existing = await requestResult(store.getKey(id));
    store.delete(id);
    await transactionComplete(transaction);
    return { id, removed: existing !== undefined };
  } finally {
    database.close();
  }
}
