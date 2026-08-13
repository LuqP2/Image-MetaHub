import fs from 'node:fs/promises';

const serverUrl = String(process.env.IMH_LICENSE_SERVER_URL || '').trim().replace(/\/$/, '');
const adminToken = String(process.env.LICENSE_SERVER_ADMIN_TOKEN || '').trim();
const email = String(process.env.LICENSE_EMAIL || process.argv[2] || '').trim();
const plan = String(process.env.LICENSE_PLAN || process.argv[3] || 'lifetime').trim();
const expiresAt = String(process.env.LICENSE_EXPIRES_AT || process.argv[4] || '').trim();
const outputPath = String(process.env.LICENSE_OUTPUT_PATH || 'license.txt').trim();

if (!serverUrl || !adminToken || !email) {
  console.error('License server URL, admin token and purchaser email are required.');
  process.exit(1);
}
if (!['lifetime', 'monthly', 'annual'].includes(plan)) {
  console.error('LICENSE_PLAN must be lifetime, monthly or annual.');
  process.exit(1);
}
if (plan !== 'lifetime' && (!expiresAt || !Number.isFinite(Date.parse(expiresAt)))) {
  console.error('LICENSE_EXPIRES_AT is required for monthly and annual licenses.');
  process.exit(1);
}

const response = await fetch(`${serverUrl}/v1/admin/licenses`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${adminToken}`,
    'content-type': 'application/json',
    accept: 'application/json',
  },
  body: JSON.stringify({ email, plan, expiresAt: plan === 'lifetime' ? null : expiresAt }),
});

let data = null;
try {
  data = await response.json();
} catch {
  data = null;
}
if (!response.ok || typeof data?.licenseKey !== 'string') {
  console.error(`License server request failed with HTTP ${response.status}.`);
  process.exit(1);
}

const artifact = [
  `Email: ${email.toLowerCase()}`,
  `License: ${data.licenseKey}`,
  `Plan: ${data.license?.plan ?? plan}`,
  `Expires: ${data.license?.expiresAt ?? 'never'}`,
].join('\n');
await fs.writeFile(outputPath, `${artifact}\n`, { encoding: 'utf8', mode: 0o600 });
console.log('License created and written to the short-lived artifact.');
