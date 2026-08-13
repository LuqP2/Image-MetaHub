import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LicenseManager } from '../electron/licenseManager.mjs';
import { issueActivationCertificate } from '../utils/licenseCertificate.mjs';
import { createEd25519TestKeys, testCrypto } from './licenseCryptoTestHelpers';

const now = new Date('2026-08-13T12:00:00.000Z');

describe('Electron license manager', () => {
  let keys: Awaited<ReturnType<typeof createEd25519TestKeys>>;
  const tempDirectories: string[] = [];

  beforeAll(async () => {
    keys = await createEd25519TestKeys();
  });

  afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  });

  async function makeDirectory() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-license-test-'));
    tempDirectories.push(directory);
    return directory;
  }

  async function certificate(installationId: string, plan: 'lifetime' | 'monthly' | 'annual' = 'lifetime', expiresAt: string | null = null) {
    return issueActivationCertificate({
      licenseId: 'license-test-id',
      plan,
      installationId,
      issuedAt: now.toISOString(),
      expiresAt,
      refreshAfter: '2026-08-20T12:00:00.000Z',
    }, keys.privateKey, testCrypto);
  }

  const plainStorage = { isEncryptionAvailable: () => false };

  it('keeps a cached lifetime activation usable offline and reloads it', async () => {
    const directory = await makeDirectory();
    const fetchForActivation = async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ activation: { certificate: await certificate(request.installationId) } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const first = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      fetchImpl: fetchForActivation,
      cryptoApi: testCrypto,
      randomUUID: () => 'installation-persisted',
      now: () => now,
    });
    await first.initialize();
    expect(await first.activate('IMH2-TEST-LICENSE-KEY2', 'buyer@example.com')).toMatchObject({ authorized: true, licenseStatus: 'lifetime' });

    const reloaded = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      fetchImpl: async () => { throw new Error('offline'); },
      cryptoApi: testCrypto,
      now: () => now,
    });
    expect(await reloaded.initialize()).toMatchObject({ authorized: true, licenseStatus: 'lifetime' });
  });

  it('automatically migrates legacy settings and removes the raw key only after success', async () => {
    const directory = await makeDirectory();
    let settings: any = { license: { licenseStatus: 'pro', licenseEmail: 'legacy@example.com', licenseKey: 'ABCD-EFGH-IJKL-MNOP-QRST' } };
    const manager = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => 'legacy-installation',
      now: () => now,
      readSettings: async () => settings,
      updateSettings: async (updater: (value: any) => any) => { settings = await updater(settings); },
      fetchImpl: async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ activation: { certificate: await certificate(request.installationId) } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    expect(await manager.initialize()).toMatchObject({ authorized: true, licenseStatus: 'lifetime' });
    expect(settings.license).toMatchObject({ licenseEmail: 'legacy@example.com', licenseKey: null, activationManagedByMain: true });
  });

  it('preserves legacy migration data when the service is offline', async () => {
    const directory = await makeDirectory();
    const original = { license: { licenseStatus: 'pro', licenseEmail: 'legacy@example.com', licenseKey: 'ABCD-EFGH-IJKL-MNOP-QRST' } };
    let settings: any = structuredClone(original);
    const manager = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => 'offline-installation',
      readSettings: async () => settings,
      updateSettings: async (updater: (value: any) => any) => { settings = await updater(settings); },
      fetchImpl: async () => { throw new Error('offline'); },
      now: () => now,
    });
    expect(await manager.initialize()).toMatchObject({ authorized: false, migrationRequired: true });
    expect(settings).toEqual(original);
  });

  it('rejects tampered, forged and installation-mismatched certificates', async () => {
    const directory = await makeDirectory();
    const manager = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => 'bound-installation',
      now: () => now,
    });
    await manager.initialize();
    const valid = await certificate('bound-installation');
    manager.certificate = `${valid.slice(0, -1)}${valid.endsWith('A') ? 'B' : 'A'}`;
    expect(await manager.getStatus()).toMatchObject({ authorized: false });

    const otherKeys = await createEd25519TestKeys();
    manager.certificate = await issueActivationCertificate({
      licenseId: 'forged-license',
      plan: 'lifetime',
      installationId: 'bound-installation',
      issuedAt: now.toISOString(),
      expiresAt: null,
      refreshAfter: '2026-08-20T12:00:00.000Z',
    }, otherKeys.privateKey, testCrypto);
    expect(await manager.getStatus()).toMatchObject({ authorized: false });

    manager.certificate = await certificate('different-installation');
    expect(await manager.getStatus()).toMatchObject({ authorized: false });
  });

  it.each(['monthly', 'annual'] as const)('expires a cached %s certificate while offline', async (plan) => {
    const directory = await makeDirectory();
    let currentTime = now;
    const manager = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => `${plan}-installation`,
      now: () => currentTime,
    });
    await manager.initialize();
    manager.certificate = await certificate(`${plan}-installation`, plan, '2026-09-13T12:00:00.000Z');
    expect(await manager.getStatus()).toMatchObject({ authorized: true, licenseStatus: 'pro' });
    currentTime = new Date('2026-09-14T12:00:00.000Z');
    expect(await manager.getStatus()).toMatchObject({ authorized: false, licenseStatus: 'free' });
  });
});
