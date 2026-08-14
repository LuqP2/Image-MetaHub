import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetUserDataContents } from '../electron/cacheReset.mjs';
import { LicenseManager } from '../electron/licenseManager.mjs';
import { issueActivationCertificate, verifyActivationCertificate } from '../utils/licenseCertificate.mjs';
import { createEd25519TestKeys, testCrypto } from './licenseCryptoTestHelpers';

const now = new Date('2026-08-14T12:00:00.000Z');
const licenseKey = 'IMH2-2222-2222-2222-2222-2222-2222-2222-2222';
const plainStorage = { isEncryptionAvailable: () => false };

describe('cache reset licensing preservation', () => {
  let keys: Awaited<ReturnType<typeof createEd25519TestKeys>>;
  const tempDirectories: string[] = [];

  beforeAll(async () => {
    keys = await createEd25519TestKeys();
  });

  afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  });

  async function fixture() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-cache-license-test-'));
    tempDirectories.push(directory);
    const settingsPath = path.join(directory, 'settings.json');
    const readSettings = async () => JSON.parse(await fs.readFile(settingsPath, 'utf8').catch(() => '{}'));
    const updateSettings = async (updater: (settings: any) => any) => {
      const next = await updater(await readSettings());
      await fs.writeFile(settingsPath, JSON.stringify(next), 'utf8');
    };
    const makeCertificate = (installationId: string, refreshAfter = '2026-08-21T12:00:00.000Z') => issueActivationCertificate({
      licenseId: 'cache-reset-license',
      plan: 'lifetime',
      installationId,
      issuedAt: now.toISOString(),
      expiresAt: null,
      refreshAfter,
    }, keys.privateKey, testCrypto);
    let refreshCalls = 0;
    const fetchImpl = async (url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      if (url.endsWith('/v1/activate')) {
        return new Response(JSON.stringify({ activation: { certificate: await makeCertificate(request.installationId) } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      refreshCalls += 1;
      const payload = await verifyActivationCertificate(request.certificate, keys.publicKey, { now, allowExpired: true }, testCrypto);
      return new Response(JSON.stringify({ activation: { certificate: await makeCertificate(payload.installationId, '2026-08-28T12:00:00.000Z') } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    return { directory, settingsPath, readSettings, updateSettings, fetchImpl, getRefreshCalls: () => refreshCalls };
  }

  it('preserves installation, certificate and refreshability when preserveLicense is true', async () => {
    const context = await fixture();
    const first = new LicenseManager({
      userDataPath: context.directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => 'cache-reset-installation',
      now: () => now,
      readSettings: context.readSettings,
      updateSettings: context.updateSettings,
      fetchImpl: context.fetchImpl,
    });
    await first.initialize();
    expect(await first.activate(licenseKey, 'buyer@example.com')).toMatchObject({ authorized: true });
    const settingsBeforeReset = await context.readSettings();
    expect(settingsBeforeReset.license.licenseKey).toBeNull();
    await fs.writeFile(path.join(context.directory, 'large-cache.json'), '{}', 'utf8');
    const preservedFileNames = first.getPreservedStateFileNames();
    first.dispose();

    await resetUserDataContents({ userDataDir: context.directory, preservedFileNames });
    await fs.writeFile(context.settingsPath, JSON.stringify({ license: settingsBeforeReset.license }), 'utf8');
    expect(await fs.stat(path.join(context.directory, 'large-cache.json')).catch(() => null)).toBeNull();

    const installationId = (await fs.readFile(path.join(context.directory, 'license-installation-id'), 'utf8')).trim();
    const envelope = JSON.parse(await fs.readFile(path.join(context.directory, 'license-activation.dat'), 'utf8'));
    await expect(verifyActivationCertificate(envelope.data, keys.publicKey, { installationId, now }, testCrypto)).resolves.toMatchObject({ plan: 'lifetime' });

    const reloaded = new LicenseManager({
      userDataPath: context.directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      now: () => now,
      readSettings: context.readSettings,
      updateSettings: context.updateSettings,
      fetchImpl: context.fetchImpl,
    });
    expect(await reloaded.initialize()).toMatchObject({ authorized: true, licenseStatus: 'lifetime' });
    expect(await reloaded.refresh()).toMatchObject({ authorized: true, licenseStatus: 'lifetime' });
    expect(context.getRefreshCalls()).toBe(1);
    reloaded.dispose();
  });

  it('removes activation authority when preserveLicense is false', async () => {
    const context = await fixture();
    const first = new LicenseManager({
      userDataPath: context.directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => 'removed-installation',
      now: () => now,
      readSettings: context.readSettings,
      updateSettings: context.updateSettings,
      fetchImpl: context.fetchImpl,
    });
    await first.initialize();
    await first.activate(licenseKey, 'buyer@example.com');
    first.dispose();

    await resetUserDataContents({ userDataDir: context.directory });
    const reloaded = new LicenseManager({
      userDataPath: context.directory,
      serverUrl: 'https://licenses.example.test',
      publicKey: keys.publicKey,
      safeStorage: plainStorage,
      cryptoApi: testCrypto,
      randomUUID: () => 'new-installation-after-reset',
      now: () => now,
      readSettings: context.readSettings,
      updateSettings: context.updateSettings,
      fetchImpl: context.fetchImpl,
    });
    expect(await reloaded.initialize()).toMatchObject({ authorized: false, licenseStatus: 'free' });
    expect((await fs.readFile(path.join(context.directory, 'license-installation-id'), 'utf8')).trim()).toBe('new-installation-after-reset');
    expect(await fs.stat(path.join(context.directory, 'license-activation.dat')).catch(() => null)).toBeNull();
    reloaded.dispose();
  });
});
