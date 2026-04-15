import { BaseMetadata, IndexedImage } from '../types';

type MetadataWithLegacyAnalytics = BaseMetadata & {
  _analytics?: BaseMetadata['analytics'];
  cfgScale?: number;
};

export const NO_METADATA_MESSAGE = 'No metadata available for this image';
export const CLIPBOARD_ACCESS_DENIED_MESSAGE = 'Clipboard access denied. Please use HTTPS or localhost.';
export const TEMPORARY_STATUS_TIMEOUT_MS = 5000;

export const getNormalizedMetadata = (image: Pick<IndexedImage, 'metadata'>): BaseMetadata | undefined =>
  image.metadata?.normalizedMetadata as BaseMetadata | undefined;

export const mergeNormalizedMetadata = (
  image: Pick<IndexedImage, 'metadata'>,
  customMetadata?: Partial<BaseMetadata>,
): BaseMetadata | undefined => {
  const normalizedMetadata = getNormalizedMetadata(image);

  if (!customMetadata) {
    return normalizedMetadata;
  }

  return normalizedMetadata ? { ...normalizedMetadata, ...customMetadata } : (customMetadata as BaseMetadata);
};

export const hasPromptMetadata = (metadata: BaseMetadata | null | undefined): metadata is BaseMetadata =>
  typeof metadata?.prompt === 'string' && metadata.prompt.trim().length > 0;

export const getImageAnalytics = (image: Pick<IndexedImage, 'metadata'>): BaseMetadata['analytics'] | undefined => {
  const normalizedMetadata = image.metadata?.normalizedMetadata as MetadataWithLegacyAnalytics | undefined;
  return normalizedMetadata?.analytics || normalizedMetadata?._analytics;
};

export const getCfgScale = (metadata: BaseMetadata | null | undefined): number | undefined =>
  metadata?.cfg_scale ?? (metadata as MetadataWithLegacyAnalytics | undefined)?.cfgScale;

export const getClipboardErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('clipboard')
    ? CLIPBOARD_ACCESS_DENIED_MESSAGE
    : `Error: ${message}`;
};

type BatchSizeMetadata = Partial<BaseMetadata> & {
  batch_size?: number;
  numberOfImages?: number;
};

export const getRequestedImageCount = (metadata?: BatchSizeMetadata | null): number => {
  const requestedCount =
    metadata?.batch_size ??
    metadata?.numberOfImages ??
    1;

  if (!Number.isFinite(requestedCount) || requestedCount <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor(requestedCount));
};
