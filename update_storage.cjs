const fs = require('fs');

let content = fs.readFileSync('services/imageAnnotationsStorage.ts', 'utf8');

// Insert bulkDeleteAnnotations
const bulkDeleteAnnotationsCode = `
/**
 * Bulk delete multiple annotations in a single transaction
 */
export async function bulkDeleteAnnotations(imageIds: string[]): Promise<void> {
  // Update in-memory cache
  for (const imageId of imageIds) {
    inMemoryAnnotations.delete(imageId);
  }

  if (isPersistenceDisabled || imageIds.length === 0) {
    return;
  }

  const db = await openDatabase();
  if (!db) {
    return;
  }

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      console.error('Failed to bulk delete image annotations', transaction.error);
      reject(transaction.error);
    };

    // Add all deletes to the transaction
    for (const imageId of imageIds) {
      store.delete(imageId);
    }
  }).catch((error) => {
    console.error('IndexedDB bulk delete error for image annotations:', error);
    disablePersistence(error);
  });
}
`;

content = content.replace(
  "export async function deleteAnnotation(imageId: string): Promise<void> {",
  bulkDeleteAnnotationsCode + "\nexport async function deleteAnnotation(imageId: string): Promise<void> {"
);


// Insert bulkDeleteShadowMetadata
const bulkDeleteShadowMetadataCode = `
/**
 * Delete shadow metadata for multiple images
 */
export async function bulkDeleteShadowMetadata(imageIds: string[]): Promise<void> {
  const db = await openDatabase();
  if (!db || imageIds.length === 0) return;

  return new Promise((resolve, reject) => {
    // Check if store exists
    if (!db.objectStoreNames.contains(SHADOW_METADATA_STORE_NAME)) {
      resolve(); // Treat as success if store doesn't exist
      return;
    }

    const transaction = db.transaction([SHADOW_METADATA_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(SHADOW_METADATA_STORE_NAME);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      console.error('Error bulk deleting shadow metadata:', transaction.error);
      reject(transaction.error);
    };

    for (const imageId of imageIds) {
      store.delete(imageId);
    }
  });
}
`;

content = content.replace(
  "export async function deleteShadowMetadata(imageId: string): Promise<void> {",
  bulkDeleteShadowMetadataCode + "\nexport async function deleteShadowMetadata(imageId: string): Promise<void> {"
);


// Insert bulkTransferImagePersistence
const bulkTransferImagePersistenceCode = `
export async function bulkTransferImagePersistence(
  transfers: Array<{ sourceImageId: string; targetImageId: string }>,
  mode: 'copy' | 'move'
): Promise<void> {
  if (transfers.length === 0) return;

  // 1. Get all current annotations and shadow metadata
  const sourceImageIds = transfers.map(t => t.sourceImageId);

  // We can just loop and get them sequentially for simplicity, or we could do a bulkGet.
  // Given we have in-memory cache for annotations, sequential is relatively fast.
  const annotationsToSave: ImageAnnotations[] = [];
  const shadowsToSave: ShadowMetadata[] = [];

  for (const transfer of transfers) {
    if (transfer.sourceImageId === transfer.targetImageId) continue;

    const currentAnnotation = await getAnnotation(transfer.sourceImageId);
    if (currentAnnotation) {
      annotationsToSave.push({
        ...currentAnnotation,
        imageId: transfer.targetImageId,
        updatedAt: Date.now(),
      });
    }

    const currentShadow = await getShadowMetadata(transfer.sourceImageId);
    if (currentShadow) {
      shadowsToSave.push({
        ...currentShadow,
        imageId: transfer.targetImageId,
        updatedAt: Date.now(),
      });
    }
  }

  // 2. Bulk Save
  if (annotationsToSave.length > 0) {
    await bulkSaveAnnotations(annotationsToSave);
  }
  if (shadowsToSave.length > 0) {
    await bulkSaveShadowMetadata(shadowsToSave);
  }

  // 3. Bulk Delete for move
  if (mode === 'move') {
    const idsToDelete = transfers
      .filter(t => t.sourceImageId !== t.targetImageId)
      .map(t => t.sourceImageId);

    if (idsToDelete.length > 0) {
      await bulkDeleteAnnotations(idsToDelete);
      await bulkDeleteShadowMetadata(idsToDelete);
    }
  }
}
`;

content = content.replace(
  "export async function transferImagePersistence(",
  bulkTransferImagePersistenceCode + "\nexport async function transferImagePersistence("
);

fs.writeFileSync('services/imageAnnotationsStorage.ts', content);
