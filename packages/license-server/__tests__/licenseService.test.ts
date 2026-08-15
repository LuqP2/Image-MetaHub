import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyActivationCertificate } from '../../../utils/licenseCertificate.mjs';
import { createEd25519TestKeys, testCrypto } from '../../../__tests__/licenseCryptoTestHelpers';
import { LicenseService } from '../src/licenseService.js';

class InMemoryRepository {
  licenses = new Map<string, any>();
  activations = new Map<string, any>();

  async createLicense(record: any) {
    if ([...this.licenses.values()].some((license) => license.keyHash === record.keyHash)) {
      throw new Error('UNIQUE constraint failed');
    }
    this.licenses.set(record.id, { ...record });
    return record;
  }

  async findLicenseById(id: string) {
    return this.licenses.get(id) ?? null;
  }

  async findLicenseByKeyHash(keyHash: string) {
    return [...this.licenses.values()].find((license) => license.keyHash === keyHash) ?? null;
  }

  async findLicenseForActivation(keyHash: string, emailLookup: string) {
    return [...this.licenses.values()].find(
      (license) => license.keyHash === keyHash && license.emailLookup === emailLookup,
    ) ?? null;
  }

  async findLicenseBySourceAndEmailLookup(source: string, emailLookup: string) {
    return [...this.licenses.values()].find(
      (license) => license.source === source && license.emailLookup === emailLookup,
    ) ?? null;
  }

  async updateLicense(id: string, patch: any) {
    const next = { ...this.licenses.get(id), ...patch };
    this.licenses.set(id, next);
    return next;
  }

  async activateInstallation(record: any, maxActivations: number | null) {
    const key = `${record.licenseId}:${record.installationHash}`;
    const existing = this.activations.get(key);
    const activeCount = [...this.activations.values()].filter(
      (activation) => activation.licenseId === record.licenseId && !activation.deactivatedAt,
    ).length;
    if (!existing?.deactivatedAt && existing) {
      const next = { ...existing, lastSeenAt: record.lastSeenAt, appVersion: record.appVersion, platform: record.platform };
      this.activations.set(key, next);
      return next;
    }
    if (maxActivations !== null && activeCount >= maxActivations) return null;
    const next = { ...(existing ?? record), ...record, deactivatedAt: null };
    this.activations.set(key, next);
    return next;
  }

  async findActivation(licenseId: string, installationHash: string) {
    return this.activations.get(`${licenseId}:${installationHash}`) ?? null;
  }

  async touchActivation(licenseId: string, installationHash: string, lastSeenAt: string) {
    const key = `${licenseId}:${installationHash}`;
    const activation = this.activations.get(key);
    if (!activation || activation.deactivatedAt) return false;
    activation.lastSeenAt = lastSeenAt;
    return true;
  }

  async deactivateActivation(licenseId: string, installationHash: string, deactivatedAt: string) {
    const activation = this.activations.get(`${licenseId}:${installationHash}`);
    if (activation && !activation.deactivatedAt) activation.deactivatedAt = deactivatedAt;
    return true;
  }
}

describe('license server entitlement service', () => {
  let keys: Awaited<ReturnType<typeof createEd25519TestKeys>>;
  let repository: InMemoryRepository;
  let now: Date;
  let service: LicenseService;

  beforeAll(async () => {
    keys = await createEd25519TestKeys();
  });

  beforeEach(() => {
    repository = new InMemoryRepository();
    now = new Date('2026-08-13T12:00:00.000Z');
    service = new LicenseService({
      repository,
      emailPepper: 'test-only-email-pepper-value',
      signingPrivateKey: keys.privateKey,
      signingPublicKey: keys.publicKey,
      cryptoApi: testCrypto,
      now: () => now,
    });
  });

  it('creates and activates a random lifetime license', async () => {
    const created = await service.createLicense({ email: 'Buyer@Example.com', plan: 'lifetime', maxActivations: 1 });
    expect(created.licenseKey).toMatch(/^IMH2-(?:[A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
    expect(created.license.keyHash).not.toContain(created.licenseKey);

    const activation = await service.activate({
      email: 'buyer@example.com',
      licenseKey: created.licenseKey,
      installationId: 'installation-one',
    });
    const payload = await verifyActivationCertificate(
      activation.certificate,
      keys.publicKey,
      { installationId: 'installation-one', now },
      testCrypto,
    );
    expect(payload.plan).toBe('lifetime');
    expect(payload.expiresAt).toBeNull();
    expect(created.license.maxActivations).toBeNull();
    await expect(service.activate({
      email: 'buyer@example.com',
      licenseKey: created.licenseKey,
      installationId: 'installation-two',
    })).resolves.toHaveProperty('certificate');
  });

  it('rejects an invalid key and a wrong email with the same public error', async () => {
    const created = await service.createLicense({ email: 'buyer@example.com', plan: 'lifetime' });
    await expect(service.activate({
      email: 'buyer@example.com',
      licenseKey: 'IMH2-2222-2222-2222-2222-2222-2222-2222-2222',
      installationId: 'installation-one',
    })).rejects.toMatchObject({ code: 'invalid_credentials', status: 401 });
    await expect(service.activate({
      email: 'wrong@example.com',
      licenseKey: created.licenseKey,
      installationId: 'installation-one',
    })).rejects.toMatchObject({ code: 'invalid_credentials', status: 401 });
  });

  it('retains generic activation limits for time-bounded products', async () => {
    const created = await service.createLicense({
      email: 'buyer@example.com',
      plan: 'monthly',
      expiresAt: '2026-09-13T12:00:00.000Z',
      maxActivations: 1,
    });
    await service.activate({ email: 'buyer@example.com', licenseKey: created.licenseKey, installationId: 'installation-one' });
    await expect(service.activate({
      email: 'buyer@example.com',
      licenseKey: created.licenseKey,
      installationId: 'installation-one',
    })).resolves.toHaveProperty('certificate');
    await expect(service.activate({
      email: 'buyer@example.com',
      licenseKey: created.licenseKey,
      installationId: 'installation-two',
    })).rejects.toMatchObject({ code: 'activation_limit_reached' });
  });

  it('supports deactivation and reactivation', async () => {
    const created = await service.createLicense({
      email: 'buyer@example.com',
      plan: 'monthly',
      expiresAt: '2026-09-13T12:00:00.000Z',
      maxActivations: 1,
    });
    const first = await service.activate({ email: 'buyer@example.com', licenseKey: created.licenseKey, installationId: 'installation-one' });
    await expect(service.deactivate({ certificate: first.certificate })).resolves.toEqual({ deactivated: true });
    await expect(service.activate({
      email: 'buyer@example.com',
      licenseKey: created.licenseKey,
      installationId: 'installation-one',
    })).resolves.toHaveProperty('certificate');
  });

  it('rejects refresh after revocation', async () => {
    const created = await service.createLicense({ email: 'buyer@example.com', plan: 'lifetime' });
    const activation = await service.activate({ email: 'buyer@example.com', licenseKey: created.licenseKey, installationId: 'installation-one' });
    await service.updateLicense(created.license.id, { status: 'revoked' });
    await expect(service.refresh({ certificate: activation.certificate })).rejects.toMatchObject({ code: 'entitlement_revoked' });
  });

  it('rejects a tampered refresh certificate as invalid activation state', async () => {
    const created = await service.createLicense({ email: 'buyer@example.com', plan: 'lifetime' });
    const activation = await service.activate({ email: 'buyer@example.com', licenseKey: created.licenseKey, installationId: 'installation-one' });
    const parts = activation.certificate.split('.');
    parts[1] = `${parts[1].slice(0, 8)}${parts[1][8] === 'A' ? 'B' : 'A'}${parts[1].slice(9)}`;
    await expect(service.refresh({ certificate: parts.join('.') })).rejects.toMatchObject({ code: 'activation_invalid', status: 401 });
  });

  it.each(['monthly', 'annual'] as const)('enforces %s expiration locally and on refresh', async (plan) => {
    const created = await service.createLicense({
      email: `${plan}@example.com`,
      plan,
      expiresAt: '2026-09-13T12:00:00.000Z',
    });
    const activation = await service.activate({ email: `${plan}@example.com`, licenseKey: created.licenseKey, installationId: `installation-${plan}` });
    now = new Date('2026-09-14T12:00:00.000Z');
    await expect(verifyActivationCertificate(
      activation.certificate,
      keys.publicKey,
      { installationId: `installation-${plan}`, now },
      testCrypto,
    )).rejects.toThrow('expired');
    await expect(service.refresh({ certificate: activation.certificate })).rejects.toMatchObject({ code: 'entitlement_expired' });
  });

  it('reissues historical licenses idempotently as fresh unlimited IMH2 lifetime entitlements', async () => {
    const reissuedKey = 'IMH2-2222-2222-2222-2222-2222-2222-2222-2222';
    const first = await service.reissueHistoricalLicense({ email: 'legacy@example.com', licenseKey: reissuedKey });
    const duplicate = await service.reissueHistoricalLicense({ email: 'legacy@example.com', licenseKey: reissuedKey });
    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(first.license).toMatchObject({ plan: 'lifetime', source: 'legacy_reissue', maxActivations: null, expiresAt: null });
    await expect(service.activate({
      email: 'legacy@example.com',
      licenseKey: reissuedKey,
      installationId: 'legacy-installation',
    })).resolves.toHaveProperty('certificate');
    await expect(service.activate({
      email: 'legacy@example.com',
      licenseKey: reissuedKey,
      installationId: 'legacy-installation-two',
    })).resolves.toHaveProperty('certificate');
    await expect(service.reissueHistoricalLicense({
      email: 'legacy@example.com',
      licenseKey: 'IMH2-3333-3333-3333-3333-3333-3333-3333-3333',
    })).rejects.toMatchObject({ code: 'license_conflict' });
  });

  it('requires the dedicated operation for the legacy_reissue source', async () => {
    await expect(service.createLicense({
      email: 'legacy@example.com',
      plan: 'lifetime',
      source: 'legacy_reissue',
    })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('rejects HMAC-era credentials at the public activation boundary', async () => {
    await expect(service.activate({
      email: 'not-issued@example.com',
      licenseKey: 'ABCD-EFGH-IJKL-MNOP-QRST',
      installationId: 'fabricated-installation',
    })).rejects.toMatchObject({ code: 'invalid_credentials' });
  });
});
