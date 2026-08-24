import {
  effectiveLicenseStatus,
  LEGACY_STATUS_PROJECTION_SQL,
} from './licenseStatusProjection.js';

const mapLicense = (row) => row && ({
  id: row.id,
  keyHash: row.key_hash,
  emailLookup: row.email_lookup,
  plan: row.plan,
  status: effectiveLicenseStatus(row),
  adminStatus: row.admin_status,
  billingState: row.billing_state ?? null,
  source: row.source,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  expiresAt: row.expires_at,
  maxActivations: row.max_activations,
  stripeCustomerId: row.stripe_customer_id,
  stripeSubscriptionId: row.stripe_subscription_id,
  stripePriceId: row.stripe_price_id,
  stripeCheckoutSessionId: row.stripe_checkout_session_id,
  externalReference: row.external_reference,
});

const LICENSE_SELECT = `
  SELECT licenses.*, stripe_entitlements.billing_state
  FROM licenses
  LEFT JOIN stripe_entitlements ON stripe_entitlements.license_id = licenses.id
`;

const mapActivation = (row) => row && ({
  id: row.id,
  licenseId: row.license_id,
  installationHash: row.installation_hash,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  deactivatedAt: row.deactivated_at,
  appVersion: row.app_version,
  platform: row.platform,
});

export class D1LicenseRepository {
  constructor(database) {
    this.database = database;
  }

  async createLicense(record) {
    await this.database.prepare(`
      INSERT INTO licenses (
        id, key_hash, email_lookup, plan, status, admin_status, source, created_at, updated_at,
        expires_at, max_activations, stripe_customer_id, stripe_subscription_id,
        stripe_price_id, stripe_checkout_session_id, external_reference
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      record.id,
      record.keyHash,
      record.emailLookup,
      record.plan,
      record.status,
      record.status,
      record.source,
      record.createdAt,
      record.updatedAt,
      record.expiresAt,
      record.maxActivations,
      record.stripeCustomerId,
      record.stripeSubscriptionId,
      record.stripePriceId,
      record.stripeCheckoutSessionId,
      record.externalReference,
    ).run();
    return record;
  }

  async findLicenseById(id) {
    return mapLicense(await this.database.prepare(`${LICENSE_SELECT} WHERE licenses.id = ?`).bind(id).first());
  }

  async findLicenseByKeyHash(keyHash) {
    return mapLicense(await this.database.prepare(`${LICENSE_SELECT} WHERE licenses.key_hash = ?`).bind(keyHash).first());
  }

  async findLicenseForActivation(keyHash, emailLookupValue) {
    return mapLicense(await this.database.prepare(
      `${LICENSE_SELECT} WHERE licenses.key_hash = ? AND licenses.email_lookup = ?`,
    ).bind(keyHash, emailLookupValue).first());
  }

  async findLicenseBySourceAndEmailLookup(source, emailLookupValue) {
    return mapLicense(await this.database.prepare(
      `${LICENSE_SELECT} WHERE licenses.source = ? AND licenses.email_lookup = ?`,
    ).bind(source, emailLookupValue).first());
  }

  async updateLicense(id, patch) {
    const columns = {
      plan: 'plan',
      status: 'admin_status',
      expiresAt: 'expires_at',
      maxActivations: 'max_activations',
      stripeCustomerId: 'stripe_customer_id',
      stripeSubscriptionId: 'stripe_subscription_id',
      stripePriceId: 'stripe_price_id',
      stripeCheckoutSessionId: 'stripe_checkout_session_id',
      externalReference: 'external_reference',
      updatedAt: 'updated_at',
    };
    const entries = Object.entries(patch).filter(([key]) => columns[key]);
    if (entries.length === 0) return this.findLicenseById(id);

    const assignments = [];
    const values = [];
    for (const [key, value] of entries) {
      if (key === 'status') {
        assignments.push('status = ?', 'admin_status = ?');
        values.push(value, value);
      } else {
        assignments.push(`${columns[key]} = ?`);
        values.push(value);
      }
    }
    const update = this.database.prepare(`UPDATE licenses SET ${assignments.join(', ')} WHERE id = ?`)
      .bind(...values, id);
    const syncLegacyStatus = this.database.prepare(`
      UPDATE licenses
      SET status = ${LEGACY_STATUS_PROJECTION_SQL},
          legacy_status_revision = legacy_status_revision + 1
      WHERE id = ?
    `).bind(id);
    const statements = [update, syncLegacyStatus];
    if (patch.status !== undefined && patch.status !== 'active') {
      statements.push(this.database.prepare(`
        UPDATE license_delivery_outbox
        SET status = 'cancelled', encrypted_payload = NULL, updated_at = ?,
            lease_token = NULL, lease_expires_at = NULL
        WHERE license_id = ? AND status IN ('pending', 'leased', 'dead_letter')
      `).bind(patch.updatedAt, id));
    }
    await this.database.batch(statements);
    return this.findLicenseById(id);
  }

  async activateInstallation(record, maxActivations) {
    const result = await this.database.prepare(`
      INSERT INTO activations (
        id, license_id, installation_hash, created_at, last_seen_at,
        deactivated_at, app_version, platform
      )
      SELECT ?, ?, ?, ?, ?, NULL, ?, ?
      WHERE ? IS NULL
        OR EXISTS (
          SELECT 1 FROM activations
          WHERE license_id = ? AND installation_hash = ? AND deactivated_at IS NULL
        )
        OR (
          SELECT COUNT(*) FROM activations
          WHERE license_id = ? AND deactivated_at IS NULL
        ) < ?
      ON CONFLICT(license_id, installation_hash) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        deactivated_at = NULL,
        app_version = excluded.app_version,
        platform = excluded.platform
    `).bind(
      record.id,
      record.licenseId,
      record.installationHash,
      record.createdAt,
      record.lastSeenAt,
      record.appVersion,
      record.platform,
      maxActivations,
      record.licenseId,
      record.installationHash,
      record.licenseId,
      maxActivations,
    ).run();

    if (!result.meta?.changes) return null;
    return this.findActivation(record.licenseId, record.installationHash);
  }

  async findActivation(licenseId, installationHash) {
    return mapActivation(await this.database.prepare(
      'SELECT * FROM activations WHERE license_id = ? AND installation_hash = ?',
    ).bind(licenseId, installationHash).first());
  }

  async touchActivation(licenseId, installationHash, lastSeenAt) {
    const result = await this.database.prepare(`
      UPDATE activations SET last_seen_at = ?
      WHERE license_id = ? AND installation_hash = ? AND deactivated_at IS NULL
    `).bind(lastSeenAt, licenseId, installationHash).run();
    return Boolean(result.meta?.changes);
  }

  async deactivateActivation(licenseId, installationHash, deactivatedAt) {
    await this.database.prepare(`
      UPDATE activations SET deactivated_at = COALESCE(deactivated_at, ?), last_seen_at = ?
      WHERE license_id = ? AND installation_hash = ?
    `).bind(deactivatedAt, deactivatedAt, licenseId, installationHash).run();
    return true;
  }
}
