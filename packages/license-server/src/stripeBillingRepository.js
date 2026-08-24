import { LEGACY_STATUS_PROJECTION_SQL } from './licenseStatusProjection.js';

const mapEvent = (row) => row && ({
  eventId: row.event_id,
  eventType: row.event_type,
  objectId: row.object_id,
  livemode: Boolean(row.livemode),
  eventCreatedAt: row.event_created_at,
  status: row.status,
  attempts: row.attempts,
});

const mapDelivery = (row) => row && ({
  id: row.id,
  licenseId: row.license_id,
  encryptedPayload: row.encrypted_payload,
  status: row.status,
  attempts: row.attempts,
  authorizedAt: row.authorized_at,
  firstProviderAttemptAt: row.first_provider_attempt_at,
});

const blockingEventWorkSql = `
  EXISTS (
    SELECT 1 FROM stripe_event_inbox event_work
    WHERE event_work.status = 'processing'
      OR (
        event_work.status = 'pending'
        AND event_work.next_attempt_at <= ?
      )
      OR (
        event_work.status IN ('pending', 'dead_letter')
        AND event_work.event_type IN (
          'customer.subscription.deleted',
          'refund.created',
          'refund.updated',
          'charge.refunded'
        )
      )
  )
`;

const reversibleRefundSuspensionSql = `
  EXISTS (
    SELECT 1
    FROM licenses refund_license
    JOIN stripe_entitlements refund_entitlement
      ON refund_entitlement.license_id = refund_license.id
    JOIN stripe_payments refund_payment
      ON refund_payment.license_id = refund_license.id
    JOIN stripe_refund_facts refund_fact
      ON refund_fact.payment_fully_refunded = 1
     AND (
       (refund_fact.stripe_payment_intent_id IS NOT NULL
         AND refund_fact.stripe_payment_intent_id = refund_payment.stripe_payment_intent_id)
       OR (refund_fact.stripe_charge_id IS NOT NULL
         AND refund_fact.stripe_charge_id = refund_payment.stripe_charge_id)
     )
    LEFT JOIN stripe_invoices refunded_invoice
      ON refunded_invoice.stripe_invoice_id = refund_payment.stripe_invoice_id
    WHERE refund_license.id = license_delivery_outbox.license_id
      AND refund_license.admin_status = 'active'
      AND refund_entitlement.billing_state IN ('refunded', 'expired')
      AND (
        refund_license.plan = 'lifetime'
        OR (
          refunded_invoice.period_end > ?
          AND refunded_invoice.period_end = (
            SELECT MAX(latest_invoice.period_end)
            FROM stripe_invoices latest_invoice
            WHERE latest_invoice.stripe_subscription_id = refund_license.stripe_subscription_id
              AND latest_invoice.invoice_status = 'paid'
          )
        )
      )
  )
`;

const subscriptionEventInsert = (database, record) => database.prepare(`
  INSERT INTO stripe_subscription_events (
    event_id, stripe_subscription_id, event_type, billing_status,
    stripe_price_id, cancel_at_period_end, event_created_at, recorded_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(event_id) DO NOTHING
`).bind(
  record.eventId,
  record.stripeSubscriptionId,
  record.eventType,
  record.billingStatus,
  record.stripePriceId,
  record.cancelAtPeriodEnd ? 1 : 0,
  record.eventCreatedAt,
  record.recordedAt,
);

const paidInvoiceUpsert = (database, record) => database.prepare(`
  INSERT INTO stripe_invoices (
    stripe_invoice_id, stripe_subscription_id, stripe_price_id, plan,
    stripe_payment_intent_id, stripe_charge_id, invoice_status,
    period_start, period_end, amount_paid, currency, paid_event_created_at,
    last_event_id, last_event_created_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(stripe_invoice_id) DO UPDATE SET
    stripe_payment_intent_id = COALESCE(excluded.stripe_payment_intent_id, stripe_invoices.stripe_payment_intent_id),
    stripe_charge_id = COALESCE(excluded.stripe_charge_id, stripe_invoices.stripe_charge_id),
    stripe_price_id = excluded.stripe_price_id,
    plan = excluded.plan,
    invoice_status = 'paid',
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    amount_paid = excluded.amount_paid,
    currency = excluded.currency,
    paid_event_created_at = CASE
      WHEN stripe_invoices.paid_event_created_at IS NULL
        OR excluded.paid_event_created_at > stripe_invoices.paid_event_created_at
        OR (
          excluded.paid_event_created_at = stripe_invoices.paid_event_created_at
          AND excluded.last_event_id > stripe_invoices.last_event_id
        )
      THEN excluded.paid_event_created_at
      ELSE stripe_invoices.paid_event_created_at
    END,
    last_event_id = CASE
      WHEN excluded.last_event_created_at > stripe_invoices.last_event_created_at
        OR (
          excluded.last_event_created_at = stripe_invoices.last_event_created_at
          AND excluded.last_event_id > stripe_invoices.last_event_id
        )
      THEN excluded.last_event_id
      ELSE stripe_invoices.last_event_id
    END,
    last_event_created_at = MAX(stripe_invoices.last_event_created_at, excluded.last_event_created_at),
    updated_at = excluded.updated_at
`).bind(
  record.stripeInvoiceId,
  record.stripeSubscriptionId,
  record.stripePriceId,
  record.plan,
  record.stripePaymentIntentId,
  record.stripeChargeId,
  record.periodStart,
  record.periodEnd,
  record.amountPaid,
  record.currency,
  record.eventCreatedAt,
  record.eventId,
  record.eventCreatedAt,
  record.createdAt,
  record.updatedAt,
);

const paymentUpsert = (database, record) => database.prepare(`
  INSERT INTO stripe_payments (
    payment_reference, payment_kind, stripe_payment_intent_id,
    stripe_charge_id, stripe_checkout_session_id, stripe_invoice_id,
    stripe_subscription_id, license_id, payment_status, amount_paid,
    currency, paid_event_id, paid_event_created_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'paid', ?, ?, ?, ?, ?, ?)
  ON CONFLICT(payment_reference) DO UPDATE SET
    stripe_payment_intent_id = COALESCE(excluded.stripe_payment_intent_id, stripe_payments.stripe_payment_intent_id),
    stripe_charge_id = COALESCE(excluded.stripe_charge_id, stripe_payments.stripe_charge_id),
    stripe_checkout_session_id = COALESCE(excluded.stripe_checkout_session_id, stripe_payments.stripe_checkout_session_id),
    stripe_invoice_id = COALESCE(excluded.stripe_invoice_id, stripe_payments.stripe_invoice_id),
    stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, stripe_payments.stripe_subscription_id),
    payment_status = 'paid',
    amount_paid = excluded.amount_paid,
    currency = excluded.currency,
    paid_event_id = CASE
      WHEN excluded.paid_event_created_at > stripe_payments.paid_event_created_at
        OR (
          excluded.paid_event_created_at = stripe_payments.paid_event_created_at
          AND excluded.paid_event_id > stripe_payments.paid_event_id
        )
      THEN excluded.paid_event_id
      ELSE stripe_payments.paid_event_id
    END,
    paid_event_created_at = MAX(stripe_payments.paid_event_created_at, excluded.paid_event_created_at),
    updated_at = excluded.updated_at
`).bind(
  record.paymentReference,
  record.paymentKind,
  record.stripePaymentIntentId,
  record.stripeChargeId,
  record.stripeCheckoutSessionId,
  record.stripeInvoiceId,
  record.stripeSubscriptionId,
  record.amountPaid,
  record.currency,
  record.eventId,
  record.eventCreatedAt,
  record.createdAt,
  record.updatedAt,
);

const refundUpsert = (database, record) => database.prepare(`
  INSERT INTO stripe_refund_facts (
    fact_id, stripe_refund_id, stripe_payment_intent_id, stripe_charge_id,
    refund_status, amount, currency, payment_fully_refunded, event_id,
    event_created_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(fact_id) DO UPDATE SET
    stripe_payment_intent_id = COALESCE(excluded.stripe_payment_intent_id, stripe_refund_facts.stripe_payment_intent_id),
    stripe_charge_id = COALESCE(excluded.stripe_charge_id, stripe_refund_facts.stripe_charge_id),
    refund_status = CASE
      WHEN excluded.event_created_at > stripe_refund_facts.event_created_at
        OR (
          excluded.event_created_at = stripe_refund_facts.event_created_at
          AND excluded.event_id > stripe_refund_facts.event_id
        )
      THEN excluded.refund_status
      ELSE stripe_refund_facts.refund_status
    END,
    amount = CASE
      WHEN excluded.event_created_at > stripe_refund_facts.event_created_at
        OR (
          excluded.event_created_at = stripe_refund_facts.event_created_at
          AND excluded.event_id > stripe_refund_facts.event_id
        )
      THEN excluded.amount ELSE stripe_refund_facts.amount END,
    currency = COALESCE(excluded.currency, stripe_refund_facts.currency),
    payment_fully_refunded = CASE
      WHEN excluded.event_created_at > stripe_refund_facts.event_created_at
        OR (
          excluded.event_created_at = stripe_refund_facts.event_created_at
          AND excluded.event_id > stripe_refund_facts.event_id
        )
      THEN excluded.payment_fully_refunded
      ELSE stripe_refund_facts.payment_fully_refunded
    END,
    event_id = CASE
      WHEN excluded.event_created_at > stripe_refund_facts.event_created_at
        OR (
          excluded.event_created_at = stripe_refund_facts.event_created_at
          AND excluded.event_id > stripe_refund_facts.event_id
        )
      THEN excluded.event_id
      ELSE stripe_refund_facts.event_id
    END,
    event_created_at = MAX(stripe_refund_facts.event_created_at, excluded.event_created_at),
    updated_at = excluded.updated_at
`).bind(
  record.factId,
  record.stripeRefundId,
  record.stripePaymentIntentId,
  record.stripeChargeId,
  record.refundStatus,
  record.amount,
  record.currency,
  record.paymentFullyRefunded ? 1 : 0,
  record.eventId,
  record.eventCreatedAt,
  record.createdAt,
  record.updatedAt,
);

const licenseInsert = (database, record, eligibilitySql, eligibilityBindings) => database.prepare(`
  INSERT INTO licenses (
    id, key_hash, email_lookup, plan, status, admin_status, source, created_at, updated_at,
    expires_at, max_activations, stripe_customer_id, stripe_subscription_id,
    stripe_price_id, stripe_checkout_session_id, external_reference
  )
  SELECT ?, ?, ?, ?, 'active', 'active', 'stripe', ?, ?, ?, ?, ?, ?, ?, ?, ?
  WHERE NOT EXISTS (
    SELECT 1 FROM licenses
    WHERE (? IS NOT NULL AND stripe_subscription_id = ?)
       OR (? IS NOT NULL AND stripe_checkout_session_id = ?)
  )
    AND (${eligibilitySql})
`).bind(
  record.id,
  record.keyHash,
  record.emailLookup,
  record.plan,
  record.createdAt,
  record.updatedAt,
  record.expiresAt,
  record.maxActivations,
  record.stripeCustomerId,
  record.stripeSubscriptionId,
  record.stripePriceId,
  record.stripeCheckoutSessionId,
  record.externalReference,
  record.stripeSubscriptionId,
  record.stripeSubscriptionId,
  record.stripeCheckoutSessionId,
  record.stripeCheckoutSessionId,
  ...eligibilityBindings,
);

const recomputeStatements = (database, now) => [
  database.prepare(`
    INSERT INTO stripe_entitlements (
      license_id, entitlement_kind, stripe_subscription_id,
      stripe_checkout_session_id, billing_state, plan, stripe_price_id,
      paid_through, winning_invoice_id, winning_payment_reference,
      latest_paid_event_created_at, latest_deletion_event_created_at, updated_at
    )
    SELECT l.id, 'lifetime', NULL, l.stripe_checkout_session_id,
      CASE WHEN EXISTS (
        SELECT 1
        FROM stripe_payments p
        JOIN stripe_refund_facts r
          ON r.payment_fully_refunded = 1
         AND (
           (r.stripe_payment_intent_id IS NOT NULL AND r.stripe_payment_intent_id = p.stripe_payment_intent_id)
           OR (r.stripe_charge_id IS NOT NULL AND r.stripe_charge_id = p.stripe_charge_id)
         )
        WHERE p.stripe_checkout_session_id = l.stripe_checkout_session_id
      ) THEN 'refunded' ELSE 'active' END,
      'lifetime', l.stripe_price_id, NULL, NULL,
      (SELECT p.payment_reference FROM stripe_payments p
       WHERE p.stripe_checkout_session_id = l.stripe_checkout_session_id LIMIT 1),
      (SELECT p.paid_event_created_at FROM stripe_payments p
       WHERE p.stripe_checkout_session_id = l.stripe_checkout_session_id LIMIT 1),
      NULL, ?
    FROM licenses l
    WHERE l.source = 'stripe' AND l.plan = 'lifetime'
      AND l.stripe_checkout_session_id IS NOT NULL
    ON CONFLICT(license_id) DO UPDATE SET
      billing_state = excluded.billing_state,
      winning_payment_reference = excluded.winning_payment_reference,
      latest_paid_event_created_at = excluded.latest_paid_event_created_at,
      updated_at = excluded.updated_at
  `).bind(now),
  database.prepare(`
    WITH valid_invoices AS (
      SELECT i.*,
        ROW_NUMBER() OVER (
          PARTITION BY i.stripe_subscription_id
          ORDER BY i.period_end DESC, i.paid_event_created_at DESC, i.stripe_invoice_id DESC
        ) AS rank
      FROM stripe_invoices i
      WHERE i.invoice_status = 'paid'
        AND i.paid_event_created_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM stripe_refund_facts r
          WHERE r.payment_fully_refunded = 1
            AND (
              (r.stripe_payment_intent_id IS NOT NULL AND r.stripe_payment_intent_id = i.stripe_payment_intent_id)
              OR (r.stripe_charge_id IS NOT NULL AND r.stripe_charge_id = i.stripe_charge_id)
            )
        )
    ),
    deletions AS (
      SELECT stripe_subscription_id, MAX(event_created_at) AS deleted_at
      FROM stripe_subscription_events
      WHERE event_type = 'customer.subscription.deleted'
      GROUP BY stripe_subscription_id
    )
    INSERT INTO stripe_entitlements (
      license_id, entitlement_kind, stripe_subscription_id,
      stripe_checkout_session_id, billing_state, plan, stripe_price_id,
      paid_through, winning_invoice_id, winning_payment_reference,
      latest_paid_event_created_at, latest_deletion_event_created_at, updated_at
    )
    SELECT l.id, 'subscription', l.stripe_subscription_id, NULL,
      CASE
        WHEN v.stripe_invoice_id IS NULL OR v.period_end <= ? THEN 'expired'
        WHEN COALESCE(d.deleted_at, 0) >= v.paid_event_created_at THEN 'cancelled'
        ELSE 'active'
      END,
      COALESCE(v.plan, l.plan),
      COALESCE(v.stripe_price_id, l.stripe_price_id),
      v.period_end,
      v.stripe_invoice_id,
      (SELECT p.payment_reference FROM stripe_payments p
       WHERE p.stripe_invoice_id = v.stripe_invoice_id LIMIT 1),
      v.paid_event_created_at,
      d.deleted_at,
      ?
    FROM licenses l
    LEFT JOIN valid_invoices v
      ON v.stripe_subscription_id = l.stripe_subscription_id AND v.rank = 1
    LEFT JOIN deletions d
      ON d.stripe_subscription_id = l.stripe_subscription_id
    WHERE l.source = 'stripe' AND l.plan IN ('monthly', 'annual')
      AND l.stripe_subscription_id IS NOT NULL
    ON CONFLICT(license_id) DO UPDATE SET
      billing_state = excluded.billing_state,
      plan = excluded.plan,
      stripe_price_id = excluded.stripe_price_id,
      paid_through = excluded.paid_through,
      winning_invoice_id = excluded.winning_invoice_id,
      winning_payment_reference = excluded.winning_payment_reference,
      latest_paid_event_created_at = excluded.latest_paid_event_created_at,
      latest_deletion_event_created_at = excluded.latest_deletion_event_created_at,
      updated_at = excluded.updated_at
  `).bind(now, now),
  database.prepare(`
    UPDATE licenses
    SET plan = COALESCE((SELECT e.plan FROM stripe_entitlements e WHERE e.license_id = licenses.id), plan),
        expires_at = CASE
          WHEN plan = 'lifetime' THEN NULL
          ELSE COALESCE(
            (SELECT e.paid_through FROM stripe_entitlements e WHERE e.license_id = licenses.id),
            expires_at
          )
        END,
        stripe_price_id = COALESCE(
          (SELECT e.stripe_price_id FROM stripe_entitlements e WHERE e.license_id = licenses.id),
          stripe_price_id
        ),
        status = ${LEGACY_STATUS_PROJECTION_SQL},
        legacy_status_revision = legacy_status_revision + 1,
        updated_at = ?
    WHERE source = 'stripe'
  `).bind(now),
  database.prepare(`
    UPDATE stripe_payments
    SET license_id = COALESCE(
      (SELECT l.id FROM licenses l
       WHERE stripe_payments.stripe_subscription_id IS NOT NULL
         AND l.stripe_subscription_id = stripe_payments.stripe_subscription_id),
      (SELECT l.id FROM licenses l
       WHERE stripe_payments.stripe_checkout_session_id IS NOT NULL
         AND l.stripe_checkout_session_id = stripe_payments.stripe_checkout_session_id),
      license_id
    ),
    updated_at = ?
  `).bind(now),
  database.prepare(`
    UPDATE license_delivery_outbox
    SET status = 'pending', attempts = 0, next_attempt_at = ?,
        lease_token = NULL, lease_expires_at = NULL,
        last_error_code = NULL, updated_at = ?
    WHERE status = 'suspended'
      AND encrypted_payload IS NOT NULL
      AND first_provider_attempt_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM licenses l
        JOIN stripe_entitlements e ON e.license_id = l.id
        WHERE l.id = license_delivery_outbox.license_id
          AND l.admin_status = 'active'
          AND e.billing_state = 'active'
          AND (l.expires_at IS NULL OR l.expires_at > ?)
      )
  `).bind(now, now, now),
  database.prepare(`
    UPDATE license_delivery_outbox
    SET status = 'cancelled', encrypted_payload = NULL, updated_at = ?,
        lease_token = NULL, lease_expires_at = NULL
    WHERE status IN ('pending', 'leased', 'suspended', 'dead_letter')
      AND EXISTS (
        SELECT 1
        FROM licenses l
        LEFT JOIN stripe_entitlements e ON e.license_id = l.id
        WHERE l.id = license_delivery_outbox.license_id
          AND (
            l.admin_status <> 'active'
            OR e.billing_state IS NULL
            OR e.billing_state <> 'active'
            OR (l.expires_at IS NOT NULL AND l.expires_at <= ?)
          )
      )
      AND NOT (${reversibleRefundSuspensionSql})
  `).bind(now, now, now),
  database.prepare(`
    UPDATE license_delivery_outbox
    SET status = 'suspended', updated_at = ?,
        lease_token = NULL, lease_expires_at = NULL
    WHERE status IN ('pending', 'leased', 'dead_letter')
      AND encrypted_payload IS NOT NULL
      AND first_provider_attempt_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM licenses l
        LEFT JOIN stripe_entitlements e ON e.license_id = l.id
        WHERE l.id = license_delivery_outbox.license_id
          AND (
            l.admin_status <> 'active'
            OR e.billing_state IS NULL
            OR e.billing_state <> 'active'
            OR (l.expires_at IS NOT NULL AND l.expires_at <= ?)
          )
      )
      AND (${reversibleRefundSuspensionSql})
  `).bind(now, now, now),
];

const deliveryInsert = (database, record, candidateKeyHash, now) => database.prepare(`
  INSERT INTO license_delivery_outbox (
    id, license_id, encrypted_payload, payload_version, status, attempts,
    next_attempt_at, created_at, updated_at
  )
  SELECT ?, l.id, ?, 1, 'pending', 0, ?, ?, ?
  FROM licenses l
  JOIN stripe_entitlements e ON e.license_id = l.id
  WHERE l.key_hash = ?
    AND l.admin_status = 'active'
    AND e.billing_state = 'active'
    AND (l.expires_at IS NULL OR l.expires_at > ?)
  ON CONFLICT(license_id) DO NOTHING
`).bind(
  record.id,
  record.encryptedPayload,
  record.nextAttemptAt,
  record.createdAt,
  record.updatedAt,
  candidateKeyHash,
  now,
);

const reactivateUndeliveredDelivery = (
  database,
  candidateLicense,
  delivery,
  now,
) => [
  database.prepare(`
    UPDATE licenses
    SET key_hash = ?, email_lookup = ?, stripe_customer_id = ?,
        stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ?),
        updated_at = ?
    WHERE source = 'stripe'
      AND admin_status = 'active'
      AND stripe_subscription_id = ?
      AND EXISTS (
        SELECT 1 FROM stripe_entitlements e
        WHERE e.license_id = licenses.id AND e.billing_state = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM license_delivery_outbox d
        WHERE d.license_id = licenses.id
          AND d.status IN ('cancelled', 'dead_letter')
          AND d.first_provider_attempt_at IS NULL
      )
  `).bind(
    candidateLicense.keyHash,
    candidateLicense.emailLookup,
    candidateLicense.stripeCustomerId,
    candidateLicense.stripeCheckoutSessionId,
    now,
    candidateLicense.stripeSubscriptionId,
  ),
  database.prepare(`
    UPDATE license_delivery_outbox
    SET encrypted_payload = ?, status = 'pending', attempts = 0,
        next_attempt_at = ?, lease_token = NULL, lease_expires_at = NULL,
        last_error_code = NULL, updated_at = ?
    WHERE license_id = (
      SELECT id FROM licenses WHERE key_hash = ?
    )
      AND status IN ('cancelled', 'dead_letter')
      AND first_provider_attempt_at IS NULL
  `).bind(
    delivery.encryptedPayload,
    now,
    now,
    candidateLicense.keyHash,
  ),
];

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
      record.eventId,
      record.eventType,
      record.objectId,
      record.livemode ? 1 : 0,
      record.eventCreatedAt,
      record.receivedAt,
      record.receivedAt,
    ).run();
    return Boolean(result.meta?.changes);
  }

  async claimEvents({ now, leaseToken, leaseExpiresAt, limit }) {
    const rows = await this.database.prepare(`
      SELECT event_id FROM stripe_event_inbox
      WHERE (status = 'pending' OR (status = 'processing' AND lease_expires_at <= ?))
        AND next_attempt_at <= ?
      ORDER BY event_created_at, received_at, event_id
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
      SELECT * FROM stripe_event_inbox
      WHERE lease_token = ? AND status = 'processing'
      ORDER BY event_created_at, received_at, event_id
    `).bind(leaseToken).all();
    return (claimed.results || []).map(mapEvent);
  }

  async markEventProcessed(eventId, leaseToken, now) {
    await this.database.prepare(`
      UPDATE stripe_event_inbox
      SET status = 'processed', processed_at = ?, lease_token = NULL,
          lease_expires_at = NULL, last_error_code = NULL
      WHERE event_id = ? AND status = 'processing' AND lease_token = ?
    `).bind(now, eventId, leaseToken).run();
  }

  async rescheduleEvent(eventId, leaseToken, { attempts, nextAttemptAt, errorCode, deadLetter }) {
    await this.database.prepare(`
      UPDATE stripe_event_inbox
      SET status = ?, attempts = ?, next_attempt_at = ?, last_error_code = ?,
          lease_token = NULL, lease_expires_at = NULL
      WHERE event_id = ? AND status = 'processing' AND lease_token = ?
    `).bind(
      deadLetter ? 'dead_letter' : 'pending',
      attempts,
      nextAttemptAt,
      errorCode,
      eventId,
      leaseToken,
    ).run();
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

  async recordSubscriptionSnapshot(record) {
    await this.database.batch([
      subscriptionEventInsert(this.database, record),
      ...recomputeStatements(this.database, record.recordedAt),
    ]);
  }

  async applySubscriptionDeleted(record) {
    return this.recordSubscriptionSnapshot(record);
  }

  async applyPaidInvoice({ invoice, payment, candidateLicense, delivery, now }) {
    const eligible = `
      EXISTS (
        SELECT 1 FROM stripe_invoices i
        WHERE i.stripe_invoice_id = ?
          AND i.period_end > ?
          AND NOT EXISTS (
            SELECT 1 FROM stripe_refund_facts r
            WHERE r.payment_fully_refunded = 1
              AND (
                (r.stripe_payment_intent_id IS NOT NULL AND r.stripe_payment_intent_id = i.stripe_payment_intent_id)
                OR (r.stripe_charge_id IS NOT NULL AND r.stripe_charge_id = i.stripe_charge_id)
              )
          )
          AND COALESCE((
            SELECT MAX(se.event_created_at)
            FROM stripe_subscription_events se
            WHERE se.stripe_subscription_id = i.stripe_subscription_id
              AND se.event_type = 'customer.subscription.deleted'
          ), 0) < i.paid_event_created_at
      )
    `;
    await this.database.batch([
      paidInvoiceUpsert(this.database, invoice),
      paymentUpsert(this.database, payment),
      licenseInsert(this.database, candidateLicense, eligible, [invoice.stripeInvoiceId, now]),
      ...recomputeStatements(this.database, now),
      ...reactivateUndeliveredDelivery(
        this.database,
        candidateLicense,
        delivery,
        now,
      ),
      deliveryInsert(this.database, delivery, candidateLicense.keyHash, now),
    ]);
  }

  async applyLifetimePayment({ payment, candidateLicense, delivery, now }) {
    const eligible = `
      EXISTS (
        SELECT 1 FROM stripe_payments p
        WHERE p.stripe_checkout_session_id = ?
          AND p.payment_status = 'paid'
          AND NOT EXISTS (
            SELECT 1 FROM stripe_refund_facts r
            WHERE r.payment_fully_refunded = 1
              AND (
                (r.stripe_payment_intent_id IS NOT NULL AND r.stripe_payment_intent_id = p.stripe_payment_intent_id)
                OR (r.stripe_charge_id IS NOT NULL AND r.stripe_charge_id = p.stripe_charge_id)
              )
          )
      )
    `;
    await this.database.batch([
      paymentUpsert(this.database, payment),
      licenseInsert(
        this.database,
        candidateLicense,
        eligible,
        [payment.stripeCheckoutSessionId],
      ),
      ...recomputeStatements(this.database, now),
      deliveryInsert(this.database, delivery, candidateLicense.keyHash, now),
    ]);
  }

  async applyRefundSnapshot(record) {
    const facts = [record, record.chargeSnapshot].filter(Boolean);
    await this.database.batch([
      ...facts.map((fact) => refundUpsert(this.database, fact)),
      ...recomputeStatements(this.database, record.updatedAt),
    ]);
  }

  async claimDeliveries({ now, leaseToken, leaseExpiresAt, limit }) {
    const rows = await this.database.prepare(`
      SELECT id FROM license_delivery_outbox
      WHERE (
        status = 'pending'
        OR (
          status IN ('leased', 'authorized')
          AND (lease_token IS NULL OR lease_expires_at <= ?)
        )
      )
        AND next_attempt_at <= ?
        AND NOT (${blockingEventWorkSql})
      ORDER BY created_at, id
      LIMIT ?
    `).bind(now, now, now, limit).all();
    const statements = (rows.results || []).map((row) => this.database.prepare(`
      UPDATE license_delivery_outbox
      SET status = CASE WHEN status = 'authorized' THEN 'authorized' ELSE 'leased' END,
          lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ?
        AND (
          status = 'pending'
          OR (
            status IN ('leased', 'authorized')
            AND (lease_token IS NULL OR lease_expires_at <= ?)
          )
        )
        AND NOT (${blockingEventWorkSql})
    `).bind(leaseToken, leaseExpiresAt, now, row.id, now, now));
    if (statements.length) await this.database.batch(statements);
    const claimed = await this.database.prepare(`
      SELECT * FROM license_delivery_outbox
      WHERE lease_token = ? AND status IN ('leased', 'authorized')
      ORDER BY created_at, id
    `).bind(leaseToken).all();
    return (claimed.results || []).map(mapDelivery);
  }

  async authorizeDeliverySend(id, leaseToken, now) {
    const results = await this.database.batch([
      this.database.prepare(`
        UPDATE license_delivery_outbox
        SET status = 'cancelled', encrypted_payload = NULL, updated_at = ?,
            lease_token = NULL, lease_expires_at = NULL
        WHERE id = ? AND status = 'leased' AND lease_token = ?
          AND NOT EXISTS (
            SELECT 1
            FROM licenses l
            JOIN stripe_entitlements e ON e.license_id = l.id
            WHERE l.id = license_delivery_outbox.license_id
              AND l.admin_status = 'active'
              AND e.billing_state = 'active'
              AND (l.expires_at IS NULL OR l.expires_at > ?)
          )
      `).bind(now, id, leaseToken, now),
      this.database.prepare(`
        UPDATE license_delivery_outbox
        SET status = 'authorized',
            authorized_at = COALESCE(authorized_at, ?),
            first_provider_attempt_at = COALESCE(first_provider_attempt_at, ?),
            updated_at = ?
        WHERE id = ? AND lease_token = ?
          AND encrypted_payload IS NOT NULL
          AND NOT (${blockingEventWorkSql})
          AND (
            status = 'authorized'
            OR (
              status = 'leased'
              AND EXISTS (
                SELECT 1
                FROM licenses l
                JOIN stripe_entitlements e ON e.license_id = l.id
                WHERE l.id = license_delivery_outbox.license_id
                  AND l.admin_status = 'active'
                  AND e.billing_state = 'active'
                  AND (l.expires_at IS NULL OR l.expires_at > ?)
              )
            )
          )
      `).bind(now, now, now, id, leaseToken, now, now),
      this.database.prepare(`
        UPDATE license_delivery_outbox
        SET status = 'pending', updated_at = ?, lease_token = NULL,
            lease_expires_at = NULL
        WHERE id = ? AND status = 'leased' AND lease_token = ?
          AND (${blockingEventWorkSql})
      `).bind(now, id, leaseToken, now),
    ]);
    return Boolean(results[1]?.meta?.changes);
  }

  async markDeliveryDelivered(id, leaseToken, messageId, now) {
    await this.database.prepare(`
      UPDATE license_delivery_outbox
      SET status = 'delivered', encrypted_payload = NULL, provider_message_id = ?,
          delivered_at = ?, updated_at = ?, lease_token = NULL,
          lease_expires_at = NULL, last_error_code = NULL
      WHERE id = ? AND status = 'authorized' AND lease_token = ?
    `).bind(messageId, now, now, id, leaseToken).run();
  }

  async markDeliveryManualReview(id, leaseToken, errorCode, now) {
    await this.database.prepare(`
      UPDATE license_delivery_outbox
      SET status = 'manual_review', last_error_code = ?, updated_at = ?,
          lease_token = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'authorized' AND lease_token = ?
    `).bind(errorCode, now, id, leaseToken).run();
  }

  async rescheduleDelivery(
    id,
    leaseToken,
    { attempts, nextAttemptAt, errorCode, deadLetter, manualReview, now },
  ) {
    await this.database.prepare(`
      UPDATE license_delivery_outbox
      SET status = CASE
            WHEN ? = 1 THEN 'manual_review'
            WHEN ? = 1 THEN 'dead_letter'
            WHEN status = 'authorized' THEN 'authorized'
            ELSE 'pending'
          END,
          attempts = ?, next_attempt_at = ?, last_error_code = ?,
          updated_at = ?, lease_token = NULL, lease_expires_at = NULL
      WHERE id = ? AND status IN ('leased', 'authorized') AND lease_token = ?
    `).bind(
      manualReview ? 1 : 0,
      deadLetter ? 1 : 0,
      attempts,
      nextAttemptAt,
      errorCode,
      now,
      id,
      leaseToken,
    ).run();
  }

  async cancelDeliveryForLicense(licenseId, now) {
    const result = await this.database.prepare(`
      UPDATE license_delivery_outbox
      SET status = 'cancelled', encrypted_payload = NULL, updated_at = ?,
          lease_token = NULL, lease_expires_at = NULL
      WHERE license_id = ? AND status IN ('pending', 'leased', 'dead_letter')
    `).bind(now, licenseId).run();
    return Boolean(result.meta?.changes);
  }

  async requeueDelivery(id, now) {
    const result = await this.database.prepare(`
      UPDATE license_delivery_outbox
      SET status = 'pending', attempts = 0, next_attempt_at = ?, updated_at = ?,
          lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL
      WHERE id = ? AND status = 'dead_letter'
        AND first_provider_attempt_at IS NULL
        AND encrypted_payload IS NOT NULL
    `).bind(now, now, id).run();
    if (result.meta?.changes) return { requeued: true, manualReviewRequired: false };
    const row = await this.database.prepare(`
      SELECT status, first_provider_attempt_at
      FROM license_delivery_outbox WHERE id = ?
    `).bind(id).first();
    return {
      requeued: false,
      manualReviewRequired: row?.status === 'manual_review'
        || row?.status === 'authorized'
        || Boolean(row?.first_provider_attempt_at),
    };
  }
}
