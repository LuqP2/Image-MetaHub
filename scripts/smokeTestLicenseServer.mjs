import crypto from 'node:crypto';

const serverUrl = String(process.env.LICENSE_SERVER_URL || '').trim().replace(/\/$/, '');
const adminToken = String(process.env.LICENSE_SERVER_ADMIN_TOKEN || '').trim();
if (!serverUrl || !adminToken) throw new Error('LICENSE_SERVER_URL and LICENSE_SERVER_ADMIN_TOKEN are required.');
const parsedUrl = new URL(serverUrl);
if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname.endsWith('.invalid')) {
  throw new Error('Smoke tests require the production HTTPS Worker URL.');
}

async function request(pathname, body, { admin = false } = {}) {
  const response = await fetch(`${serverUrl}${pathname}`, {
    method: 'POST',
    headers: {
      ...(admin ? { authorization: `Bearer ${adminToken}` } : {}),
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Smoke-test request failed at ${pathname} with HTTP ${response.status}.`);
  return data;
}

const suffix = crypto.randomUUID();
const email = `deployment-smoke-${suffix}@example.invalid`;
const created = await request('/v1/admin/licenses', { email, plan: 'lifetime', source: 'manual' }, { admin: true });
const licenseKey = created?.licenseKey;
const licenseId = created?.license?.id;
if (!licenseKey || !licenseId) throw new Error('Create smoke test did not return a license.');

const activated = await request('/v1/activate', {
  email,
  licenseKey,
  installationId: `deployment-smoke-${suffix}`,
  appVersion: 'deployment-smoke-test',
  platform: 'github-actions',
});
const certificate = activated?.activation?.certificate;
if (!certificate) throw new Error('Activate smoke test did not return a certificate.');
const refreshed = await request('/v1/refresh', { certificate });
const refreshedCertificate = refreshed?.activation?.certificate;
if (!refreshedCertificate) throw new Error('Refresh smoke test did not return a certificate.');
const deactivated = await request('/v1/deactivate', { certificate: refreshedCertificate });
if (deactivated?.deactivated !== true) throw new Error('Deactivate smoke test did not confirm deactivation.');
await request(`/v1/admin/licenses/${encodeURIComponent(licenseId)}/revoke`, {}, { admin: true });
console.log('License server smoke test passed: create -> activate -> refresh -> deactivate.');
