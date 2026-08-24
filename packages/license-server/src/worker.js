import { D1LicenseRepository } from './d1Repository.js';
import { LicenseError } from './errors.js';
import { secureStringEqual } from './cryptoHelpers.js';
import { LicenseService } from './licenseService.js';
import { D1StripeBillingRepository } from './stripeBillingRepository.js';
import { StripeBillingService, createStripeBillingConfig } from './stripeBillingService.js';
import { createStripeClient, verifyStripeWebhook } from './stripeClient.js';
import { ResendDeliveryClient } from './resendClient.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

async function readJson(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 32_768) throw new LicenseError('invalid_request', 'Invalid request.', 413);
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
    return body;
  } catch {
    throw new LicenseError('invalid_request', 'Invalid request.');
  }
}

async function requireAdmin(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!await secureStringEqual(token, env.LICENSE_SERVER_ADMIN_TOKEN)) {
    throw new LicenseError('unauthorized', 'Unauthorized.', 401);
  }
}

function createService(env) {
  if (!env.DB || !env.EMAIL_LOOKUP_PEPPER || !env.LICENSE_SIGNING_PRIVATE_KEY || !env.LICENSE_SIGNING_PUBLIC_KEY || !env.LICENSE_SERVER_ADMIN_TOKEN) {
    throw new Error('License server environment is incomplete.');
  }
  return new LicenseService({
    repository: new D1LicenseRepository(env.DB),
    emailPepper: env.EMAIL_LOOKUP_PEPPER,
    signingPrivateKey: env.LICENSE_SIGNING_PRIVATE_KEY,
    signingPublicKey: env.LICENSE_SIGNING_PUBLIC_KEY,
  });
}

function createBillingService(env) {
  const required = [
    'STRIPE_RESTRICTED_API_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_ACCOUNT_ID',
    'STRIPE_SUBSCRIPTION_PRODUCT_ID',
    'STRIPE_MONTHLY_PRICE_ID',
    'STRIPE_ANNUAL_PRICE_ID',
    'STRIPE_LIFETIME_PRICE_ID',
    'LICENSE_DELIVERY_ENCRYPTION_KEY',
    'RESEND_API_KEY',
    'LICENSE_EMAIL_FROM',
  ];
  if (required.some((name) => !String(env[name] || '').trim())) {
    throw new Error('Stripe billing environment is incomplete.');
  }
  return new StripeBillingService({
    repository: new D1StripeBillingRepository(env.DB),
    licenseService: createService(env),
    stripeClient: createStripeClient(env.STRIPE_RESTRICTED_API_KEY),
    deliveryClient: new ResendDeliveryClient({
      apiKey: env.RESEND_API_KEY,
      from: env.LICENSE_EMAIL_FROM,
      replyTo: env.LICENSE_EMAIL_REPLY_TO || null,
    }),
    config: createStripeBillingConfig(env),
  });
}

async function handleStripeWebhook(request, env, context) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 262_144) throw new LicenseError('invalid_webhook', 'Invalid webhook.', 413);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 262_144) {
    throw new LicenseError('invalid_webhook', 'Invalid webhook.', 413);
  }
  let event;
  try {
    event = await verifyStripeWebhook(
      rawBody,
      request.headers.get('stripe-signature'),
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    throw new LicenseError('invalid_webhook_signature', 'Invalid webhook signature.', 400);
  }
  const billingService = createBillingService(env);
  const result = await billingService.enqueueVerifiedEvent(event);
  if (result.accepted && !result.duplicate) {
    const work = billingService.processQueues();
    if (context?.waitUntil) context.waitUntil(work);
    else await work;
  }
  return json({ received: true, duplicate: result.duplicate });
}

export async function handleRequest(request, env, context) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, service: 'image-metahub-license-server', version: 2 });
  }
  if (request.method === 'POST' && url.pathname === '/v1/stripe/webhook') {
    return handleStripeWebhook(request, env, context);
  }
  if (request.method !== 'POST' && request.method !== 'PATCH') {
    return json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
  }

  const service = createService(env);

  if (url.pathname.startsWith('/v1/admin/')) {
    await requireAdmin(request, env);
    const stripeEventRetry = url.pathname.match(/^\/v1\/admin\/stripe\/events\/([^/]+)\/retry$/);
    if (request.method === 'POST' && stripeEventRetry) {
      const requeued = await createBillingService(env).repository.requeueEvent(
        decodeURIComponent(stripeEventRetry[1]),
        new Date().toISOString(),
      );
      return json({ requeued }, requeued ? 200 : 404);
    }
    const deliveryRetry = url.pathname.match(/^\/v1\/admin\/license-deliveries\/([^/]+)\/retry$/);
    if (request.method === 'POST' && deliveryRetry) {
      const requeued = await createBillingService(env).repository.requeueDelivery(
        decodeURIComponent(deliveryRetry[1]),
        new Date().toISOString(),
      );
      return json({ requeued }, requeued ? 200 : 404);
    }
  }

  const body = await readJson(request);

  if (request.method === 'POST' && url.pathname === '/v1/activate') {
    return json({ activation: await service.activate(body) });
  }
  if (request.method === 'POST' && url.pathname === '/v1/refresh') {
    return json({ activation: await service.refresh(body) });
  }
  if (request.method === 'POST' && url.pathname === '/v1/deactivate') {
    return json(await service.deactivate(body));
  }

  if (url.pathname.startsWith('/v1/admin/')) {
    if (request.method === 'POST' && url.pathname === '/v1/admin/licenses') {
      const result = await service.createLicense(body);
      return json({
        created: true,
        license: {
          id: result.license.id,
          plan: result.license.plan,
          status: result.license.status,
          source: result.license.source,
          expiresAt: result.license.expiresAt,
          maxActivations: result.license.maxActivations,
        },
        licenseKey: result.licenseKey,
      }, 201);
    }
    if (request.method === 'POST' && url.pathname === '/v1/admin/licenses/reissue-historical') {
      const result = await service.reissueHistoricalLicense(body);
      return json({
        created: result.created,
        license: {
          id: result.license.id,
          plan: result.license.plan,
          source: result.license.source,
          expiresAt: result.license.expiresAt,
          maxActivations: result.license.maxActivations,
        },
      }, result.created ? 201 : 200);
    }
    const revokeMatch = url.pathname.match(/^\/v1\/admin\/licenses\/([^/]+)\/revoke$/);
    if (request.method === 'POST' && revokeMatch) {
      const license = await service.updateLicense(decodeURIComponent(revokeMatch[1]), { status: 'revoked' });
      return json({ license: { id: license.id, status: license.status } });
    }
    const match = url.pathname.match(/^\/v1\/admin\/licenses\/([^/]+)$/);
    if (request.method === 'PATCH' && match) {
      const license = await service.updateLicense(decodeURIComponent(match[1]), body);
      return json({
        license: {
          id: license.id,
          plan: license.plan,
          status: license.status,
          expiresAt: license.expiresAt,
          maxActivations: license.maxActivations,
        },
      });
    }
  }

  return json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
}

export default {
  async fetch(request, env, context) {
    try {
      return await handleRequest(request, env, context);
    } catch (error) {
      if (error instanceof LicenseError) {
        return json({ error: { code: error.code, message: error.message } }, error.status);
      }
      console.error('license_server_error');
      return json({ error: { code: 'internal_error', message: 'Service unavailable.' } }, 500);
    }
  },
  async scheduled(_controller, env, context) {
    const work = createBillingService(env).processQueues();
    if (context?.waitUntil) context.waitUntil(work);
    else await work;
  },
};
