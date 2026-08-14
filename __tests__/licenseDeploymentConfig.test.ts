import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareLicenseServerDeployment } from '../scripts/prepareLicenseServerDeployment.mjs';
import { createEd25519TestKeys } from './licenseCryptoTestHelpers';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('license server deployment preflight', () => {
  it('fails before generating deployment configuration when a placeholder remains', async () => {
    await expect(prepareLicenseServerDeployment({
      outputPath: 'unused.json',
      env: { LICENSE_D1_DATABASE_ID: 'REPLACE_DURING_DEPLOYMENT' },
    })).rejects.toThrow('missing or still uses a placeholder');
  });

  it('generates a placeholder-free Wrangler config from validated operator inputs', async () => {
    const keys = await createEd25519TestKeys();
    const d1DatabaseId = '123e4567-e89b-42d3-a456-426614174000';
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-deploy-config-test-'));
    tempDirectories.push(directory);
    const outputPath = path.join(directory, 'wrangler.production.generated.json');
    await prepareLicenseServerDeployment({
      outputPath,
      env: {
        CLOUDFLARE_API_TOKEN: 'test-cloudflare-token',
        CLOUDFLARE_ACCOUNT_ID: 'test-cloudflare-account',
        LICENSE_D1_DATABASE_ID: d1DatabaseId,
        LICENSE_SERVER_URL: 'https://licenses.example.com',
        LICENSE_SIGNING_PUBLIC_KEY: keys.publicKey,
        LICENSE_SIGNING_PRIVATE_KEY: keys.privateKey,
        LICENSE_SERVER_ADMIN_TOKEN: 'a'.repeat(32),
        EMAIL_LOOKUP_PEPPER: 'test-only-email-pepper',
      },
    });
    const contents = await fs.readFile(outputPath, 'utf8');
    expect(contents).not.toContain('REPLACE_DURING_DEPLOYMENT');
    expect(JSON.parse(contents)).toMatchObject({
      d1_databases: [{ database_id: d1DatabaseId }],
      vars: { LICENSE_SIGNING_PUBLIC_KEY: keys.publicKey },
    });
    expect(contents).not.toContain(keys.privateKey);
    expect(contents).not.toContain('test-only-email-pepper');
  });
});
