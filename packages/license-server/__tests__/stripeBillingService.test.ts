import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { encodeBase64Url } from '../../../utils/licenseCertificate.mjs';
import { testCrypto } from '../../../__tests__/licenseCryptoTestHelpers';
import { LicenseService } from '../src/licenseService.js';
import { StripeBillingService, selectPaidSubscriptionLine } from '../src/stripeBillingService.js';
import { verifyStripeWebhook } from '../src/stripeClient.js';

const config = {
  expectedLivemode: false,
  accountId: 'acct_test',
  subscriptionProductId: 'prod_subscription',
  monthlyPriceId: 'price_monthly',
  annualPriceId: 'price_annual',
  monthlyHistoricalPriceIds: ['price_monthly_old'],
  annualHistoricalPriceIds: ['price_annual_old'],
  lifetimePriceId: 'price_lifetime',
  deliveryEncryptionKey: encodeBase64Url(new Uint8Array(32).fill(7)),
};

class MemoryBillingRepository {
  events = new Map<string, any>();
  licenses = new Map<string, any>();
  subscriptions = new Map<string, any>();
  invoices = new Map<string, any>();
  payments = new Map<string, any>();
  refunds = new Map<string, any>();
  deliveries = new Map<string, any>();

  async enqueueEvent(record: any) {
    if (this.events.has(record.eventId)) return false;
    this.events.set(record.eventId, { ...record, status: 'pending', attempts: 0 });
    return true;
  }
  async claimEvents({ leaseToken }: any) {
    const result = [...this.events.values()].filter((event) => event.status === 'pending');
    result.forEach((event) => Object.assign(event, { status: 'processing', leaseToken }));
    return result;
  }
  async markEventProcessed(id: string, leaseToken: string) {
    const event = this.events.get(id);
    if (event?.status === 'processing' && event.leaseToken === leaseToken) event.status = 'processed';
  }
  async rescheduleEvent(id: string, leaseToken: string, patch: any) {
    const event = this.events.get(id);
    if (event?.status === 'processing' && event.leaseToken === leaseToken) {
      Object.assign(event, patch, { status: patch.deadLetter ? 'dead_letter' : 'pending', leaseToken: null });
    }
  }
  async requeueEvent(id: string) {
    const event = this.events.get(id);
    if (!event || event.status !== 'dead_letter') return false;
    Object.assign(event, { status: 'pending', attempts: 0 });
    return true;
  }
  async findLicenseBySubscriptionId(id: string) {
    return [...this.licenses.values()].find((license) => license.stripeSubscriptionId === id) ?? null;
  }
  async findLicenseByCheckoutSessionId(id: string) {
    return [...this.licenses.values()].find((license) => license.stripeCheckoutSessionId === id) ?? null;
  }
  async findLicenseById(id: string) { return this.licenses.get(id) ?? null; }
  async findSubscription(id: string) { return this.subscriptions.get(id) ?? null; }
  async upsertSubscription(record: any) {
    const current = this.subscriptions.get(record.stripeSubscriptionId);
    const next = current ? {
      ...current,
      ...record,
      stripeCheckoutSessionId: current.stripeCheckoutSessionId ?? record.stripeCheckoutSessionId,
      licenseId: current.licenseId ?? record.licenseId,
      paidThrough: [current.paidThrough, record.paidThrough].filter(Boolean).sort().at(-1) ?? null,
      latestPaidEventCreatedAt: Math.max(current.latestPaidEventCreatedAt ?? 0, record.latestPaidEventCreatedAt ?? 0) || null,
      lastEventCreatedAt: Math.max(current.lastEventCreatedAt, record.lastEventCreatedAt),
    } : { ...record };
    this.subscriptions.set(record.stripeSubscriptionId, next);
    return next;
  }
  async linkCheckoutToSubscription(id: string, sessionId: string) {
    const sub = this.subscriptions.get(id);
    if (sub) sub.stripeCheckoutSessionId ??= sessionId;
    const license = await this.findLicenseBySubscriptionId(id);
    if (license) license.stripeCheckoutSessionId ??= sessionId;
  }
  async createStripeLicenseBundle({ license, subscription, invoice, payment, delivery }: any) {
    if (await this.findLicenseBySubscriptionId(license.stripeSubscriptionId)
      || await this.findLicenseByCheckoutSessionId(license.stripeCheckoutSessionId)) {
      throw new Error('UNIQUE constraint failed');
    }
    const blockedByTermination = subscription
      && this.subscriptions.get(subscription.stripeSubscriptionId)?.billingStatus === 'canceled'
      && this.subscriptions.get(subscription.stripeSubscriptionId).lastEventCreatedAt >= subscription.lastEventCreatedAt;
    this.licenses.set(license.id, { ...license, status: blockedByTermination ? 'cancelled' : license.status });
    if (subscription) await this.upsertSubscription(subscription);
    if (invoice) this.invoices.set(invoice.stripeInvoiceId, { ...invoice });
    if (payment) this.payments.set(payment.paymentReference, { ...payment });
    this.deliveries.set(delivery.id, {
      ...delivery,
      encryptedPayload: blockedByTermination ? null : delivery.encryptedPayload,
      status: blockedByTermination ? 'cancelled' : 'pending',
      attempts: 0,
    });
  }
  async recordPaidRenewal({ licenseId, plan, expiresAt, subscription, invoice, payment }: any) {
    const license = this.licenses.get(licenseId);
    license.plan = plan;
    const currentSubscription = this.subscriptions.get(subscription.stripeSubscriptionId);
    const blockedByTermination = currentSubscription?.billingStatus === 'canceled'
      && currentSubscription.lastEventCreatedAt >= subscription.latestPaidEventCreatedAt;
    const blockedByRefund = [...this.refunds.values()].some((refund) => {
      if (!refund.isFullRefund || refund.refundStatus !== 'succeeded') return false;
      const refundedPayment = this.payments.get(refund.paymentReference);
      const refundedInvoice = refundedPayment?.stripeInvoiceId
        ? this.invoices.get(refundedPayment.stripeInvoiceId)
        : null;
      return refund.licenseId === licenseId
        && (!refundedInvoice?.periodEnd || refundedInvoice.periodEnd >= expiresAt);
    });
    if (!blockedByRefund && !blockedByTermination) {
      if (license.status !== 'revoked') license.status = 'active';
      license.expiresAt = [license.expiresAt, expiresAt].filter(Boolean).sort().at(-1);
    }
    await this.upsertSubscription({ ...subscription, licenseId });
    this.invoices.set(invoice.stripeInvoiceId, { ...invoice, licenseId });
    this.payments.set(payment.paymentReference, { ...payment, licenseId });
  }
  async recordInvoice(record: any) { this.invoices.set(record.stripeInvoiceId, { ...record }); }
  async findInvoice(id: string) { return this.invoices.get(id) ?? null; }
  async findPayment({ paymentIntentId, chargeId }: any) {
    return [...this.payments.values()].find(
      (payment) => (paymentIntentId && payment.stripePaymentIntentId === paymentIntentId)
        || (chargeId && payment.stripeChargeId === chargeId),
    ) ?? null;
  }
  async recordRefund(record: any) { this.refunds.set(record.stripeRefundId, { ...record }); }
  async revokeRefundedLicense({ licenseId, recurring, refundedPeriodEnd, now }: any) {
    if (recurring && [...this.invoices.values()].some(
      (invoice) => invoice.licenseId === licenseId && invoice.periodEnd > refundedPeriodEnd,
    )) return false;
    const license = this.licenses.get(licenseId);
    if (license.status !== 'revoked') license.status = recurring ? 'expired' : 'revoked';
    if (recurring) license.expiresAt = now;
    const delivery = [...this.deliveries.values()].find((item) => item.licenseId === licenseId);
    if (delivery && ['pending', 'processing', 'dead_letter'].includes(delivery.status)) {
      Object.assign(delivery, { status: 'cancelled', encryptedPayload: null, leaseToken: null });
    }
    return true;
  }
  async terminateSubscription(id: string, eventCreatedAt: number) {
    const subscription = this.subscriptions.get(id);
    if (!subscription?.licenseId || (subscription.latestPaidEventCreatedAt ?? 0) > eventCreatedAt) return false;
    const license = this.licenses.get(subscription.licenseId);
    if (license.status !== 'revoked') license.status = 'cancelled';
    const delivery = [...this.deliveries.values()].find((item) => item.licenseId === subscription.licenseId);
    if (delivery && ['pending', 'processing', 'dead_letter'].includes(delivery.status)) {
      Object.assign(delivery, { status: 'cancelled', encryptedPayload: null, leaseToken: null });
    }
    return true;
  }
  async claimDeliveries({ leaseToken }: any) {
    const result = [...this.deliveries.values()].filter((delivery) => delivery.status === 'pending');
    result.forEach((delivery) => Object.assign(delivery, { status: 'processing', leaseToken }));
    return result.map((delivery) => ({ ...delivery }));
  }
  async authorizeDeliverySend(id: string, leaseToken: string, now: string) {
    const delivery = this.deliveries.get(id);
    const license = delivery ? this.licenses.get(delivery.licenseId) : null;
    const authorized = delivery?.status === 'processing' && delivery.leaseToken === leaseToken
      && delivery.encryptedPayload && license?.status === 'active'
      && (!license.expiresAt || license.expiresAt > now);
    if (!authorized && delivery?.status === 'processing' && delivery.leaseToken === leaseToken) {
      Object.assign(delivery, { status: 'cancelled', encryptedPayload: null, leaseToken: null });
    }
    return Boolean(authorized);
  }
  async markDeliveryDelivered(id: string, leaseToken: string, messageId: string) {
    const delivery = this.deliveries.get(id);
    if (delivery?.status === 'processing' && delivery.leaseToken === leaseToken) {
      Object.assign(delivery, {
        status: 'delivered', encryptedPayload: null, providerMessageId: messageId, leaseToken: null,
      });
    }
  }
  async rescheduleDelivery(id: string, leaseToken: string, patch: any) {
    const delivery = this.deliveries.get(id);
    if (delivery?.status === 'processing' && delivery.leaseToken === leaseToken) {
      Object.assign(delivery, patch, {
        status: patch.deadLetter ? 'dead_letter' : 'pending', leaseToken: null,
      });
    }
  }
  async requeueDelivery(id: string) {
    const delivery = this.deliveries.get(id);
    if (!delivery || delivery.status !== 'dead_letter') return false;
    Object.assign(delivery, { status: 'pending', attempts: 0 });
    return true;
  }
}

const subscription = (overrides: any = {}) => ({
  id: 'sub_1',
  customer: { id: 'cus_1', email: 'buyer@example.com' },
  status: 'active',
  livemode: false,
  cancel_at_period_end: false,
  ended_at: null,
  items: { data: [{ price: { id: 'price_monthly', product: 'prod_subscription' } }] },
  ...overrides,
});

const paidLine = (priceId = 'price_monthly', end = 1_789_000_000) => ({
  id: `il_${priceId}_${end}`,
  quantity: 1,
  parent: { type: 'subscription_item_details', subscription_item_details: { proration: false } },
  pricing: { price_details: { price: priceId, product: 'prod_subscription' } },
  period: { start: end - 2_592_000, end },
});

const event = (id: string, type: string, object: any, created = 1_786_000_000) => ({
  id, type, livemode: false, created, data: { object },
});

describe('Stripe billing service', () => {
  let repository: MemoryBillingRepository;
  let stripe: any;
  let deliveries: any[];
  let service: StripeBillingService;
  let now: Date;

  beforeEach(() => {
    repository = new MemoryBillingRepository();
    deliveries = [];
    now = new Date('2026-08-23T12:00:00.000Z');
    const subscriptions = new Map([['sub_1', subscription()]]);
    const sessions = new Map<string, any>();
    const invoices = new Map<string, any>();
    const invoiceLines = new Map<string, any[]>();
    const refunds = new Map<string, any>();
    const charges = new Map<string, any>();
    stripe = {
      _subscriptions: subscriptions,
      _sessions: sessions,
      _invoices: invoices,
      _invoiceLines: invoiceLines,
      _refunds: refunds,
      _charges: charges,
      customers: { retrieve: vi.fn(async () => ({ id: 'cus_1', email: 'buyer@example.com' })) },
      subscriptions: { retrieve: vi.fn(async (id: string) => subscriptions.get(id)) },
      checkout: { sessions: {
        retrieve: vi.fn(async (id: string) => sessions.get(id)),
        listLineItems: vi.fn(async (id: string) => ({ data: sessions.get(id).lineItems })),
        list: vi.fn(async ({ subscription: subscriptionId }: any) => ({
          data: [...sessions.values()].filter((session) => session.subscription?.id === subscriptionId || session.subscription === subscriptionId),
        })),
      } },
      invoices: {
        retrieve: vi.fn(async (id: string) => invoices.get(id)),
        listLineItems: vi.fn(async (id: string) => ({ data: invoiceLines.get(id) })),
      },
      refunds: { retrieve: vi.fn(async (id: string) => refunds.get(id)) },
      charges: { retrieve: vi.fn(async (id: string) => charges.get(id)) },
    };
    const licenseService = new LicenseService({
      repository: {} as any,
      emailPepper: 'test-email-pepper',
      signingPrivateKey: '',
      signingPublicKey: '',
      cryptoApi: testCrypto,
      now: () => now,
    });
    service = new StripeBillingService({
      repository,
      licenseService,
      stripeClient: stripe,
      deliveryClient: {
        sendLicense: vi.fn(async (payload) => {
          deliveries.push(payload);
          return { ok: true, messageId: `email_${deliveries.length}` };
        }),
      },
      config,
      cryptoApi: testCrypto,
      now: () => now,
    });
  });

  async function process(stripeEvent: any) {
    await service.enqueueVerifiedEvent(stripeEvent);
    await service.processEventInbox();
  }

  it('rejects events from a different livemode or Stripe account context', async () => {
    await expect(service.enqueueVerifiedEvent({
      ...event('evt_wrong_mode', 'invoice.paid', { id: 'in_wrong_mode' }),
      livemode: true,
    })).rejects.toThrow(/livemode/);
    await expect(service.enqueueVerifiedEvent({
      ...event('evt_wrong_account', 'invoice.paid', { id: 'in_wrong_account' }),
      account: 'acct_other',
    })).rejects.toThrow(/account/);
  });

  it('deduplicates delivery of the same Stripe event id', async () => {
    const session = {
      id: 'cs_duplicate', mode: 'payment', payment_status: 'paid', livemode: false,
      customer_details: { email: 'buyer@example.com' }, payment_intent: 'pi_duplicate',
      lineItems: [{ quantity: 1, price: { id: 'price_lifetime', product: 'prod_subscription' } }],
    };
    stripe._sessions.set(session.id, session);
    const duplicate = event('evt_duplicate', 'checkout.session.completed', session);
    await process(duplicate);
    await process(duplicate);
    expect(repository.events.size).toBe(1);
    expect(repository.licenses.size).toBe(1);
    expect(repository.deliveries.size).toBe(1);
  });

  it('provisions Lifetime for paid and asynchronous checkout exactly once', async () => {
    const session = {
      id: 'cs_lifetime', mode: 'payment', payment_status: 'paid', livemode: false,
      customer: { id: 'cus_1', email: 'buyer@example.com' }, customer_details: { email: 'buyer@example.com' },
      payment_intent: 'pi_lifetime', amount_total: 3900, currency: 'usd',
      lineItems: [{ quantity: 1, price: { id: 'price_lifetime', product: 'prod_subscription' } }],
    };
    stripe._sessions.set(session.id, session);
    await process(event('evt_checkout', 'checkout.session.completed', session));
    await process(event('evt_async', 'checkout.session.async_payment_succeeded', session, 1_786_000_001));
    expect(repository.licenses.size).toBe(1);
    expect(repository.deliveries.size).toBe(1);
    expect([...repository.licenses.values()][0]).toMatchObject({ plan: 'lifetime', source: 'stripe', expiresAt: null });
  });

  it('does not provision Lifetime after asynchronous payment failure', async () => {
    const session = { id: 'cs_failed', mode: 'payment', payment_status: 'unpaid', livemode: false };
    stripe._sessions.set(session.id, session);
    await process(event('evt_failed', 'checkout.session.async_payment_failed', session));
    expect(repository.licenses.size).toBe(0);
  });

  it('provisions Lifetime when a delayed checkout changes from unpaid to paid', async () => {
    const session = {
      id: 'cs_delayed', mode: 'payment', payment_status: 'unpaid', livemode: false,
      customer_details: { email: 'buyer@example.com' }, payment_intent: 'pi_delayed',
      lineItems: [{ quantity: 1, price: { id: 'price_lifetime', product: 'prod_subscription' } }],
    };
    stripe._sessions.set(session.id, session);
    await process(event('evt_delayed_completed', 'checkout.session.completed', session));
    expect(repository.licenses.size).toBe(0);
    session.payment_status = 'paid';
    await process(event('evt_delayed_succeeded', 'checkout.session.async_payment_succeeded', session, 1_786_000_001));
    expect(repository.licenses.size).toBe(1);
  });

  it('records subscription creation without granting entitlement', async () => {
    await process(event('evt_subscription_created', 'customer.subscription.created', { id: 'sub_1' }));
    expect(repository.subscriptions.get('sub_1')).toMatchObject({ billingStatus: 'active' });
    expect(repository.licenses.size).toBe(0);
  });

  it('uses the single matching non-proration subscription line', () => {
    const selected = selectPaidSubscriptionLine([
      { ...paidLine(), parent: { type: 'invoice_item_details' } },
      { ...paidLine(), parent: { type: 'subscription_item_details', subscription_item_details: { proration: true } } },
      paidLine('price_annual', 1_820_000_000),
    ], config);
    expect(selected).toMatchObject({ priceId: 'price_annual', periodEnd: new Date(1_820_000_000_000).toISOString() });
    expect(selectPaidSubscriptionLine([paidLine(), paidLine()], config)).toBeNull();
  });

  it('finds the paid subscription line on a later invoice page', async () => {
    const existing = {
      id: 'lic_paginated', plan: 'monthly', status: 'active', source: 'stripe',
      expiresAt: '2026-09-23T00:00:00.000Z', stripeSubscriptionId: 'sub_1',
    };
    repository.licenses.set(existing.id, existing);
    repository.subscriptions.set('sub_1', {
      stripeSubscriptionId: 'sub_1', licenseId: existing.id,
      latestPaidEventCreatedAt: 100, lastEventCreatedAt: 100, paidThrough: existing.expiresAt,
    });
    const invoice = {
      id: 'in_paginated', status: 'paid', customer_email: 'buyer@example.com',
      parent: { subscription_details: { subscription: 'sub_1' } },
      payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_paginated' } }] },
      amount_paid: 499, currency: 'usd',
    };
    stripe._invoices.set(invoice.id, invoice);
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...paidLine('price_monthly', 1_789_000_000),
      id: `il_noise_${index}`,
      parent: { type: 'invoice_item_details' },
    }));
    stripe.invoices.listLineItems
      .mockImplementationOnce(async () => ({ data: firstPage, has_more: true }))
      .mockImplementationOnce(async () => ({
        data: [paidLine('price_monthly', 1_791_592_000)], has_more: false,
      }));

    await process(event('evt_paginated_paid', 'invoice.paid', invoice, 1_788_500_000));

    expect(stripe.invoices.listLineItems).toHaveBeenNthCalledWith(2, invoice.id, {
      limit: 100, starting_after: 'il_noise_99',
    });
    expect(existing.expiresAt).toBe(new Date(1_791_592_000_000).toISOString());
  });

  it('creates one subscription key on invoice.paid and reuses it on renewal', async () => {
    const checkout = {
      id: 'cs_subscription', mode: 'subscription', payment_status: 'paid', livemode: false,
      customer: { id: 'cus_1', email: 'buyer@example.com' }, customer_details: { email: 'buyer@example.com' },
      subscription: subscription(),
    };
    stripe._sessions.set(checkout.id, checkout);
    const firstInvoice = {
      id: 'in_1', status: 'paid', customer: checkout.customer, customer_email: 'buyer@example.com',
      parent: { subscription_details: { subscription: 'sub_1' } },
      payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_1' } }] },
      amount_paid: 499, currency: 'usd',
    };
    stripe._invoices.set(firstInvoice.id, firstInvoice);
    stripe._invoiceLines.set(firstInvoice.id, [paidLine('price_monthly', 1_789_000_000)]);
    await process(event('evt_paid_1', 'invoice.paid', firstInvoice));
    const license = [...repository.licenses.values()][0];
    const firstKeyHash = license.keyHash;

    const renewal = {
      ...firstInvoice, id: 'in_2',
      payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_2' } }] },
    };
    stripe._invoices.set(renewal.id, renewal);
    stripe._invoiceLines.set(renewal.id, [paidLine('price_monthly', 1_791_592_000)]);
    await process(event('evt_paid_2', 'invoice.paid', renewal, 1_788_500_000));

    expect(repository.licenses.size).toBe(1);
    expect(repository.deliveries.size).toBe(1);
    expect(repository.licenses.get(license.id).keyHash).toBe(firstKeyHash);
    expect(repository.licenses.get(license.id).expiresAt).toBe(new Date(1_791_592_000_000).toISOString());
  });

  it('reapplies a colliding paid invoice to the license created by the winning worker', async () => {
    const invoice = {
      id: 'in_collision_newer', status: 'paid', customer_email: 'buyer@example.com',
      parent: { subscription_details: { subscription: 'sub_1' } },
      payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_collision_newer' } }] },
      amount_paid: 499, currency: 'usd',
    };
    stripe._invoices.set(invoice.id, invoice);
    stripe._invoiceLines.set(invoice.id, [paidLine('price_monthly', 1_791_592_000)]);
    vi.spyOn(repository, 'createStripeLicenseBundle').mockImplementationOnce(async ({
      license, subscription: createdSubscription,
    }: any) => {
      const winner = {
        ...license, id: 'lic_collision_winner', expiresAt: '2026-09-23T00:00:00.000Z',
      };
      repository.licenses.set(winner.id, winner);
      await repository.upsertSubscription({ ...createdSubscription, licenseId: winner.id });
      throw new Error('UNIQUE constraint failed: licenses.stripe_subscription_id');
    });

    await process(event('evt_collision_newer', 'invoice.paid', invoice, 1_788_500_000));

    const winner = repository.licenses.get('lic_collision_winner');
    expect(repository.licenses.size).toBe(1);
    expect(winner).toMatchObject({
      status: 'active',
      expiresAt: new Date(1_791_592_000_000).toISOString(),
    });
    expect(repository.invoices.get(invoice.id)).toMatchObject({ licenseId: winner.id });
    expect(repository.payments.get('pi_collision_newer')).toMatchObject({ licenseId: winner.id });
    expect(repository.deliveries.size).toBe(0);
  });

  it('renews a subscription on an allowlisted historical Price ID', async () => {
    stripe._subscriptions.set('sub_old_price', subscription({
      id: 'sub_old_price',
      items: { data: [{ price: { id: 'price_monthly_old', product: 'prod_subscription' } }] },
    }));
    const existing = {
      id: 'lic_old_price', plan: 'monthly', status: 'active', source: 'stripe',
      expiresAt: '2026-09-23T00:00:00.000Z', stripeSubscriptionId: 'sub_old_price',
    };
    repository.licenses.set(existing.id, existing);
    repository.subscriptions.set('sub_old_price', {
      stripeSubscriptionId: 'sub_old_price', licenseId: existing.id,
      latestPaidEventCreatedAt: 100, lastEventCreatedAt: 100, paidThrough: existing.expiresAt,
    });
    const renewal = {
      id: 'in_old_price', status: 'paid', customer_email: 'buyer@example.com',
      parent: { subscription_details: { subscription: 'sub_old_price' } },
      payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_old_price' } }] },
      amount_paid: 499, currency: 'usd',
    };
    stripe._invoices.set(renewal.id, renewal);
    stripe._invoiceLines.set(renewal.id, [paidLine('price_monthly_old', 1_791_592_000)]);
    await process(event('evt_old_price_paid', 'invoice.paid', renewal, 1_788_500_000));
    expect(existing).toMatchObject({
      status: 'active', plan: 'monthly',
      expiresAt: new Date(1_791_592_000_000).toISOString(),
    });
  });

  it('preserves an administrative revocation across a paid renewal', async () => {
    const existing = {
      id: 'lic_revoked', plan: 'monthly', status: 'revoked', source: 'stripe',
      expiresAt: '2026-09-23T00:00:00.000Z', stripeSubscriptionId: 'sub_1',
    };
    repository.licenses.set(existing.id, existing);
    repository.subscriptions.set('sub_1', {
      stripeSubscriptionId: 'sub_1', licenseId: existing.id,
      latestPaidEventCreatedAt: 100, lastEventCreatedAt: 100, paidThrough: existing.expiresAt,
    });
    stripe._subscriptions.set('sub_1', subscription({ status: 'canceled', ended_at: 1_788_000_000 }));
    await process(event('evt_revoked_deleted', 'customer.subscription.deleted', { id: 'sub_1' }, 1_788_000_000));
    expect(existing.status).toBe('revoked');
    const renewal = {
      id: 'in_revoked', status: 'paid', customer_email: 'buyer@example.com',
      parent: { subscription_details: { subscription: 'sub_1' } },
      payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_revoked' } }] },
      amount_paid: 499, currency: 'usd',
    };
    stripe._invoices.set(renewal.id, renewal);
    stripe._invoiceLines.set(renewal.id, [paidLine('price_monthly', 1_791_592_000)]);
    await process(event('evt_revoked_paid', 'invoice.paid', renewal, 1_788_500_000));
    expect(existing).toMatchObject({
      status: 'revoked',
      expiresAt: new Date(1_791_592_000_000).toISOString(),
    });
  });

  it('uses the exact annual line period as the annual entitlement expiry', async () => {
    stripe._subscriptions.set('sub_annual', subscription({
      id: 'sub_annual',
      items: { data: [{ price: { id: 'price_annual', product: 'prod_subscription' } }] },
    }));
    const checkout = {
      id: 'cs_annual', mode: 'subscription', payment_status: 'paid', livemode: false,
      customer_details: { email: 'annual@example.com' }, subscription: 'sub_annual',
    };
    stripe._sessions.set(checkout.id, checkout);
    const annualInvoice = {
      id: 'in_annual', status: 'paid', customer_email: 'annual@example.com',
      parent: { subscription_details: { subscription: 'sub_annual' } },
      payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_annual' } }] },
      amount_paid: 1999, currency: 'usd',
    };
    stripe._invoices.set(annualInvoice.id, annualInvoice);
    stripe._invoiceLines.set(annualInvoice.id, [paidLine('price_annual', 1_820_000_000)]);
    await process(event('evt_annual_paid', 'invoice.paid', annualInvoice));
    expect([...repository.licenses.values()][0]).toMatchObject({
      plan: 'annual',
      expiresAt: new Date(1_820_000_000_000).toISOString(),
    });
  });

  it('keeps paid access for failures, past_due and cancel_at_period_end', async () => {
    const existing = {
      id: 'lic_1', plan: 'monthly', status: 'active', source: 'stripe', expiresAt: '2026-09-23T00:00:00.000Z',
      stripeSubscriptionId: 'sub_1',
    };
    repository.licenses.set(existing.id, existing);
    repository.subscriptions.set('sub_1', {
      stripeSubscriptionId: 'sub_1', licenseId: existing.id, latestPaidEventCreatedAt: 100,
      lastEventCreatedAt: 100, paidThrough: existing.expiresAt,
    });
    stripe._subscriptions.set('sub_1', subscription({ status: 'past_due', cancel_at_period_end: true }));
    await process(event('evt_updated', 'customer.subscription.updated', { id: 'sub_1' }, 200));
    expect(repository.licenses.get(existing.id).status).toBe('active');

    const failedInvoice = {
      id: 'in_failed', status: 'open', parent: { subscription_details: { subscription: 'sub_1' } },
      amount_paid: 0, currency: 'usd',
    };
    stripe._invoices.set(failedInvoice.id, failedInvoice);
    await process(event('evt_payment_failed', 'invoice.payment_failed', failedInvoice, 201));
    await process(event('evt_action_required', 'invoice.payment_action_required', failedInvoice, 202));
    await process(event('evt_finalization_failed', 'invoice.finalization_failed', failedInvoice, 203));
    expect(repository.licenses.get(existing.id).status).toBe('active');
  });

  it('ignores stale deletion but applies a later effective deletion', async () => {
    const existing = { id: 'lic_1', plan: 'monthly', status: 'active', source: 'stripe', stripeSubscriptionId: 'sub_1' };
    repository.licenses.set(existing.id, existing);
    repository.subscriptions.set('sub_1', {
      stripeSubscriptionId: 'sub_1', licenseId: existing.id,
      latestPaidEventCreatedAt: 300, lastEventCreatedAt: 300,
    });
    const pendingDelivery = {
      id: 'delivery_cancelled', licenseId: existing.id, encryptedPayload: 'encrypted',
      status: 'pending', attempts: 0,
    };
    repository.deliveries.set(pendingDelivery.id, pendingDelivery);
    stripe._subscriptions.set('sub_1', subscription({ status: 'canceled', ended_at: 1_786_000_000 }));
    await process(event('evt_delete_old', 'customer.subscription.deleted', { id: 'sub_1' }, 200));
    expect(existing.status).toBe('active');
    await process(event('evt_delete_new', 'customer.subscription.deleted', { id: 'sub_1' }, 400));
    expect(existing.status).toBe('cancelled');
    expect(pendingDelivery).toMatchObject({ status: 'cancelled', encryptedPayload: null });

    const stalePaidInvoice = {
      id: 'in_before_deletion', status: 'paid', customer_email: 'buyer@example.com',
      parent: { subscription_details: { subscription: 'sub_1' } },
      payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_before_deletion' } }] },
      amount_paid: 499, currency: 'usd',
    };
    stripe._invoices.set(stalePaidInvoice.id, stalePaidInvoice);
    stripe._invoiceLines.set(stalePaidInvoice.id, [paidLine('price_monthly', 1_789_000_000)]);
    await process(event('evt_paid_before_deletion', 'invoice.paid', stalePaidInvoice, 400));
    expect(existing.status).toBe('cancelled');
  });

  it('does not provision a same-second paid invoice after deletion was processed first', async () => {
    stripe._subscriptions.set('sub_1', subscription({ status: 'canceled', ended_at: 1_786_000_000 }));
    await process(event('evt_delete_tied', 'customer.subscription.deleted', { id: 'sub_1' }, 400));
    const tiedInvoice = {
      id: 'in_tied', status: 'paid', customer_email: 'buyer@example.com',
      parent: { subscription_details: { subscription: 'sub_1' } },
      payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_tied' } }] },
      amount_paid: 499, currency: 'usd',
    };
    stripe._invoices.set(tiedInvoice.id, tiedInvoice);
    stripe._invoiceLines.set(tiedInvoice.id, [paidLine('price_monthly', 1_789_000_000)]);
    await process(event('evt_paid_tied', 'invoice.paid', tiedInvoice, 400));
    expect(repository.licenses.size).toBe(0);
    expect(repository.deliveries.size).toBe(0);
    expect(repository.invoices.get(tiedInvoice.id)).toMatchObject({ licenseId: null });
  });

  it('retries delivery without storing plaintext and clears ciphertext after success', async () => {
    const session = {
      id: 'cs_delivery', mode: 'payment', payment_status: 'paid', livemode: false,
      customer: { id: 'cus_1', email: 'buyer@example.com' }, customer_details: { email: 'buyer@example.com' },
      payment_intent: 'pi_delivery',
      lineItems: [{ quantity: 1, price: { id: 'price_lifetime', product: 'prod_subscription' } }],
    };
    stripe._sessions.set(session.id, session);
    await process(event('evt_delivery', 'checkout.session.completed', session));
    const outbox = [...repository.deliveries.values()][0];
    expect(outbox.encryptedPayload).not.toContain('buyer@example.com');
    expect(outbox.encryptedPayload).not.toContain('IMH2-');
    await service.processDeliveryOutbox();
    expect(outbox.status).toBe('delivered');
    expect(outbox.encryptedPayload).toBeNull();
    expect(deliveries[0].licenseKey).toMatch(/^IMH2-/);
  });

  it('does not send a stale claimed payload after entitlement cancellation', async () => {
    const session = {
      id: 'cs_claim_cancel', mode: 'payment', payment_status: 'paid', livemode: false,
      customer_details: { email: 'buyer@example.com' }, payment_intent: 'pi_claim_cancel',
      lineItems: [{ quantity: 1, price: { id: 'price_lifetime', product: 'prod_subscription' } }],
    };
    stripe._sessions.set(session.id, session);
    await process(event('evt_claim_cancel', 'checkout.session.completed', session));
    const claimDeliveries = repository.claimDeliveries.bind(repository);
    vi.spyOn(repository, 'claimDeliveries').mockImplementationOnce(async (options: any) => {
      const claimed = await claimDeliveries(options);
      const persisted = repository.deliveries.get(claimed[0].id);
      repository.licenses.get(persisted.licenseId).status = 'revoked';
      Object.assign(persisted, { status: 'cancelled', encryptedPayload: null, leaseToken: null });
      return claimed;
    });

    await service.processDeliveryOutbox();

    expect(deliveries).toHaveLength(0);
    expect([...repository.deliveries.values()][0]).toMatchObject({
      status: 'cancelled', encryptedPayload: null,
    });
  });

  it('keeps partial and old-period refunds from reducing a later paid entitlement', async () => {
    const license = {
      id: 'lic_refund', plan: 'monthly', status: 'active', source: 'stripe',
      expiresAt: '2026-11-23T00:00:00.000Z', stripeSubscriptionId: 'sub_1',
    };
    repository.licenses.set(license.id, license);
    repository.invoices.set('in_old', {
      stripeInvoiceId: 'in_old', licenseId: license.id, periodEnd: '2026-10-23T00:00:00.000Z',
    });
    repository.invoices.set('in_new', {
      stripeInvoiceId: 'in_new', licenseId: license.id, periodEnd: license.expiresAt,
    });
    repository.payments.set('pi_old', {
      paymentReference: 'pi_old', stripePaymentIntentId: 'pi_old', stripeChargeId: 'ch_old',
      stripeInvoiceId: 'in_old', licenseId: license.id,
    });
    stripe._refunds.set('re_partial', {
      id: 're_partial', status: 'succeeded', amount: 100, currency: 'usd',
      charge: 'ch_old', payment_intent: 'pi_old',
    });
    stripe._charges.set('ch_old', { id: 'ch_old', amount: 499, amount_refunded: 100 });
    await process(event('evt_refund_partial', 'refund.created', { id: 're_partial' }));
    expect(license.status).toBe('active');

    stripe._refunds.set('re_full_old', {
      id: 're_full_old', status: 'succeeded', amount: 499, currency: 'usd',
      charge: 'ch_old', payment_intent: 'pi_old',
    });
    stripe._charges.set('ch_old', { id: 'ch_old', amount: 499, amount_refunded: 499 });
    await process(event('evt_refund_full_old', 'refund.created', { id: 're_full_old' }, 1_786_000_001));
    expect(license.status).toBe('active');
  });

  it('revokes Lifetime and expires the latest recurring period only after a full succeeded refund', async () => {
    const lifetime = { id: 'lic_life', plan: 'lifetime', status: 'active', source: 'stripe' };
    repository.licenses.set(lifetime.id, lifetime);
    repository.payments.set('pi_life', {
      paymentReference: 'pi_life', stripePaymentIntentId: 'pi_life', stripeChargeId: 'ch_life',
      licenseId: lifetime.id,
    });
    stripe._refunds.set('re_life', {
      id: 're_life', status: 'succeeded', amount: 3900, currency: 'usd',
      charge: 'ch_life', payment_intent: 'pi_life',
    });
    stripe._charges.set('ch_life', { id: 'ch_life', amount: 3900, amount_refunded: 3900 });
    await process(event('evt_refund_life', 'refund.created', { id: 're_life' }));
    expect(lifetime.status).toBe('revoked');

    const monthly = {
      id: 'lic_monthly', plan: 'monthly', status: 'active', source: 'stripe',
      expiresAt: '2026-09-23T00:00:00.000Z', stripeSubscriptionId: 'sub_1',
    };
    repository.licenses.set(monthly.id, monthly);
    repository.subscriptions.set('sub_1', {
      stripeSubscriptionId: 'sub_1', licenseId: monthly.id,
      latestPaidEventCreatedAt: 1_786_000_000, lastEventCreatedAt: 1_786_000_000,
    });
    repository.invoices.set('in_latest', {
      stripeInvoiceId: 'in_latest', licenseId: monthly.id, periodEnd: monthly.expiresAt,
    });
    repository.payments.set('pi_latest', {
      paymentReference: 'pi_latest', stripePaymentIntentId: 'pi_latest', stripeChargeId: 'ch_latest',
      stripeInvoiceId: 'in_latest', licenseId: monthly.id,
    });
    stripe._refunds.set('re_failed', {
      id: 're_failed', status: 'failed', amount: 499, currency: 'usd',
      charge: 'ch_latest', payment_intent: 'pi_latest',
    });
    stripe._charges.set('ch_latest', { id: 'ch_latest', amount: 499, amount_refunded: 0 });
    await process(event('evt_refund_failed', 'refund.failed', { id: 're_failed' }));
    expect(monthly.status).toBe('active');

    stripe._refunds.set('re_latest', {
      id: 're_latest', status: 'succeeded', amount: 499, currency: 'usd',
      charge: 'ch_latest', payment_intent: 'pi_latest',
    });
    stripe._charges.set('ch_latest', { id: 'ch_latest', amount: 499, amount_refunded: 499 });
    await process(event('evt_refund_latest', 'refund.created', { id: 're_latest' }, 1_786_000_001));
    expect(monthly.status).toBe('expired');
    expect(monthly.expiresAt).toBe(now.toISOString());

    const delayedOldInvoice = {
      id: 'in_delayed_old', status: 'paid', customer: { id: 'cus_1' },
      parent: { subscription_details: { subscription: 'sub_1' } },
      payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_delayed_old' } }] },
      amount_paid: 499, currency: 'usd',
    };
    stripe._invoices.set(delayedOldInvoice.id, delayedOldInvoice);
    stripe._invoiceLines.set(delayedOldInvoice.id, [paidLine('price_monthly', 1_777_500_000)]);
    await process(event('evt_paid_delayed_old', 'invoice.paid', delayedOldInvoice, 1_785_000_000));
    expect(monthly.status).toBe('expired');
    expect(monthly.expiresAt).toBe(now.toISOString());
  });

  it('processes refund.updated after a pending refund event has dead-lettered', async () => {
    const lifetime = { id: 'lic_refund_updated', plan: 'lifetime', status: 'active', source: 'stripe' };
    repository.licenses.set(lifetime.id, lifetime);
    repository.payments.set('pi_refund_updated', {
      paymentReference: 'pi_refund_updated', stripePaymentIntentId: 'pi_refund_updated',
      stripeChargeId: 'ch_refund_updated', licenseId: lifetime.id,
    });
    stripe._refunds.set('re_updated', {
      id: 're_updated', status: 'pending', amount: 3900, currency: 'usd',
      charge: 'ch_refund_updated', payment_intent: 'pi_refund_updated',
    });
    stripe._charges.set('ch_refund_updated', { id: 'ch_refund_updated', amount: 3900, amount_refunded: 0 });
    await process(event('evt_refund_pending', 'refund.created', { id: 're_updated' }));
    repository.events.get('evt_refund_pending').status = 'dead_letter';
    expect(lifetime.status).toBe('active');

    stripe._refunds.set('re_updated', {
      id: 're_updated', status: 'succeeded', amount: 3900, currency: 'usd',
      charge: 'ch_refund_updated', payment_intent: 'pi_refund_updated',
    });
    stripe._charges.set('ch_refund_updated', { id: 'ch_refund_updated', amount: 3900, amount_refunded: 3900 });
    await process(event('evt_refund_updated', 'refund.updated', { id: 're_updated' }, 1_786_100_000));
    expect(lifetime.status).toBe('revoked');
    expect(repository.events.get('evt_refund_updated').status).toBe('processed');
  });

  it('retries transient email failures and dead-letters after the seven scheduled retries', async () => {
    const failingDelivery = vi.fn(async () => ({ ok: false, retryable: true, code: 'provider_unavailable' }));
    (service as any).deliveryClient = { sendLicense: failingDelivery };
    const session = {
      id: 'cs_dead_letter', mode: 'payment', payment_status: 'paid', livemode: false,
      customer: { id: 'cus_1', email: 'buyer@example.com' }, customer_details: { email: 'buyer@example.com' },
      payment_intent: 'pi_dead_letter',
      lineItems: [{ quantity: 1, price: { id: 'price_lifetime', product: 'prod_subscription' } }],
    };
    stripe._sessions.set(session.id, session);
    await process(event('evt_dead_letter', 'checkout.session.completed', session));
    const outbox = [...repository.deliveries.values()][0];
    for (let attempt = 0; attempt < 8; attempt += 1) await service.processDeliveryOutbox();
    expect(failingDelivery).toHaveBeenCalledTimes(8);
    expect(outbox).toMatchObject({ status: 'dead_letter', attempts: 8 });
    expect(outbox.encryptedPayload).not.toContain('buyer@example.com');
    expect(await repository.requeueDelivery(outbox.id)).toBe(true);
    expect(outbox).toMatchObject({ status: 'pending', attempts: 0 });
  });
});

describe('Stripe webhook signatures', () => {
  it('accepts exact raw bodies and rejects tampering or stale timestamps', async () => {
    const stripe = new Stripe('rk_test_signature', { apiVersion: '2026-07-29.dahlia' });
    const secret = 'whsec_test_secret';
    const payload = JSON.stringify(event('evt_signed', 'invoice.paid', { id: 'in_signed' }));
    const timestamp = Math.floor(Date.now() / 1000);
    const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret, timestamp });
    await expect(verifyStripeWebhook(payload, header, secret)).resolves.toMatchObject({ id: 'evt_signed' });
    await expect(verifyStripeWebhook(payload, null, secret)).rejects.toThrow();
    await expect(verifyStripeWebhook(`${payload} `, header, secret)).rejects.toThrow();
    const staleHeader = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret, timestamp: timestamp - 600 });
    await expect(verifyStripeWebhook(payload, staleHeader, secret)).rejects.toThrow();
  });
});
