import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { generateLegacyLicenseKey, importLegacyLicenses } from '../scripts/generateLegacyLicenseMap.mjs';

describe('legacy license migration tooling', () => {
  it('reuses the historical HMAC reconstruction and posts directly without a CSV', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ created: true }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }));
    const summary = await importLegacyLicenses({
      emailsInput: 'First@Example.com\nsecond@example.com\nfirst@example.com',
      secret: 'historical-test-secret',
      serverUrl: 'https://licenses.example.test',
      adminToken: 'admin-test-token',
      fetchImpl,
    });
    expect(summary).toEqual({ imported: 2, alreadyExisted: 0, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstRequest = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(firstRequest).toEqual({
      email: 'first@example.com',
      licenseKey: generateLegacyLicenseKey('first@example.com', 'historical-test-secret'),
    });
  });

  it('matches the original 20-hex-character legacy key algorithm', () => {
    const expected = createHmac('sha256', 'historical-test-secret')
      .update('buyer@example.com')
      .digest('hex')
      .toUpperCase()
      .slice(0, 20)
      .match(/.{1,4}/g)!
      .join('-');
    expect(generateLegacyLicenseKey(' Buyer@Example.com ', 'historical-test-secret')).toBe(expected);
  });

  it('reports duplicate imports and failures only as aggregate counts', async () => {
    const responses = [
      new Response(JSON.stringify({ created: false }), { status: 200 }),
      new Response(JSON.stringify({ error: { code: 'internal_error' } }), { status: 500 }),
    ];
    const summary = await importLegacyLicenses({
      emailsInput: 'existing@example.com\nfailed@example.com',
      secret: 'historical-test-secret',
      serverUrl: 'https://licenses.example.test',
      adminToken: 'admin-test-token',
      fetchImpl: vi.fn(async () => responses.shift()!),
    });
    expect(summary).toEqual({ imported: 0, alreadyExisted: 1, failed: 1 });
  });
});
