import type { BaseMetadata, IndexedImage, MetaHubAttribution } from '../types';

export const PRO_LICENSE_URL = 'https://www.imagemetahub.com/pro';

export type ProLicenseUrlContext = 'menu' | 'lockedfeature' | 'settings' | 'banner' | 'about' | 'trial_expired';
export type ProPlan = 'monthly' | 'annual' | 'lifetime';

/**
 * Stripe Payment Links are intentionally defined in one place for every
 * in-app purchase CTA. The public /pro page continues to own its own links.
 */
export const PRO_CHECKOUT_URLS: Record<ProPlan, string> = {
  monthly: 'https://buy.stripe.com/00w9ASeuo9tUgtN45r3Ru01',
  annual: 'https://buy.stripe.com/eVq28q5XSgWmb9t45r3Ru02',
  lifetime: 'https://buy.stripe.com/14AfZg9a48pQa5p8lH3Ru00',
};

const STRIPE_CLIENT_REFERENCE_ID_MAX_LENGTH = 200;

const normalizeToken = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const token = value.trim();
  return token.length > 0 ? token : null;
};

// Keep this in lockstep with imagemetahub.com/public/js/analytics.js. The
// alphanumeric-only fields make the client reference separators unambiguous.
const cleanRestrictedAttribution = (value: unknown, maxLength: number): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, maxLength);

const cleanCreatorReference = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 120);

const buildStripeClientReferenceId = (
  token?: string | null,
  ctx?: ProLicenseUrlContext,
  feature?: string
): string => {
  let clientReferenceId = `src-${cleanRestrictedAttribution('app', 32) || 'direct'}`;
  const cleanFeature = cleanRestrictedAttribution(feature, 16);
  const cleanCtx = cleanRestrictedAttribution(ctx, 15);
  const cleanReference = cleanCreatorReference(token);

  if (cleanFeature) {
    clientReferenceId += `_f-${cleanFeature}`;
  }
  if (cleanCtx) {
    clientReferenceId += `_ctx-${cleanCtx}`;
  }
  if (cleanReference) {
    clientReferenceId += `_ref-${cleanReference}`;
  }

  return clientReferenceId.slice(0, STRIPE_CLIENT_REFERENCE_ID_MAX_LENGTH);
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

export const buildProLicenseUrl = (
  token?: string | null,
  ctx?: ProLicenseUrlContext,
  feature?: string
): string => {
  const url = new URL(PRO_LICENSE_URL);
  url.searchParams.set('src', 'app');
  if (ctx) {
    url.searchParams.set('ctx', ctx);
  }
  const normalizedToken = normalizeToken(token);
  if (normalizedToken) {
    url.searchParams.set('imh_ref', normalizedToken);
  }
  if (feature) {
    url.searchParams.set('feature', feature);
  }
  return url.toString();
};

/**
 * Builds a direct Stripe Payment Link for desktop-app buyers. Query parameters
 * intentionally mirror the existing public checkout attribution contract.
 */
export const buildProCheckoutUrl = (
  plan: ProPlan,
  token?: string | null,
  ctx?: ProLicenseUrlContext,
  feature?: string
): string => {
  const url = new URL(PRO_CHECKOUT_URLS[plan]);
  const normalizedToken = normalizeToken(token);

  url.searchParams.set('src', 'app');
  if (ctx) {
    url.searchParams.set('ctx', ctx);
  }
  if (feature) {
    url.searchParams.set('feature', feature);
  }
  if (normalizedToken) {
    url.searchParams.set('imh_ref', normalizedToken);
  }
  url.searchParams.set('utm_source', 'app');
  url.searchParams.set('utm_campaign', 'image_metahub_pro');
  url.searchParams.set('utm_term', plan);
  url.searchParams.set('client_reference_id', buildStripeClientReferenceId(token, ctx, feature));

  return url.toString();
};
