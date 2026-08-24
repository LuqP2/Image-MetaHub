// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { D1LicenseRepository } from '../src/d1Repository.js';
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
  failNextBatchWith: Error | null = null;

  constructor(private database: DatabaseSync) {}

  prepare(sql: string) { return new SqliteD1Statement(this.database, sql); }

  async batch(statements: SqliteD1Statement[]) {
    if (this.failNextBatchWith) {
      const error = this.failNextBatchWith;
      this.failNextBatchWith = null;
      throw error;
    }
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

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);
const now = '2026-08-24T12:00:00.000Z';
const period1 = '2026-09-24T00:00:00.000Z';
const period2 = '2026-10-24T00:00:00.000Z';

const candidate = (
  suffix: string,
  expiresAt: string,
  checkoutSessionId = 'cs_1',
) => ({
  id: `lic_${suffix}`,
  keyHash: `hash_${suffix}`,
  emailLookup: `email_${suffix}`,
  plan: 'monthly',
  status: 'active',
  source: 'stripe',
  createdAt: now,
  updatedAt: now,
  expiresAt,
  maxActivations: null,
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  stripePriceId: 'price_monthly',
  stripeCheckoutSessionId: checkoutSessionId,
  externalReference: `in_${suffix}`,
});

const delivery = (suffix: string) => ({
  id: `delivery_${suffix}`,
  licenseId: `lic_${suffix}`,
  encryptedPayload: `encrypted_${suffix}`,
  nextAttemptAt: now,
  createdAt: now,
  updatedAt: now,
});

const paidInvoice = (suffix: string, eventCreatedAt: number, periodEnd: string) => ({
  invoice: {
    stripeInvoiceId: `in_${suffix}`,
    stripeSubscriptionId: 'sub_1',
    stripePriceId: 'price_monthly',
    plan: 'monthly',
    stripePaymentIntentId: `pi_${suffix}`,
    stripeChargeId: `ch_${suffix}`,
    periodStart: '2026-08-24T00:00:00.000Z',
    periodEnd,
    amountPaid: 499,
    currency: 'usd',
    eventId: `evt_paid_${suffix}`,
    eventCreatedAt,
    createdAt: now,
    updatedAt: now,
  },
  payment: {
    paymentReference: `pi_${suffix}`,
    paymentKind: 'subscription',
    stripePaymentIntentId: `pi_${suffix}`,
    stripeChargeId: `ch_${suffix}`,
    stripeCheckoutSessionId: suffix === '1' ? 'cs_1' : null,
    stripeInvoiceId: `in_${suffix}`,
    stripeSubscriptionId: 'sub_1',
    amountPaid: 499,
    currency: 'usd',
    eventId: `evt_paid_${suffix}`,
    eventCreatedAt,
    createdAt: now,
    updatedAt: now,
  },
  candidateLicense: candidate(suffix, periodEnd, suffix === '1' ? 'cs_1' : null),
  delivery: delivery(suffix),
  now,
});

const deletion = (eventCreatedAt: number) => ({
  eventId: `evt_deleted_${eventCreatedAt}`,
  eventType: 'customer.subscription.deleted',
  stripeSubscriptionId: 'sub_1',
  billingStatus: 'canceled',
  stripePriceId: 'price_monthly',
  cancelAtPeriodEnd: false,
  eventCreatedAt,
  recordedAt: now,
});

const fullRefund = (suffix: string, eventCreatedAt = 400) => ({
  factId: `refund:re_${suffix}`,
  stripeRefundId: `re_${suffix}`,
  stripePaymentIntentId: `pi_${suffix}`,
  stripeChargeId: `ch_${suffix}`,
  refundStatus: 'succeeded',
  amount: 499,
  currency: 'usd',
  paymentFullyRefunded: true,
  eventId: `evt_refund_${suffix}`,
  eventCreatedAt,
  createdAt: now,
  updatedAt: now,
});

const permutations = <T,>(values: T[]): T[][] => {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) => (
    permutations([...values.slice(0, index), ...values.slice(index + 1)])
      .map((rest) => [value, ...rest])
  ));
};

describe('D1 Stripe billing reducer', () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    while (databases.length) databases.pop()?.close();
  });

  async function setup() {
    const sqlite = new DatabaseSync(':memory:');
    databases.push(sqlite);
    sqlite.exec(await fs.readFile(path.join(migrationsDirectory, '0001_initial.sql'), 'utf8'));
    sqlite.exec(await fs.readFile(path.join(migrationsDirectory, '0002_stripe_billing.sql'), 'utf8'));
    const database = new SqliteD1Database(sqlite);
    return {
      sqlite,
      database,
      repository: new D1StripeBillingRepository(database),
    };
  }

  it('preserves every pre-existing administrative status while migrating 0001', async () => {
    const sqlite = new DatabaseSync(':memory:');
    databases.push(sqlite);
    sqlite.exec(await fs.readFile(path.join(migrationsDirectory, '0001_initial.sql'), 'utf8'));
    const insert = sqlite.prepare(`
      INSERT INTO licenses (
        id, key_hash, email_lookup, plan, status, source, created_at, updated_at,
        expires_at, max_activations
      ) VALUES (?, ?, ?, 'lifetime', ?, 'manual', ?, ?, NULL, NULL)
    `);
    for (const status of ['active', 'revoked', 'cancelled', 'expired']) {
      insert.run(`lic_${status}`, `hash_${status}`, `email_${status}`, status, now, now);
    }
    sqlite.exec(await fs.readFile(path.join(migrationsDirectory, '0002_stripe_billing.sql'), 'utf8'));
    expect(sqlite.prepare('SELECT status, admin_status FROM licenses ORDER BY id').all())
      .toEqual([
        { status: 'active', admin_status: 'active' },
        { status: 'cancelled', admin_status: 'cancelled' },
        { status: 'expired', admin_status: 'expired' },
        { status: 'revoked', admin_status: 'revoked' },
      ]);

    sqlite.prepare(`UPDATE licenses SET status = 'revoked' WHERE id = 'lic_active'`).run();
    expect(sqlite.prepare(`SELECT status, admin_status FROM licenses WHERE id = 'lic_active'`).get())
      .toEqual({ status: 'revoked', admin_status: 'revoked' });

    sqlite.prepare(`UPDATE licenses SET admin_status = 'active' WHERE id = 'lic_active'`).run();
    expect(sqlite.prepare(`SELECT status, admin_status FROM licenses WHERE id = 'lic_active'`).get())
      .toEqual({ status: 'active', admin_status: 'active' });

    sqlite.prepare(`
      INSERT INTO licenses (
        id, key_hash, email_lookup, plan, status, source, created_at, updated_at,
        expires_at, max_activations
      ) VALUES ('lic_old_worker', 'hash_old_worker', 'email_old_worker', 'lifetime',
        'cancelled', 'manual', ?, ?, NULL, NULL)
    `).run(now, now);
    expect(sqlite.prepare(`SELECT status, admin_status FROM licenses WHERE id = 'lic_old_worker'`).get())
      .toEqual({ status: 'cancelled', admin_status: 'cancelled' });
  });

  it('converges to the same entitlement for every delivery order', async () => {
    const actions = ['paid1', 'deleted', 'paid2', 'refund1'] as const;
    const snapshots = [];
    for (const order of permutations([...actions])) {
      const { sqlite, repository } = await setup();
      for (const action of order) {
        if (action === 'paid1') await repository.applyPaidInvoice(paidInvoice('1', 100, period1));
        if (action === 'deleted') await repository.applySubscriptionDeleted(deletion(200));
        if (action === 'paid2') await repository.applyPaidInvoice(paidInvoice('2', 300, period2));
        if (action === 'refund1') await repository.applyRefundSnapshot(fullRefund('1'));
      }
      snapshots.push({
        licenseCount: sqlite.prepare('SELECT COUNT(*) AS count FROM licenses').get(),
        invoiceCount: sqlite.prepare('SELECT COUNT(*) AS count FROM stripe_invoices').get(),
        paymentCount: sqlite.prepare('SELECT COUNT(*) AS count FROM stripe_payments').get(),
        entitlement: sqlite.prepare(`
          SELECT billing_state, paid_through, winning_invoice_id,
                 latest_paid_event_created_at, latest_deletion_event_created_at
          FROM stripe_entitlements
        `).get(),
        outbox: sqlite.prepare(`
          SELECT status, encrypted_payload IS NOT NULL AS has_payload
          FROM license_delivery_outbox
        `).get(),
      });
    }
    for (const snapshot of snapshots) {
      expect(snapshot).toEqual({
        licenseCount: { count: 1 },
        invoiceCount: { count: 2 },
        paymentCount: { count: 2 },
        entitlement: {
          billing_state: 'active',
          paid_through: period2,
          winning_invoice_id: 'in_2',
          latest_paid_event_created_at: 300,
          latest_deletion_event_created_at: 200,
        },
        outbox: { status: 'pending', has_payload: 1 },
      });
    }
  });

  it('lets a same-second deletion block access in either processing order', async () => {
    for (const order of ['paid-first', 'deletion-first']) {
      const { sqlite, repository } = await setup();
      if (order === 'paid-first') {
        await repository.applyPaidInvoice(paidInvoice('1', 200, period1));
        await repository.applySubscriptionDeleted(deletion(200));
      } else {
        await repository.applySubscriptionDeleted(deletion(200));
        await repository.applyPaidInvoice(paidInvoice('1', 200, period1));
      }
      const entitlement = sqlite.prepare('SELECT billing_state FROM stripe_entitlements').get();
      expect(entitlement?.billing_state ?? 'not_provisioned').not.toBe('active');
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM license_delivery_outbox
        WHERE status IN ('pending', 'leased', 'authorized', 'delivered')
      `).get()).toEqual({ count: 0 });
    }
  });

  it('persists an early refund and blocks later provisioning of that payment', async () => {
    const { sqlite, repository } = await setup();
    await repository.applyRefundSnapshot(fullRefund('1', 50));
    await repository.applyPaidInvoice(paidInvoice('1', 100, period1));
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM stripe_invoices').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM licenses').get()).toEqual({ count: 0 });
  });

  it('revokes Lifetime only after the payment becomes fully refunded', async () => {
    const { sqlite, repository } = await setup();
    const lifetimeCandidate = {
      ...candidate('life', period1, 'cs_life'),
      plan: 'lifetime',
      expiresAt: null,
      stripeSubscriptionId: null,
      stripePriceId: 'price_lifetime',
      externalReference: 'pi_life',
    };
    await repository.applyLifetimePayment({
      payment: {
        paymentReference: 'pi_life',
        paymentKind: 'lifetime',
        stripePaymentIntentId: 'pi_life',
        stripeChargeId: 'ch_life',
        stripeCheckoutSessionId: 'cs_life',
        stripeInvoiceId: null,
        stripeSubscriptionId: null,
        amountPaid: 3900,
        currency: 'usd',
        eventId: 'evt_life',
        eventCreatedAt: 100,
        createdAt: now,
        updatedAt: now,
      },
      candidateLicense: lifetimeCandidate,
      delivery: {
        ...delivery('life'),
        licenseId: lifetimeCandidate.id,
      },
      now,
    });
    expect(sqlite.prepare(`
      SELECT billing_state FROM stripe_entitlements
    `).get()).toEqual({ billing_state: 'active' });
    await repository.applyRefundSnapshot({
      ...fullRefund('life'),
      stripePaymentIntentId: 'pi_life',
      stripeChargeId: 'ch_life',
      amount: 3900,
    });
    expect(sqlite.prepare(`
      SELECT billing_state FROM stripe_entitlements
    `).get()).toEqual({ billing_state: 'refunded' });
    expect(sqlite.prepare(`
      SELECT status, encrypted_payload FROM license_delivery_outbox
    `).get()).toEqual({ status: 'cancelled', encrypted_payload: null });
  });

  it('does not let an old-period refund reduce a newer paid period', async () => {
    const { sqlite, repository } = await setup();
    await repository.applyPaidInvoice(paidInvoice('1', 100, period1));
    await repository.applyPaidInvoice(paidInvoice('2', 300, period2));
    await repository.applyRefundSnapshot(fullRefund('1'));
    expect(sqlite.prepare(`
      SELECT billing_state, paid_through, winning_invoice_id
      FROM stripe_entitlements
    `).get()).toEqual({
      billing_state: 'active',
      paid_through: period2,
      winning_invoice_id: 'in_2',
    });
  });

  it('keeps administrative revocation separate from every Stripe transition', async () => {
    const { sqlite, repository } = await setup();
    await repository.applyPaidInvoice(paidInvoice('1', 100, period1));
    sqlite.prepare(`UPDATE licenses SET admin_status = 'revoked'`).run();
    await repository.applySubscriptionDeleted(deletion(200));
    await repository.applyRefundSnapshot(fullRefund('1'));
    await repository.applyPaidInvoice(paidInvoice('2', 300, period2));
    expect(sqlite.prepare(`
      SELECT admin_status, plan, expires_at FROM licenses
    `).get()).toEqual({
      admin_status: 'revoked',
      plan: 'monthly',
      expires_at: period2,
    });
    expect(sqlite.prepare(`
      SELECT billing_state, paid_through FROM stripe_entitlements
    `).get()).toEqual({ billing_state: 'active', paid_through: period2 });
    expect(sqlite.prepare(`
      SELECT status, encrypted_payload FROM license_delivery_outbox
    `).get()).toEqual({ status: 'cancelled', encrypted_payload: null });
  });

  it('preserves the public status contract while admin and billing states stay separate', async () => {
    const { database, repository } = await setup();
    const licenses = new D1LicenseRepository(database);
    await repository.applyPaidInvoice(paidInvoice('1', 100, period1));
    const licenseId = (await licenses.findLicenseByKeyHash('hash_1'))?.id;
    expect(licenseId).toBeTruthy();
    expect(await licenses.findLicenseById(licenseId)).toMatchObject({
      status: 'active',
      adminStatus: 'active',
      billingState: 'active',
    });
    await licenses.updateLicense(licenseId, {
      status: 'revoked',
      updatedAt: now,
    });
    await repository.applyPaidInvoice(paidInvoice('2', 300, period2));
    expect(await licenses.findLicenseById(licenseId)).toMatchObject({
      status: 'revoked',
      adminStatus: 'revoked',
      billingState: 'active',
      expiresAt: period2,
    });
    await licenses.updateLicense(licenseId, {
      status: 'active',
      updatedAt: now,
    });
    expect(await licenses.findLicenseById(licenseId)).toMatchObject({
      status: 'active',
      adminStatus: 'active',
      billingState: 'active',
    });
    await repository.applyRefundSnapshot(fullRefund('2'));
    expect(await licenses.findLicenseById(licenseId)).toMatchObject({
      status: 'active',
      adminStatus: 'active',
      billingState: 'active',
      expiresAt: period1,
    });
    await repository.applyRefundSnapshot(fullRefund('1', 401));
    expect(await licenses.findLicenseById(licenseId)).toMatchObject({
      status: 'expired',
      adminStatus: 'active',
      billingState: 'expired',
    });
  });

  it('cancels a claimed delivery before authorization but honors the authorization boundary', async () => {
    const first = await setup();
    await first.repository.applyPaidInvoice(paidInvoice('1', 100, period1));
    const claimed = await first.repository.claimDeliveries({
      now,
      leaseToken: 'lease_before',
      leaseExpiresAt: period1,
      limit: 1,
    });
    expect(claimed).toHaveLength(1);
    await first.repository.applySubscriptionDeleted(deletion(200));
    expect(await first.repository.authorizeDeliverySend(
      claimed[0].id,
      'lease_before',
      now,
    )).toBe(false);

    const second = await setup();
    await second.repository.applyPaidInvoice(paidInvoice('1', 100, period1));
    const authorized = await second.repository.claimDeliveries({
      now,
      leaseToken: 'lease_after',
      leaseExpiresAt: period1,
      limit: 1,
    });
    expect(await second.repository.authorizeDeliverySend(
      authorized[0].id,
      'lease_after',
      now,
    )).toBe(true);
    await second.repository.applySubscriptionDeleted(deletion(200));
    expect(second.sqlite.prepare(`
      SELECT status FROM license_delivery_outbox
    `).get()).toEqual({ status: 'authorized' });
    await second.repository.markDeliveryDelivered(
      authorized[0].id,
      'lease_after',
      'email_1',
      now,
    );
    expect(second.sqlite.prepare(`
      SELECT status, provider_message_id FROM license_delivery_outbox
    `).get()).toEqual({ status: 'delivered', provider_message_id: 'email_1' });
  });

  it('rolls back the whole command when D1 rejects its batch', async () => {
    const { sqlite, database, repository } = await setup();
    database.failNextBatchWith = new Error('D1_ERROR: overloaded');
    await expect(repository.applyPaidInvoice(paidInvoice('1', 100, period1)))
      .rejects.toThrow('overloaded');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM stripe_invoices').get())
      .toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM licenses').get())
      .toEqual({ count: 0 });
  });
});
