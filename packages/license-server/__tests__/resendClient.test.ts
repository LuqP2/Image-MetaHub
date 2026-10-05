// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ResendDeliveryClient } from '../src/resendClient.js';

describe('ResendDeliveryClient', () => {
  it('invokes fetch with the global receiver required by Cloudflare Workers', async () => {
    let sentBody: Record<string, unknown> | undefined;
    const fetchImpl = function (this: unknown, _url: string | URL | Request, init?: RequestInit) {
      expect(this).toBe(globalThis);
      sentBody = JSON.parse(String(init?.body));
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
    expect(sentBody?.text).toBe([
      'Hi there!',
      '',
      'Thank you for your purchase and for supporting the project!',
      '',
      'Your license is ready to use. Just open Image MetaHub, go to Settings → License, enter the email below and the key, and the app will activate immediately.',
      '',
      'Plan: Monthly',
      'Date of expiry: September 27, 2026',
      '',
      'Email: buyer@example.com',
      'License: IMH2-TEST',
      '',
      'If you have a moment, I’d really appreciate it if you could fill out this short survey: https://licenses.imagemetahub.com/survey. Hearing directly from you helps me a lot in making the app better for everyone!',
      '',
      'If you have any issues activating the license, please let me know!',
      '',
      'Best regards,',
      'Lucas',
    ].join('\n'));
    expect(sentBody?.html).toContain('<p>Hi there!</p>');
    expect(sentBody?.html).toContain('<strong>Plan:</strong> Monthly<br>');
    expect(sentBody?.html).toContain('<strong>Date of expiry:</strong> September 27, 2026');
    expect(sentBody?.html).toContain('<strong>Email:</strong> buyer@example.com<br>');
    expect(sentBody?.html).toContain('<strong>License:</strong> <code>IMH2-TEST</code>');
    expect(sentBody?.html).toContain('<a href="https://licenses.imagemetahub.com/survey">');
    expect(sentBody?.html).toContain('<p>Best regards,<br>Lucas</p>');
  });

  it('shows lifetime licenses as having no expiration', async () => {
    let sentBody: Record<string, unknown> | undefined;
    const client = new ResendDeliveryClient({
      apiKey: 're_test',
      from: 'Image MetaHub <delivery@licenses.imagemetahub.com>',
      fetchImpl: (_url: string | URL | Request, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body));
        return Promise.resolve(new Response(JSON.stringify({ id: 'email_2' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      },
    });

    await client.sendLicense({
      outboxId: 'delivery_2',
      email: 'lifetime@example.com',
      licenseKey: 'IMH2-LIFETIME',
      plan: 'lifetime',
      expiresAt: null,
    });

    expect(sentBody?.text).toContain('Plan: Lifetime\nDate of expiry: No expiration');
    expect(sentBody?.html).toContain('<strong>Date of expiry:</strong> No expiration');
  });
});
