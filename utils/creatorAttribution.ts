import type { BaseMetadata, IndexedImage, MetaHubAttribution } from '../types';

export const PRO_LICENSE_URL = 'https://imagemetahub.com/getpro.html';

const normalizeToken = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const token = value.trim();
  return token.length > 0 ? token : null;
};

export const extractCreatorAttributionToken = (metadata?: BaseMetadata | null): string | null => {
  const attribution = metadata?.imh_attribution as MetaHubAttribution | null | undefined;
  return normalizeToken(attribution?.token);
};

export const extractImageCreatorAttributionToken = (image?: IndexedImage | null): string | null =>
  extractCreatorAttributionToken(image?.metadata?.normalizedMetadata ?? null);

export const findLatestCreatorAttributionToken = (images: IndexedImage[]): string | null => {
  let latestToken: string | null = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const image of images) {
    const token = extractImageCreatorAttributionToken(image);
    if (!token) {
      continue;
    }

    const timestamp = Number.isFinite(image.lastModified) ? image.lastModified : 0;
    if (!latestToken || timestamp >= latestTimestamp) {
      latestToken = token;
      latestTimestamp = timestamp;
    }
  }

  return latestToken;
};

export const buildProLicenseUrl = (token?: string | null): string => {
  const url = new URL(PRO_LICENSE_URL);
  const normalizedToken = normalizeToken(token);
  if (normalizedToken) {
    url.searchParams.set('imh_ref', normalizedToken);
  }
  return url.toString();
};
