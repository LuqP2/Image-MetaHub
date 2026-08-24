const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const planLabel = (plan) => ({ lifetime: 'Lifetime', monthly: 'Monthly', annual: 'Annual' }[plan] || 'Pro');

function formatExpiration(expiresAt) {
  if (!expiresAt) return 'No expiration';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(expiresAt));
}

export class ResendDeliveryClient {
  constructor({ apiKey, from, replyTo = null, fetchImpl = globalThis.fetch }) {
    this.apiKey = apiKey;
    this.from = from;
    this.replyTo = replyTo;
    this.fetchImpl = fetchImpl;
  }

  async sendLicense({ outboxId, email, licenseKey, plan, expiresAt }) {
    const label = planLabel(plan);
    const validity = formatExpiration(expiresAt);
    const text = [
      'Thank you for supporting Image MetaHub.',
      '',
      `Plan: ${label}`,
      `Validity: ${validity}`,
      `License key: ${licenseKey}`,
      '',
      'Activate it in Image MetaHub using this email address and the license key above.',
    ].join('\n');
    const html = [
      '<p>Thank you for supporting Image MetaHub.</p>',
      `<p><strong>Plan:</strong> ${escapeHtml(label)}<br>`,
      `<strong>Validity:</strong> ${escapeHtml(validity)}</p>`,
      `<p><strong>License key:</strong><br><code>${escapeHtml(licenseKey)}</code></p>`,
      '<p>Activate it in Image MetaHub using this email address and the license key above.</p>',
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
      response = await this.fetchImpl(RESEND_ENDPOINT, {
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
