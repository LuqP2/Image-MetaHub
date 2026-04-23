import type { MetadataClipboardPayload } from '../types';
import { buildMetadataClipboardPayload, sanitizeEditableMetadataFields } from '../utils/editableMetadata';

const STORAGE_KEY = 'image-metahub-editable-metadata-clipboard';

let memoryClipboard: MetadataClipboardPayload | null = null;

const canUseStorage = (): boolean => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const copyEditableMetadata = (
  metadata: MetadataClipboardPayload['metadata'],
  sourceImageId?: string | null,
): MetadataClipboardPayload => {
  const payload = buildMetadataClipboardPayload(sourceImageId, metadata);
  memoryClipboard = payload;

  if (canUseStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  return payload;
};

export const readEditableMetadataClipboard = (): MetadataClipboardPayload | null => {
  if (memoryClipboard) {
    return memoryClipboard;
  }

  if (!canUseStorage()) {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as MetadataClipboardPayload;
    if (parsed?.schemaVersion !== 1 || !parsed.metadata) {
      return null;
    }

    const payload: MetadataClipboardPayload = {
      schemaVersion: 1,
      copiedAt: typeof parsed.copiedAt === 'number' ? parsed.copiedAt : Date.now(),
      sourceImageId: typeof parsed.sourceImageId === 'string' ? parsed.sourceImageId : null,
      metadata: sanitizeEditableMetadataFields(parsed.metadata),
    };
    memoryClipboard = payload;
    return payload;
  } catch (error) {
    console.warn('Failed to read editable metadata clipboard:', error);
    return null;
  }
};

export const clearEditableMetadataClipboard = (): void => {
  memoryClipboard = null;
  if (canUseStorage()) {
    window.localStorage.removeItem(STORAGE_KEY);
  }
};
