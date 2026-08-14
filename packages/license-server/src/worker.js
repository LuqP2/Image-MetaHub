import { D1LicenseRepository } from './d1Repository.js';
import { LicenseError } from './errors.js';
import { secureStringEqual } from './cryptoHelpers.js';
import { LicenseService } from './licenseService.js';

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

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, service: 'image-metahub-license-server', version: 1 });
  }
  if (request.method !== 'POST' && request.method !== 'PATCH') {
    return json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
  }

  const service = createService(env);
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
    await requireAdmin(request, env);
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
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      if (error instanceof LicenseError) {
        return json({ error: { code: error.code, message: error.message } }, error.status);
      }
      console.error('license_server_error');
      return json({ error: { code: 'internal_error', message: 'Service unavailable.' } }, 500);
    }
  },
};
