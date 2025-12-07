import crypto from 'crypto';

// IMPORTANTE:
// - NÃO comite seu segredo real. Deixe este placeholder no git.
// - Antes de buildar para distribuir, defina IMH_LICENSE_SECRET no ambiente
//   (ex.: IMH_LICENSE_SECRET="seu-segredo" npm run build) para embutir o valor.
// - O segredo fica no binário final (app cliente). É simples e offline; não há
//   como ocultar 100% em código cliente.
const LICENSE_SECRET =
  (typeof process !== 'undefined' && process.env.IMH_LICENSE_SECRET) ||
  'CHANGE-ME-BEFORE-RELEASE';

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const normalizeKey = (key: string): string =>
  key.toUpperCase().replace(/[^A-Z0-9]/g, '');

const formatKey = (raw: string): string =>
  raw.match(/.{1,4}/g)?.join('-') ?? raw;

export const generateLicenseKeyFromEmail = (email: string): string => {
  const normalizedEmail = normalizeEmail(email);
  const hmac = crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(normalizedEmail)
    .digest('hex')
    .toUpperCase();

  const raw = hmac.replace(/[^A-Z0-9]/g, '').slice(0, 20);
  return formatKey(raw);
};

export const validateLicenseKey = (email: string, key: string): boolean => {
  if (!email || !key) return false;

  const expected = normalizeKey(generateLicenseKeyFromEmail(email));
  const provided = normalizeKey(key);

  return expected === provided;
};
