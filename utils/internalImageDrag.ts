import { areFilesystemPathsEqual } from './filesystemPath';

export const INTERNAL_IMAGE_DRAG_TYPE = 'application/x-image-metahub-drag';

interface InternalImageDragPayload {
  imageIds: string[];
  primaryImageId?: string;
}

let activeInternalImageDrag: InternalImageDragPayload | null = null;
let nativeGalleryDrag: (InternalImageDragPayload & { filePath: string; cleanup: AbortController }) | null = null;

export const setNativeGalleryDrag = (filePath: string, primaryImageId: string, imageIds: string[]): void => {
  clearInternalImageDragData();
  const cleanup = new AbortController();
  nativeGalleryDrag = { filePath, primaryImageId, imageIds: Array.from(new Set([primaryImageId, ...imageIds])), cleanup };
  const options = { signal: cleanup.signal };
  window.addEventListener('pointerdown', clearInternalImageDragData, options);
  window.addEventListener('pointermove', event => {
    if (event.buttons === 0) clearInternalImageDragData();
  }, options);
  window.addEventListener('blur', clearInternalImageDragData, options);
  window.addEventListener('dragend', clearInternalImageDragData, options);
  // Drop targets read the payload during dispatch. Also clean up drops on non-targets.
  window.addEventListener('drop', () => {
    const drag = nativeGalleryDrag;
    setTimeout(() => {
      if (nativeGalleryDrag === drag) clearInternalImageDragData();
    }, 0);
  }, { ...options, capture: true, once: true });
};

const hasNativeGalleryDragType = (dataTransfer: DataTransfer): boolean =>
  nativeGalleryDrag !== null && Array.from(dataTransfer.types || []).includes('Files');

const getNativeGalleryDrop = (dataTransfer: DataTransfer): InternalImageDragPayload | null => {
  const drag = nativeGalleryDrag;
  if (!drag || !hasNativeGalleryDragType(dataTransfer)) return null;

  for (const file of Array.from(dataTransfer.files || [])) {
    try {
      const path = window.electronAPI?.getPathForFile?.(file);
      if (path && areFilesystemPathsEqual(path, drag.filePath)) return drag;
    } catch {
      // A browser File without a verified filesystem path cannot identify the source.
    }
  }
  return null;
};

export const setInternalImageDragData = (
  dataTransfer: DataTransfer,
  primaryImageId: string,
  imageIds: string[] = [primaryImageId],
): void => {
  clearInternalImageDragData();
  const uniqueImageIds = Array.from(new Set([primaryImageId, ...imageIds]));
  activeInternalImageDrag = { imageIds: uniqueImageIds, primaryImageId };

  try {
    dataTransfer.setData(
      INTERNAL_IMAGE_DRAG_TYPE,
      JSON.stringify({ imageIds: uniqueImageIds, primaryImageId } satisfies InternalImageDragPayload),
    );
    dataTransfer.setData('text/plain', primaryImageId);
  } catch {
    // Electron's native file drag can reject custom MIME data; external dragging still works.
  }
};

export const getInternalImageDragId = (dataTransfer: DataTransfer): string | null => {
  if (hasNativeGalleryDragType(dataTransfer)) return getNativeGalleryDrop(dataTransfer)?.primaryImageId ?? null;
  try {
    const rawPayload = dataTransfer.getData(INTERNAL_IMAGE_DRAG_TYPE);
    if (!rawPayload) {
      return activeInternalImageDrag?.primaryImageId ?? activeInternalImageDrag?.imageIds[0] ?? null;
    }

    const payload = JSON.parse(rawPayload) as Partial<InternalImageDragPayload>;
    if (typeof payload.primaryImageId === 'string' && payload.primaryImageId) {
      return payload.primaryImageId;
    }

    return Array.isArray(payload.imageIds) && typeof payload.imageIds[0] === 'string'
      ? payload.imageIds[0]
      : null;
  } catch {
    return activeInternalImageDrag?.primaryImageId ?? activeInternalImageDrag?.imageIds[0] ?? null;
  }
};

export const getInternalImageDragIds = (dataTransfer: DataTransfer): string[] => {
  if (hasNativeGalleryDragType(dataTransfer)) return getNativeGalleryDrop(dataTransfer)?.imageIds ?? [];
  const clean = (ids: unknown) => Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string' && !!id.trim()))] : [];
  try {
    const raw = dataTransfer.getData(INTERNAL_IMAGE_DRAG_TYPE);
    if (raw) {
      const payload = JSON.parse(raw) as Partial<InternalImageDragPayload>;
      const ids = clean(payload.imageIds);
      if (ids.length) return ids;
      return typeof payload.primaryImageId === 'string' && payload.primaryImageId.trim() ? [payload.primaryImageId] : [];
    }
  } catch { /* Native drag can deny reading custom MIME. */ }
  return clean(activeInternalImageDrag?.imageIds);
};

export const hasInternalImageDragType = (dataTransfer: DataTransfer): boolean =>
  hasNativeGalleryDragType(dataTransfer) || activeInternalImageDrag !== null || Array.from(dataTransfer.types).includes(INTERNAL_IMAGE_DRAG_TYPE);

export const clearInternalImageDragData = (): void => {
  activeInternalImageDrag = null;
  nativeGalleryDrag?.cleanup.abort();
  nativeGalleryDrag = null;
};
