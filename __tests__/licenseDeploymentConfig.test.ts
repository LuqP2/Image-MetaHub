import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareLicenseServerDeployment } from '../scripts/prepareLicenseServerDeployment.mjs';
import { getConfiguredSensitiveValues } from '../scripts/verifyPackagedLicensing.mjs';
import { createEd25519TestKeys } from './licenseCryptoTestHelpers';
import { encodeBase64Url } from '../utils/licenseCertificate.mjs';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('license server deployment preflight', () => {
  it('makes migrations mandatory and rolls the Worker back when smoke fails', async () => {
    const workflow = await fs.readFile(
      path.resolve('.github/workflows/license-server-deploy.yml'),
      'utf8',
    );
    expect(workflow).not.toContain('apply_migrations');
    expect(workflow).not.toContain('wrangler secret bulk');
    expect(workflow).toContain('wrangler d1 migrations apply');
    expect(workflow).toContain('--secrets-file .production-secrets.json');
    expect(workflow).toContain('steps.deploy.outcome == \'success\'');
    expect(workflow).toContain('wrangler rollback --yes');
  });

  it('includes the Cloudflare deployment token in packaged secret-value scans', () => {
    expect(getConfiguredSensitiveValues({
      CLOUDFLARE_API_TOKEN: 'production-cloudflare-token',
      LICENSE_SERVER_ADMIN_TOKEN: 'production-admin-token',
      STRIPE_WEBHOOK_SECRET: 'production-webhook-secret',
      STRIPE_RESTRICTED_API_KEY: 'production-restricted-key',
      LICENSE_DELIVERY_ENCRYPTION_KEY: 'production-encryption-key',
      RESEND_API_KEY: 'production-resend-key',
    })).toEqual([
      'production-admin-token',
      'production-webhook-secret',
      'production-restricted-key',
      'production-encryption-key',
      'production-resend-key',
      'production-cloudflare-token',
    ]);
  });

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
    const env = {
      CLOUDFLARE_API_TOKEN: 'test-cloudflare-token',
      CLOUDFLARE_ACCOUNT_ID: 'test-cloudflare-account',
      LICENSE_D1_DATABASE_ID: d1DatabaseId,
      LICENSE_SERVER_URL: 'https://licenses.example.com',
      LICENSE_SIGNING_PUBLIC_KEY: keys.publicKey,
      LICENSE_SIGNING_PRIVATE_KEY: keys.privateKey,
      LICENSE_SERVER_ADMIN_TOKEN: 'a'.repeat(32),
      EMAIL_LOOKUP_PEPPER: 'test-only-email-pepper',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_webhook_secret',
      STRIPE_RESTRICTED_API_KEY: 'rk_live_restrictedkey',
      LICENSE_DELIVERY_ENCRYPTION_KEY: encodeBase64Url(new Uint8Array(32).fill(9)),
      RESEND_API_KEY: 're_test_resend_key',
      STRIPE_ACCOUNT_ID: 'acct_testaccount',
      STRIPE_SUBSCRIPTION_PRODUCT_ID: 'prod_subscription',
      STRIPE_MONTHLY_PRICE_ID: 'price_monthly',
      STRIPE_ANNUAL_PRICE_ID: 'price_annual',
      STRIPE_MONTHLY_HISTORICAL_PRICE_IDS: 'price_monthlyold, price_monthlyolder',
      STRIPE_ANNUAL_HISTORICAL_PRICE_IDS: 'price_annualold',
      STRIPE_LIFETIME_PRICE_ID: 'price_lifetime',
      LICENSE_EMAIL_FROM: 'Image MetaHub <licenses@example.com>',
      LICENSE_EMAIL_REPLY_TO: 'support@example.com',
    };
    await prepareLicenseServerDeployment({ outputPath, env });
    const contents = await fs.readFile(outputPath, 'utf8');
    expect(contents).not.toContain('REPLACE_DURING_DEPLOYMENT');
    expect(JSON.parse(contents)).toMatchObject({
      d1_databases: [{ database_id: d1DatabaseId }],
      vars: {
        LICENSE_SIGNING_PUBLIC_KEY: keys.publicKey,
        STRIPE_LIVEMODE: 'true',
        STRIPE_ACCOUNT_ID: 'acct_testaccount',
        STRIPE_SUBSCRIPTION_PRODUCT_ID: 'prod_subscription',
        STRIPE_MONTHLY_PRICE_ID: 'price_monthly',
        STRIPE_ANNUAL_PRICE_ID: 'price_annual',
        STRIPE_MONTHLY_HISTORICAL_PRICE_IDS: 'price_monthlyold,price_monthlyolder',
        STRIPE_ANNUAL_HISTORICAL_PRICE_IDS: 'price_annualold',
        STRIPE_LIFETIME_PRICE_ID: 'price_lifetime',
        LICENSE_EMAIL_FROM: 'Image MetaHub <licenses@example.com>',
        LICENSE_EMAIL_REPLY_TO: 'support@example.com',
      },
      triggers: { crons: ['* * * * *'] },
    });
    expect(contents).not.toContain(keys.privateKey);
    expect(contents).not.toContain('test-only-email-pepper');
    expect(contents).not.toContain('whsec_test_webhook_secret');
    expect(contents).not.toContain('rk_live_restrictedkey');
    expect(contents).not.toContain('re_test_resend_key');
    await expect(prepareLicenseServerDeployment({
      outputPath,
      env: { ...env, STRIPE_RESTRICTED_API_KEY: 'rk_test_restrictedkey' },
    })).rejects.toThrow('live-mode restricted Stripe API key');
  });
});
