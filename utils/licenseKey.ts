// IMPORTANTE:
// - Nao comite seu segredo real. Deixe este placeholder no git.
// - Antes de buildar para distribuir, defina IMH_LICENSE_SECRET no ambiente
//   (ex.: IMH_LICENSE_SECRET="seu-segredo" npm run build) para embutir o valor.
// - O segredo fica no binario final (app cliente). E simples e offline; nao ha
//   como ocultar 100% em codigo cliente.
const LICENSE_SECRET =
  (typeof process !== 'undefined' && process.env.IMH_LICENSE_SECRET) ||
  'CHANGE-ME-BEFORE-RELEASE';

const getWebCrypto = (): Crypto | null => {
  if (typeof globalThis !== 'undefined' && (globalThis as any).crypto?.subtle) {
    return (globalThis as any).crypto as Crypto;
  }
  return null;
};

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

const hmacSha256Web = async (secret: string, message: string): Promise<string> => {
  const cryptoApi = getWebCrypto();
  if (!cryptoApi?.subtle) {
    throw new Error('WebCrypto not available');
  }

  const enc = new TextEncoder();
  const key = await cryptoApi.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await cryptoApi.subtle.sign('HMAC', key, enc.encode(message));
  return toHex(signature);
};

const hmacSha256Node = async (secret: string, message: string): Promise<string | null> => {
  try {
    const { createHmac } = await import('crypto');
    return createHmac('sha256', secret).update(message).digest('hex').toUpperCase();
  } catch {
    return null;
  }
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const normalizeKey = (key: string): string =>
  key.toUpperCase().replace(/[^A-Z0-9]/g, '');

const formatKey = (raw: string): string =>
  raw.match(/.{1,4}/g)?.join('-') ?? raw;

const hmacSha256 = async (message: string): Promise<string> => {
  // Prefer WebCrypto (renderer), fall back to Node crypto (CLI/tests)
  const webCrypto = getWebCrypto();
  if (webCrypto?.subtle) {
    return hmacSha256Web(LICENSE_SECRET, message);
  }

  const nodeHmac = await hmacSha256Node(LICENSE_SECRET, message);
  if (nodeHmac) return nodeHmac;

  throw new Error('No crypto backend available for HMAC-SHA256');
};

export const generateLicenseKeyFromEmail = async (email: string): Promise<string> => {
  const normalizedEmail = normalizeEmail(email);
  const hmac = await hmacSha256(normalizedEmail);

  const raw = hmac.replace(/[^A-Z0-9]/g, '').slice(0, 20);
  return formatKey(raw);
};

export const validateLicenseKey = async (email: string, key: string): Promise<boolean> => {
  if (!email || !key) return false;

  const expected = normalizeKey(await generateLicenseKeyFromEmail(email));
  const provided = normalizeKey(key);

  return expected === provided;
};
