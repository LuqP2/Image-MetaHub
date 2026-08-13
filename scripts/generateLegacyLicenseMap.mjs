import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const normalizeLegacyEmail = (email) => String(email || '').trim().toLowerCase();

export function generateLegacyLicenseKey(email, secret) {
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(normalizeLegacyEmail(email))
    .digest('hex')
    .toUpperCase()
    .slice(0, 20);
  return hmac.match(/.{1,4}/g).join('-');
}

export async function importLegacyLicenses({ emailsInput, secret, serverUrl, adminToken, fetchImpl = fetch }) {
  if (!secret || !serverUrl || !adminToken) {
    throw new Error('Legacy secret, license server URL and admin token are required.');
  }

  const candidates = Array.from(new Set(
    String(emailsInput || '')
      .split(/[\r\n,;]+/)
      .map(normalizeLegacyEmail)
      .filter(Boolean),
  ));
  if (candidates.length === 0) throw new Error('No customer emails were provided.');

  const summary = { imported: 0, alreadyExisted: 0, failed: 0 };
  for (const email of candidates) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      summary.failed += 1;
      continue;
    }
    const licenseKey = generateLegacyLicenseKey(email, secret);
    try {
      const response = await fetchImpl(`${serverUrl.replace(/\/$/, '')}/v1/admin/licenses/import-legacy`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ email, licenseKey }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        summary.failed += 1;
      } else if (data?.created === true) {
        summary.imported += 1;
      } else {
        summary.alreadyExisted += 1;
      }
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

async function main() {
  const summary = await importLegacyLicenses({
    emailsInput: process.env.IMH_LEGACY_EMAILS,
    secret: process.env.IMH_LICENSE_SECRET,
    serverUrl: process.env.IMH_LICENSE_SERVER_URL,
    adminToken: process.env.LICENSE_SERVER_ADMIN_TOKEN,
  });
  const summaryLine = `Imported: ${summary.imported}; already existed: ${summary.alreadyExisted}; failed: ${summary.failed}.`;
  console.log(summaryLine);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import('node:fs/promises');
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `## Legacy license migration\n\n${summaryLine}\n`, 'utf8');
  }
  if (summary.failed > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error?.message || 'Legacy migration failed.');
    process.exit(1);
  });
}
