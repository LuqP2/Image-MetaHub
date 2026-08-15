import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LicenseManager } from '../electron/licenseManager.mjs';
import { issueActivationCertificate } from '../utils/licenseCertificate.mjs';
import { createEd25519TestKeys, testCrypto } from './licenseCryptoTestHelpers';

const initialNow = new Date('2026-08-13T12:00:00.000Z');
const validLicenseKey = 'IMH2-2222-2222-2222-2222-2222-2222-2222-2222';

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

  async function certificate({
    installationId,
    plan = 'lifetime',
    expiresAt = null,
    refreshAfter = '2026-08-20T12:00:00.000Z',
  }: {
    installationId: string;
    plan?: 'lifetime' | 'monthly' | 'annual';
    expiresAt?: string | null;
    refreshAfter?: string;
  }) {
    return issueActivationCertificate({
      licenseId: 'license-test-id',
      plan,
      installationId,
      issuedAt: initialNow.toISOString(),
      expiresAt,
      refreshAfter,
    }, keys.privateKey, testCrypto);
  }

  const plainStorage = { isEncryptionAvailable: () => false };

  it('keeps a cached lifetime activation usable offline and reloads it', async () => {
    const directory = await makeDirectory();
    const fetchForActivation = async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ activation: { certificate: await certificate({ installationId: request.installationId }) } }), {
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
      now: () => initialNow,
    });
    await first.initialize();
    expect(await first.activate(validLicenseKey, 'buyer@example.com')).toMatchObject({
      activated: true,
      status: { authorized: true, licenseStatus: 'lifetime' },
    });
    first.dispose();

    const reloaded = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      fetchImpl: async () => { throw new Error('offline'); },
      cryptoApi: testCrypto,
      now: () => initialNow,
    });
    expect(await reloaded.initialize()).toMatchObject({ authorized: true, licenseStatus: 'lifetime' });
    reloaded.dispose();
  });

  it('preserves HMAC-era settings but never submits them for automatic activation', async () => {
    const directory = await makeDirectory();
    const original = { license: { licenseStatus: 'pro', licenseEmail: 'legacy@example.com', licenseKey: 'ABCD-EFGH-IJKL-MNOP-QRST' } };
    let settings: any = structuredClone(original);
    const fetchImpl = vi.fn();
    const manager = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => 'legacy-installation',
      now: () => initialNow,
      readSettings: async () => settings,
      updateSettings: async (updater: (value: any) => any) => { settings = await updater(settings); },
      fetchImpl,
    });
    expect(await manager.initialize()).toMatchObject({
      authorized: false,
      migrationRequired: true,
      message: expect.stringContaining('reissued IMH2'),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(settings).toEqual(original);
    manager.dispose();
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
      now: () => initialNow,
    });
    await manager.initialize();
    const valid = await certificate({ installationId: 'bound-installation' });
    manager.certificate = `${valid.slice(0, -1)}${valid.endsWith('A') ? 'B' : 'A'}`;
    expect(await manager.getStatus()).toMatchObject({ authorized: false });

    const otherKeys = await createEd25519TestKeys();
    manager.certificate = await issueActivationCertificate({
      licenseId: 'forged-license',
      plan: 'lifetime',
      installationId: 'bound-installation',
      issuedAt: initialNow.toISOString(),
      expiresAt: null,
      refreshAfter: '2026-08-20T12:00:00.000Z',
    }, otherKeys.privateKey, testCrypto);
    expect(await manager.getStatus()).toMatchObject({ authorized: false });

    manager.certificate = await certificate({ installationId: 'different-installation' });
    expect(await manager.getStatus()).toMatchObject({ authorized: false });
    manager.dispose();
  });

  it.each(['monthly', 'annual'] as const)('expires %s at runtime and publishes Free status without a restart', async (plan) => {
    const directory = await makeDirectory();
    let currentTime = initialNow;
    let scheduledCallback: (() => Promise<void>) | null = null;
    const scheduledDelays: number[] = [];
    let settings: any = { license: {} };
    const statusChanges: any[] = [];
    const expiration = '2026-08-13T13:00:00.000Z';
    const manager = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => `${plan}-installation`,
      now: () => currentTime,
      readSettings: async () => settings,
      updateSettings: async (updater: (value: any) => any) => { settings = await updater(settings); },
      onStatusChanged: async (status: any) => { statusChanges.push(status); },
      setTimer: ((callback: () => Promise<void>, delay: number) => {
        scheduledCallback = callback;
        scheduledDelays.push(delay);
        return { unref() {} };
      }) as any,
      clearTimer: (() => {}) as any,
      fetchImpl: async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ activation: { certificate: await certificate({
          installationId: request.installationId,
          plan,
          expiresAt: expiration,
          refreshAfter: '2026-08-14T12:00:00.000Z',
        }) } }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    await manager.initialize();
    expect(await manager.activate(validLicenseKey, `${plan}@example.com`)).toMatchObject({
      activated: true,
      status: { authorized: true, licenseStatus: 'pro' },
    });
    expect(scheduledCallback).not.toBeNull();
    expect(scheduledDelays.at(-1)).toBe(60 * 60 * 1000);

    currentTime = new Date('2026-08-13T13:00:01.000Z');
    await scheduledCallback!();

    expect(await manager.getStatus()).toMatchObject({ authorized: false, licenseStatus: 'free' });
    expect(settings.license).toMatchObject({ licenseStatus: 'free', licensePlan: null, licenseKey: null });
    expect(statusChanges.at(-1)).toMatchObject({ authorized: false, licenseStatus: 'free' });
    expect(scheduledDelays.at(-1)).toBeGreaterThan(0);
    manager.dispose();
  });

  it('keeps lifetime authorized after an advisory refresh failure', async () => {
    const directory = await makeDirectory();
    let calls = 0;
    const manager = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => 'lifetime-refresh-installation',
      now: () => initialNow,
      fetchImpl: async (_url: string, init: RequestInit) => {
        calls += 1;
        if (calls === 1) {
          const request = JSON.parse(String(init.body));
          return new Response(JSON.stringify({ activation: { certificate: await certificate({ installationId: request.installationId }) } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('{}', { status: 503 });
      },
    });
    await manager.initialize();
    await manager.activate(validLicenseKey, 'lifetime@example.com');
    expect(await manager.refresh()).toMatchObject({ authorized: true, licenseStatus: 'lifetime' });
    manager.dispose();
  });

  it('reports a failed replacement activation separately from the cached entitlement', async () => {
    const directory = await makeDirectory();
    let calls = 0;
    const manager = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => 'replacement-installation',
      now: () => initialNow,
      fetchImpl: async (_url: string, init: RequestInit) => {
        calls += 1;
        if (calls === 1) {
          const request = JSON.parse(String(init.body));
          return new Response(JSON.stringify({ activation: { certificate: await certificate({ installationId: request.installationId }) } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: { code: 'activation_limit', message: 'Activation limit reached.' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    await manager.initialize();
    expect((await manager.activate(validLicenseKey, 'buyer@example.com')).activated).toBe(true);

    const replacement = await manager.activate(validLicenseKey, 'other@example.com');

    expect(replacement).toMatchObject({
      activated: false,
      status: {
        authorized: true,
        licenseStatus: 'lifetime',
        message: 'Invalid license for this email.',
      },
    });
    manager.dispose();
  });

  it('treats lifetime deactivation as online convenience rather than permanent offline revocation', async () => {
    const directory = await makeDirectory();
    const activationPath = path.join(directory, 'license-activation.dat');
    const first = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => 'restored-lifetime-installation',
      now: () => initialNow,
      fetchImpl: async (url: string, init: RequestInit) => {
        if (url.endsWith('/v1/activate')) {
          const request = JSON.parse(String(init.body));
          return new Response(JSON.stringify({ activation: { certificate: await certificate({ installationId: request.installationId }) } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ deactivated: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    await first.initialize();
    await first.activate(validLicenseKey, 'buyer@example.com');
    const savedEnvelope = await fs.readFile(activationPath);
    await first.deactivate();
    first.dispose();

    await fs.writeFile(activationPath, savedEnvelope);
    const restored = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      now: () => initialNow,
      fetchImpl: async () => new Response(JSON.stringify({
        error: { code: 'activation_inactive', message: 'License is not active.' },
      }), { status: 403, headers: { 'content-type': 'application/json' } }),
    });
    expect(await restored.initialize()).toMatchObject({ authorized: true, licenseStatus: 'lifetime' });
    expect(await restored.refresh()).toMatchObject({ authorized: false, licenseStatus: 'free' });
    restored.dispose();
  });

  it('uses persisted last-known-good time as simple rollback resistance for temporal plans only', async () => {
    const directory = await makeDirectory();
    let currentTime = initialNow;
    const manager = new LicenseManager({
      userDataPath: directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => 'rollback-installation',
      now: () => currentTime,
      fetchImpl: async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ activation: { certificate: await certificate({
          installationId: request.installationId,
          plan: 'monthly',
          expiresAt: '2026-09-13T12:00:00.000Z',
        }) } }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    await manager.initialize();
    await manager.activate(validLicenseKey, 'rollback@example.com');
    currentTime = new Date('2026-08-12T12:00:00.000Z');
    expect(await manager.getStatus()).toMatchObject({ authorized: false, message: expect.stringContaining('rollback') });
    manager.dispose();
  });
});
