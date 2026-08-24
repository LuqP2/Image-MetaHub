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

  it('keeps the Checkout Session off renewal payment facts', async () => {
    const invoices = new Map([
      ['in_initial', {
        id: 'in_initial',
        status: 'paid',
        billing_reason: 'subscription_create',
        parent: { subscription_details: { subscription: 'sub_1' } },
        customer: 'cus_1',
        amount_paid: 499,
        currency: 'usd',
        payments: {
          data: [{
            status: 'paid',
            payment: { payment_intent: 'pi_initial', charge: 'ch_initial' },
          }],
        },
      }],
      ['in_renewal', {
        id: 'in_renewal',
        status: 'paid',
        billing_reason: 'subscription_cycle',
        parent: { subscription_details: { subscription: 'sub_1' } },
        customer: 'cus_1',
        amount_paid: 499,
        currency: 'usd',
        payments: {
          data: [{
            status: 'paid',
            payment: { payment_intent: 'pi_renewal', charge: 'ch_renewal' },
          }],
        },
      }],
    ]);
    const lineItems = new Map([
      ['in_initial', { start: 1_786_000_000, end: 1_788_500_000 }],
      ['in_renewal', { start: 1_788_500_000, end: 1_791_200_000 }],
    ]);
    let licenseSequence = 0;
    const applyPaidInvoice = vi.fn(async () => undefined);
    const { service } = createService({
      repository: { applyPaidInvoice },
      licenseService: {
        prepareLicense: vi.fn(async (input: { stripeCheckoutSessionId: string | null }) => ({
          license: {
            id: `lic_${++licenseSequence}`,
            stripeCheckoutSessionId: input.stripeCheckoutSessionId,
          },
          licenseKey: 'IMH2-TEST',
        })),
      },
      stripeClient: {
        invoices: {
          retrieve: vi.fn(async (id: string) => invoices.get(id)),
          listLineItems: vi.fn(async (id: string) => {
            const period = lineItems.get(id);
            return {
              data: [{
                id: `li_${id}`,
                quantity: 1,
                parent: {
                  type: 'subscription_item_details',
                  subscription_item_details: { proration: false },
                },
                pricing: {
                  price_details: { price: 'price_monthly', product: 'prod_1' },
                },
                period,
              }],
              has_more: false,
            };
          }),
        },
        subscriptions: {
          retrieve: vi.fn(async () => ({
            id: 'sub_1',
            customer: 'cus_1',
            items: {
              data: [{ price: { id: 'price_monthly', product: 'prod_1' } }],
            },
          })),
        },
        checkout: {
          sessions: {
            list: vi.fn(async () => ({
              data: [{
                id: 'cs_initial',
                customer: 'cus_1',
                customer_details: { email: 'buyer@example.com' },
              }],
            })),
          },
        },
      },
    });

    await service.processEvent(event('invoice.paid', 'in_initial', 100));
    await service.processEvent(event('invoice.paid', 'in_renewal', 200));

    expect(applyPaidInvoice).toHaveBeenCalledTimes(2);
    expect(applyPaidInvoice.mock.calls.map(([command]) => ({
      paymentCheckoutSessionId: command.payment.stripeCheckoutSessionId,
      licenseCheckoutSessionId: command.candidateLicense.stripeCheckoutSessionId,
    }))).toEqual([
      { paymentCheckoutSessionId: 'cs_initial', licenseCheckoutSessionId: 'cs_initial' },
      { paymentCheckoutSessionId: null, licenseCheckoutSessionId: 'cs_initial' },
    ]);
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
