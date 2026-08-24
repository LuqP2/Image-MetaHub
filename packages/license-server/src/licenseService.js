import { issueActivationCertificate, verifyActivationCertificate } from '../../../utils/licenseCertificate.mjs';
import {
  emailLookup,
  generateRandomLicenseKey,
  normalizeEmail,
  normalizeImh2LicenseKey,
  sha256Hex,
} from './cryptoHelpers.js';
import { LicenseError, requireValue } from './errors.js';

const PLANS = new Set(['lifetime', 'monthly', 'annual']);
const STATUSES = new Set(['active', 'revoked', 'cancelled', 'expired']);
const SOURCES = new Set(['legacy_reissue', 'manual', 'stripe']);
const REFRESH_INTERVAL_MS = {
  lifetime: 7 * 24 * 60 * 60 * 1000,
  monthly: 24 * 60 * 60 * 1000,
  annual: 24 * 60 * 60 * 1000,
};

const optionalString = (value, maxLength = 255) => {
  if (value === undefined || value === null || value === '') return null;
  requireValue(typeof value === 'string' && value.trim().length <= maxLength, 'invalid_request', 'Invalid request.');
  return value.trim();
};

const isoTimestamp = (value, fieldName, { nullable = true, future = false, nowMs = Date.now() } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    throw new LicenseError('invalid_request', `${fieldName} is required.`);
  }
  const timestamp = Date.parse(value);
  requireValue(Number.isFinite(timestamp), 'invalid_request', `${fieldName} must be an ISO-8601 timestamp.`);
  if (future) requireValue(timestamp > nowMs, 'invalid_request', `${fieldName} must be in the future.`);
  return new Date(timestamp).toISOString();
};

function entitlementFailure(license, nowMs) {
  if (!license) return new LicenseError('invalid_credentials', 'Invalid email or license key.', 401);
  if (license.status === 'revoked') return new LicenseError('entitlement_revoked', 'License is not active.', 403);
  if (license.status === 'cancelled') return new LicenseError('entitlement_cancelled', 'License is not active.', 403);
  if (license.status === 'expired') return new LicenseError('entitlement_expired', 'License has expired.', 403);
  if (license.status !== 'active') return new LicenseError('entitlement_inactive', 'License is not active.', 403);
  if (license.expiresAt && Date.parse(license.expiresAt) <= nowMs) {
    return new LicenseError('entitlement_expired', 'License has expired.', 403);
  }
  return null;
}

export class LicenseService {
  constructor({ repository, emailPepper, signingPrivateKey, signingPublicKey, cryptoApi = globalThis.crypto, now = () => new Date() }) {
    this.repository = repository;
    this.emailPepper = emailPepper;
    this.signingPrivateKey = signingPrivateKey;
    this.signingPublicKey = signingPublicKey;
    this.cryptoApi = cryptoApi;
    this.now = now;
  }

  nowDate() {
    const value = this.now();
    return value instanceof Date ? value : new Date(value);
  }

  async buildLicenseRecord(input, plaintextKey) {
    const now = this.nowDate();
    const plan = input.plan ?? 'lifetime';
    requireValue(PLANS.has(plan), 'invalid_request', 'Unsupported license plan.');
    requireValue(SOURCES.has(input.source), 'invalid_request', 'Unsupported license source.');
    const expiresAt = plan === 'lifetime'
      ? null
      : isoTimestamp(input.expiresAt, 'expiresAt', { nullable: false, future: true, nowMs: now.getTime() });
    const requestedMaxActivations = input.maxActivations === undefined || input.maxActivations === null
      ? null
      : Number(input.maxActivations);
    requireValue(
      requestedMaxActivations === null || (Number.isInteger(requestedMaxActivations) && requestedMaxActivations >= 1),
      'invalid_request',
      'maxActivations must be a positive integer or null.',
    );
    const maxActivations = plan === 'lifetime' ? null : requestedMaxActivations;
    const status = input.status ?? 'active';
    requireValue(STATUSES.has(status), 'invalid_request', 'Unsupported license status.');

    return {
      id: this.cryptoApi.randomUUID(),
      keyHash: await sha256Hex(normalizeImh2LicenseKey(plaintextKey), this.cryptoApi),
      emailLookup: await emailLookup(normalizeEmail(input.email), this.emailPepper, this.cryptoApi),
      plan,
      status,
      source: input.source,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt,
      maxActivations,
      stripeCustomerId: optionalString(input.stripeCustomerId),
      stripeSubscriptionId: optionalString(input.stripeSubscriptionId),
      stripePriceId: optionalString(input.stripePriceId),
      stripeCheckoutSessionId: optionalString(input.stripeCheckoutSessionId),
      externalReference: optionalString(input.externalReference),
    };
  }

  async createLicense(input) {
    requireValue(input.source !== 'legacy_reissue', 'invalid_request', 'Historical reissues must use the dedicated reissue operation.');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const plaintextKey = generateRandomLicenseKey(this.cryptoApi);
      const record = await this.buildLicenseRecord({ ...input, source: input.source ?? 'manual' }, plaintextKey);
      try {
        await this.repository.createLicense(record);
        return { license: record, licenseKey: plaintextKey, created: true };
      } catch (error) {
        if (!/unique|constraint/i.test(String(error?.message || '')) || attempt === 2) throw error;
      }
    }
    throw new Error('Unable to create a unique license key.');
  }

  async prepareLicense(input) {
    requireValue(input.source !== 'legacy_reissue', 'invalid_request', 'Historical reissues must use the dedicated reissue operation.');
    const plaintextKey = generateRandomLicenseKey(this.cryptoApi);
    const record = await this.buildLicenseRecord({ ...input, source: input.source ?? 'manual' }, plaintextKey);
    return { license: record, licenseKey: plaintextKey };
  }

  async reissueHistoricalLicense({ email, licenseKey }) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedKey = normalizeImh2LicenseKey(licenseKey);
    const [lookup, keyHash] = await Promise.all([
      emailLookup(normalizedEmail, this.emailPepper, this.cryptoApi),
      sha256Hex(normalizedKey, this.cryptoApi),
    ]);
    const existing = await this.repository.findLicenseBySourceAndEmailLookup('legacy_reissue', lookup);
    if (existing) {
      if (existing.keyHash === keyHash) return { license: existing, created: false };
      throw new LicenseError('license_conflict', 'Historical license was already reissued.', 409);
    }
    const existingKey = await this.repository.findLicenseByKeyHash(keyHash);
    if (existingKey) throw new LicenseError('license_conflict', 'License could not be reissued.', 409);

    const record = await this.buildLicenseRecord({
      email: normalizedEmail,
      plan: 'lifetime',
      status: 'active',
      source: 'legacy_reissue',
      expiresAt: null,
      maxActivations: null,
    }, normalizedKey);
    try {
      await this.repository.createLicense(record);
      return { license: record, created: true };
    } catch (error) {
      const concurrent = await this.repository.findLicenseBySourceAndEmailLookup('legacy_reissue', lookup);
      if (concurrent?.keyHash === keyHash) return { license: concurrent, created: false };
      throw error;
    }
  }

  async issueCertificate(license, installationId, issuedAt = this.nowDate()) {
    const refreshAtMs = issuedAt.getTime() + REFRESH_INTERVAL_MS[license.plan];
    const refreshAfter = license.expiresAt
      ? new Date(Math.min(refreshAtMs, Date.parse(license.expiresAt))).toISOString()
      : new Date(refreshAtMs).toISOString();
    return issueActivationCertificate({
      licenseId: license.id,
      plan: license.plan,
      installationId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: license.expiresAt,
      refreshAfter,
    }, this.signingPrivateKey, this.cryptoApi);
  }

  async activate({ email, licenseKey, installationId, appVersion, platform }) {
    requireValue(typeof installationId === 'string' && installationId.length >= 8 && installationId.length <= 200, 'invalid_request', 'Invalid request.');
    const [keyHash, lookup, installationHash] = await Promise.all([
      sha256Hex(normalizeImh2LicenseKey(licenseKey), this.cryptoApi),
      emailLookup(normalizeEmail(email), this.emailPepper, this.cryptoApi),
      sha256Hex(installationId, this.cryptoApi),
    ]);
    const license = await this.repository.findLicenseForActivation(keyHash, lookup);
    const now = this.nowDate();
    const failure = entitlementFailure(license, now.getTime());
    if (failure) throw failure;

    const activation = await this.repository.activateInstallation({
      id: this.cryptoApi.randomUUID(),
      licenseId: license.id,
      installationHash,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      appVersion: optionalString(appVersion, 100),
      platform: optionalString(platform, 100),
    }, license.maxActivations);
    if (!activation) {
      throw new LicenseError('activation_limit_reached', 'Activation limit reached.', 409);
    }

    return {
      certificate: await this.issueCertificate(license, installationId, now),
      plan: license.plan,
      expiresAt: license.expiresAt,
    };
  }

  async verifyExistingCertificate(certificate) {
    try {
      return await verifyActivationCertificate(
        certificate,
        this.signingPublicKey,
        { now: this.nowDate(), allowExpired: true },
        this.cryptoApi,
      );
    } catch {
      throw new LicenseError('activation_invalid', 'Activation is not valid.', 401);
    }
  }

  async refresh({ certificate }) {
    const payload = await this.verifyExistingCertificate(certificate);
    const [license, installationHash] = await Promise.all([
      this.repository.findLicenseById(payload.licenseId),
      sha256Hex(payload.installationId, this.cryptoApi),
    ]);
    const now = this.nowDate();
    const failure = entitlementFailure(license, now.getTime());
    if (failure) throw failure;
    const touched = await this.repository.touchActivation(license.id, installationHash, now.toISOString());
    if (!touched) throw new LicenseError('activation_inactive', 'Activation is not active.', 403);

    return {
      certificate: await this.issueCertificate(license, payload.installationId, now),
      plan: license.plan,
      expiresAt: license.expiresAt,
    };
  }

  async deactivate({ certificate }) {
    const payload = await this.verifyExistingCertificate(certificate);
    const installationHash = await sha256Hex(payload.installationId, this.cryptoApi);
    const now = this.nowDate().toISOString();
    await this.repository.deactivateActivation(payload.licenseId, installationHash, now);
    return { deactivated: true };
  }

  async updateLicense(id, input) {
    const current = await this.repository.findLicenseById(id);
    if (!current) throw new LicenseError('not_found', 'License not found.', 404);
    const now = this.nowDate();
    const patch = { updatedAt: now.toISOString() };

    if (input.status !== undefined) {
      requireValue(STATUSES.has(input.status), 'invalid_request', 'Unsupported license status.');
      patch.status = input.status;
    }
    const nextPlan = input.plan ?? current.plan;
    if (input.plan !== undefined) {
      requireValue(PLANS.has(input.plan), 'invalid_request', 'Unsupported license plan.');
      patch.plan = input.plan;
    }
    if (input.expiresAt !== undefined || input.plan !== undefined) {
      patch.expiresAt = nextPlan === 'lifetime'
        ? null
        : isoTimestamp(input.expiresAt ?? current.expiresAt, 'expiresAt', { nullable: false, nowMs: now.getTime() });
    }
    if (nextPlan === 'lifetime') {
      patch.maxActivations = null;
    } else if (input.maxActivations !== undefined) {
      const value = input.maxActivations === null ? null : Number(input.maxActivations);
      requireValue(value === null || (Number.isInteger(value) && value >= 1), 'invalid_request', 'Invalid activation limit.');
      patch.maxActivations = value;
    }
    for (const key of ['stripeCustomerId', 'stripeSubscriptionId', 'stripePriceId', 'stripeCheckoutSessionId', 'externalReference']) {
      if (input[key] !== undefined) patch[key] = optionalString(input[key]);
    }

    return this.repository.updateLicense(id, patch);
  }
}
