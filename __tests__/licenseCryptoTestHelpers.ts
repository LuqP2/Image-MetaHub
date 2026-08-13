import { randomUUID, webcrypto } from 'node:crypto';
import { encodeBase64Url } from '../utils/licenseCertificate.mjs';

export const testCrypto = {
  subtle: webcrypto.subtle,
  getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
  randomUUID,
} as Crypto & { randomUUID: () => string };

export async function createEd25519TestKeys() {
  const keyPair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const [privateKey, publicKey] = await Promise.all([
    webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey),
    webcrypto.subtle.exportKey('raw', keyPair.publicKey),
  ]);
  return {
    privateKey: encodeBase64Url(new Uint8Array(privateKey)),
    publicKey: encodeBase64Url(new Uint8Array(publicKey)),
  };
}
