import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';

export const sha256File = (filePath) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const stream = fsSync.createReadStream(filePath);
  stream.on('error', reject);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

export const expectedSha256FromHeaders = (headers) => {
  const raw = headers.get('x-linked-etag') || headers.get('X-Linked-Etag');
  if (!raw) return null;
  const value = raw.replace(/^"|"$/g, '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
};

export const verifyDownloadedModelFile = async (
  filePath,
  expectedSha256,
  dependencies = {}
) => {
  if (!expectedSha256) return { verified: false };
  const hashFile = dependencies.sha256File ?? sha256File;
  const removeFile = dependencies.removeFile ?? ((target) => fs.rm(target, { force: true }));
  const actualSha256 = await hashFile(filePath);
  if (actualSha256 !== expectedSha256) {
    await removeFile(filePath);
    throw new Error(`Checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }
  return { verified: true, sha256: actualSha256 };
};
