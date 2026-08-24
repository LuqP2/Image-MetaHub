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
  constructor(private database: DatabaseSync) {}

  prepare(sql: string) { return new SqliteD1Statement(this.database, sql); }

  async batch(statements: SqliteD1Statement[]) {
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
  let repository: D1StripeBillingRepository;

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:');
    const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
    sqlite.exec(await fs.readFile(path.join(migrationsDirectory, '0001_initial.sql'), 'utf8'));
    sqlite.exec(await fs.readFile(path.join(migrationsDirectory, '0002_stripe_billing.sql'), 'utf8'));
    repository = new D1StripeBillingRepository(new SqliteD1Database(sqlite) as any);
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
});
