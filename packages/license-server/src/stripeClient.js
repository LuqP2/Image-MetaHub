import Stripe from 'stripe';

export const STRIPE_API_VERSION = '2026-07-29.dahlia';
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

export function createStripeClient(apiKey, fetchImpl = globalThis.fetch) {
  return new Stripe(apiKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(fetchImpl),
    maxNetworkRetries: 2,
    timeout: 10_000,
    telemetry: false,
    appInfo: {
      name: 'Image MetaHub License Server',
      version: '2.0.0',
      url: 'https://www.imagemetahub.com',
    },
  });
}

export async function verifyStripeWebhook(rawBody, signature, secret, receivedAt = Date.now()) {
  if (!signature || !secret) throw new Error('Missing Stripe webhook signature configuration.');
  return new Stripe('rk_test_webhook_verification_only', {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
    telemetry: false,
  }).webhooks.constructEventAsync(
    rawBody,
    signature,
    secret,
    STRIPE_WEBHOOK_TOLERANCE_SECONDS,
    Stripe.createSubtleCryptoProvider(globalThis.crypto.subtle),
    receivedAt,
  );
}
