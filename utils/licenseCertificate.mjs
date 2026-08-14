const CERTIFICATE_PREFIX = 'IMHC1';
const CERTIFICATE_VERSION = 1;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid base64url value.');
  }
  const decoded = base64ToBytes(value);
  if (encodeBase64Url(decoded) !== value) {
    throw new Error('Non-canonical base64url value.');
  }
  return decoded;
}

function parseTimestamp(value, fieldName) {
  if (typeof value !== 'string') {
    throw new Error(`Certificate ${fieldName} is invalid.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Certificate ${fieldName} is invalid.`);
  }
  return timestamp;
}

export function validateActivationPayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Certificate payload is invalid.');
  }
  if (payload.v !== CERTIFICATE_VERSION || payload.certificate !== CERTIFICATE_PREFIX) {
    throw new Error('Certificate version is not supported.');
  }
  if (typeof payload.licenseId !== 'string' || payload.licenseId.length < 8) {
    throw new Error('Certificate license is invalid.');
  }
  if (!['lifetime', 'monthly', 'annual'].includes(payload.plan)) {
    throw new Error('Certificate plan is invalid.');
  }
  if (typeof payload.installationId !== 'string' || payload.installationId.length < 8) {
    throw new Error('Certificate installation binding is invalid.');
  }

  const nowMs = options.now instanceof Date
    ? options.now.getTime()
    : typeof options.now === 'number'
      ? options.now
      : Date.now();
  const issuedAtMs = parseTimestamp(payload.issuedAt, 'issuedAt');
  parseTimestamp(payload.refreshAfter, 'refreshAfter');

  if (issuedAtMs > nowMs + CLOCK_SKEW_MS) {
    throw new Error('Certificate issue time is in the future.');
  }
  if (options.installationId && payload.installationId !== options.installationId) {
    throw new Error('Certificate belongs to another installation.');
  }

  if (payload.plan === 'lifetime') {
    if (payload.expiresAt !== null) {
      throw new Error('Lifetime certificate must not expire.');
    }
  } else {
    const expiresAtMs = parseTimestamp(payload.expiresAt, 'expiresAt');
    if (!options.allowExpired && expiresAtMs <= nowMs) {
      throw new Error('Certificate entitlement has expired.');
    }
  }

  return payload;
}

export async function issueActivationCertificate(payload, privateKeyBase64Url, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) {
    throw new Error('Web Crypto is unavailable.');
  }

  const canonicalPayload = {
    v: CERTIFICATE_VERSION,
    certificate: CERTIFICATE_PREFIX,
    licenseId: payload.licenseId,
    plan: payload.plan,
    installationId: payload.installationId,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt ?? null,
    refreshAfter: payload.refreshAfter,
  };
  validateActivationPayload(canonicalPayload, { now: Date.parse(canonicalPayload.issuedAt), allowExpired: true });

  const encodedPayload = encodeBase64Url(textEncoder.encode(JSON.stringify(canonicalPayload)));
  const signingBytes = textEncoder.encode(encodedPayload);
  const privateKey = await cryptoApi.subtle.importKey(
    'pkcs8',
    decodeBase64Url(privateKeyBase64Url),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const signature = await cryptoApi.subtle.sign('Ed25519', privateKey, signingBytes);
  return `${CERTIFICATE_PREFIX}.${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyActivationCertificate(token, publicKeyBase64Url, options = {}, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) {
    throw new Error('Web Crypto is unavailable.');
  }
  if (typeof token !== 'string') {
    throw new Error('Certificate is missing.');
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== CERTIFICATE_PREFIX) {
    throw new Error('Certificate format is invalid.');
  }

  const publicKey = await cryptoApi.subtle.importKey(
    'raw',
    decodeBase64Url(publicKeyBase64Url),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  const signatureValid = await cryptoApi.subtle.verify(
    'Ed25519',
    publicKey,
    decodeBase64Url(parts[2]),
    textEncoder.encode(parts[1]),
  );
  if (!signatureValid) {
    throw new Error('Certificate signature is invalid.');
  }

  let payload;
  try {
    payload = JSON.parse(textDecoder.decode(decodeBase64Url(parts[1])));
  } catch {
    throw new Error('Certificate payload is invalid.');
  }
  return validateActivationPayload(payload, options);
}

export { CERTIFICATE_PREFIX, CERTIFICATE_VERSION };
