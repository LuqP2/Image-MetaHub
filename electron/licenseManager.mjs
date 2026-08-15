import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyActivationCertificate } from '../utils/licenseCertificate.mjs';

const ACTIVATION_FILE_VERSION = 2;
const LEGACY_ACTIVATION_FILE_VERSION = 1;
const NETWORK_TIMEOUT_MS = 10_000;
const REFRESH_RETRY_MS = 15 * 60 * 1000;
const SCHEDULER_SAFETY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
const IMH2_KEY_PATTERN = /^IMH2-(?:[A-Z2-9]{4}-){7}[A-Z2-9]{4}$/i;

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

const comparableStatus = (status) => JSON.stringify({
  authorized: status.authorized,
  licenseStatus: status.licenseStatus,
  plan: status.plan,
  licenseEmail: status.licenseEmail,
  expiresAt: status.expiresAt,
  refreshAfter: status.refreshAfter,
  migrationRequired: status.migrationRequired,
  message: status.message,
});

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
    onStatusChanged = async () => {},
    appVersion = 'unknown',
    platform = process.platform,
    now = () => new Date(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
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
    this.onStatusChanged = onStatusChanged;
    this.appVersion = appVersion;
    this.platform = platform;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.installationIdPath = path.join(userDataPath, 'license-installation-id');
    this.activationPath = path.join(userDataPath, 'license-activation.dat');
    this.installationId = null;
    this.certificate = null;
    this.licenseEmail = null;
    this.lastKnownGoodTimeMs = 0;
    this.clockRollbackDetected = false;
    this.lastMessage = null;
    this.migrationRequired = false;
    this.schedulerTimer = null;
    this.nextRefreshAttemptAtMs = 0;
    this.lastPublishedStatus = null;
    this.refreshPromise = null;
    this.disposed = false;
  }

  async initialize() {
    this.disposed = false;
    await fs.mkdir(this.userDataPath, { recursive: true });
    this.installationId = await this.loadOrCreateInstallationId();
    const settings = await this.readSettings();
    const storedLicense = settings?.license && typeof settings.license === 'object' ? settings.license : {};
    this.licenseEmail = normalizeDisplayEmail(storedLicense.licenseEmail);
    await this.loadActivationState();

    const cached = await this.getStatus();
    if (!cached.authorized && storedLicense.licenseEmail && storedLicense.licenseKey) {
      this.migrationRequired = true;
      this.lastMessage = 'Historical licenses require a reissued IMH2 key. Existing license details were preserved.';
    }

    const status = await this.getStatus();
    if (status.authorized) await this.applyStatusToSettings(status);
    await this.publishStatus(status, { force: true });
    await this.scheduleNextCheck();
    return status;
  }

  nowDate() {
    const value = this.now();
    return value instanceof Date ? value : new Date(value);
  }

  effectiveNowDate() {
    const wallClockMs = this.nowDate().getTime();
    if (!Number.isFinite(wallClockMs)) return new Date(this.lastKnownGoodTimeMs || Date.now());
    this.clockRollbackDetected = this.lastKnownGoodTimeMs > 0
      && wallClockMs + CLOCK_ROLLBACK_TOLERANCE_MS < this.lastKnownGoodTimeMs;
    if (!this.clockRollbackDetected && wallClockMs > this.lastKnownGoodTimeMs) {
      this.lastKnownGoodTimeMs = wallClockMs;
    }
    return new Date(Math.max(wallClockMs, this.lastKnownGoodTimeMs));
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

  buildActivationEnvelope(certificate) {
    const envelope = this.encryptionAvailable()
      ? {
          version: ACTIVATION_FILE_VERSION,
          storage: 'safeStorage',
          data: this.safeStorage.encryptString(certificate).toString('base64'),
        }
      : {
          version: ACTIVATION_FILE_VERSION,
          storage: 'plain',
          data: certificate,
        };
    return {
      ...envelope,
      lastKnownGoodTime: new Date(this.lastKnownGoodTimeMs || this.nowDate().getTime()).toISOString(),
    };
  }

  async persistCertificate(certificate) {
    this.effectiveNowDate();
    await this.atomicWrite(this.activationPath, JSON.stringify(this.buildActivationEnvelope(certificate)));
    this.certificate = certificate;
  }

  async loadActivationState() {
    try {
      const envelope = JSON.parse(await fs.readFile(this.activationPath, 'utf8'));
      if (![LEGACY_ACTIVATION_FILE_VERSION, ACTIVATION_FILE_VERSION].includes(envelope?.version) || typeof envelope.data !== 'string') {
        return;
      }
      const persistedTime = Date.parse(envelope.lastKnownGoodTime);
      if (Number.isFinite(persistedTime)) this.lastKnownGoodTimeMs = persistedTime;
      if (envelope.storage === 'plain') {
        this.certificate = envelope.data;
      } else if (envelope.storage === 'safeStorage' && this.encryptionAvailable()) {
        this.certificate = this.safeStorage.decryptString(Buffer.from(envelope.data, 'base64'));
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') this.lastMessage = 'Saved activation could not be read.';
    }
  }

  async removeCertificate() {
    this.certificate = null;
    this.lastKnownGoodTimeMs = 0;
    try {
      await fs.rm(this.activationPath, { force: true });
    } catch {
      // Status remains unauthorized even if cleanup is delayed by the OS.
    }
  }

  getPreservedStateFileNames() {
    return new Set([path.basename(this.installationIdPath), path.basename(this.activationPath)]);
  }

  async storedPayload() {
    if (!this.certificate || !this.installationId) return null;
    try {
      return await verifyActivationCertificate(
        this.certificate,
        this.publicKey,
        { installationId: this.installationId, now: this.effectiveNowDate(), allowExpired: true },
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
    const payload = await this.storedPayload();
    if (payload) {
      const nowMs = this.effectiveNowDate().getTime();
      if (payload.plan !== 'lifetime' && this.clockRollbackDetected) {
        return emptyStatus({
          licenseEmail: this.licenseEmail,
          message: 'System clock rollback detected. Reconnect and refresh the license.',
        });
      }
      if (payload.plan !== 'lifetime' && Date.parse(payload.expiresAt) <= nowMs) {
        return emptyStatus({ licenseEmail: this.licenseEmail, message: 'License has expired.' });
      }
      return this.statusFromPayload(payload);
    }
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

  async applyStatusToSettings(status) {
    await this.updateSettings((currentSettings) => ({
      ...currentSettings,
      license: {
        ...(currentSettings?.license ?? {}),
        licenseStatus: status.authorized ? status.licenseStatus : 'free',
        licensePlan: status.authorized ? status.plan : null,
        licenseEmail: this.licenseEmail,
        licenseKey: this.migrationRequired ? currentSettings?.license?.licenseKey ?? null : null,
        activationManagedByMain: true,
      },
    }));
  }

  async publishStatus(status, { force = false } = {}) {
    const serialized = comparableStatus(status);
    if (!force && serialized === this.lastPublishedStatus) return;
    this.lastPublishedStatus = serialized;
    try {
      await this.onStatusChanged(status);
    } catch {
      // Renderer notification failure never changes licensing authority.
    }
  }

  clearScheduledCheck() {
    if (this.schedulerTimer !== null) {
      this.clearTimer(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  async scheduleNextCheck() {
    this.clearScheduledCheck();
    if (this.disposed) return;
    const payload = await this.storedPayload();
    if (!payload) return;

    const nowMs = this.effectiveNowDate().getTime();
    const candidates = [nowMs + SCHEDULER_SAFETY_INTERVAL_MS];
    const refreshAfterMs = Date.parse(payload.refreshAfter);
    if (Number.isFinite(refreshAfterMs)) {
      candidates.push(Math.max(refreshAfterMs, this.nextRefreshAttemptAtMs || 0));
    }
    if (payload.plan !== 'lifetime') {
      const expiresAtMs = Date.parse(payload.expiresAt);
      if (Number.isFinite(expiresAtMs) && expiresAtMs > nowMs) candidates.push(expiresAtMs);
    }

    const targetMs = Math.min(...candidates.filter(Number.isFinite));
    const delay = Math.max(0, Math.min(targetMs - nowMs, SCHEDULER_SAFETY_INTERVAL_MS));
    this.schedulerTimer = this.setTimer(() => this.handleScheduledCheck(), delay);
    this.schedulerTimer?.unref?.();
  }

  async handleScheduledCheck() {
    this.schedulerTimer = null;
    if (this.disposed) return;
    const payload = await this.storedPayload();
    if (!payload) {
      const status = await this.getStatus();
      await this.publishStatus(status);
      return;
    }

    const nowMs = this.effectiveNowDate().getTime();
    const status = await this.getStatus();
    if (!status.authorized) {
      await this.applyStatusToSettings(status);
      await this.publishStatus(status);
      if (!this.nextRefreshAttemptAtMs) this.nextRefreshAttemptAtMs = nowMs + REFRESH_RETRY_MS;
      if (nowMs >= this.nextRefreshAttemptAtMs) {
        await this.refresh();
        return;
      }
      await this.scheduleNextCheck();
      return;
    }

    const refreshDue = Date.parse(payload.refreshAfter) <= nowMs
      || (this.nextRefreshAttemptAtMs > 0 && this.nextRefreshAttemptAtMs <= nowMs);
    if (refreshDue) {
      await this.refresh();
      return;
    }

    await this.persistCertificate(this.certificate);
    await this.publishStatus(status);
    await this.scheduleNextCheck();
  }

  async activate(licenseKey, email) {
    const normalizedEmail = normalizeDisplayEmail(email);
    const normalizedKey = typeof licenseKey === 'string' ? licenseKey.trim() : '';
    if (!normalizedEmail || !IMH2_KEY_PATTERN.test(normalizedKey)) {
      this.lastMessage = 'Invalid license for this email.';
      const status = await this.getStatus();
      await this.publishStatus(status);
      return { activated: false, status };
    }

    const response = await this.request('/v1/activate', {
      email: normalizedEmail,
      licenseKey: normalizedKey,
      installationId: this.installationId,
      appVersion: this.appVersion,
      platform: this.platform,
    });
    if (!response.ok) {
      this.lastMessage = response.transient
        ? 'License service is temporarily unavailable.'
        : 'Invalid license for this email.';
      const status = await this.getStatus();
      await this.publishStatus(status);
      await this.scheduleNextCheck();
      return { activated: false, status };
    }

    const certificate = response.data?.activation?.certificate;
    try {
      const payload = await verifyActivationCertificate(
        certificate,
        this.publicKey,
        { installationId: this.installationId, now: this.effectiveNowDate() },
        this.cryptoApi,
      );
      await this.persistCertificate(certificate);
      this.licenseEmail = normalizedEmail;
      this.migrationRequired = false;
      this.nextRefreshAttemptAtMs = 0;
      this.lastMessage = null;
      const status = this.statusFromPayload(payload);
      await this.applyStatusToSettings(status);
      await this.publishStatus(status);
      await this.scheduleNextCheck();
      return { activated: true, status };
    } catch {
      this.lastMessage = 'License service returned an invalid activation.';
      const status = await this.getStatus();
      await this.publishStatus(status);
      return { activated: false, status };
    }
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async performRefresh() {
    const currentPayload = await this.storedPayload();
    if (!currentPayload) return this.getStatus();
    const response = await this.request('/v1/refresh', { certificate: this.certificate });
    if (!response.ok) {
      if (['entitlement_revoked', 'entitlement_cancelled', 'entitlement_expired', 'activation_inactive'].includes(response.code)) {
        await this.removeCertificate();
        this.lastMessage = response.code === 'entitlement_expired' ? 'License has expired.' : 'License is not active.';
      } else {
        this.nextRefreshAttemptAtMs = this.effectiveNowDate().getTime() + REFRESH_RETRY_MS;
        this.lastMessage = 'License service is temporarily unavailable.';
      }
      const status = await this.getStatus();
      await this.applyStatusToSettings(status);
      await this.publishStatus(status);
      await this.scheduleNextCheck();
      return status;
    }

    const certificate = response.data?.activation?.certificate;
    try {
      const payload = await verifyActivationCertificate(
        certificate,
        this.publicKey,
        { installationId: this.installationId, now: this.effectiveNowDate() },
        this.cryptoApi,
      );
      await this.persistCertificate(certificate);
      this.nextRefreshAttemptAtMs = 0;
      this.lastMessage = null;
      const status = this.statusFromPayload(payload);
      await this.applyStatusToSettings(status);
      await this.publishStatus(status);
      await this.scheduleNextCheck();
      return status;
    } catch {
      this.nextRefreshAttemptAtMs = this.effectiveNowDate().getTime() + REFRESH_RETRY_MS;
      const status = await this.getStatus();
      await this.publishStatus(status);
      await this.scheduleNextCheck();
      return status;
    }
  }

  async deactivate() {
    const payload = await this.storedPayload();
    if (!payload) {
      await this.removeCertificate();
      const status = emptyStatus({ licenseEmail: this.licenseEmail });
      await this.publishStatus(status);
      return status;
    }
    const response = await this.request('/v1/deactivate', { certificate: this.certificate });
    if (!response.ok && response.transient) return this.getStatus();
    if (!response.ok && !['activation_inactive', 'entitlement_expired'].includes(response.code)) return this.getStatus();

    await this.removeCertificate();
    this.licenseEmail = null;
    this.lastMessage = null;
    this.migrationRequired = false;
    this.nextRefreshAttemptAtMs = 0;
    const status = emptyStatus();
    await this.applyStatusToSettings(status);
    await this.publishStatus(status);
    this.clearScheduledCheck();
    return status;
  }

  dispose() {
    this.disposed = true;
    this.clearScheduledCheck();
  }
}

export function createLicenseManager(options) {
  return new LicenseManager(options);
}
