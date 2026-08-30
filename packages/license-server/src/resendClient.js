const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

export class ResendDeliveryClient {
  constructor({ apiKey, from, replyTo = null, fetchImpl = globalThis.fetch }) {
    this.apiKey = apiKey;
    this.from = from;
    this.replyTo = replyTo;
    this.fetchImpl = fetchImpl;
  }

  async sendLicense({ outboxId, email, licenseKey }) {
    const text = [
      'Hi there!',
      '',
      'Thank you for your purchase and for supporting the project!',
      '',
      'Your license is ready to use. Just open Image MetaHub, go to Settings → License, enter the email below and the key, and the app will activate immediately.',
      '',
      `Email: ${email}`,
      `License: ${licenseKey}`,
      '',
      'If you have any issues activating the license, please let me know!',
      '',
      'Best regards,',
      'Lucas',
    ].join('\n');
    const html = [
      '<p>Hi there!</p>',
      '<p>Thank you for your purchase and for supporting the project!</p>',
      '<p>Your license is ready to use. Just open Image MetaHub, go to Settings → License, enter the email below and the key, and the app will activate immediately.</p>',
      `<p><strong>Email:</strong> ${escapeHtml(email)}<br>`,
      `<strong>License:</strong> <code>${escapeHtml(licenseKey)}</code></p>`,
      '<p>If you have any issues activating the license, please let me know!</p>',
      '<p>Best regards,<br>Lucas</p>',
    ].join('');
    const body = {
      from: this.from,
      to: [email],
      subject: 'Your Image MetaHub license key',
      text,
      html,
      ...(this.replyTo ? { reply_to: this.replyTo } : {}),
      tags: [{ name: 'delivery_type', value: 'license' }],
    };
    let response;
    try {
      response = await this.fetchImpl.call(globalThis, RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': `license-delivery/${outboxId}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, retryable: true, uncertain: true, code: 'resend_network_error' };
    }

    let result = null;
    try {
      result = await response.json();
    } catch {
      // Response bodies are not needed for retry classification.
    }
    if (response.ok && typeof result?.id === 'string') {
      return { ok: true, messageId: result.id };
    }
    if (response.status === 409 && result?.name === 'concurrent_idempotent_requests') {
      return { ok: false, retryable: true, code: 'resend_concurrent_request' };
    }
    if (response.status === 429 || response.status >= 500) {
      return { ok: false, retryable: true, code: `resend_http_${response.status}` };
    }
    return { ok: false, retryable: false, code: `resend_http_${response.status}` };
  }
}
