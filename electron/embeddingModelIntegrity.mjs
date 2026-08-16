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

export const verifyDownloadedModelFile = async (
  filePath,
  integrity,
  dependencies = {}
) => {
  const hashFile = dependencies.sha256File ?? sha256File;
  const statFile = dependencies.statFile ?? ((target) => fs.stat(target));
  const removeFile = dependencies.removeFile ?? ((target) => fs.rm(target, { force: true }));
  const rejectAndRemove = async (message) => {
    await removeFile(filePath);
    throw new Error(message);
  };

  if (!integrity || !Number.isSafeInteger(integrity.size) || integrity.size <= 0 ||
      !/^[a-f0-9]{64}$/.test(integrity.sha256 ?? '')) {
    return rejectAndRemove('Missing trusted model integrity policy');
  }

  const stats = await statFile(filePath).catch(() => null);
  if (!stats || stats.size !== integrity.size) {
    return rejectAndRemove(`Size mismatch: expected ${integrity.size}, got ${stats?.size ?? 0}`);
  }

  let actualSha256;
  try {
    actualSha256 = await hashFile(filePath);
  } catch (error) {
    return rejectAndRemove(`Unable to hash model file: ${error?.message ?? String(error)}`);
  }
  if (actualSha256 !== integrity.sha256) {
    return rejectAndRemove(`Checksum mismatch: expected ${integrity.sha256}, got ${actualSha256}`);
  }
  return { verified: true, sha256: actualSha256, size: stats.size };
};

export const waitForWritableDrain = (stream) => new Promise((resolve, reject) => {
  const cleanup = () => {
    stream.removeListener('drain', onDrain);
    stream.removeListener('error', onError);
    stream.removeListener('close', onClose);
  };
  const onDrain = () => {
    cleanup();
    resolve();
  };
  const onError = (error) => {
    cleanup();
    reject(error);
  };
  const onClose = () => {
    cleanup();
    reject(new Error('Model destination stream closed before draining'));
  };

  stream.once('drain', onDrain);
  stream.once('error', onError);
  stream.once('close', onClose);
});
