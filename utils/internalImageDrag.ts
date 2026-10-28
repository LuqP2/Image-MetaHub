export const INTERNAL_IMAGE_DRAG_TYPE = 'application/x-image-metahub-drag';

interface InternalImageDragPayload {
  imageIds: string[];
  primaryImageId?: string;
}

let activeInternalImageDrag: InternalImageDragPayload | null = null;

export const setInternalImageDragData = (
  dataTransfer: DataTransfer,
  primaryImageId: string,
  imageIds: string[] = [primaryImageId],
): void => {
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
  activeInternalImageDrag !== null || Array.from(dataTransfer.types).includes(INTERNAL_IMAGE_DRAG_TYPE);

export const clearInternalImageDragData = (): void => {
  activeInternalImageDrag = null;
};
