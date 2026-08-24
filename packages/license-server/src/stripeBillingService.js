import { encryptDeliveryPayload, decryptDeliveryPayload } from './deliveryCrypto.js';

export const SUPPORTED_STRIPE_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'invoice.finalization_failed',
  'refund.created',
  'refund.updated',
  'refund.failed',
]);

const EVENT_RETRY_LIMIT = 20;
const EVENT_RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const DELIVERY_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
];
const LEASE_MS = 5 * 60 * 1000;

class RetryableStripeEventError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RetryableStripeEventError';
    this.code = code;
  }
}

const objectId = (value) => typeof value === 'string' ? value : value?.id ?? null;
const toIso = (unixSeconds) => Number.isFinite(Number(unixSeconds))
  ? new Date(Number(unixSeconds) * 1000).toISOString()
  : null;
const isUniqueError = (error) => /unique|constraint/i.test(String(error?.message || ''));
const parsePriceIds = (value) => String(value || '')
  .split(',')
  .map((priceId) => priceId.trim())
  .filter(Boolean);
const safeErrorCode = (error) => {
  const value = String(error?.code || error?.type || 'processing_error').toLowerCase();
  return /^[a-z0-9_:-]{1,80}$/.test(value) ? value : 'processing_error';
};

async function collectStripeList(fetchPage) {
  const data = [];
  const cursors = new Set();
  let startingAfter = null;
  while (true) {
    const page = await fetchPage({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const pageData = page?.data || [];
    data.push(...pageData);
    if (!page?.has_more) return data;
    const nextCursor = objectId(pageData.at(-1));
    if (!nextCursor || cursors.has(nextCursor)) {
      throw new RetryableStripeEventError('stripe_pagination_cursor_invalid');
    }
    cursors.add(nextCursor);
    startingAfter = nextCursor;
  }
}

function paymentReferences(invoice) {
  const paidPayment = invoice?.payments?.data?.find((item) => item?.status === 'paid')
    ?? invoice?.payments?.data?.[0]
    ?? null;
  return {
    paymentIntentId: objectId(paidPayment?.payment?.payment_intent ?? invoice?.payment_intent),
    chargeId: objectId(paidPayment?.payment?.charge ?? invoice?.charge),
  };
}

function priceFromSubscription(subscription, config) {
  const matches = (subscription?.items?.data || []).filter((item) => {
    const priceId = objectId(item?.price ?? item?.plan);
    const productId = objectId(item?.price?.product ?? item?.plan?.product);
    return productId === config.subscriptionProductId
      && (planForPrice(priceId, config) === 'monthly' || planForPrice(priceId, config) === 'annual');
  });
  if (matches.length !== 1) return null;
  return objectId(matches[0].price ?? matches[0].plan);
}

function planForPrice(priceId, config) {
  if (priceId === config.monthlyPriceId || config.monthlyHistoricalPriceIds?.includes(priceId)) return 'monthly';
  if (priceId === config.annualPriceId || config.annualHistoricalPriceIds?.includes(priceId)) return 'annual';
  if (priceId === config.lifetimePriceId) return 'lifetime';
  return null;
}

function selectPaidSubscriptionLine(lines, config) {
  const matches = (lines || []).filter((line) => {
    const details = line?.parent?.subscription_item_details;
    const priceId = objectId(line?.pricing?.price_details?.price ?? line?.price);
    const productId = objectId(line?.pricing?.price_details?.product ?? line?.price?.product);
    return line?.parent?.type === 'subscription_item_details'
      && details?.proration === false
      && Number(line?.quantity ?? 1) === 1
      && productId === config.subscriptionProductId
      && (planForPrice(priceId, config) === 'monthly' || planForPrice(priceId, config) === 'annual')
      && Number.isFinite(Number(line?.period?.end));
  });
  if (matches.length !== 1) return null;
  const line = matches[0];
  return {
    priceId: objectId(line.pricing?.price_details?.price ?? line.price),
    periodStart: toIso(line.period?.start),
    periodEnd: toIso(line.period?.end),
  };
}

function stripeLicenseId(license) {
  return license?.id ?? null;
}

export function createStripeBillingConfig(env) {
  return {
    expectedLivemode: String(env.STRIPE_LIVEMODE ?? 'true').toLowerCase() === 'true',
    accountId: String(env.STRIPE_ACCOUNT_ID || ''),
    subscriptionProductId: String(env.STRIPE_SUBSCRIPTION_PRODUCT_ID || ''),
    monthlyPriceId: String(env.STRIPE_MONTHLY_PRICE_ID || ''),
    annualPriceId: String(env.STRIPE_ANNUAL_PRICE_ID || ''),
    monthlyHistoricalPriceIds: parsePriceIds(env.STRIPE_MONTHLY_HISTORICAL_PRICE_IDS),
    annualHistoricalPriceIds: parsePriceIds(env.STRIPE_ANNUAL_HISTORICAL_PRICE_IDS),
    lifetimePriceId: String(env.STRIPE_LIFETIME_PRICE_ID || ''),
    deliveryEncryptionKey: String(env.LICENSE_DELIVERY_ENCRYPTION_KEY || ''),
  };
}

export class StripeBillingService {
  constructor({
    repository,
    licenseService,
    stripeClient,
    deliveryClient,
    config,
    cryptoApi = globalThis.crypto,
    now = () => new Date(),
  }) {
    this.repository = repository;
    this.licenseService = licenseService;
    this.stripeClient = stripeClient;
    this.deliveryClient = deliveryClient;
    this.config = config;
    this.cryptoApi = cryptoApi;
    this.now = now;
  }

  nowDate() {
    const value = this.now();
    return value instanceof Date ? value : new Date(value);
  }

  async enqueueVerifiedEvent(event) {
    if (!SUPPORTED_STRIPE_EVENTS.has(event?.type)) return { accepted: false, duplicate: false };
    if (!event?.id || !event?.data?.object?.id || !Number.isFinite(Number(event.created))) {
      throw new Error('Invalid Stripe event envelope.');
    }
    if (Boolean(event.livemode) !== this.config.expectedLivemode) {
      throw new Error('Stripe event livemode does not match this environment.');
    }
    const eventAccountId = event.account
      ?? (String(event.context || '').startsWith('acct_') ? event.context : null);
    if (eventAccountId && eventAccountId !== this.config.accountId) {
      throw new Error('Stripe event account does not match this environment.');
    }
    const receivedAt = this.nowDate().toISOString();
    const inserted = await this.repository.enqueueEvent({
      eventId: event.id,
      eventType: event.type,
      objectId: event.data.object.id,
      livemode: Boolean(event.livemode),
      eventCreatedAt: Number(event.created),
      receivedAt,
    });
    return { accepted: true, duplicate: !inserted };
  }

  async resolveCustomerEmail(customerValue, preferredEmail) {
    const preferred = String(preferredEmail || '').trim().toLowerCase();
    if (preferred) return preferred;
    if (customerValue && typeof customerValue === 'object' && !customerValue.deleted) {
      const expanded = String(customerValue.email || '').trim().toLowerCase();
      if (expanded) return expanded;
    }
    const customerId = objectId(customerValue);
    if (!customerId) throw new RetryableStripeEventError('stripe_customer_email_missing');
    const customer = await this.stripeClient.customers.retrieve(customerId);
    const email = String(!customer?.deleted ? customer?.email || '' : '').trim().toLowerCase();
    if (!email) throw new RetryableStripeEventError('stripe_customer_email_missing');
    return email;
  }

  subscriptionRecord(subscription, event, now, overrides = {}) {
    return {
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: objectId(subscription.customer),
      stripeCheckoutSessionId: overrides.stripeCheckoutSessionId ?? null,
      licenseId: overrides.licenseId ?? null,
      billingStatus: String(subscription.status || 'unknown'),
      stripePriceId: overrides.stripePriceId ?? priceFromSubscription(subscription, this.config),
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      paidThrough: overrides.paidThrough ?? null,
      latestPaidEventCreatedAt: overrides.latestPaidEventCreatedAt ?? null,
      endedAt: toIso(subscription.ended_at),
      lastEventCreatedAt: event.eventCreatedAt,
      createdAt: now,
      updatedAt: now,
    };
  }

  invoiceRecord(invoice, event, now, overrides = {}) {
    const references = paymentReferences(invoice);
    return {
      stripeInvoiceId: invoice.id,
      stripeSubscriptionId: overrides.stripeSubscriptionId,
      licenseId: overrides.licenseId ?? null,
      stripePriceId: overrides.stripePriceId ?? null,
      stripePaymentIntentId: references.paymentIntentId,
      stripeChargeId: references.chargeId,
      invoiceStatus: String(invoice.status || event.eventType.replace('invoice.', '')),
      periodStart: overrides.periodStart ?? null,
      periodEnd: overrides.periodEnd ?? null,
      amountPaid: Number.isFinite(Number(invoice.amount_paid)) ? Number(invoice.amount_paid) : null,
      currency: invoice.currency ?? null,
      paidEventCreatedAt: event.eventType === 'invoice.paid' ? event.eventCreatedAt : null,
      lastEventCreatedAt: event.eventCreatedAt,
      createdAt: now,
      updatedAt: now,
    };
  }

  paymentRecord({ licenseId, checkoutSessionId = null, invoice = null, now }) {
    const references = invoice ? paymentReferences(invoice) : {
      paymentIntentId: null,
      chargeId: null,
    };
    const paymentIntentId = references.paymentIntentId;
    const chargeId = references.chargeId;
    const invoiceId = invoice?.id ?? null;
    const reference = paymentIntentId || chargeId || checkoutSessionId || invoiceId;
    if (!reference) throw new RetryableStripeEventError('stripe_payment_reference_missing');
    return {
      paymentReference: reference,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: chargeId,
      stripeCheckoutSessionId: checkoutSessionId,
      stripeInvoiceId: invoiceId,
      licenseId,
      amountPaid: invoice ? Number(invoice.amount_paid ?? 0) : null,
      currency: invoice?.currency ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async createDeliveryBundle({ email, plan, expiresAt, licenseKey, licenseId, now }) {
    const id = this.cryptoApi.randomUUID();
    const encryptedPayload = await encryptDeliveryPayload({
      email, plan, expiresAt, licenseKey,
    }, this.config.deliveryEncryptionKey, this.cryptoApi);
    return {
      id,
      licenseId,
      encryptedPayload,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  async handleCheckout(event) {
    const now = this.nowDate().toISOString();
    const session = await this.stripeClient.checkout.sessions.retrieve(event.objectId, {
      expand: ['customer', 'subscription'],
    });
    if (Boolean(session.livemode) !== this.config.expectedLivemode) return;
    if (session.mode === 'subscription') {
      const subscriptionId = objectId(session.subscription);
      if (!subscriptionId) return;
      const subscription = typeof session.subscription === 'object'
        ? session.subscription
        : await this.stripeClient.subscriptions.retrieve(subscriptionId);
      const priceId = priceFromSubscription(subscription, this.config);
      if (!priceId) return;
      await this.repository.upsertSubscription(this.subscriptionRecord(subscription, event, now, {
        stripeCheckoutSessionId: session.id,
        stripePriceId: priceId,
      }));
      await this.repository.linkCheckoutToSubscription(subscriptionId, session.id, event.eventCreatedAt, now);
      return;
    }
    if (session.mode !== 'payment') return;
    if (event.eventType === 'checkout.session.async_payment_failed') return;
    if (session.payment_status !== 'paid') return;

    const lineItems = await collectStripeList(
      (params) => this.stripeClient.checkout.sessions.listLineItems(session.id, params),
    );
    const matches = lineItems.filter((line) => {
      const priceId = objectId(line.price);
      const productId = objectId(line.price?.product);
      return priceId === this.config.lifetimePriceId
        && productId === this.config.subscriptionProductId
        && Number(line.quantity ?? 1) === 1;
    });
    if (matches.length !== 1) return;
    const existing = await this.repository.findLicenseByCheckoutSessionId(session.id);
    if (existing) return;

    const email = await this.resolveCustomerEmail(session.customer, session.customer_details?.email ?? session.customer_email);
    const prepared = await this.licenseService.prepareLicense({
      email,
      plan: 'lifetime',
      status: 'active',
      source: 'stripe',
      stripeCustomerId: objectId(session.customer),
      stripePriceId: this.config.lifetimePriceId,
      stripeCheckoutSessionId: session.id,
      externalReference: objectId(session.payment_intent) ?? session.id,
    });
    const delivery = await this.createDeliveryBundle({
      email,
      plan: 'lifetime',
      expiresAt: null,
      licenseKey: prepared.licenseKey,
      licenseId: prepared.license.id,
      now,
    });
    const payment = {
      paymentReference: objectId(session.payment_intent) ?? session.id,
      stripePaymentIntentId: objectId(session.payment_intent),
      stripeChargeId: null,
      stripeCheckoutSessionId: session.id,
      stripeInvoiceId: null,
      licenseId: prepared.license.id,
      amountPaid: Number.isFinite(Number(session.amount_total)) ? Number(session.amount_total) : null,
      currency: session.currency ?? null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.repository.createStripeLicenseBundle({
        license: prepared.license,
        subscription: null,
        invoice: null,
        payment,
        delivery,
      });
    } catch (error) {
      if (!isUniqueError(error) || !await this.repository.findLicenseByCheckoutSessionId(session.id)) throw error;
    }
  }

  async handleSubscription(event) {
    const now = this.nowDate().toISOString();
    const subscription = await this.stripeClient.subscriptions.retrieve(event.objectId);
    const priceId = priceFromSubscription(subscription, this.config);
    if (!priceId) return;
    await this.repository.upsertSubscription(this.subscriptionRecord(subscription, event, now, { stripePriceId: priceId }));
    if (event.eventType === 'customer.subscription.deleted') {
      await this.repository.terminateSubscription(subscription.id, event.eventCreatedAt, now);
    }
  }

  async handleInvoice(event) {
    const now = this.nowDate().toISOString();
    const invoice = await this.stripeClient.invoices.retrieve(event.objectId, {
      expand: ['customer', 'payments.data.payment.payment_intent'],
    });
    const subscriptionId = objectId(invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription);
    if (!subscriptionId) return;
    const subscription = await this.stripeClient.subscriptions.retrieve(subscriptionId);
    const subscriptionPrice = priceFromSubscription(subscription, this.config);
    if (!subscriptionPrice) return;

    if (event.eventType !== 'invoice.paid') {
      const existingLicense = await this.repository.findLicenseBySubscriptionId(subscriptionId);
      await this.repository.upsertSubscription(this.subscriptionRecord(subscription, event, now, {
        stripePriceId: subscriptionPrice,
        licenseId: stripeLicenseId(existingLicense),
      }));
      await this.repository.recordInvoice(this.invoiceRecord(invoice, event, now, {
        stripeSubscriptionId: subscriptionId,
        licenseId: stripeLicenseId(existingLicense),
      }));
      return;
    }
    if (invoice.status !== 'paid') throw new RetryableStripeEventError('stripe_invoice_not_paid');

    const lineItems = await collectStripeList(
      (params) => this.stripeClient.invoices.listLineItems(invoice.id, params),
    );
    const paidLine = selectPaidSubscriptionLine(lineItems, this.config);
    if (!paidLine) throw new RetryableStripeEventError('stripe_invoice_line_ambiguous');
    const plan = planForPrice(paidLine.priceId, this.config);
    if (!plan || plan === 'lifetime') throw new RetryableStripeEventError('stripe_invoice_price_invalid');
    const expiresAt = paidLine.periodEnd;
    if (!expiresAt) throw new RetryableStripeEventError('stripe_invoice_period_missing');

    const existing = await this.repository.findLicenseBySubscriptionId(subscriptionId);
    const billingMirror = await this.repository.findSubscription(subscriptionId);
    const blockingTerminationExists = billingMirror?.billingStatus === 'canceled'
      && billingMirror.lastEventCreatedAt >= event.eventCreatedAt;
    const subscriptionRecord = this.subscriptionRecord(subscription, event, now, {
      licenseId: stripeLicenseId(existing),
      stripePriceId: paidLine.priceId,
      paidThrough: expiresAt,
      latestPaidEventCreatedAt: event.eventCreatedAt,
    });
    const invoiceRecord = this.invoiceRecord(invoice, event, now, {
      stripeSubscriptionId: subscriptionId,
      licenseId: stripeLicenseId(existing),
      stripePriceId: paidLine.priceId,
      periodStart: paidLine.periodStart,
      periodEnd: expiresAt,
    });

    if (existing) {
      const payment = this.paymentRecord({ licenseId: existing.id, invoice, now });
      await this.repository.recordPaidRenewal({
        licenseId: existing.id,
        plan,
        expiresAt,
        priceId: paidLine.priceId,
        now,
        subscription: subscriptionRecord,
        invoice: invoiceRecord,
        payment,
      });
      return;
    }

    if (blockingTerminationExists) {
      await this.repository.recordInvoice(invoiceRecord);
      return;
    }

    let checkoutSessionId = null;
    const checkoutSessions = await this.stripeClient.checkout.sessions.list({ subscription: subscriptionId, limit: 1 });
    const checkoutSession = checkoutSessions.data?.[0] ?? null;
    if (checkoutSession) checkoutSessionId = checkoutSession.id;
    const email = await this.resolveCustomerEmail(
      checkoutSession?.customer ?? invoice.customer ?? subscription.customer,
      checkoutSession?.customer_details?.email ?? invoice.customer_email,
    );
    const prepared = await this.licenseService.prepareLicense({
      email,
      plan,
      status: 'active',
      source: 'stripe',
      expiresAt,
      stripeCustomerId: objectId(subscription.customer),
      stripeSubscriptionId: subscriptionId,
      stripePriceId: paidLine.priceId,
      stripeCheckoutSessionId: checkoutSessionId,
      externalReference: invoice.id,
    });
    subscriptionRecord.licenseId = prepared.license.id;
    subscriptionRecord.stripeCheckoutSessionId = checkoutSessionId;
    invoiceRecord.licenseId = prepared.license.id;
    const payment = this.paymentRecord({ licenseId: prepared.license.id, invoice, now });
    const delivery = await this.createDeliveryBundle({
      email,
      plan,
      expiresAt,
      licenseKey: prepared.licenseKey,
      licenseId: prepared.license.id,
      now,
    });
    try {
      await this.repository.createStripeLicenseBundle({
        license: prepared.license,
        subscription: subscriptionRecord,
        invoice: invoiceRecord,
        payment,
        delivery,
      });
    } catch (error) {
      const winner = isUniqueError(error)
        ? await this.repository.findLicenseBySubscriptionId(subscriptionId)
        : null;
      if (!winner) throw error;
      await this.repository.recordPaidRenewal({
        licenseId: winner.id,
        plan,
        expiresAt,
        priceId: paidLine.priceId,
        now,
        subscription: { ...subscriptionRecord, licenseId: winner.id },
        invoice: { ...invoiceRecord, licenseId: winner.id },
        payment: this.paymentRecord({ licenseId: winner.id, invoice, now }),
      });
    }
  }

  async handleRefund(event) {
    const now = this.nowDate().toISOString();
    const refund = await this.stripeClient.refunds.retrieve(event.objectId);
    const chargeId = objectId(refund.charge);
    const paymentIntentId = objectId(refund.payment_intent);
    const payment = await this.repository.findPayment({ paymentIntentId, chargeId });
    if (!payment && event.eventType !== 'refund.failed' && refund.status !== 'failed') {
      throw new RetryableStripeEventError('stripe_refund_payment_unresolved');
    }
    let charge = null;
    if (chargeId) charge = await this.stripeClient.charges.retrieve(chargeId);
    const isFullRefund = refund.status === 'succeeded'
      && charge
      && Number(charge.amount_refunded) >= Number(charge.amount);
    await this.repository.recordRefund({
      stripeRefundId: refund.id,
      paymentReference: payment?.paymentReference ?? null,
      licenseId: payment?.licenseId ?? null,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: chargeId,
      refundStatus: String(refund.status || (event.eventType === 'refund.failed' ? 'failed' : 'unknown')),
      amount: Number(refund.amount || 0),
      currency: refund.currency ?? null,
      isFullRefund,
      eventCreatedAt: event.eventCreatedAt,
      createdAt: now,
      updatedAt: now,
    });
    if (event.eventType === 'refund.failed' || refund.status === 'failed') return;
    if (refund.status === 'pending' || refund.status === 'requires_action') {
      throw new RetryableStripeEventError('stripe_refund_pending');
    }
    if (!isFullRefund || !payment?.licenseId) return;
    const license = await this.repository.findLicenseById(payment.licenseId);
    if (!license) return;
    const plan = license.plan;
    let refundedPeriodEnd = null;
    if (plan !== 'lifetime' && payment.stripeInvoiceId) {
      const invoice = await this.repository.findInvoice(payment.stripeInvoiceId);
      refundedPeriodEnd = invoice?.periodEnd ?? null;
      if (!refundedPeriodEnd) throw new RetryableStripeEventError('stripe_refund_invoice_unresolved');
    }
    await this.repository.revokeRefundedLicense({
      licenseId: payment.licenseId,
      recurring: plan !== 'lifetime',
      refundedPeriodEnd,
      now,
    });
  }

  async processEvent(event) {
    if (event.eventType.startsWith('checkout.session.')) return this.handleCheckout(event);
    if (event.eventType.startsWith('customer.subscription.')) return this.handleSubscription(event);
    if (event.eventType.startsWith('invoice.')) return this.handleInvoice(event);
    if (event.eventType.startsWith('refund.')) return this.handleRefund(event);
  }

  async processEventInbox(limit = 25) {
    const now = this.nowDate();
    const leaseToken = this.cryptoApi.randomUUID();
    const events = await this.repository.claimEvents({
      now: now.toISOString(),
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS).toISOString(),
      limit,
    });
    for (const event of events) {
      try {
        await this.processEvent(event);
        await this.repository.markEventProcessed(event.eventId, leaseToken, this.nowDate().toISOString());
      } catch (error) {
        const attempts = event.attempts + 1;
        const retryable = error instanceof RetryableStripeEventError
          || error?.type === 'StripeConnectionError'
          || error?.statusCode === 429
          || Number(error?.statusCode) >= 500;
        const deadLetter = !retryable || attempts >= EVENT_RETRY_LIMIT;
        const delay = Math.min(60_000 * (2 ** Math.min(attempts - 1, 8)), EVENT_RETRY_MAX_MS);
        await this.repository.rescheduleEvent(event.eventId, leaseToken, {
          attempts,
          nextAttemptAt: new Date(this.nowDate().getTime() + delay).toISOString(),
          errorCode: safeErrorCode(error),
          deadLetter,
        });
      }
    }
    return events.length;
  }

  async processDeliveryOutbox(limit = 25) {
    const now = this.nowDate();
    const leaseToken = this.cryptoApi.randomUUID();
    const deliveries = await this.repository.claimDeliveries({
      now: now.toISOString(),
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS).toISOString(),
      limit,
    });
    for (const delivery of deliveries) {
      let result;
      try {
        const payload = await decryptDeliveryPayload(
          delivery.encryptedPayload,
          this.config.deliveryEncryptionKey,
          this.cryptoApi,
        );
        const authorized = await this.repository.authorizeDeliverySend(
          delivery.id, leaseToken, this.nowDate().toISOString(),
        );
        result = authorized
          ? await this.deliveryClient.sendLicense({ outboxId: delivery.id, ...payload })
          : { ok: false, cancelled: true };
      } catch (error) {
        result = { ok: false, retryable: false, code: safeErrorCode(error) };
      }
      if (result.cancelled) continue;
      if (result.ok) {
        await this.repository.markDeliveryDelivered(
          delivery.id, leaseToken, result.messageId, this.nowDate().toISOString(),
        );
        continue;
      }
      const attempts = delivery.attempts + 1;
      const retryDelay = DELIVERY_RETRY_DELAYS_MS[attempts - 1];
      const deadLetter = !result.retryable || retryDelay === undefined;
      await this.repository.rescheduleDelivery(delivery.id, leaseToken, {
        attempts,
        nextAttemptAt: new Date(this.nowDate().getTime() + (retryDelay ?? 0)).toISOString(),
        errorCode: safeErrorCode({ code: result.code }),
        deadLetter,
        now: this.nowDate().toISOString(),
      });
    }
    return deliveries.length;
  }

  async processQueues() {
    await this.processEventInbox();
    await this.processDeliveryOutbox();
  }
}

export { RetryableStripeEventError, selectPaidSubscriptionLine };
