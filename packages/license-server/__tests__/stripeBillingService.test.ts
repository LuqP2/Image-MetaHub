// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { encodeBase64Url } from '../../../utils/licenseCertificate.mjs';
import { encryptDeliveryPayload } from '../src/deliveryCrypto.js';
import {
  collectStripeList,
  PermanentStripeEventError,
  selectPaidSubscriptionLine,
  StripeBillingService,
} from '../src/stripeBillingService.js';
import { verifyStripeWebhook } from '../src/stripeClient.js';

const encryptionKey = encodeBase64Url(new Uint8Array(32).fill(7));
const fixedNow = new Date('2026-08-24T12:00:00.000Z');
const config = {
  expectedLivemode: false,
  accountId: 'acct_1',
  subscriptionProductId: 'prod_1',
  monthlyPriceId: 'price_monthly',
  annualPriceId: 'price_annual',
  monthlyHistoricalPriceIds: ['price_monthly_old'],
  annualHistoricalPriceIds: [],
  lifetimePriceId: 'price_lifetime',
  deliveryEncryptionKey: encryptionKey,
};

const event = (eventType: string, objectId = 'obj_1', eventCreatedAt = 100) => ({
  eventId: `evt_${eventType}_${eventCreatedAt}`,
  eventType,
  objectId,
  eventCreatedAt,
  attempts: 0,
});

function createService(overrides: Record<string, unknown> = {}) {
  const repository = {
    claimEvents: vi.fn(async () => []),
    markEventProcessed: vi.fn(async () => undefined),
    rescheduleEvent: vi.fn(async () => undefined),
    claimDeliveries: vi.fn(async () => []),
    authorizeDeliverySend: vi.fn(async () => true),
    markDeliveryDelivered: vi.fn(async () => undefined),
    markDeliveryManualReview: vi.fn(async () => undefined),
    rescheduleDelivery: vi.fn(async () => undefined),
    applyRefundSnapshot: vi.fn(async () => undefined),
    ...overrides.repository as object,
  };
  const stripeClient = {
    refunds: { retrieve: vi.fn() },
    charges: { retrieve: vi.fn() },
    ...overrides.stripeClient as object,
  };
  const service = new StripeBillingService({
    repository,
    licenseService: overrides.licenseService ?? {},
    stripeClient,
    deliveryClient: overrides.deliveryClient ?? {
      sendLicense: vi.fn(async () => ({ ok: true, messageId: 'email_1' })),
    },
    config,
    cryptoApi: globalThis.crypto,
    now: () => fixedNow,
  });
  return { service, repository, stripeClient };
}

describe('Stripe billing failure classification', () => {
  it('retries unexpected infrastructure errors instead of dead-lettering immediately', async () => {
    const inboxEvent = event('invoice.paid');
    const { service, repository } = createService({
      repository: { claimEvents: vi.fn(async () => [inboxEvent]) },
    });
    vi.spyOn(service, 'processEvent').mockRejectedValueOnce(
      new Error('D1_ERROR: overloaded'),
    );
    await service.processEventInbox();
    expect(repository.rescheduleEvent).toHaveBeenCalledWith(
      inboxEvent.eventId,
      expect.any(String),
      expect.objectContaining({
        attempts: 1,
        deadLetter: false,
        errorCode: 'processing_error',
      }),
    );
  });

  it('dead-letters only an explicitly permanent domain error', async () => {
    const inboxEvent = event('invoice.paid');
    const { service, repository } = createService({
      repository: { claimEvents: vi.fn(async () => [inboxEvent]) },
    });
    vi.spyOn(service, 'processEvent').mockRejectedValueOnce(
      new PermanentStripeEventError('stripe_invoice_price_unmapped'),
    );
    await service.processEventInbox();
    expect(repository.rescheduleEvent).toHaveBeenCalledWith(
      inboxEvent.eventId,
      expect.any(String),
      expect.objectContaining({
        attempts: 1,
        deadLetter: true,
        errorCode: 'stripe_invoice_price_unmapped',
      }),
    );
  });

  it('lets an expired lease recover if even rescheduling fails', async () => {
    const inboxEvent = event('invoice.paid');
    const { service } = createService({
      repository: {
        claimEvents: vi.fn(async () => [inboxEvent]),
        rescheduleEvent: vi.fn(async () => {
          throw new Error('D1_ERROR: still unavailable');
        }),
      },
    });
    vi.spyOn(service, 'processEvent').mockRejectedValueOnce(
      new Error('D1_ERROR: overloaded'),
    );
    await expect(service.processEventInbox()).rejects.toThrow('still unavailable');
  });
});

describe('Stripe normalization', () => {
  it('paginates deterministically and accepts an allowlisted historical Price', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `li_${index}` }));
    const fetchPage = vi.fn(async ({ starting_after }: { starting_after?: string }) => (
      starting_after
        ? { data: [{ id: 'li_valid' }], has_more: false }
        : { data: firstPage, has_more: true }
    ));
    const lines = await collectStripeList(fetchPage);
    expect(lines).toHaveLength(101);
    expect(fetchPage).toHaveBeenLastCalledWith({
      limit: 100,
      starting_after: 'li_99',
    });

    expect(selectPaidSubscriptionLine([{
      id: 'li_valid',
      quantity: 1,
      parent: {
        type: 'subscription_item_details',
        subscription_item_details: { proration: false },
      },
      pricing: {
        price_details: {
          price: 'price_monthly_old',
          product: 'prod_1',
        },
      },
      period: { start: 1_786_000_000, end: 1_788_500_000 },
    }], config)).toMatchObject({
      priceId: 'price_monthly_old',
      plan: 'monthly',
    });
  });
});

describe('delivery authorization and Resend window', () => {
  it('retries a transient D1 authorization failure', async () => {
    const encryptedPayload = await encryptDeliveryPayload({
      email: 'buyer@example.com',
      plan: 'lifetime',
      expiresAt: null,
      licenseKey: 'IMH2-TEST',
    }, encryptionKey);
    const claimed = {
      id: 'delivery_1',
      licenseId: 'lic_1',
      encryptedPayload,
      status: 'leased',
      attempts: 0,
      authorizedAt: null,
      firstProviderAttemptAt: null,
    };
    const { service, repository } = createService({
      repository: {
        claimDeliveries: vi.fn(async () => [claimed]),
        authorizeDeliverySend: vi.fn(async () => {
          throw new Error('D1_ERROR: temporary');
        }),
      },
    });
    await service.processDeliveryOutbox();
    expect(repository.rescheduleDelivery).toHaveBeenCalledWith(
      claimed.id,
      expect.any(String),
      expect.objectContaining({
        attempts: 1,
        deadLetter: false,
        manualReview: false,
      }),
    );
  });

  it('moves uncertain provider work to manual review outside 24 hours', async () => {
    const encryptedPayload = await encryptDeliveryPayload({
      email: 'buyer@example.com',
      plan: 'lifetime',
      expiresAt: null,
      licenseKey: 'IMH2-TEST',
    }, encryptionKey);
    const claimed = {
      id: 'delivery_old',
      licenseId: 'lic_1',
      encryptedPayload,
      status: 'authorized',
      attempts: 7,
      authorizedAt: '2026-08-23T12:00:00.000Z',
      firstProviderAttemptAt: '2026-08-23T12:00:00.000Z',
    };
    const deliveryClient = {
      sendLicense: vi.fn(async () => ({
        ok: false,
        retryable: true,
        uncertain: true,
        code: 'resend_network_error',
      })),
    };
    const { service, repository } = createService({
      repository: { claimDeliveries: vi.fn(async () => [claimed]) },
      deliveryClient,
    });
    await service.processDeliveryOutbox();
    expect(deliveryClient.sendLicense).not.toHaveBeenCalled();
    expect(repository.markDeliveryManualReview).toHaveBeenCalledWith(
      claimed.id,
      expect.any(String),
      'resend_idempotency_window_expired',
      fixedNow.toISOString(),
    );
  });
});

describe('refund convergence', () => {
  it('records a succeeded refund.updated without requiring a local payment lookup', async () => {
    const { service, repository, stripeClient } = createService();
    stripeClient.refunds.retrieve.mockResolvedValue({
      id: 're_1',
      status: 'succeeded',
      charge: 'ch_1',
      payment_intent: 'pi_1',
      amount: 499,
      currency: 'usd',
    });
    stripeClient.charges.retrieve.mockResolvedValue({
      id: 'ch_1',
      payment_intent: 'pi_1',
      amount: 499,
      amount_refunded: 499,
      currency: 'usd',
    });
    await service.processEvent(event('refund.updated', 're_1', 200));
    expect(repository.applyRefundSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        factId: 'refund:re_1',
        paymentFullyRefunded: true,
        stripePaymentIntentId: 'pi_1',
        stripeChargeId: 'ch_1',
      }),
    );
  });

  it('accepts charge.refunded as a full-payment convergence signal', async () => {
    const { service, repository, stripeClient } = createService();
    stripeClient.charges.retrieve.mockResolvedValue({
      id: 'ch_1',
      payment_intent: 'pi_1',
      amount: 499,
      amount_refunded: 499,
      currency: 'usd',
    });
    await service.processEvent(event('charge.refunded', 'ch_1', 201));
    expect(repository.applyRefundSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        factId: 'charge:ch_1',
        paymentFullyRefunded: true,
        refundStatus: 'succeeded',
      }),
    );
  });
});

describe('Stripe webhook signatures', () => {
  it('accepts the exact raw body and rejects tampering', async () => {
    const secret = 'whsec_test_secret';
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'invoice.paid',
      created: 1_786_000_000,
      livemode: false,
      data: { object: { id: 'in_1' } },
    });
    const timestamp = 1_786_000_000;
    const signed = `${timestamp}.${body}`;
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = Array.from(new Uint8Array(
      await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed)),
    )).map((value) => value.toString(16).padStart(2, '0')).join('');
    const header = `t=${timestamp},v1=${signature}`;
    await expect(verifyStripeWebhook(
      body,
      header,
      secret,
      timestamp * 1000,
    )).resolves.toMatchObject({ id: 'evt_1' });
    await expect(verifyStripeWebhook(
      `${body} `,
      header,
      secret,
      timestamp * 1000,
    )).rejects.toThrow();
  });
});
