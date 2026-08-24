const mapEvent = (row) => row && ({
  eventId: row.event_id,
  eventType: row.event_type,
  objectId: row.object_id,
  livemode: Boolean(row.livemode),
  eventCreatedAt: row.event_created_at,
  status: row.status,
  attempts: row.attempts,
});

const mapSubscription = (row) => row && ({
  stripeSubscriptionId: row.stripe_subscription_id,
  stripeCustomerId: row.stripe_customer_id,
  stripeCheckoutSessionId: row.stripe_checkout_session_id,
  licenseId: row.license_id,
  billingStatus: row.billing_status,
  stripePriceId: row.stripe_price_id,
  cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
  paidThrough: row.paid_through,
  latestPaidEventCreatedAt: row.latest_paid_event_created_at,
  endedAt: row.ended_at,
  lastEventCreatedAt: row.last_event_created_at,
});

const mapInvoice = (row) => row && ({
  stripeInvoiceId: row.stripe_invoice_id,
  stripeSubscriptionId: row.stripe_subscription_id,
  licenseId: row.license_id,
  stripePriceId: row.stripe_price_id,
  stripePaymentIntentId: row.stripe_payment_intent_id,
  stripeChargeId: row.stripe_charge_id,
  invoiceStatus: row.invoice_status,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  paidEventCreatedAt: row.paid_event_created_at,
});

const mapPayment = (row) => row && ({
  paymentReference: row.payment_reference,
  stripePaymentIntentId: row.stripe_payment_intent_id,
  stripeChargeId: row.stripe_charge_id,
  stripeCheckoutSessionId: row.stripe_checkout_session_id,
  stripeInvoiceId: row.stripe_invoice_id,
  licenseId: row.license_id,
  amountPaid: row.amount_paid,
  currency: row.currency,
});

const mapDelivery = (row) => row && ({
  id: row.id,
  licenseId: row.license_id,
  encryptedPayload: row.encrypted_payload,
  status: row.status,
  attempts: row.attempts,
});

const licenseInsert = (database, record) => database.prepare(`
  INSERT INTO licenses (
    id, key_hash, email_lookup, plan, status, source, created_at, updated_at,
    expires_at, max_activations, stripe_customer_id, stripe_subscription_id,
    stripe_price_id, stripe_checkout_session_id, external_reference
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).bind(
  record.id, record.keyHash, record.emailLookup, record.plan, record.status, record.source,
  record.createdAt, record.updatedAt, record.expiresAt, record.maxActivations,
  record.stripeCustomerId, record.stripeSubscriptionId, record.stripePriceId,
  record.stripeCheckoutSessionId, record.externalReference,
);

const subscriptionUpsert = (database, record) => database.prepare(`
  INSERT INTO stripe_subscriptions (
    stripe_subscription_id, stripe_customer_id, stripe_checkout_session_id, license_id,
    billing_status, stripe_price_id, cancel_at_period_end, paid_through,
    latest_paid_event_created_at, ended_at, last_event_created_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(stripe_subscription_id) DO UPDATE SET
    stripe_customer_id = COALESCE(excluded.stripe_customer_id, stripe_subscriptions.stripe_customer_id),
    stripe_checkout_session_id = COALESCE(stripe_subscriptions.stripe_checkout_session_id, excluded.stripe_checkout_session_id),
    license_id = COALESCE(stripe_subscriptions.license_id, excluded.license_id),
    billing_status = CASE WHEN excluded.last_event_created_at >= stripe_subscriptions.last_event_created_at THEN excluded.billing_status ELSE stripe_subscriptions.billing_status END,
    stripe_price_id = CASE WHEN excluded.last_event_created_at >= stripe_subscriptions.last_event_created_at THEN COALESCE(excluded.stripe_price_id, stripe_subscriptions.stripe_price_id) ELSE stripe_subscriptions.stripe_price_id END,
    cancel_at_period_end = CASE WHEN excluded.last_event_created_at >= stripe_subscriptions.last_event_created_at THEN excluded.cancel_at_period_end ELSE stripe_subscriptions.cancel_at_period_end END,
    paid_through = CASE
      WHEN excluded.paid_through IS NULL THEN stripe_subscriptions.paid_through
      WHEN stripe_subscriptions.paid_through IS NULL OR excluded.paid_through > stripe_subscriptions.paid_through THEN excluded.paid_through
      ELSE stripe_subscriptions.paid_through END,
    latest_paid_event_created_at = CASE
      WHEN excluded.latest_paid_event_created_at IS NULL THEN stripe_subscriptions.latest_paid_event_created_at
      WHEN stripe_subscriptions.latest_paid_event_created_at IS NULL OR excluded.latest_paid_event_created_at > stripe_subscriptions.latest_paid_event_created_at THEN excluded.latest_paid_event_created_at
      ELSE stripe_subscriptions.latest_paid_event_created_at END,
    ended_at = CASE WHEN excluded.last_event_created_at >= stripe_subscriptions.last_event_created_at THEN excluded.ended_at ELSE stripe_subscriptions.ended_at END,
    last_event_created_at = MAX(stripe_subscriptions.last_event_created_at, excluded.last_event_created_at),
    updated_at = excluded.updated_at
`).bind(
  record.stripeSubscriptionId, record.stripeCustomerId, record.stripeCheckoutSessionId,
  record.licenseId, record.billingStatus, record.stripePriceId,
  record.cancelAtPeriodEnd ? 1 : 0, record.paidThrough,
  record.latestPaidEventCreatedAt, record.endedAt, record.lastEventCreatedAt,
  record.createdAt, record.updatedAt,
);

const invoiceUpsert = (database, record) => database.prepare(`
  INSERT INTO stripe_invoices (
    stripe_invoice_id, stripe_subscription_id, license_id, stripe_price_id,
    stripe_payment_intent_id, stripe_charge_id, invoice_status, period_start,
    period_end, amount_paid, currency, paid_event_created_at,
    last_event_created_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(stripe_invoice_id) DO UPDATE SET
    license_id = COALESCE(stripe_invoices.license_id, excluded.license_id),
    stripe_price_id = COALESCE(excluded.stripe_price_id, stripe_invoices.stripe_price_id),
    stripe_payment_intent_id = COALESCE(excluded.stripe_payment_intent_id, stripe_invoices.stripe_payment_intent_id),
    stripe_charge_id = COALESCE(excluded.stripe_charge_id, stripe_invoices.stripe_charge_id),
    invoice_status = CASE WHEN excluded.last_event_created_at >= stripe_invoices.last_event_created_at THEN excluded.invoice_status ELSE stripe_invoices.invoice_status END,
    period_start = COALESCE(excluded.period_start, stripe_invoices.period_start),
    period_end = COALESCE(excluded.period_end, stripe_invoices.period_end),
    amount_paid = COALESCE(excluded.amount_paid, stripe_invoices.amount_paid),
    currency = COALESCE(excluded.currency, stripe_invoices.currency),
    paid_event_created_at = CASE
      WHEN excluded.paid_event_created_at IS NULL THEN stripe_invoices.paid_event_created_at
      WHEN stripe_invoices.paid_event_created_at IS NULL OR excluded.paid_event_created_at > stripe_invoices.paid_event_created_at THEN excluded.paid_event_created_at
      ELSE stripe_invoices.paid_event_created_at END,
    last_event_created_at = MAX(stripe_invoices.last_event_created_at, excluded.last_event_created_at),
    updated_at = excluded.updated_at
`).bind(
  record.stripeInvoiceId, record.stripeSubscriptionId, record.licenseId,
  record.stripePriceId, record.stripePaymentIntentId, record.stripeChargeId,
  record.invoiceStatus, record.periodStart, record.periodEnd, record.amountPaid,
  record.currency, record.paidEventCreatedAt, record.lastEventCreatedAt,
  record.createdAt, record.updatedAt,
);

const paymentUpsert = (database, record) => database.prepare(`
  INSERT INTO stripe_payments (
    payment_reference, stripe_payment_intent_id, stripe_charge_id,
    stripe_checkout_session_id, stripe_invoice_id, license_id,
    amount_paid, currency, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(payment_reference) DO UPDATE SET
    stripe_payment_intent_id = COALESCE(excluded.stripe_payment_intent_id, stripe_payments.stripe_payment_intent_id),
    stripe_charge_id = COALESCE(excluded.stripe_charge_id, stripe_payments.stripe_charge_id),
    stripe_checkout_session_id = COALESCE(excluded.stripe_checkout_session_id, stripe_payments.stripe_checkout_session_id),
    stripe_invoice_id = COALESCE(excluded.stripe_invoice_id, stripe_payments.stripe_invoice_id),
    amount_paid = COALESCE(excluded.amount_paid, stripe_payments.amount_paid),
    currency = COALESCE(excluded.currency, stripe_payments.currency),
    updated_at = excluded.updated_at
`).bind(
  record.paymentReference, record.stripePaymentIntentId, record.stripeChargeId,
  record.stripeCheckoutSessionId, record.stripeInvoiceId, record.licenseId,
  record.amountPaid, record.currency, record.createdAt, record.updatedAt,
);

const deliveryInsert = (database, record) => database.prepare(`
  INSERT INTO license_delivery_outbox (
    id, license_id, encrypted_payload, payload_version, status, attempts,
    next_attempt_at, created_at, updated_at
  ) VALUES (?, ?, ?, 1, 'pending', 0, ?, ?, ?)
`).bind(record.id, record.licenseId, record.encryptedPayload, record.nextAttemptAt, record.createdAt, record.updatedAt);

export class D1StripeBillingRepository {
  constructor(database) {
    this.database = database;
  }

  async enqueueEvent(record) {
    const result = await this.database.prepare(`
      INSERT OR IGNORE INTO stripe_event_inbox (
        event_id, event_type, object_id, livemode, event_created_at,
        status, attempts, next_attempt_at, received_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
    `).bind(
      record.eventId, record.eventType, record.objectId, record.livemode ? 1 : 0,
      record.eventCreatedAt, record.receivedAt, record.receivedAt,
    ).run();
    return Boolean(result.meta?.changes);
  }

  async claimEvents({ now, leaseToken, leaseExpiresAt, limit }) {
    const rows = await this.database.prepare(`
      SELECT event_id FROM stripe_event_inbox
      WHERE (status = 'pending' OR (status = 'processing' AND lease_expires_at <= ?))
        AND next_attempt_at <= ?
      ORDER BY event_created_at, received_at
      LIMIT ?
    `).bind(now, now, limit).all();
    const statements = (rows.results || []).map((row) => this.database.prepare(`
      UPDATE stripe_event_inbox
      SET status = 'processing', lease_token = ?, lease_expires_at = ?
      WHERE event_id = ?
        AND (status = 'pending' OR (status = 'processing' AND lease_expires_at <= ?))
    `).bind(leaseToken, leaseExpiresAt, row.event_id, now));
    if (statements.length) await this.database.batch(statements);
    const claimed = await this.database.prepare(`
      SELECT * FROM stripe_event_inbox WHERE lease_token = ? AND status = 'processing'
      ORDER BY event_created_at, received_at
    `).bind(leaseToken).all();
    return (claimed.results || []).map(mapEvent);
  }

  async markEventProcessed(eventId, now) {
    await this.database.prepare(`
      UPDATE stripe_event_inbox
      SET status = 'processed', processed_at = ?, lease_token = NULL,
          lease_expires_at = NULL, last_error_code = NULL
      WHERE event_id = ?
    `).bind(now, eventId).run();
  }

  async rescheduleEvent(eventId, { attempts, nextAttemptAt, errorCode, deadLetter }) {
    await this.database.prepare(`
      UPDATE stripe_event_inbox
      SET status = ?, attempts = ?, next_attempt_at = ?, last_error_code = ?,
          lease_token = NULL, lease_expires_at = NULL
      WHERE event_id = ?
    `).bind(deadLetter ? 'dead_letter' : 'pending', attempts, nextAttemptAt, errorCode, eventId).run();
  }

  async requeueEvent(eventId, now) {
    const result = await this.database.prepare(`
      UPDATE stripe_event_inbox
      SET status = 'pending', attempts = 0, next_attempt_at = ?,
          lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL
      WHERE event_id = ? AND status = 'dead_letter'
    `).bind(now, eventId).run();
    return Boolean(result.meta?.changes);
  }

  async findLicenseBySubscriptionId(subscriptionId) {
    return this.database.prepare('SELECT * FROM licenses WHERE stripe_subscription_id = ?')
      .bind(subscriptionId).first();
  }

  async findLicenseByCheckoutSessionId(sessionId) {
    return this.database.prepare('SELECT * FROM licenses WHERE stripe_checkout_session_id = ?')
      .bind(sessionId).first();
  }

  async findLicenseById(id) {
    return this.database.prepare('SELECT * FROM licenses WHERE id = ?').bind(id).first();
  }

  async findSubscription(subscriptionId) {
    return mapSubscription(await this.database.prepare(
      'SELECT * FROM stripe_subscriptions WHERE stripe_subscription_id = ?',
    ).bind(subscriptionId).first());
  }

  async upsertSubscription(record) {
    await subscriptionUpsert(this.database, record).run();
    return this.findSubscription(record.stripeSubscriptionId);
  }

  async linkCheckoutToSubscription(subscriptionId, sessionId, eventCreatedAt, now) {
    await this.database.batch([
      this.database.prepare(`
        UPDATE stripe_subscriptions
        SET stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ?), updated_at = ?
        WHERE stripe_subscription_id = ?
      `).bind(sessionId, now, subscriptionId),
      this.database.prepare(`
        UPDATE licenses
        SET stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ?), updated_at = ?
        WHERE stripe_subscription_id = ?
      `).bind(sessionId, now, subscriptionId),
    ]);
    return this.findSubscription(subscriptionId);
  }

  async createStripeLicenseBundle({ license, subscription, invoice, payment, delivery }) {
    const statements = [licenseInsert(this.database, license)];
    if (subscription) statements.push(subscriptionUpsert(this.database, subscription));
    if (invoice) statements.push(invoiceUpsert(this.database, invoice));
    if (payment) statements.push(paymentUpsert(this.database, payment));
    statements.push(deliveryInsert(this.database, delivery));
    await this.database.batch(statements);
  }

  async recordPaidRenewal({ licenseId, plan, expiresAt, priceId, now, subscription, invoice, payment }) {
    await this.database.batch([
      this.database.prepare(`
        UPDATE licenses
        SET plan = ?,
            status = CASE WHEN status = 'revoked' THEN status
              WHEN EXISTS (
              SELECT 1 FROM stripe_refunds r
              JOIN stripe_payments p ON p.payment_reference = r.payment_reference
              LEFT JOIN stripe_invoices i ON i.stripe_invoice_id = p.stripe_invoice_id
              WHERE r.license_id = ? AND r.refund_status = 'succeeded'
                AND r.is_full_refund = 1
                AND (i.period_end IS NULL OR i.period_end >= ?)
            ) OR EXISTS (
              SELECT 1 FROM stripe_subscriptions s
              WHERE s.stripe_subscription_id = ? AND s.billing_status = 'canceled'
                AND s.last_event_created_at >= ?
            ) THEN status ELSE 'active' END,
            expires_at = CASE WHEN EXISTS (
              SELECT 1 FROM stripe_refunds r
              JOIN stripe_payments p ON p.payment_reference = r.payment_reference
              LEFT JOIN stripe_invoices i ON i.stripe_invoice_id = p.stripe_invoice_id
              WHERE r.license_id = ? AND r.refund_status = 'succeeded'
                AND r.is_full_refund = 1
                AND (i.period_end IS NULL OR i.period_end >= ?)
            ) OR EXISTS (
              SELECT 1 FROM stripe_subscriptions s
              WHERE s.stripe_subscription_id = ? AND s.billing_status = 'canceled'
                AND s.last_event_created_at >= ?
            ) THEN expires_at
              WHEN expires_at IS NULL OR expires_at < ? THEN ? ELSE expires_at END,
            stripe_price_id = ?, updated_at = ?
        WHERE id = ? AND source = 'stripe'
      `).bind(
        plan,
        licenseId, expiresAt,
        subscription.stripeSubscriptionId, subscription.latestPaidEventCreatedAt,
        licenseId, expiresAt,
        subscription.stripeSubscriptionId, subscription.latestPaidEventCreatedAt,
        expiresAt, expiresAt,
        priceId, now, licenseId,
      ),
      subscriptionUpsert(this.database, { ...subscription, licenseId }),
      invoiceUpsert(this.database, { ...invoice, licenseId }),
      paymentUpsert(this.database, { ...payment, licenseId }),
    ]);
  }

  async recordInvoice(record) {
    await invoiceUpsert(this.database, record).run();
  }

  async findInvoice(invoiceId) {
    return mapInvoice(await this.database.prepare(
      'SELECT * FROM stripe_invoices WHERE stripe_invoice_id = ?',
    ).bind(invoiceId).first());
  }

  async findPayment({ paymentIntentId, chargeId }) {
    if (paymentIntentId) {
      const row = await this.database.prepare(
        'SELECT * FROM stripe_payments WHERE stripe_payment_intent_id = ?',
      ).bind(paymentIntentId).first();
      if (row) return mapPayment(row);
    }
    if (chargeId) {
      return mapPayment(await this.database.prepare(
        'SELECT * FROM stripe_payments WHERE stripe_charge_id = ?',
      ).bind(chargeId).first());
    }
    return null;
  }

  async recordRefund(record) {
    await this.database.prepare(`
      INSERT INTO stripe_refunds (
        stripe_refund_id, payment_reference, license_id, stripe_payment_intent_id,
        stripe_charge_id, refund_status, amount, currency, is_full_refund,
        event_created_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stripe_refund_id) DO UPDATE SET
        payment_reference = COALESCE(excluded.payment_reference, stripe_refunds.payment_reference),
        license_id = COALESCE(excluded.license_id, stripe_refunds.license_id),
        refund_status = excluded.refund_status,
        amount = excluded.amount,
        currency = excluded.currency,
        is_full_refund = excluded.is_full_refund,
        event_created_at = MAX(stripe_refunds.event_created_at, excluded.event_created_at),
        updated_at = excluded.updated_at
    `).bind(
      record.stripeRefundId, record.paymentReference, record.licenseId,
      record.stripePaymentIntentId, record.stripeChargeId, record.refundStatus,
      record.amount, record.currency, record.isFullRefund ? 1 : 0,
      record.eventCreatedAt, record.createdAt, record.updatedAt,
    ).run();
  }

  async revokeRefundedLicense({ licenseId, recurring, refundedPeriodEnd, now }) {
    const results = await this.database.batch([
      this.database.prepare(`
        UPDATE licenses
        SET status = ?, expires_at = CASE WHEN plan = 'lifetime' THEN NULL ELSE ? END, updated_at = ?
        WHERE id = ? AND source = 'stripe'
          AND (? = 0 OR NOT EXISTS (
            SELECT 1 FROM stripe_invoices
            WHERE license_id = ? AND paid_event_created_at IS NOT NULL AND period_end > ?
          ))
      `).bind(
        recurring ? 'expired' : 'revoked', now, now, licenseId,
        recurring ? 1 : 0, licenseId, refundedPeriodEnd,
      ),
      this.database.prepare(`
        UPDATE license_delivery_outbox
        SET status = 'cancelled', encrypted_payload = NULL, updated_at = ?
        WHERE license_id = ? AND status IN ('pending', 'processing')
          AND (? = 0 OR NOT EXISTS (
            SELECT 1 FROM stripe_invoices
            WHERE license_id = ? AND paid_event_created_at IS NOT NULL AND period_end > ?
          ))
      `).bind(now, licenseId, recurring ? 1 : 0, licenseId, refundedPeriodEnd),
    ]);
    return Boolean(results[0]?.meta?.changes);
  }

  async terminateSubscription(subscriptionId, eventCreatedAt, now) {
    const subscription = await this.findSubscription(subscriptionId);
    if (!subscription?.licenseId) return false;
    if (subscription.latestPaidEventCreatedAt && subscription.latestPaidEventCreatedAt > eventCreatedAt) return false;
    const results = await this.database.batch([
      this.database.prepare(`
        UPDATE licenses
        SET status = CASE WHEN status = 'revoked' THEN status ELSE 'cancelled' END,
            updated_at = ?
        WHERE id = ? AND source = 'stripe'
          AND EXISTS (
            SELECT 1 FROM stripe_subscriptions
            WHERE stripe_subscription_id = ? AND license_id = ?
              AND COALESCE(latest_paid_event_created_at, 0) <= ?
          )
      `).bind(
        now, subscription.licenseId,
        subscriptionId, subscription.licenseId, eventCreatedAt,
      ),
      this.database.prepare(`
        UPDATE stripe_subscriptions
        SET billing_status = 'canceled', ended_at = COALESCE(ended_at, ?),
            last_event_created_at = MAX(last_event_created_at, ?), updated_at = ?
        WHERE stripe_subscription_id = ?
      `).bind(now, eventCreatedAt, now, subscriptionId),
      this.database.prepare(`
        UPDATE license_delivery_outbox
        SET status = 'cancelled', encrypted_payload = NULL, updated_at = ?,
            lease_token = NULL, lease_expires_at = NULL
        WHERE license_id = ? AND status IN ('pending', 'processing')
          AND EXISTS (
            SELECT 1 FROM stripe_subscriptions
            WHERE stripe_subscription_id = ? AND license_id = ?
              AND COALESCE(latest_paid_event_created_at, 0) <= ?
          )
      `).bind(
        now, subscription.licenseId,
        subscriptionId, subscription.licenseId, eventCreatedAt,
      ),
    ]);
    return Boolean(results[0]?.meta?.changes);
  }

  async claimDeliveries({ now, leaseToken, leaseExpiresAt, limit }) {
    const rows = await this.database.prepare(`
      SELECT id FROM license_delivery_outbox
      WHERE (status = 'pending' OR (status = 'processing' AND lease_expires_at <= ?))
        AND next_attempt_at <= ?
      ORDER BY created_at LIMIT ?
    `).bind(now, now, limit).all();
    const statements = (rows.results || []).map((row) => this.database.prepare(`
      UPDATE license_delivery_outbox
      SET status = 'processing', lease_token = ?, lease_expires_at = ?
      WHERE id = ? AND (status = 'pending' OR (status = 'processing' AND lease_expires_at <= ?))
    `).bind(leaseToken, leaseExpiresAt, row.id, now));
    if (statements.length) await this.database.batch(statements);
    const claimed = await this.database.prepare(`
      SELECT * FROM license_delivery_outbox WHERE lease_token = ? AND status = 'processing'
      ORDER BY created_at
    `).bind(leaseToken).all();
    return (claimed.results || []).map(mapDelivery);
  }

  async markDeliveryDelivered(id, messageId, now) {
    await this.database.prepare(`
      UPDATE license_delivery_outbox
      SET status = 'delivered', encrypted_payload = NULL, provider_message_id = ?,
          delivered_at = ?, updated_at = ?, lease_token = NULL,
          lease_expires_at = NULL, last_error_code = NULL
      WHERE id = ?
    `).bind(messageId, now, now, id).run();
  }

  async rescheduleDelivery(id, { attempts, nextAttemptAt, errorCode, deadLetter, now }) {
    await this.database.prepare(`
      UPDATE license_delivery_outbox
      SET status = ?, attempts = ?, next_attempt_at = ?, last_error_code = ?,
          updated_at = ?, lease_token = NULL, lease_expires_at = NULL
      WHERE id = ?
    `).bind(deadLetter ? 'dead_letter' : 'pending', attempts, nextAttemptAt, errorCode, now, id).run();
  }

  async requeueDelivery(id, now) {
    const result = await this.database.prepare(`
      UPDATE license_delivery_outbox
      SET status = 'pending', attempts = 0, next_attempt_at = ?, updated_at = ?,
          lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL
      WHERE id = ? AND status = 'dead_letter' AND encrypted_payload IS NOT NULL
    `).bind(now, now, id).run();
    return Boolean(result.meta?.changes);
  }
}
