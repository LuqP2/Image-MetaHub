import { LicenseError } from './errors.js';

const BASE32_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const encoder = new TextEncoder();

export function normalizeEmail(email) {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new LicenseError('invalid_request', 'Invalid request.');
  }
  return normalized;
}

export function normalizeLicenseKey(key) {
  const normalized = String(key ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (normalized.length < 16 || normalized.length > 80 || !/^[A-Z0-9]+$/.test(normalized)) {
    throw new LicenseError('invalid_credentials', 'Invalid email or license key.', 401);
  }
  return normalized;
}

export async function sha256Hex(value, cryptoApi = globalThis.crypto) {
  const digest = await cryptoApi.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function emailLookup(email, pepper, cryptoApi = globalThis.crypto) {
  if (typeof pepper !== 'string' || pepper.length < 16) {
    throw new Error('EMAIL_LOOKUP_PEPPER is not configured.');
  }
  const key = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await cryptoApi.subtle.sign('HMAC', key, encoder.encode(normalizeEmail(email)));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function generateRandomLicenseKey(cryptoApi = globalThis.crypto) {
  const random = new Uint8Array(20);
  cryptoApi.getRandomValues(random);

  let bits = 0;
  let value = 0;
  let encoded = '';
  for (const byte of random) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    encoded += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return `IMH2-${encoded.match(/.{1,4}/g).join('-')}`;
}

export async function secureStringEqual(left, right, cryptoApi = globalThis.crypto) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const [leftHash, rightHash] = await Promise.all([
    cryptoApi.subtle.digest('SHA-256', encoder.encode(left)),
    cryptoApi.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}
