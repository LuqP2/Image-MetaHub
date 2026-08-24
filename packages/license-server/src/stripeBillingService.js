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
  'charge.refunded',
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
const DELIVERY_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;

class RetryableStripeEventError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RetryableStripeEventError';
    this.code = code;
  }
}

class PermanentStripeEventError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PermanentStripeEventError';
    this.code = code;
  }
}

class PermanentDeliveryPayloadError extends Error {
  constructor(cause) {
    super('delivery_payload_invalid', { cause });
    this.name = 'PermanentDeliveryPayloadError';
    this.code = 'delivery_payload_invalid';
  }
}

const objectId = (value) => typeof value === 'string' ? value : value?.id ?? null;
const toIso = (unixSeconds) => Number.isFinite(Number(unixSeconds))
  ? new Date(Number(unixSeconds) * 1000).toISOString()
  : null;
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

function planForPrice(priceId, config) {
  if (priceId === config.monthlyPriceId || config.monthlyHistoricalPriceIds.includes(priceId)) return 'monthly';
  if (priceId === config.annualPriceId || config.annualHistoricalPriceIds.includes(priceId)) return 'annual';
  if (priceId === config.lifetimePriceId) return 'lifetime';
  return null;
}

function subscriptionProductItems(subscription, config) {
  return (subscription?.items?.data || []).filter((item) => {
    const productId = objectId(item?.price?.product ?? item?.plan?.product);
    return productId === config.subscriptionProductId;
  });
}

function priceFromSubscription(subscription, config) {
  const productItems = subscriptionProductItems(subscription, config);
  const matches = productItems.filter((item) => {
    const plan = planForPrice(objectId(item?.price ?? item?.plan), config);
    return plan === 'monthly' || plan === 'annual';
  });
  if (productItems.length && !matches.length) {
    throw new PermanentStripeEventError('stripe_subscription_price_unmapped');
  }
  if (matches.length !== 1) return null;
  return objectId(matches[0].price ?? matches[0].plan);
}

function selectPaidSubscriptionLine(lines, config) {
  const productLines = (lines || []).filter((line) => {
    const productId = objectId(line?.pricing?.price_details?.product ?? line?.price?.product);
    return productId === config.subscriptionProductId;
  });
  const matches = productLines.filter((line) => {
    const details = line?.parent?.subscription_item_details;
    const priceId = objectId(line?.pricing?.price_details?.price ?? line?.price);
    const plan = planForPrice(priceId, config);
    return line?.parent?.type === 'subscription_item_details'
      && details?.proration === false
      && Number(line?.quantity ?? 1) === 1
      && (plan === 'monthly' || plan === 'annual')
      && Number.isFinite(Number(line?.period?.start))
      && Number.isFinite(Number(line?.period?.end));
  });
  if (productLines.length && !matches.length) {
    throw new PermanentStripeEventError('stripe_invoice_price_unmapped');
  }
  if (matches.length !== 1) return null;
  const line = matches[0];
  const priceId = objectId(line.pricing?.price_details?.price ?? line.price);
  return {
    priceId,
    plan: planForPrice(priceId, config),
    periodStart: toIso(line.period.start),
    periodEnd: toIso(line.period.end),
  };
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

  async prepareCandidateLicense({
    email,
    plan,
    expiresAt,
    stripeCustomerId,
    stripeSubscriptionId = null,
    stripePriceId,
    stripeCheckoutSessionId = null,
    externalReference,
    now,
  }) {
    const prepared = await this.licenseService.prepareLicense({
      email,
      plan,
      status: 'active',
      source: 'stripe',
      expiresAt,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId,
      stripeCheckoutSessionId,
      externalReference,
    });
    const deliveryId = this.cryptoApi.randomUUID();
    const encryptedPayload = await encryptDeliveryPayload({
      email,
      plan,
      expiresAt,
      licenseKey: prepared.licenseKey,
    }, this.config.deliveryEncryptionKey, this.cryptoApi);
    return {
      candidateLicense: prepared.license,
      delivery: {
        id: deliveryId,
        licenseId: prepared.license.id,
        encryptedPayload,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  subscriptionCommand(subscription, event, recordedAt, priceId) {
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      stripeSubscriptionId: subscription.id,
      billingStatus: String(subscription.status || 'unknown'),
      stripePriceId: priceId,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      eventCreatedAt: event.eventCreatedAt,
      recordedAt,
    };
  }

  async handleCheckout(event) {
    const now = this.nowDate().toISOString();
    const session = await this.stripeClient.checkout.sessions.retrieve(event.objectId, {
      expand: ['customer', 'subscription'],
    });
    if (Boolean(session.livemode) !== this.config.expectedLivemode) return;
    if (session.mode === 'subscription') return;
    if (session.mode !== 'payment' || event.eventType === 'checkout.session.async_payment_failed') return;
    if (session.payment_status !== 'paid') return;

    const lineItems = await collectStripeList(
      (params) => this.stripeClient.checkout.sessions.listLineItems(session.id, params),
    );
    const matches = lineItems.filter((line) => (
      objectId(line.price) === this.config.lifetimePriceId
      && Number(line.quantity ?? 1) === 1
    ));
    if (matches.length !== 1) return;

    const email = await this.resolveCustomerEmail(
      session.customer,
      session.customer_details?.email ?? session.customer_email,
    );
    const prepared = await this.prepareCandidateLicense({
      email,
      plan: 'lifetime',
      expiresAt: null,
      stripeCustomerId: objectId(session.customer),
      stripePriceId: this.config.lifetimePriceId,
      stripeCheckoutSessionId: session.id,
      externalReference: objectId(session.payment_intent) ?? session.id,
      now,
    });
    const paymentIntentId = objectId(session.payment_intent);
    await this.repository.applyLifetimePayment({
      payment: {
        paymentReference: paymentIntentId ?? session.id,
        paymentKind: 'lifetime',
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: null,
        stripeCheckoutSessionId: session.id,
        stripeInvoiceId: null,
        stripeSubscriptionId: null,
        amountPaid: Number.isFinite(Number(session.amount_total)) ? Number(session.amount_total) : null,
        currency: session.currency ?? null,
        eventId: event.eventId,
        eventCreatedAt: event.eventCreatedAt,
        createdAt: now,
        updatedAt: now,
      },
      ...prepared,
      now,
    });
  }

  async handleSubscription(event) {
    const now = this.nowDate().toISOString();
    const subscription = await this.stripeClient.subscriptions.retrieve(event.objectId);
    const priceId = priceFromSubscription(subscription, this.config);
    if (!priceId) return;
    const command = this.subscriptionCommand(subscription, event, now, priceId);
    if (event.eventType === 'customer.subscription.deleted') {
      await this.repository.applySubscriptionDeleted(command);
    } else {
      await this.repository.recordSubscriptionSnapshot(command);
    }
  }

  async handleInvoice(event) {
    if (event.eventType !== 'invoice.paid') return;
    const now = this.nowDate().toISOString();
    const invoice = await this.stripeClient.invoices.retrieve(event.objectId, {
      expand: ['customer', 'payments.data.payment.payment_intent'],
    });
    if (invoice.status !== 'paid') throw new RetryableStripeEventError('stripe_invoice_not_paid');
    const subscriptionId = objectId(
      invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription,
    );
    if (!subscriptionId) return;
    const subscription = await this.stripeClient.subscriptions.retrieve(subscriptionId);
    const subscriptionPrice = priceFromSubscription(subscription, this.config);
    if (!subscriptionPrice) return;
    const lineItems = await collectStripeList(
      (params) => this.stripeClient.invoices.listLineItems(invoice.id, params),
    );
    const paidLine = selectPaidSubscriptionLine(lineItems, this.config);
    if (!paidLine) throw new PermanentStripeEventError('stripe_invoice_line_ambiguous');
    const references = paymentReferences(invoice);
    const paymentReference = references.paymentIntentId || references.chargeId || invoice.id;
    const checkoutSessions = await this.stripeClient.checkout.sessions.list({
      subscription: subscriptionId,
      limit: 1,
    });
    const checkoutSession = checkoutSessions.data?.[0] ?? null;
    const checkoutSessionId = checkoutSession?.id ?? null;
    const paymentCheckoutSessionId = invoice.billing_reason === 'subscription_create'
      ? checkoutSessionId
      : null;
    const email = await this.resolveCustomerEmail(
      checkoutSession?.customer ?? invoice.customer ?? subscription.customer,
      checkoutSession?.customer_details?.email ?? invoice.customer_email,
    );
    const prepared = await this.prepareCandidateLicense({
      email,
      plan: paidLine.plan,
      expiresAt: paidLine.periodEnd,
      stripeCustomerId: objectId(subscription.customer),
      stripeSubscriptionId: subscriptionId,
      stripePriceId: paidLine.priceId,
      stripeCheckoutSessionId: checkoutSessionId,
      externalReference: invoice.id,
      now,
    });
    await this.repository.applyPaidInvoice({
      invoice: {
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: subscriptionId,
        stripePriceId: paidLine.priceId,
        plan: paidLine.plan,
        stripePaymentIntentId: references.paymentIntentId,
        stripeChargeId: references.chargeId,
        periodStart: paidLine.periodStart,
        periodEnd: paidLine.periodEnd,
        amountPaid: Number.isFinite(Number(invoice.amount_paid)) ? Number(invoice.amount_paid) : null,
        currency: invoice.currency ?? null,
        eventId: event.eventId,
        eventCreatedAt: event.eventCreatedAt,
        createdAt: now,
        updatedAt: now,
      },
      payment: {
        paymentReference,
        paymentKind: 'subscription',
        stripePaymentIntentId: references.paymentIntentId,
        stripeChargeId: references.chargeId,
        stripeCheckoutSessionId: paymentCheckoutSessionId,
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: subscriptionId,
        amountPaid: Number.isFinite(Number(invoice.amount_paid)) ? Number(invoice.amount_paid) : null,
        currency: invoice.currency ?? null,
        eventId: event.eventId,
        eventCreatedAt: event.eventCreatedAt,
        createdAt: now,
        updatedAt: now,
      },
      ...prepared,
      now,
    });
  }

  async handleRefund(event) {
    const now = this.nowDate().toISOString();
    if (event.eventType === 'charge.refunded') {
      const charge = await this.stripeClient.charges.retrieve(event.objectId);
      const fullyRefunded = Number(charge.amount) > 0
        && Number(charge.amount_refunded) >= Number(charge.amount);
      await this.repository.applyRefundSnapshot({
        factId: `charge:${charge.id}`,
        stripeRefundId: null,
        stripePaymentIntentId: objectId(charge.payment_intent),
        stripeChargeId: charge.id,
        refundStatus: fullyRefunded ? 'succeeded' : 'partial',
        amount: Number(charge.amount_refunded || 0),
        currency: charge.currency ?? null,
        paymentFullyRefunded: fullyRefunded,
        eventId: event.eventId,
        eventCreatedAt: event.eventCreatedAt,
        createdAt: now,
        updatedAt: now,
      });
      return;
    }

    const refund = await this.stripeClient.refunds.retrieve(event.objectId);
    const chargeId = objectId(refund.charge);
    const paymentIntentId = objectId(refund.payment_intent);
    const charge = chargeId
      ? await this.stripeClient.charges.retrieve(chargeId)
      : null;
    const succeeded = refund.status === 'succeeded';
    const fullyRefunded = succeeded
      && charge
      && Number(charge.amount) > 0
      && Number(charge.amount_refunded) >= Number(charge.amount);
    await this.repository.applyRefundSnapshot({
      factId: `refund:${refund.id}`,
      stripeRefundId: refund.id,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: chargeId,
      refundStatus: String(refund.status || event.eventType.replace('refund.', '')),
      amount: Number(refund.amount || 0),
      currency: refund.currency ?? null,
      paymentFullyRefunded: fullyRefunded,
      eventId: event.eventId,
      eventCreatedAt: event.eventCreatedAt,
      createdAt: now,
      updatedAt: now,
    });
  }

  async processEvent(event) {
    if (event.eventType.startsWith('checkout.session.')) return this.handleCheckout(event);
    if (event.eventType.startsWith('customer.subscription.')) return this.handleSubscription(event);
    if (event.eventType.startsWith('invoice.')) return this.handleInvoice(event);
    if (event.eventType.startsWith('refund.') || event.eventType === 'charge.refunded') {
      return this.handleRefund(event);
    }
    return undefined;
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
        await this.repository.markEventProcessed(
          event.eventId,
          leaseToken,
          this.nowDate().toISOString(),
        );
      } catch (error) {
        const attempts = event.attempts + 1;
        const permanent = error instanceof PermanentStripeEventError;
        const deadLetter = permanent || attempts >= EVENT_RETRY_LIMIT;
        const delay = Math.min(
          60_000 * (2 ** Math.min(attempts - 1, 8)),
          EVENT_RETRY_MAX_MS,
        );
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
      const providerAttemptAt = delivery.firstProviderAttemptAt
        ? Date.parse(delivery.firstProviderAttemptAt)
        : null;
      if (
        delivery.status === 'authorized'
        && Number.isFinite(providerAttemptAt)
        && this.nowDate().getTime() >= providerAttemptAt + DELIVERY_IDEMPOTENCY_WINDOW_MS
      ) {
        await this.repository.markDeliveryManualReview(
          delivery.id,
          leaseToken,
          'resend_idempotency_window_expired',
          this.nowDate().toISOString(),
        );
        continue;
      }
      let payload;
      let result;
      try {
        try {
          payload = await decryptDeliveryPayload(
            delivery.encryptedPayload,
            this.config.deliveryEncryptionKey,
            this.cryptoApi,
          );
        } catch (error) {
          throw new PermanentDeliveryPayloadError(error);
        }
        const authorized = await this.repository.authorizeDeliverySend(
          delivery.id,
          leaseToken,
          this.nowDate().toISOString(),
        );
        result = authorized
          ? await this.deliveryClient.sendLicense({ outboxId: delivery.id, ...payload })
          : { ok: false, cancelled: true };
      } catch (error) {
        result = {
          ok: false,
          retryable: !(error instanceof PermanentDeliveryPayloadError),
          code: safeErrorCode(error),
          beforeProvider: error instanceof PermanentDeliveryPayloadError,
        };
      }
      if (result.cancelled) continue;
      if (result.ok) {
        await this.repository.markDeliveryDelivered(
          delivery.id,
          leaseToken,
          result.messageId,
          this.nowDate().toISOString(),
        );
        continue;
      }

      const attempts = delivery.attempts + 1;
      const retryDelay = DELIVERY_RETRY_DELAYS_MS[attempts - 1];
      const attemptStartedAt = delivery.firstProviderAttemptAt
        ? Date.parse(delivery.firstProviderAttemptAt)
        : this.nowDate().getTime();
      const nextAttemptMs = this.nowDate().getTime() + (retryDelay ?? 0);
      const outsideIdempotencyWindow = nextAttemptMs
        >= attemptStartedAt + DELIVERY_IDEMPOTENCY_WINDOW_MS;
      const terminalAfterProvider = !result.beforeProvider
        && (!result.retryable || retryDelay === undefined || outsideIdempotencyWindow);
      await this.repository.rescheduleDelivery(delivery.id, leaseToken, {
        attempts,
        nextAttemptAt: new Date(nextAttemptMs).toISOString(),
        errorCode: safeErrorCode({ code: result.code }),
        deadLetter: Boolean(result.beforeProvider && !result.retryable),
        manualReview: terminalAfterProvider,
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

export {
  collectStripeList,
  PermanentStripeEventError,
  RetryableStripeEventError,
  selectPaidSubscriptionLine,
};
