/// <reference lib="dom" />

import type { ClusterPreference, ImageAnnotations, IndexedImage, ShadowMetadata, SmartCollection, TagInfo } from '../types';
import {
  getIndexedDbErrorName,
  openPreferencesDatabase,
  resetPreferencesDatabase,
  PREFERENCES_STORE_NAMES,
} from './preferencesDb';

const STORE_NAME = PREFERENCES_STORE_NAMES.imageAnnotations;
const MANUAL_TAGS_STORE_NAME = PREFERENCES_STORE_NAMES.manualTags;
const CLUSTER_PREFERENCES_STORE_NAME = PREFERENCES_STORE_NAMES.clusterPreferences;
const SMART_COLLECTIONS_STORE_NAME = PREFERENCES_STORE_NAMES.smartCollections;
const SHADOW_METADATA_STORE_NAME = PREFERENCES_STORE_NAMES.shadowMetadata;

type ManualTagRecord = {
  name: string;
  createdAt: number;
  updatedAt: number;
};

const inMemoryAnnotations: Map<string, ImageAnnotations> = new Map();
const inMemoryManualTags: Set<string> = new Set();
let isPersistenceDisabled = false;
let hasResetAttempted = false;

function disablePersistence(error?: unknown) {
  if (isPersistenceDisabled) {
    return;
  }

  console.error(
    'IndexedDB open error for image annotations storage. Annotations persistence will be disabled for this session.',
    error,
  );
  isPersistenceDisabled = true;
}

function normalizeManualTagName(tagName: string): string {
  return tagName.trim().toLowerCase();
}

const normalizeCollectionTagName = (tagName: string | null | undefined): string | null => {
  if (typeof tagName !== 'string') {
    return null;
  }

  const normalized = tagName.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const uniqueImageIds = (imageIds: unknown): string[] => {
  if (!Array.isArray(imageIds)) {
    return [];
  }

  return Array.from(
    new Set(
      imageIds
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim()),
    ),
  );
};

async function openDatabase({ allowReset = true }: { allowReset?: boolean } = {}): Promise<IDBDatabase | null> {
  const db = await openPreferencesDatabase({
    context: 'image annotations storage',
    disablePersistence,
    allowReset,
  });

  if (db) {
    hasResetAttempted = false;
  }

  return db;
}

/**
 * Load all annotations from IndexedDB
 */
export async function loadAllAnnotations(): Promise<Map<string, ImageAnnotations>> {
  if (isPersistenceDisabled) {
    return new Map(inMemoryAnnotations);
  }

  const db = await openDatabase();
  if (!db) {
    return new Map(inMemoryAnnotations);
  }

  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      const close = () => {
        try {
          db.close();
        } catch (error) {
          console.warn('Failed to close image annotations storage after load', error);
        }
      };

      transaction.oncomplete = close;
      transaction.onabort = close;
      transaction.onerror = close;

      request.onsuccess = () => {
        const results = request.result as ImageAnnotations[];
        inMemoryAnnotations.clear();
        for (const annotation of results) {
          inMemoryAnnotations.set(annotation.imageId, annotation);
        }
        resolve(new Map(inMemoryAnnotations));
      };

      request.onerror = () => {
        console.error('Failed to load image annotations', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    const errorName = getIndexedDbErrorName(error);

    // If the object store doesn't exist, reset the database and retry once
    if (errorName === 'NotFoundError' && !hasResetAttempted) {
      console.warn('Image annotations store not found. Resetting database...', error);
      try {
        db.close();
      } catch (closeError) {
        console.warn('Failed to close database before reset', closeError);
      }

      hasResetAttempted = true;
      const resetSuccessful = await resetPreferencesDatabase('image annotations storage', disablePersistence);
      if (resetSuccessful) {
        return loadAllAnnotations();
      }
    }

    console.error('Failed to load image annotations from IndexedDB:', error);
    disablePersistence(error);
    return new Map(inMemoryAnnotations);
  }
}

/**
 * Save a single annotation to IndexedDB
 */
export async function saveAnnotation(annotation: ImageAnnotations): Promise<void> {
  inMemoryAnnotations.set(annotation.imageId, annotation);

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
    const request = store.put(annotation);

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close image annotations storage after save', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Failed to save image annotation', request.error);
      reject(request.error);
    };
  }).catch((error) => {
    console.error('IndexedDB save error for image annotation:', error);
    disablePersistence(error);
  });
}

/**
 * Delete an annotation from IndexedDB
 */
export async function deleteAnnotation(imageId: string): Promise<void> {
  inMemoryAnnotations.delete(imageId);

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
    const request = store.delete(imageId);

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close image annotations storage after delete', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Failed to delete image annotation', request.error);
      reject(request.error);
    };
  }).catch((error) => {
    console.error('IndexedDB delete error for image annotation:', error);
    disablePersistence(error);
  });
}

async function cloneShadowMetadata(sourceImageId: string, targetImageId: string): Promise<boolean> {
  const currentShadow = await getShadowMetadata(sourceImageId);
  if (!currentShadow) {
    return false;
  }

  await saveShadowMetadata({
    ...currentShadow,
    imageId: targetImageId,
    updatedAt: Date.now(),
  });

  return true;
}

export async function transferImagePersistence(
  sourceImageId: string,
  targetImageId: string,
  mode: 'copy' | 'move',
): Promise<void> {
  if (!sourceImageId || !targetImageId || sourceImageId === targetImageId) {
    return;
  }

  const currentAnnotation = await getAnnotation(sourceImageId);
  if (currentAnnotation) {
    await saveAnnotation({
      ...currentAnnotation,
      imageId: targetImageId,
      updatedAt: Date.now(),
    });
  }

  const clonedShadow = await cloneShadowMetadata(sourceImageId, targetImageId);

  if (mode === 'move') {
    if (currentAnnotation) {
      await deleteAnnotation(sourceImageId);
    }
    if (clonedShadow) {
      await deleteShadowMetadata(sourceImageId);
    }
  }
}

/**
 * Bulk save multiple annotations in a single transaction (for performance)
 */
export async function bulkSaveAnnotations(annotations: ImageAnnotations[]): Promise<void> {
  // Update in-memory cache
  for (const annotation of annotations) {
    inMemoryAnnotations.set(annotation.imageId, annotation);
  }

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

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close image annotations storage after bulk save', error);
      }
    };

    transaction.oncomplete = () => {
      close();
      resolve();
    };
    transaction.onabort = () => {
      close();
      reject(transaction.error);
    };
    transaction.onerror = () => {
      close();
      console.error('Failed to bulk save image annotations', transaction.error);
      reject(transaction.error);
    };

    // Add all puts to the transaction
    for (const annotation of annotations) {
      store.put(annotation);
    }
  }).catch((error) => {
    console.error('IndexedDB bulk save error for image annotations:', error);
    disablePersistence(error);
  });
}

/**
 * Get a single annotation by imageId
 */
export async function getAnnotation(imageId: string): Promise<ImageAnnotations | null> {
  // First check in-memory cache
  if (inMemoryAnnotations.has(imageId)) {
    return inMemoryAnnotations.get(imageId) || null;
  }

  if (isPersistenceDisabled) {
    return null;
  }

  const db = await openDatabase();
  if (!db) {
    return null;
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(imageId);

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close image annotations storage after get', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => {
      const result = request.result as ImageAnnotations | undefined;
      if (result) {
        inMemoryAnnotations.set(imageId, result);
        resolve(result);
      } else {
        resolve(null);
      }
    };

    request.onerror = () => {
      console.error('Failed to get image annotation', request.error);
      resolve(null);
    };
  });
}

/**
 * Get all image IDs that are marked as favorites
 */
export async function getFavoriteImageIds(): Promise<string[]> {
  if (isPersistenceDisabled) {
    return Array.from(inMemoryAnnotations.values())
      .filter(ann => ann.isFavorite)
      .map(ann => ann.imageId);
  }

  const db = await openDatabase();
  if (!db) {
    return [];
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('isFavorite');
    const request = index.getAll(IDBKeyRange.only(true)); // Get all where isFavorite === true

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close image annotations storage after favorite query', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => {
      const results = request.result as ImageAnnotations[];
      resolve(results.map(ann => ann.imageId));
    };

    request.onerror = () => {
      console.error('Failed to query favorite image IDs', request.error);
      resolve([]);
    };
  });
}

/**
 * Get all image IDs that have a specific tag
 */
export async function getImageIdsByTag(tag: string): Promise<string[]> {
  if (isPersistenceDisabled) {
    return Array.from(inMemoryAnnotations.values())
      .filter(ann => ann.tags.includes(tag))
      .map(ann => ann.imageId);
  }

  const db = await openDatabase();
  if (!db) {
    return [];
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('tags');
    const request = index.getAll(tag); // Get all with this tag (multiEntry index)

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close image annotations storage after tag query', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => {
      const results = request.result as ImageAnnotations[];
      resolve(results.map(ann => ann.imageId));
    };

    request.onerror = () => {
      console.error('Failed to query image IDs by tag', request.error);
      resolve([]);
    };
  });
}

export async function ensureManualTagExists(tagName: string): Promise<void> {
  const normalizedTag = normalizeManualTagName(tagName);
  if (!normalizedTag) {
    return;
  }

  inMemoryManualTags.add(normalizedTag);

  if (isPersistenceDisabled) {
    return;
  }

  const db = await openDatabase();
  if (!db) {
    return;
  }

  const timestamp = Date.now();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(MANUAL_TAGS_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(MANUAL_TAGS_STORE_NAME);
    const request = store.get(normalizedTag);

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close image annotations storage after ensuring manual tag', error);
      }
    };

    transaction.oncomplete = () => {
      close();
      resolve();
    };
    transaction.onabort = () => {
      close();
      reject(transaction.error);
    };
    transaction.onerror = () => {
      close();
      reject(transaction.error);
    };

    request.onsuccess = () => {
      const existing = request.result as ManualTagRecord | undefined;
      const record: ManualTagRecord = existing
        ? { ...existing, updatedAt: timestamp }
        : { name: normalizedTag, createdAt: timestamp, updatedAt: timestamp };
      store.put(record);
    };

    request.onerror = () => {
      console.error('Failed to ensure manual tag exists', request.error);
      reject(request.error);
    };
  }).catch((error) => {
    console.error('IndexedDB ensure manual tag error:', error);
    disablePersistence(error);
  });
}

export async function getAllManualTagNames(): Promise<string[]> {
  if (isPersistenceDisabled) {
    return Array.from(inMemoryManualTags).sort((a, b) => a.localeCompare(b));
  }

  const db = await openDatabase();
  if (!db) {
    return Array.from(inMemoryManualTags).sort((a, b) => a.localeCompare(b));
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(MANUAL_TAGS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(MANUAL_TAGS_STORE_NAME);
    const request = store.getAllKeys();

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close image annotations storage after loading manual tags', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => {
      const tagNames = (request.result as IDBValidKey[])
        .map((value) => String(value))
        .sort((a, b) => a.localeCompare(b));

      inMemoryManualTags.clear();
      for (const tagName of tagNames) {
        inMemoryManualTags.add(tagName);
      }

      resolve(tagNames);
    };

    request.onerror = () => {
      console.error('Failed to load manual tags', request.error);
      resolve(Array.from(inMemoryManualTags).sort((a, b) => a.localeCompare(b)));
    };
  });
}

export async function renameManualTag(sourceTag: string, targetTag: string): Promise<void> {
  const normalizedSource = normalizeManualTagName(sourceTag);
  const normalizedTarget = normalizeManualTagName(targetTag);

  if (!normalizedSource || !normalizedTarget || normalizedSource === normalizedTarget) {
    return;
  }

  inMemoryManualTags.delete(normalizedSource);
  inMemoryManualTags.add(normalizedTarget);

  if (isPersistenceDisabled) {
    return;
  }

  const db = await openDatabase();
  if (!db) {
    return;
  }

  const timestamp = Date.now();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(MANUAL_TAGS_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(MANUAL_TAGS_STORE_NAME);
    const getSourceRequest = store.get(normalizedSource);
    const getTargetRequest = store.get(normalizedTarget);

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close image annotations storage after renaming manual tag', error);
      }
    };

    transaction.oncomplete = () => {
      close();
      resolve();
    };
    transaction.onabort = () => {
      close();
      reject(transaction.error);
    };
    transaction.onerror = () => {
      close();
      reject(transaction.error);
    };

    let sourceRecord: ManualTagRecord | undefined;
    let targetRecord: ManualTagRecord | undefined;

    const finalize = () => {
      if (getSourceRequest.readyState !== 'done' || getTargetRequest.readyState !== 'done') {
        return;
      }

      const recordToSave: ManualTagRecord = targetRecord
        ? { ...targetRecord, updatedAt: timestamp }
        : {
            name: normalizedTarget,
            createdAt: sourceRecord?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };

      store.put(recordToSave);
      store.delete(normalizedSource);
    };

    getSourceRequest.onsuccess = () => {
      sourceRecord = getSourceRequest.result as ManualTagRecord | undefined;
      finalize();
    };

    getTargetRequest.onsuccess = () => {
      targetRecord = getTargetRequest.result as ManualTagRecord | undefined;
      finalize();
    };

    getSourceRequest.onerror = () => {
      console.error('Failed to read source manual tag before rename', getSourceRequest.error);
      reject(getSourceRequest.error);
    };

    getTargetRequest.onerror = () => {
      console.error('Failed to read target manual tag before rename', getTargetRequest.error);
      reject(getTargetRequest.error);
    };
  }).catch((error) => {
    console.error('IndexedDB rename manual tag error:', error);
    disablePersistence(error);
  });
}

export async function deleteManualTag(tagName: string): Promise<void> {
  const normalizedTag = normalizeManualTagName(tagName);
  if (!normalizedTag) {
    return;
  }

  inMemoryManualTags.delete(normalizedTag);

  if (isPersistenceDisabled) {
    return;
  }

  const db = await openDatabase();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(MANUAL_TAGS_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(MANUAL_TAGS_STORE_NAME);
    const request = store.delete(normalizedTag);

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close image annotations storage after deleting manual tag', error);
      }
    };

    transaction.oncomplete = () => {
      close();
      resolve();
    };
    transaction.onabort = () => {
      close();
      reject(transaction.error);
    };
    transaction.onerror = () => {
      close();
      reject(transaction.error);
    };

    request.onsuccess = () => {};
    request.onerror = () => {
      console.error('Failed to delete manual tag', request.error);
      reject(request.error);
    };
  }).catch((error) => {
    console.error('IndexedDB delete manual tag error:', error);
    disablePersistence(error);
  });
}

/**
 * Get all tags with their usage counts
 */
export async function getAllTags(): Promise<TagInfo[]> {
  const annotations = await loadAllAnnotations();
  const manualTags = await getAllManualTagNames();

  const tagCounts = new Map<string, number>();

  for (const tagName of manualTags) {
    tagCounts.set(tagName, 0);
  }

  for (const annotation of annotations.values()) {
    for (const tag of annotation.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const tags: TagInfo[] = Array.from(tagCounts.entries()).map(([name, count]) => ({
    name,
    count,
  }));

  // Sort alphabetically by default
  tags.sort((a, b) => a.name.localeCompare(b.name));

  return tags;
}

/**
 * Clear all annotations (for testing/reset)
 */
export async function clearAllAnnotations(): Promise<void> {
  inMemoryAnnotations.clear();

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
    const request = store.clear();

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close image annotations storage after clear', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Failed to clear image annotations', request.error);
      reject(request.error);
    };
  }).catch((error) => {
    console.error('IndexedDB clear error for image annotations:', error);
    disablePersistence(error);
  });
}

// ===== Cluster Preferences Functions (Phase 1) =====

/**
 * Get cluster preference by ID
 */
export async function getClusterPreference(clusterId: string): Promise<ClusterPreference | null> {
  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    const transaction = db.transaction([CLUSTER_PREFERENCES_STORE_NAME], 'readonly');
    const store = transaction.objectStore(CLUSTER_PREFERENCES_STORE_NAME);
    const request = store.get(clusterId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('Error getting cluster preference:', request.error);
      resolve(null);
    };
  });
}

/**
 * Save cluster preference
 */
export async function saveClusterPreference(preference: ClusterPreference): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  preference.updatedAt = Date.now();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CLUSTER_PREFERENCES_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CLUSTER_PREFERENCES_STORE_NAME);
    const request = store.put(preference);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Error saving cluster preference:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Delete cluster preference
 */
export async function deleteClusterPreference(clusterId: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CLUSTER_PREFERENCES_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CLUSTER_PREFERENCES_STORE_NAME);
    const request = store.delete(clusterId);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Error deleting cluster preference:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Get all cluster preferences
 */
export async function getAllClusterPreferences(): Promise<ClusterPreference[]> {
  const db = await openDatabase();
  if (!db) return [];

  return new Promise((resolve) => {
    const transaction = db.transaction([CLUSTER_PREFERENCES_STORE_NAME], 'readonly');
    const store = transaction.objectStore(CLUSTER_PREFERENCES_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => {
      console.error('Error getting all cluster preferences:', request.error);
      resolve([]);
    };
  });
}

/**
 * Mark images as best in a cluster
 */
export async function markAsBest(clusterId: string, imageIds: string[]): Promise<void> {
  const existing = await getClusterPreference(clusterId);

  const preference: ClusterPreference = existing || {
    clusterId,
    bestImageIds: [],
    archivedImageIds: [],
    isExpanded: false,
    updatedAt: Date.now(),
  };

  // Add to best images (avoid duplicates)
  preference.bestImageIds = [...new Set([...preference.bestImageIds, ...imageIds])];

  // Remove from archived if present
  preference.archivedImageIds = preference.archivedImageIds.filter(
    (id) => !imageIds.includes(id)
  );

  await saveClusterPreference(preference);
}

/**
 * Mark images for archival in a cluster
 */
export async function markForArchive(clusterId: string, imageIds: string[]): Promise<void> {
  const existing = await getClusterPreference(clusterId);

  const preference: ClusterPreference = existing || {
    clusterId,
    bestImageIds: [],
    archivedImageIds: [],
    isExpanded: false,
    updatedAt: Date.now(),
  };

  // Add to archived (avoid duplicates)
  preference.archivedImageIds = [...new Set([...preference.archivedImageIds, ...imageIds])];

  // Remove from best if present
  preference.bestImageIds = preference.bestImageIds.filter((id) => !imageIds.includes(id));

  await saveClusterPreference(preference);
}

// ===== Smart Collections Functions (Phase 1) =====

export function normalizeSmartCollection(
  collection: Partial<SmartCollection> & Pick<SmartCollection, 'id' | 'name' | 'createdAt' | 'updatedAt'>,
  fallbackSortIndex = 0,
): SmartCollection {
  const imageIds = uniqueImageIds(collection.imageIds);
  const snapshotImageIds = uniqueImageIds(collection.snapshotImageIds);
  const sourceTag = normalizeCollectionTagName(collection.sourceTag);
  const kind = collection.kind === 'tag_rule' ? 'tag_rule' : 'manual';
  const autoUpdate = kind === 'tag_rule' ? collection.autoUpdate !== false : false;
  const coverImageId =
    typeof collection.coverImageId === 'string'
      ? collection.coverImageId
      : typeof collection.thumbnailId === 'string'
      ? collection.thumbnailId
      : null;
  const normalizedCount = Number.isFinite(collection.imageCount)
    ? Math.max(0, Number(collection.imageCount))
    : kind === 'tag_rule'
    ? (autoUpdate ? 0 : snapshotImageIds.length)
    : imageIds.length;

  return {
    id: collection.id,
    kind,
    name: collection.name.trim(),
    description: collection.description?.trim() || undefined,
    coverImageId,
    sortIndex: Number.isFinite(collection.sortIndex) ? Number(collection.sortIndex) : fallbackSortIndex,
    sourceTag,
    autoUpdate,
    imageIds,
    snapshotImageIds,
    imageCount: normalizedCount,
    thumbnailId: coverImageId ?? undefined,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
    type: collection.type,
    query: collection.query,
  };
}

export function resolveSmartCollectionImageIds(collection: SmartCollection, images: IndexedImage[]): string[] {
  const manualImageIds = uniqueImageIds(collection.imageIds);

  if (collection.kind === 'manual') {
    return manualImageIds;
  }

  if (collection.autoUpdate !== false) {
    const sourceTag = normalizeCollectionTagName(collection.sourceTag);
    if (!sourceTag) {
      return manualImageIds;
    }

    return uniqueImageIds([
      ...manualImageIds,
      ...images
        .filter((image) => Array.isArray(image.tags) && image.tags.includes(sourceTag))
        .map((image) => image.id),
    ]);
  }

  return uniqueImageIds([...manualImageIds, ...uniqueImageIds(collection.snapshotImageIds)]);
}

export function resolveSmartCollectionImages(collection: SmartCollection, images: IndexedImage[]): IndexedImage[] {
  const imageLookup = new Map(images.map((image) => [image.id, image]));
  return resolveSmartCollectionImageIds(collection, images)
    .map((imageId) => imageLookup.get(imageId))
    .filter((image): image is IndexedImage => Boolean(image));
}

export function resolveSmartCollectionImageCount(collection: SmartCollection, images: IndexedImage[]): number {
  return resolveSmartCollectionImageIds(collection, images).length;
}

/**
 * Get smart collection by ID
 */
export async function getSmartCollection(id: string): Promise<SmartCollection | null> {
  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    const transaction = db.transaction([SMART_COLLECTIONS_STORE_NAME], 'readonly');
    const store = transaction.objectStore(SMART_COLLECTIONS_STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const result = request.result as SmartCollection | undefined;
      resolve(result ? normalizeSmartCollection(result) : null);
    };
    request.onerror = () => {
      console.error('Error getting smart collection:', request.error);
      resolve(null);
    };
  });
}

/**
 * Save smart collection
 */
export async function saveSmartCollection(collection: SmartCollection): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  const normalizedCollection = normalizeSmartCollection(
    {
      ...collection,
      updatedAt: Date.now(),
    },
    collection.sortIndex,
  );

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SMART_COLLECTIONS_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(SMART_COLLECTIONS_STORE_NAME);
    const request = store.put(normalizedCollection);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Error saving smart collection:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Delete smart collection
 */
export async function deleteSmartCollection(id: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SMART_COLLECTIONS_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(SMART_COLLECTIONS_STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Error deleting smart collection:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Get all smart collections
 */
export async function getAllSmartCollections(): Promise<SmartCollection[]> {
  const db = await openDatabase();
  if (!db) return [];

  return new Promise((resolve) => {
    const transaction = db.transaction([SMART_COLLECTIONS_STORE_NAME], 'readonly');
    const store = transaction.objectStore(SMART_COLLECTIONS_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const collections = ((request.result || []) as SmartCollection[])
        .map((collection, index) => normalizeSmartCollection(collection, index))
        .sort((a, b) => {
          const sortDelta = a.sortIndex - b.sortIndex;
          if (sortDelta !== 0) {
            return sortDelta;
          }
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

      resolve(collections);
    };
    request.onerror = () => {
      console.error('Error getting all smart collections:', request.error);
      resolve([]);
    };
  });
}

/**
 * Get smart collections by type
 */
export async function getSmartCollectionsByType(type: SmartCollection['type']): Promise<SmartCollection[]> {
  const db = await openDatabase();
  if (!db) return [];

  return new Promise((resolve) => {
    const transaction = db.transaction([SMART_COLLECTIONS_STORE_NAME], 'readonly');
    const store = transaction.objectStore(SMART_COLLECTIONS_STORE_NAME);
    const index = store.index('type');
    const request = index.getAll(type);

    request.onsuccess = () =>
      resolve(
        ((request.result || []) as SmartCollection[]).map((collection, index) =>
          normalizeSmartCollection(collection, index),
        ),
      );
    request.onerror = () => {
      console.error('Error getting smart collections by type:', request.error);
      resolve([]);
    };
  });
}

export async function reorderSmartCollections(collections: SmartCollection[]): Promise<SmartCollection[]> {
  const normalizedCollections = collections.map((collection, index) =>
    normalizeSmartCollection(
      {
        ...collection,
        sortIndex: index,
        updatedAt: Date.now(),
      },
      index,
    ),
  );

  await Promise.all(normalizedCollections.map((collection) => saveSmartCollection(collection)));
  return normalizedCollections;
}

export async function addImagesToSmartCollection(
  collection: SmartCollection,
  imageIds: string[],
): Promise<SmartCollection> {
  const targetIds = uniqueImageIds(imageIds);
  const nextCollection = normalizeSmartCollection(
    {
      ...collection,
      imageIds: [...uniqueImageIds(collection.imageIds), ...targetIds],
      imageCount: uniqueImageIds([...(collection.imageIds ?? []), ...targetIds]).length,
      updatedAt: Date.now(),
    },
    collection.sortIndex,
  );

  await saveSmartCollection(nextCollection);
  return nextCollection;
}

export async function removeImagesFromSmartCollection(
  collection: SmartCollection,
  imageIds: string[],
): Promise<SmartCollection> {
  const targetIdSet = new Set(uniqueImageIds(imageIds));
  const nextIds = uniqueImageIds(collection.imageIds).filter((imageId) => !targetIdSet.has(imageId));
  const nextCollection = normalizeSmartCollection(
    {
      ...collection,
      imageIds: nextIds,
      imageCount: nextIds.length,
      updatedAt: Date.now(),
    },
    collection.sortIndex,
  );

  await saveSmartCollection(nextCollection);
  return nextCollection;
}

// ===== Shadow Metadata Functions =====

/**
 * Get shadow metadata for an image
 */
export async function getShadowMetadata(imageId: string): Promise<ShadowMetadata | null> {
  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    // Check if store exists first (safety check for old versions or partial migrations)
    if (!db.objectStoreNames.contains(SHADOW_METADATA_STORE_NAME)) {
      resolve(null);
      return;
    }

    const transaction = db.transaction([SHADOW_METADATA_STORE_NAME], 'readonly');
    const store = transaction.objectStore(SHADOW_METADATA_STORE_NAME);
    const request = store.get(imageId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('Error getting shadow metadata:', request.error);
      resolve(null);
    };
  });
}

/**
 * Save shadow metadata for an image
 */
export async function saveShadowMetadata(metadata: ShadowMetadata): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  metadata.updatedAt = Date.now();

  return new Promise((resolve, reject) => {
     // Check if store exists
    if (!db.objectStoreNames.contains(SHADOW_METADATA_STORE_NAME)) {
      reject(new Error('Shadow metadata store not found'));
      return;
    }

    const transaction = db.transaction([SHADOW_METADATA_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(SHADOW_METADATA_STORE_NAME);
    const request = store.put(metadata);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Error saving shadow metadata:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Delete shadow metadata for an image
 */
export async function deleteShadowMetadata(imageId: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve, reject) => {
     // Check if store exists
    if (!db.objectStoreNames.contains(SHADOW_METADATA_STORE_NAME)) {
      resolve(); // Treat as success if store doesn't exist
      return;
    }

    const transaction = db.transaction([SHADOW_METADATA_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(SHADOW_METADATA_STORE_NAME);
    const request = store.delete(imageId);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Error deleting shadow metadata:', request.error);
      reject(request.error);
    };
  });
}

