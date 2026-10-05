import { decodeBase64Url, encodeBase64Url } from '../../../utils/licenseCertificate.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PAYLOAD_VERSION = 1;

async function importEncryptionKey(secret, cryptoApi) {
  const keyBytes = decodeBase64Url(String(secret || ''));
  if (keyBytes.length !== 32) {
    throw new Error('LICENSE_DELIVERY_ENCRYPTION_KEY must contain 32 base64url-encoded bytes.');
  }
  return cryptoApi.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptDeliveryPayload(payload, secret, cryptoApi = globalThis.crypto) {
  const key = await importEncryptionKey(secret, cryptoApi);
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify({ v: PAYLOAD_VERSION, ...payload }));
  const ciphertext = await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return JSON.stringify({
    v: PAYLOAD_VERSION,
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  });
}

export async function decryptDeliveryPayload(envelope, secret, cryptoApi = globalThis.crypto) {
  let parsed;
  try {
    parsed = JSON.parse(String(envelope || ''));
  } catch {
    throw new Error('License delivery payload is invalid.');
  }
  if (parsed?.v !== PAYLOAD_VERSION || typeof parsed.iv !== 'string' || typeof parsed.ciphertext !== 'string') {
    throw new Error('License delivery payload is invalid.');
  }
  const key = await importEncryptionKey(secret, cryptoApi);
  try {
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeBase64Url(parsed.iv) },
      key,
      decodeBase64Url(parsed.ciphertext),
    );
    const payload = JSON.parse(decoder.decode(plaintext));
    if (payload?.v !== PAYLOAD_VERSION) throw new Error('version');
    return payload;
  } catch {
    throw new Error('License delivery payload could not be decrypted.');
  }
}

export { PAYLOAD_VERSION };
