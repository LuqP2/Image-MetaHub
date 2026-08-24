// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { D1StripeBillingRepository } from '../src/stripeBillingRepository.js';

class SqliteD1Statement {
  values: unknown[] = [];

  constructor(private database: DatabaseSync, private sql: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }

  async run() { return this.runSync(); }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async first() { return this.database.prepare(this.sql).get(...this.values) ?? null; }
}

class SqliteD1Database {
  private beforeNextBatch: (() => void) | null = null;

  constructor(private database: DatabaseSync) {}

  prepare(sql: string) { return new SqliteD1Statement(this.database, sql); }

  beforeBatch(callback: () => void) { this.beforeNextBatch = callback; }

  async batch(statements: SqliteD1Statement[]) {
    const beforeBatch = this.beforeNextBatch;
    this.beforeNextBatch = null;
    beforeBatch?.();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => statement.runSync());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

const now = '2026-08-23T12:00:00.000Z';
const license = (id = 'lic_1') => ({
  id,
  keyHash: `hash_${id}`,
  emailLookup: `email_${id}`,
  plan: 'monthly',
  status: 'active',
  source: 'stripe',
  createdAt: now,
  updatedAt: now,
  expiresAt: '2026-09-23T00:00:00.000Z',
  maxActivations: null,
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  stripePriceId: 'price_monthly',
  stripeCheckoutSessionId: 'cs_1',
  externalReference: 'in_1',
});

const subscription = {
  stripeSubscriptionId: 'sub_1',
  stripeCustomerId: 'cus_1',
  stripeCheckoutSessionId: 'cs_1',
  licenseId: 'lic_1',
  billingStatus: 'active',
  stripePriceId: 'price_monthly',
  cancelAtPeriodEnd: false,
  paidThrough: '2026-09-23T00:00:00.000Z',
  latestPaidEventCreatedAt: 200,
  endedAt: null,
  lastEventCreatedAt: 200,
  createdAt: now,
  updatedAt: now,
};

const invoice = {
  stripeInvoiceId: 'in_1',
  stripeSubscriptionId: 'sub_1',
  licenseId: 'lic_1',
  stripePriceId: 'price_monthly',
  stripePaymentIntentId: 'pi_1',
  stripeChargeId: 'ch_1',
  invoiceStatus: 'paid',
  periodStart: '2026-08-23T00:00:00.000Z',
  periodEnd: '2026-09-23T00:00:00.000Z',
  amountPaid: 499,
  currency: 'usd',
  paidEventCreatedAt: 200,
  lastEventCreatedAt: 200,
  createdAt: now,
  updatedAt: now,
};

const payment = {
  paymentReference: 'pi_1',
  stripePaymentIntentId: 'pi_1',
  stripeChargeId: 'ch_1',
  stripeCheckoutSessionId: null,
  stripeInvoiceId: 'in_1',
  licenseId: 'lic_1',
  amountPaid: 499,
  currency: 'usd',
  createdAt: now,
  updatedAt: now,
};

const delivery = {
  id: 'delivery_1',
  licenseId: 'lic_1',
  encryptedPayload: '{"v":1,"ciphertext":"encrypted"}',
  nextAttemptAt: now,
  createdAt: now,
  updatedAt: now,
};

describe('D1 Stripe billing repository', () => {
  let sqlite: DatabaseSync;
  let database: SqliteD1Database;
  let repository: D1StripeBillingRepository;

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:');
    const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
    sqlite.exec(await fs.readFile(path.join(migrationsDirectory, '0001_initial.sql'), 'utf8'));
    sqlite.exec(await fs.readFile(path.join(migrationsDirectory, '0002_stripe_billing.sql'), 'utf8'));
    database = new SqliteD1Database(sqlite);
    repository = new D1StripeBillingRepository(database as any);
  });

  afterEach(() => sqlite.close());

  it('commits license, Stripe lookups and encrypted delivery as one batch', async () => {
    await repository.createStripeLicenseBundle({ license: license(), subscription, invoice, payment, delivery });
    expect(await repository.findLicenseBySubscriptionId('sub_1')).toMatchObject({ id: 'lic_1' });
    expect(await repository.findPayment({ paymentIntentId: 'pi_1' })).toMatchObject({ licenseId: 'lic_1' });
    expect(sqlite.prepare('SELECT encrypted_payload FROM license_delivery_outbox').get()).toMatchObject({
      encrypted_payload: delivery.encryptedPayload,
    });
  });

  it('creates a cancelled entitlement when deletion wins the first-invoice race', async () => {
    await repository.upsertSubscription({ ...subscription, licenseId: null });
    database.beforeBatch(() => {
      sqlite.prepare(`
        UPDATE stripe_subscriptions
        SET billing_status = 'canceled', last_event_created_at = 300
        WHERE stripe_subscription_id = 'sub_1'
      `).run();
    });
    await repository.createStripeLicenseBundle({ license: license(), subscription, invoice, payment, delivery });
    expect(await repository.findLicenseById('lic_1')).toMatchObject({ status: 'cancelled' });
    expect(sqlite.prepare('SELECT status, encrypted_payload FROM license_delivery_outbox WHERE id = ?').get('delivery_1'))
      .toMatchObject({ status: 'cancelled', encrypted_payload: null });
  });

  it('rolls back the complete batch if delivery persistence fails', async () => {
    await expect(repository.createStripeLicenseBundle({
      license: license('lic_rollback'),
      subscription: null,
      invoice: null,
      payment: { ...payment, paymentReference: 'pi_rollback', licenseId: 'lic_rollback' },
      delivery: { ...delivery, id: 'delivery_rollback', licenseId: 'lic_rollback', nextAttemptAt: null },
    })).rejects.toThrow();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM licenses WHERE id = 'lic_rollback'").get()).toMatchObject({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM stripe_payments WHERE payment_reference = 'pi_rollback'").get()).toMatchObject({ count: 0 });
  });

  it('cancels pending key delivery atomically with effective subscription deletion', async () => {
    await repository.createStripeLicenseBundle({ license: license(), subscription, invoice, payment, delivery });
    expect(await repository.terminateSubscription('sub_1', 300, '2026-08-24T00:00:00.000Z')).toBe(true);
    expect(await repository.findLicenseById('lic_1')).toMatchObject({ status: 'cancelled' });
    expect(sqlite.prepare('SELECT status, encrypted_payload FROM license_delivery_outbox WHERE id = ?').get('delivery_1'))
      .toMatchObject({ status: 'cancelled', encrypted_payload: null });
  });

  it('does not cancel when a newer paid event commits immediately before deletion', async () => {
    await repository.createStripeLicenseBundle({ license: license(), subscription, invoice, payment, delivery });
    database.beforeBatch(() => {
      sqlite.prepare(`
        UPDATE stripe_subscriptions
        SET latest_paid_event_created_at = 400, paid_through = '2026-10-23T00:00:00.000Z'
        WHERE stripe_subscription_id = 'sub_1'
      `).run();
    });
    expect(await repository.terminateSubscription('sub_1', 300, '2026-08-24T00:00:00.000Z')).toBe(false);
    expect(await repository.findLicenseById('lic_1')).toMatchObject({ status: 'active' });
    expect(sqlite.prepare('SELECT status, encrypted_payload FROM license_delivery_outbox WHERE id = ?').get('delivery_1'))
      .toMatchObject({ status: 'pending', encrypted_payload: delivery.encryptedPayload });
  });

  it('does not let a delayed paid period reactivate a same-or-later fully refunded period', async () => {
    await repository.createStripeLicenseBundle({ license: license(), subscription, invoice, payment, delivery });
    await repository.recordRefund({
      stripeRefundId: 're_1', paymentReference: 'pi_1', licenseId: 'lic_1',
      stripePaymentIntentId: 'pi_1', stripeChargeId: 'ch_1', refundStatus: 'succeeded',
      amount: 499, currency: 'usd', isFullRefund: true, eventCreatedAt: 300,
      createdAt: now, updatedAt: now,
    });
    await repository.revokeRefundedLicense({
      licenseId: 'lic_1', recurring: true,
      refundedPeriodEnd: invoice.periodEnd, now,
    });
    await repository.recordPaidRenewal({
      licenseId: 'lic_1', plan: 'monthly', expiresAt: '2026-09-01T00:00:00.000Z',
      priceId: 'price_monthly', now,
      subscription: { ...subscription, paidThrough: '2026-09-01T00:00:00.000Z', lastEventCreatedAt: 100 },
      invoice: {
        ...invoice, stripeInvoiceId: 'in_old', stripePaymentIntentId: 'pi_old', stripeChargeId: 'ch_old',
        periodEnd: '2026-09-01T00:00:00.000Z', paidEventCreatedAt: 100, lastEventCreatedAt: 100,
      },
      payment: {
        ...payment, paymentReference: 'pi_old', stripePaymentIntentId: 'pi_old', stripeChargeId: 'ch_old',
        stripeInvoiceId: 'in_old',
      },
    });
    expect(await repository.findLicenseById('lic_1')).toMatchObject({ status: 'expired', expires_at: now });
  });

  it('preserves an administrative revocation while recording a later paid period', async () => {
    await repository.createStripeLicenseBundle({ license: license(), subscription, invoice, payment, delivery });
    sqlite.prepare("UPDATE licenses SET status = 'revoked' WHERE id = 'lic_1'").run();
    expect(await repository.cancelDeliveryForLicense('lic_1', now)).toBe(true);
    expect(sqlite.prepare('SELECT status, encrypted_payload FROM license_delivery_outbox WHERE id = ?').get('delivery_1'))
      .toMatchObject({ status: 'cancelled', encrypted_payload: null });
    expect(await repository.terminateSubscription('sub_1', 250, now)).toBe(true);
    expect(await repository.findLicenseById('lic_1')).toMatchObject({ status: 'revoked' });
    expect(await repository.revokeRefundedLicense({
      licenseId: 'lic_1', recurring: true, refundedPeriodEnd: invoice.periodEnd, now,
    })).toBe(true);
    expect(await repository.findLicenseById('lic_1')).toMatchObject({ status: 'revoked' });
    const expiresAt = '2026-10-23T00:00:00.000Z';
    await repository.recordPaidRenewal({
      licenseId: 'lic_1', plan: 'monthly', expiresAt,
      priceId: 'price_monthly', now,
      subscription: { ...subscription, paidThrough: expiresAt, latestPaidEventCreatedAt: 300, lastEventCreatedAt: 300 },
      invoice: {
        ...invoice, stripeInvoiceId: 'in_renewed', stripePaymentIntentId: 'pi_renewed',
        stripeChargeId: 'ch_renewed', periodEnd: expiresAt, paidEventCreatedAt: 300, lastEventCreatedAt: 300,
      },
      payment: {
        ...payment, paymentReference: 'pi_renewed', stripePaymentIntentId: 'pi_renewed',
        stripeChargeId: 'ch_renewed', stripeInvoiceId: 'in_renewed',
      },
    });
    expect(await repository.findLicenseById('lic_1')).toMatchObject({ status: 'revoked', expires_at: expiresAt });
  });

  it('does not apply an old-period refund when a newer invoice commits immediately before it', async () => {
    await repository.createStripeLicenseBundle({ license: license(), subscription, invoice, payment, delivery });
    database.beforeBatch(() => {
      sqlite.prepare(`
        INSERT INTO stripe_invoices (
          stripe_invoice_id, stripe_subscription_id, license_id, stripe_price_id,
          invoice_status, period_end, paid_event_created_at, last_event_created_at,
          created_at, updated_at
        ) VALUES ('in_newer', 'sub_1', 'lic_1', 'price_monthly', 'paid',
          '2026-10-23T00:00:00.000Z', 400, 400, ?, ?)
      `).run(now, now);
    });
    expect(await repository.revokeRefundedLicense({
      licenseId: 'lic_1', recurring: true,
      refundedPeriodEnd: invoice.periodEnd, now,
    })).toBe(false);
    expect(await repository.findLicenseById('lic_1')).toMatchObject({ status: 'active' });
    expect(sqlite.prepare('SELECT status, encrypted_payload FROM license_delivery_outbox WHERE id = ?').get('delivery_1'))
      .toMatchObject({ status: 'pending', encrypted_payload: delivery.encryptedPayload });
  });

  it('does not send or finalize a delivery cancelled after it was claimed', async () => {
    await repository.createStripeLicenseBundle({ license: license(), subscription, invoice, payment, delivery });
    const claimed = await repository.claimDeliveries({
      now, leaseToken: 'lease_1', leaseExpiresAt: '2026-08-23T12:05:00.000Z', limit: 1,
    });
    expect(claimed).toHaveLength(1);
    await repository.terminateSubscription('sub_1', 300, now);
    expect(await repository.authorizeDeliverySend('delivery_1', 'lease_1', now)).toBe(false);
    await repository.markDeliveryDelivered('delivery_1', 'lease_1', 'email_should_not_commit', now);
    expect(sqlite.prepare(`
      SELECT status, encrypted_payload, provider_message_id FROM license_delivery_outbox WHERE id = ?
    `).get('delivery_1')).toMatchObject({
      status: 'cancelled', encrypted_payload: null, provider_message_id: null,
    });
  });

  it('does not let a stale event worker finalize a stolen lease', async () => {
    await repository.enqueueEvent({
      eventId: 'evt_lease', eventType: 'invoice.paid', objectId: 'in_lease',
      livemode: false, eventCreatedAt: 100, receivedAt: now,
    });
    await repository.claimEvents({
      now, leaseToken: 'lease_old', leaseExpiresAt: '2026-08-23T12:05:00.000Z', limit: 1,
    });
    sqlite.prepare(`
      UPDATE stripe_event_inbox SET lease_token = 'lease_new' WHERE event_id = 'evt_lease'
    `).run();
    await repository.markEventProcessed('evt_lease', 'lease_old', now);
    await repository.rescheduleEvent('evt_lease', 'lease_old', {
      attempts: 1, nextAttemptAt: now, errorCode: 'stale', deadLetter: false,
    });
    expect(sqlite.prepare(`
      SELECT status, lease_token, attempts FROM stripe_event_inbox WHERE event_id = 'evt_lease'
    `).get()).toMatchObject({ status: 'processing', lease_token: 'lease_new', attempts: 0 });
  });
});
