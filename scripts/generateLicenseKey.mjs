import crypto from 'crypto';

// ATENÇÃO: troque esse segredo ANTES de liberar a versão
// E USE O MESMO SEGREDO DENTRO DO APP (arquivo utils/licenseKey.ts)
const LICENSE_SECRET = process.env.IMH_LICENSE_SECRET || 'CHANGE-ME-BEFORE-RELEASE';

const normalizeEmail = (email) => email.trim().toLowerCase();
const normalizeKey = (key) => key.toUpperCase().replace(/[^A-Z0-9]/g, '');
const formatKey = (raw) => (raw.match(/.{1,4}/g) || [raw]).join('-');

const generateLicenseKeyFromEmail = (email) => {
  const normalizedEmail = normalizeEmail(email);
  const hmac = crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(normalizedEmail)
    .digest('hex')
    .toUpperCase();

  const raw = hmac.replace(/[^A-Z0-9]/g, '').slice(0, 20);
  return formatKey(raw);
};

const email = process.argv[2];

if (!email) {
  console.error('Uso: IMH_LICENSE_SECRET="seu-segredo" node scripts/generateLicenseKey.mjs cliente@example.com');
  process.exit(1);
}

const key = generateLicenseKeyFromEmail(email);

console.log(`Email:   ${normalizeEmail(email)}`);
console.log(`License: ${normalizeKey(key)}`);
