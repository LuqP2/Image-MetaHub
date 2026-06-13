import type { CleanupDecisionRecord, CleanupImageDecision, CleanupVisualSignature } from '../types';
import {
  openPreferencesDatabase,
  PREFERENCES_STORE_NAMES,
} from './preferencesDb';

const DECISIONS_STORE_NAME = PREFERENCES_STORE_NAMES.cleanupDecisions;
const SIGNATURES_STORE_NAME = PREFERENCES_STORE_NAMES.cleanupSignatures;

const inMemoryDecisions = new Map<string, CleanupDecisionRecord>();
const inMemorySignatures = new Map<string, CleanupVisualSignature>();
let isPersistenceDisabled = false;

const getDecisionKey = (sessionId: string, imageId: string) => `${sessionId}\u001f${imageId}`;

function disablePersistence(error?: unknown) {
  if (isPersistenceDisabled) {
    return;
  }

  console.error('IndexedDB open error for Cleanup Assistant storage. Persistence is disabled for this session.', error);
  isPersistenceDisabled = true;
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (isPersistenceDisabled) {
    return null;
  }

  return openPreferencesDatabase({
    context: 'cleanup assistant storage',
    disablePersistence,
  });
}

export async function loadCleanupDecisions(sessionId: string): Promise<Map<string, CleanupImageDecision>> {
  const decisions = new Map<string, CleanupImageDecision>();

  for (const record of inMemoryDecisions.values()) {
    if (record.sessionId === sessionId) {
      decisions.set(record.imageId, record.decision);
    }
  }

  const db = await openDatabase();
  if (!db) {
    return decisions;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(DECISIONS_STORE_NAME, 'readonly');
      const store = transaction.objectStore(DECISIONS_STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const records = request.result as CleanupDecisionRecord[];
        for (const record of records) {
          if (record.sessionId === sessionId) {
            decisions.set(record.imageId, record.decision);
            inMemoryDecisions.set(getDecisionKey(record.sessionId, record.imageId), record);
          }
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.error('Failed to load cleanup decisions:', error);
  } finally {
    db.close();
  }

  return decisions;
}

export async function saveCleanupDecisions(
  sessionId: string,
  updates: Array<{ imageId: string; decision: CleanupImageDecision }>,
): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  const updatedAt = Date.now();
  const records: CleanupDecisionRecord[] = updates.map((update) => ({
    sessionId,
    imageId: update.imageId,
    decision: update.decision,
    updatedAt,
  }));

  for (const record of records) {
    inMemoryDecisions.set(getDecisionKey(record.sessionId, record.imageId), record);
  }

  const db = await openDatabase();
  if (!db) {
    return;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(DECISIONS_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(DECISIONS_STORE_NAME);
      for (const record of records) {
        store.put(record);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.error('Failed to save cleanup decisions:', error);
  } finally {
    db.close();
  }
}

export async function loadCleanupSignatures(imageIds: string[]): Promise<Map<string, CleanupVisualSignature>> {
  const signatures = new Map<string, CleanupVisualSignature>();
  const requestedIds = new Set(imageIds);

  for (const imageId of imageIds) {
    const signature = inMemorySignatures.get(imageId);
    if (signature) {
      signatures.set(imageId, signature);
    }
  }

  const missingIds = imageIds.filter((imageId) => !signatures.has(imageId));
  if (missingIds.length === 0) {
    return signatures;
  }

  const db = await openDatabase();
  if (!db) {
    return signatures;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SIGNATURES_STORE_NAME, 'readonly');
      const store = transaction.objectStore(SIGNATURES_STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const records = request.result as CleanupVisualSignature[];
        for (const record of records) {
          if (requestedIds.has(record.imageId)) {
            signatures.set(record.imageId, record);
            inMemorySignatures.set(record.imageId, record);
          }
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.error('Failed to load cleanup signatures:', error);
  } finally {
    db.close();
  }

  return signatures;
}

export async function saveCleanupSignatures(signatures: CleanupVisualSignature[]): Promise<void> {
  if (signatures.length === 0) {
    return;
  }

  for (const signature of signatures) {
    inMemorySignatures.set(signature.imageId, signature);
  }

  const db = await openDatabase();
  if (!db) {
    return;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SIGNATURES_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(SIGNATURES_STORE_NAME);
      for (const signature of signatures) {
        store.put(signature);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.error('Failed to save cleanup signatures:', error);
  } finally {
    db.close();
  }
}
