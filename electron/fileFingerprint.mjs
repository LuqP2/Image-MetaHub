import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Hash one user-requested file without copying its contents into renderer memory.
 * This module is intentionally main-process only.
 */
export const hashFileSha256 = (filePath) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);

  stream.on('data', (chunk) => hash.update(chunk));
  stream.once('error', reject);
  stream.once('end', () => resolve(hash.digest('hex')));
});
