import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashFileSha256 } from '../electron/fileFingerprint.mjs';

const fixturePath = path.join(process.cwd(), '__tests__', 'fixtures', 'provenance', 'fingerprint.txt');

describe('on-demand SHA-256 fingerprinting', () => {
  it('streams a known fixture to the expected SHA-256 fingerprint', async () => {
    await expect(hashFileSha256(fixturePath)).resolves.toBe(
      'e80c15e3190f8aed09dd3fc1203c6c943de737785d2bb7348c40d6567e07a7e4'
    );
  });

  it('reports a missing file cleanly', async () => {
    await expect(hashFileSha256(`${fixturePath}.missing`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('surfaces a file read failure', async () => {
    const directoryPath = path.dirname(fixturePath);
    await expect(hashFileSha256(directoryPath)).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('aborts a fingerprint stream when its signal is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(hashFileSha256(fixturePath, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ABORT_ERR',
    });
  });
});
