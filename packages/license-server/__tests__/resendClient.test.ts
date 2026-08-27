// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ResendDeliveryClient } from '../src/resendClient.js';

describe('ResendDeliveryClient', () => {
  it('invokes fetch with the global receiver required by Cloudflare Workers', async () => {
    const fetchImpl = function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(new Response(JSON.stringify({ id: 'email_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    };
    const client = new ResendDeliveryClient({
      apiKey: 're_test',
      from: 'Image MetaHub <delivery@licenses.imagemetahub.com>',
      fetchImpl,
    });

    const result = await client.sendLicense({
      outboxId: 'delivery_1',
      email: 'buyer@example.com',
      licenseKey: 'IMH2-TEST',
      plan: 'monthly',
      expiresAt: '2026-09-27T00:00:00.000Z',
    });

    expect(result).toEqual({ ok: true, messageId: 'email_1' });
  });
});
