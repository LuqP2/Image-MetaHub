import type { ImageAnnotations } from '../types';
import { openPreferencesDatabase, PREFERENCES_STORE_NAMES } from './preferencesDb';
import { getUserDataPersistenceStatus } from './userDataPersistenceAdapter';

function readAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not read saved annotations.'));
  });
}

export async function createAnnotationBackup() {
  const status = await getUserDataPersistenceStatus();
  if (status.authority === 'sqlite') {
    throw new Error('Export is unavailable when experimental SQLite annotation storage is active.');
  }

  let openError: unknown;
  const db = await openPreferencesDatabase({
    context: 'annotation backup',
    disablePersistence: (error) => { openError = error; },
  });
  if (!db) {
    throw openError ?? new Error('Could not open saved annotations.');
  }

  try {
    const { imageAnnotations, manualTags } = PREFERENCES_STORE_NAMES;
    const transaction = db.transaction([imageAnnotations, manualTags], 'readonly');
    const [annotations, tags] = await Promise.all([
      readAll<ImageAnnotations>(transaction.objectStore(imageAnnotations)),
      readAll<{ name: string }>(transaction.objectStore(manualTags)),
    ]);

    return {
      format: 'image-metahub-annotations',
      version: 1,
      exportedAt: new Date().toISOString(),
      manualTags: tags.map(({ name }) => name),
      annotations: annotations
        .filter(({ tags, isFavorite }) => tags.length > 0 || isFavorite)
        .map(({ imageId, tags, isFavorite }) => ({ imageId, tags, isFavorite })),
    };
  } finally {
    db.close();
  }
}
