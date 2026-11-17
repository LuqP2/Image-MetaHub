import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export function reviewHash(english) {
  return bytesToHex(sha256(utf8ToBytes(english)));
}
