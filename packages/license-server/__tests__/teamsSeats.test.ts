import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyActivationCertificate } from '../../../utils/licenseCertificate.mjs';
import { createEd25519TestKeys, testCrypto } from '../../../__tests__/licenseCryptoTestHelpers';
import { LicenseService } from '../src/licenseService.js';

class InMemoryTeamsRepository {
  licenses = new Map<string, any>();
  activations = new Map<string, any>();

  async createLicense(record: any) {
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

  async updateLicense(id: string, patch: any) {
    const next = { ...this.licenses.get(id), ...patch };
    this.licenses.set(id, next);
    return next;
  }

  async activateInstallation(record: any, maxActivations: number | null) {
    const key = `${record.licenseId}:${record.installationHash}`;
    const existing = this.activations.get(key);
    const activeCount = [...this.activations.values()].filter(
      (a) => a.licenseId === record.licenseId && !a.deactivatedAt,
    ).length;
    if (existing && !existing.deactivatedAt) {
      const next = { ...existing, lastSeenAt: record.lastSeenAt, deviceLabel: record.deviceLabel ?? existing.deviceLabel };
      this.activations.set(key, next);
      return next;
    }
    if (maxActivations !== null && activeCount >= maxActivations) return null;
    const next = { ...(existing ?? record), ...record, deactivatedAt: null };
    this.activations.set(key, next);
    return next;
  }

  async listActivationsForLicense(licenseId: string) {
    return [...this.activations.values()].filter((a) => a.licenseId === licenseId);
  }

  async revokeActivationById(licenseId: string, activationId: string, deactivatedAt: string) {
    for (const [key, value] of this.activations.entries()) {
      if (value.licenseId === licenseId && value.id === activationId && !value.deactivatedAt) {
        this.activations.set(key, { ...value, deactivatedAt, lastSeenAt: deactivatedAt });
        return true;
      }
    }
    return false;
  }
}

describe('Teams per-seat licensing (1 seat = 1 active machine)', () => {
  let keys: { privateKey: string; publicKey: string };
  let repo: InMemoryTeamsRepository;
  let service: LicenseService;
  const now = new Date('2026-11-23T12:00:00.000Z');
  const futureExpiry = '2027-11-23T12:00:00.000Z';

  beforeAll(async () => {
    keys = await createEd25519TestKeys();
  });

  beforeEach(() => {
    repo = new InMemoryTeamsRepository();
    service = new LicenseService({
      repository: repo,
      emailPepper: 'test-pepper-at-least-16-chars',
      signingPrivateKey: keys.privateKey,
      signingPublicKey: keys.publicKey,
      cryptoApi: testCrypto,
      now: () => now,
    });
  });

  it('enforces 1 commercial seat = 1 active machine, supports seat revocation, and dynamically scales seatLimit', async () => {
    const created = await service.createLicense({
      email: 'billing@studio-alpha.com',
      plan: 'annual',
      tier: 'teams',
      orgName: 'Studio Alpha',
      seatLimit: 2,
      expiresAt: futureExpiry,
      source: 'stripe',
    });

    expect(created.license.tier).toBe('teams');
    expect(created.license.seatLimit).toBe(2);
    expect(created.license.maxActivations).toBe(2);

    // Machine 1 & Machine 2 activate cleanly
    const act1 = await service.activate({
      email: 'billing@studio-alpha.com',
      licenseKey: created.licenseKey,
      installationId: 'machine-0001-uuid',
      appVersion: '0.24.0',
      platform: 'win32',
      deviceLabel: 'WORKSTATION-01',
    });
    expect(act1.tier).toBe('teams');
    expect(act1.orgName).toBe('Studio Alpha');
    expect(act1.seatLimit).toBe(2);

    const verifiedPayload = await verifyActivationCertificate(
      act1.certificate,
      keys.publicKey,
      { now, installationId: 'machine-0001-uuid' },
      testCrypto,
    );
    expect(verifiedPayload.tier).toBe('teams');
    expect(verifiedPayload.orgName).toBe('Studio Alpha');
    expect(verifiedPayload.seatLimit).toBe(2);

    await service.activate({
      email: 'billing@studio-alpha.com',
      licenseKey: created.licenseKey,
      installationId: 'machine-0002-uuid',
      appVersion: '0.24.0',
      platform: 'darwin',
      deviceLabel: 'MACBOOK-DIRECTOR',
    });

    // Machine 3 is blocked because 2/2 commercial seats are occupied
    await expect(service.activate({
      email: 'billing@studio-alpha.com',
      licenseKey: created.licenseKey,
      installationId: 'machine-0003-uuid',
      appVersion: '0.24.0',
      platform: 'win32',
      deviceLabel: 'WORKSTATION-03',
    })).rejects.toMatchObject({ code: 'activation_limit_reached', status: 409 });

    // Admin lists active seats and revokes Machine 1
    const seatList = await service.listTeamSeats({
      email: 'billing@studio-alpha.com',
      licenseKey: created.licenseKey,
    });
    expect(seatList.activeSeats).toBe(2);
    expect(seatList.seatLimit).toBe(2);
    const ws1 = seatList.activations.find((a) => a.deviceLabel === 'WORKSTATION-01');
    expect(ws1).toBeTruthy();

    const revokeResult = await service.revokeTeamSeat({
      email: 'billing@studio-alpha.com',
      licenseKey: created.licenseKey,
      activationId: ws1!.id,
    });
    expect(revokeResult.revoked).toBe(true);

    // Machine 3 can now activate immediately using the freed seat
    const act3 = await service.activate({
      email: 'billing@studio-alpha.com',
      licenseKey: created.licenseKey,
      installationId: 'machine-0003-uuid',
      appVersion: '0.24.0',
      platform: 'win32',
      deviceLabel: 'WORKSTATION-03',
    });
    expect(act3.tier).toBe('teams');

    // Upgrading seatLimit from 2 -> 4 allows Machine 4 immediately
    await service.updateLicense(created.license.id, { tier: 'teams', seatLimit: 4 });
    const act4 = await service.activate({
      email: 'billing@studio-alpha.com',
      licenseKey: created.licenseKey,
      installationId: 'machine-0004-uuid',
      appVersion: '0.24.0',
      platform: 'linux',
      deviceLabel: 'RENDER-NODE-04',
    });
    expect(act4.seatLimit).toBe(4);
  });

  it('rejects creating a teams license without a positive seatLimit', async () => {
    await expect(service.createLicense({
      email: 'billing@studio-beta.com',
      plan: 'monthly',
      tier: 'teams',
      expiresAt: futureExpiry,
      source: 'manual',
    })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
