import crypto from 'crypto';
import fs from 'fs/promises';

const LICENSE_SECRET = process.env.IMH_LICENSE_SECRET || '';
const emailsInput = process.env.IMH_LEGACY_EMAILS || '';
const outputPath = process.env.IMH_LEGACY_OUTPUT_PATH || 'legacy-license-map.csv';

if (!LICENSE_SECRET) {
  console.error('IMH_LICENSE_SECRET is missing.');
  process.exit(1);
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const normalizeKey = (key) => String(key || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const isLikelyEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

const generateLicenseKeyFromEmail = (email) => {
  const normalizedEmail = normalizeEmail(email);
  const hmac = crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(normalizedEmail)
    .digest('hex')
    .toUpperCase();

  return normalizeKey(hmac.slice(0, 20));
};

const emails = Array.from(
  new Set(
    emailsInput
      .split(/\r?\n/)
      .map((value) => normalizeEmail(value))
      .filter((value) => isLikelyEmail(value))
  )
);

if (emails.length === 0) {
  console.error('No valid emails were provided.');
  process.exit(1);
}

const lines = ['email,licenseKey'];
for (const email of emails) {
  lines.push(`${email},${generateLicenseKeyFromEmail(email)}`);
}

await fs.writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Generated ${emails.length} legacy keys to ${outputPath}`);
