import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyActivationCertificate } from '../utils/licenseCertificate.mjs';

const ACTIVATION_FILE_VERSION = 1;
const NETWORK_TIMEOUT_MS = 10_000;

const emptyStatus = (overrides = {}) => ({
  authorized: false,
  licenseStatus: 'free',
  plan: null,
  licenseEmail: null,
  expiresAt: null,
  refreshAfter: null,
  migrationRequired: false,
  message: null,
  ...overrides,
});

const normalizeDisplayEmail = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized && normalized.length <= 320 ? normalized : null;
};

export class LicenseManager {
  constructor({
    userDataPath,
    serverUrl,
    publicKey,
    safeStorage,
    fetchImpl = globalThis.fetch,
    cryptoApi = crypto.webcrypto,
    randomUUID = crypto.randomUUID,
    readSettings = async () => ({}),
    updateSettings = async () => {},
    appVersion = 'unknown',
    platform = process.platform,
    now = () => new Date(),
  }) {
    this.userDataPath = userDataPath;
    this.serverUrl = String(serverUrl || '').replace(/\/$/, '');
    this.publicKey = publicKey;
    this.safeStorage = safeStorage;
    this.fetchImpl = fetchImpl;
    this.cryptoApi = cryptoApi;
    this.randomUUID = randomUUID;
    this.readSettings = readSettings;
    this.updateSettings = updateSettings;
    this.appVersion = appVersion;
    this.platform = platform;
    this.now = now;
    this.installationIdPath = path.join(userDataPath, 'license-installation-id');
    this.activationPath = path.join(userDataPath, 'license-activation.dat');
    this.installationId = null;
    this.certificate = null;
    this.licenseEmail = null;
    this.lastMessage = null;
    this.migrationRequired = false;
  }

  async initialize() {
    await fs.mkdir(this.userDataPath, { recursive: true });
    this.installationId = await this.loadOrCreateInstallationId();
    const settings = await this.readSettings();
    const legacy = settings?.license && typeof settings.license === 'object' ? settings.license : {};
    this.licenseEmail = normalizeDisplayEmail(legacy.licenseEmail);
    this.certificate = await this.loadCertificate();

    const cached = await this.getStatus();
    if (cached.authorized) {
      if (Date.parse(cached.refreshAfter) <= this.nowDate().getTime()) {
        void this.refresh();
      }
      return cached;
    }

    if (legacy.licenseEmail && legacy.licenseKey) {
      this.migrationRequired = true;
      const result = await this.activate(legacy.licenseKey, legacy.licenseEmail, { migration: true });
      if (!result.authorized && result.message === null) {
        this.lastMessage = 'Connect to the internet once to migrate this license.';
      }
      return this.getStatus();
    }
    return cached;
  }

  nowDate() {
    const value = this.now();
    return value instanceof Date ? value : new Date(value);
  }

  async loadOrCreateInstallationId() {
    try {
      const existing = (await fs.readFile(this.installationIdPath, 'utf8')).trim();
      if (/^[A-Za-z0-9._:-]{8,200}$/.test(existing)) return existing;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const installationId = this.randomUUID();
    await this.atomicWrite(this.installationIdPath, `${installationId}\n`);
    return installationId;
  }

  async atomicWrite(filePath, contents) {
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, contents, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tempPath, filePath);
  }

  encryptionAvailable() {
    try {
      return Boolean(this.safeStorage?.isEncryptionAvailable?.());
    } catch {
      return false;
    }
  }

  async persistCertificate(certificate) {
    let envelope;
    if (this.encryptionAvailable()) {
      envelope = {
        version: ACTIVATION_FILE_VERSION,
        storage: 'safeStorage',
        data: this.safeStorage.encryptString(certificate).toString('base64'),
      };
    } else {
      // The fallback contains only a signed certificate, never the license key.
      // File permissions plus signature verification protect it from casual edits.
      envelope = { version: ACTIVATION_FILE_VERSION, storage: 'plain', data: certificate };
    }
    await this.atomicWrite(this.activationPath, JSON.stringify(envelope));
    this.certificate = certificate;
  }

  async loadCertificate() {
    try {
      const envelope = JSON.parse(await fs.readFile(this.activationPath, 'utf8'));
      if (envelope?.version !== ACTIVATION_FILE_VERSION || typeof envelope.data !== 'string') return null;
      if (envelope.storage === 'plain') return envelope.data;
      if (envelope.storage === 'safeStorage' && this.encryptionAvailable()) {
        return this.safeStorage.decryptString(Buffer.from(envelope.data, 'base64'));
      }
      return null;
    } catch (error) {
      if (error?.code !== 'ENOENT') this.lastMessage = 'Saved activation could not be read.';
      return null;
    }
  }

  async removeCertificate() {
    this.certificate = null;
    try {
      await fs.rm(this.activationPath, { force: true });
    } catch {
      // Status remains unauthorized even if cleanup is delayed by the OS.
    }
  }

  async verifiedPayload({ allowExpired = false } = {}) {
    if (!this.certificate) return null;
    try {
      return await verifyActivationCertificate(
        this.certificate,
        this.publicKey,
        { installationId: this.installationId, now: this.nowDate(), allowExpired },
        this.cryptoApi,
      );
    } catch {
      return null;
    }
  }

  statusFromPayload(payload) {
    return {
      authorized: true,
      licenseStatus: payload.plan === 'lifetime' ? 'lifetime' : 'pro',
      plan: payload.plan,
      licenseEmail: this.licenseEmail,
      expiresAt: payload.expiresAt,
      refreshAfter: payload.refreshAfter,
      migrationRequired: false,
      message: this.lastMessage,
    };
  }

  async getStatus() {
    const payload = await this.verifiedPayload();
    if (payload) return this.statusFromPayload(payload);
    return emptyStatus({
      licenseEmail: this.licenseEmail,
      migrationRequired: this.migrationRequired,
      message: this.lastMessage,
    });
  }

  async request(pathname, body) {
    if (!this.serverUrl || this.serverUrl.endsWith('.invalid')) {
      return { ok: false, transient: true, code: 'service_unavailable' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${this.serverUrl}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      return {
        ok: response.ok,
        transient: response.status >= 500 || response.status === 429,
        code: data?.error?.code ?? null,
        message: data?.error?.message ?? null,
        data,
      };
    } catch {
      return { ok: false, transient: true, code: 'service_unavailable' };
    } finally {
      clearTimeout(timeout);
    }
  }

  async applyAuthorizedSettings(payload) {
    await this.updateSettings((currentSettings) => ({
      ...currentSettings,
      license: {
        ...(currentSettings?.license ?? {}),
        licenseStatus: payload.plan === 'lifetime' ? 'lifetime' : 'pro',
        licensePlan: payload.plan,
        licenseEmail: this.licenseEmail,
        licenseKey: null,
        activationManagedByMain: true,
      },
    }));
  }

  async activate(licenseKey, email, options = {}) {
    const normalizedEmail = normalizeDisplayEmail(email);
    if (!normalizedEmail || typeof licenseKey !== 'string' || !licenseKey.trim()) {
      this.lastMessage = 'Invalid license for this email.';
      return this.getStatus();
    }

    const response = await this.request('/v1/activate', {
      email: normalizedEmail,
      licenseKey: licenseKey.trim(),
      installationId: this.installationId,
      appVersion: this.appVersion,
      platform: this.platform,
    });
    if (!response.ok) {
      this.migrationRequired = Boolean(options.migration);
      this.lastMessage = response.transient && options.migration
        ? 'Connect to the internet once to migrate this license.'
        : response.transient
          ? 'License service is temporarily unavailable.'
          : 'Invalid license for this email.';
      return this.getStatus();
    }

    const certificate = response.data?.activation?.certificate;
    try {
      const payload = await verifyActivationCertificate(
        certificate,
        this.publicKey,
        { installationId: this.installationId, now: this.nowDate() },
        this.cryptoApi,
      );
      await this.persistCertificate(certificate);
      this.licenseEmail = normalizedEmail;
      this.migrationRequired = false;
      this.lastMessage = null;
      await this.applyAuthorizedSettings(payload);
      return this.statusFromPayload(payload);
    } catch {
      this.lastMessage = 'License service returned an invalid activation.';
      return this.getStatus();
    }
  }

  async refresh() {
    const currentPayload = await this.verifiedPayload();
    if (!currentPayload) return this.getStatus();
    const response = await this.request('/v1/refresh', { certificate: this.certificate });
    if (!response.ok) {
      if (['entitlement_revoked', 'entitlement_cancelled', 'entitlement_expired', 'activation_inactive'].includes(response.code)) {
        await this.removeCertificate();
        this.lastMessage = response.code === 'entitlement_expired' ? 'License has expired.' : 'License is not active.';
      }
      return this.getStatus();
    }

    const certificate = response.data?.activation?.certificate;
    try {
      const payload = await verifyActivationCertificate(
        certificate,
        this.publicKey,
        { installationId: this.installationId, now: this.nowDate() },
        this.cryptoApi,
      );
      await this.persistCertificate(certificate);
      this.lastMessage = null;
      await this.applyAuthorizedSettings(payload);
      return this.statusFromPayload(payload);
    } catch {
      return this.statusFromPayload(currentPayload);
    }
  }

  async deactivate() {
    const payload = await this.verifiedPayload({ allowExpired: true });
    if (!payload) {
      await this.removeCertificate();
      return emptyStatus({ licenseEmail: this.licenseEmail });
    }
    const response = await this.request('/v1/deactivate', { certificate: this.certificate });
    if (!response.ok && response.transient) return this.getStatus();
    if (!response.ok && !['activation_inactive', 'entitlement_expired'].includes(response.code)) return this.getStatus();

    await this.removeCertificate();
    this.licenseEmail = null;
    this.lastMessage = null;
    this.migrationRequired = false;
    await this.updateSettings((currentSettings) => ({
      ...currentSettings,
      license: {
        ...(currentSettings?.license ?? {}),
        licenseStatus: 'free',
        licensePlan: null,
        licenseEmail: null,
        licenseKey: null,
        activationManagedByMain: true,
      },
    }));
    return emptyStatus();
  }
}

export function createLicenseManager(options) {
  return new LicenseManager(options);
}
