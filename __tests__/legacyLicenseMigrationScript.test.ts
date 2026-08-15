import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reissueHistoricalLicenses } from '../scripts/generateLegacyLicenseMap.mjs';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function outputPath() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-reissue-test-'));
  tempDirectories.push(directory);
  return path.join(directory, 'historical-imh2-reissues.json');
}

describe('historical license reissue tooling', () => {
  it('rejects an in-repository output path that is not gitignored', async () => {
    await expect(reissueHistoricalLicenses({
      emailsInput: 'buyer@example.com',
      outputPath: path.join(process.cwd(), 'historical-reissues.json'),
      serverUrl: 'https://licenses.example.test',
      adminToken: 'admin-test-token',
      fetchImpl: vi.fn(),
    })).rejects.toThrow('gitignored .license-reissues');
  });

  it('creates a private purchaser-to-random-IMH2 mapping and normalizes duplicate emails', async () => {
    const target = await outputPath();
    const keys = [
      'IMH2-2222-2222-2222-2222-2222-2222-2222-2222',
      'IMH2-3333-3333-3333-3333-3333-3333-3333-3333',
    ];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        created: true,
        license: { id: `license-${request.email}`, source: 'legacy_reissue' },
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    });

    const result = await reissueHistoricalLicenses({
      emailsInput: 'First@Example.com\nsecond@example.com\nfirst@example.com',
      outputPath: target,
      serverUrl: 'https://licenses.example.test',
      adminToken: 'admin-test-token',
      fetchImpl,
      generateKey: () => keys.shift()!,
    });

    expect(result.summary).toEqual({ reissued: 2, alreadyConfirmed: 0, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const output = JSON.parse(await fs.readFile(target, 'utf8'));
    expect(output.entries).toEqual([
      expect.objectContaining({ email: 'first@example.com', licenseKey: expect.stringMatching(/^IMH2-/), status: 'confirmed' }),
      expect.objectContaining({ email: 'second@example.com', licenseKey: expect.stringMatching(/^IMH2-/), status: 'confirmed' }),
    ]);
  });

  it('is idempotent when a confirmed mapping is run again', async () => {
    const target = await outputPath();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      created: true,
      license: { id: 'license-one', source: 'legacy_reissue' },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const options = {
      emailsInput: 'buyer@example.com',
      outputPath: target,
      serverUrl: 'https://licenses.example.test',
      adminToken: 'admin-test-token',
      fetchImpl,
      generateKey: () => 'IMH2-2222-2222-2222-2222-2222-2222-2222-2222',
    };
    await reissueHistoricalLicenses(options);
    const second = await reissueHistoricalLicenses(options);
    expect(second.summary).toEqual({ reissued: 0, alreadyConfirmed: 1, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('persists a pending key before the request and retries that same key after failure', async () => {
    const target = await outputPath();
    const bodies: any[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ created: false, license: { id: 'license-existing' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const options = {
      emailsInput: 'buyer@example.com',
      outputPath: target,
      serverUrl: 'https://licenses.example.test',
      adminToken: 'admin-test-token',
      fetchImpl,
      generateKey: () => 'IMH2-4444-4444-4444-4444-4444-4444-4444-4444',
    };
    expect((await reissueHistoricalLicenses(options)).summary.failed).toBe(1);
    expect((await reissueHistoricalLicenses(options)).summary.reissued).toBe(1);
    expect(bodies[0]).toEqual(bodies[1]);
  });
});
