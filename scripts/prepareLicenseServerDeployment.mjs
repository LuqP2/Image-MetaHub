import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBase64Url } from '../utils/licenseCertificate.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function prepareLicenseServerDeployment({ env = process.env, outputPath }) {
  const required = [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'LICENSE_D1_DATABASE_ID',
    'LICENSE_SERVER_URL',
    'LICENSE_SIGNING_PUBLIC_KEY',
    'LICENSE_SIGNING_PRIVATE_KEY',
    'LICENSE_SERVER_ADMIN_TOKEN',
    'EMAIL_LOOKUP_PEPPER',
  ];
  for (const name of required) {
    if (!String(env[name] || '').trim() || /REPLACE_DURING_DEPLOYMENT/i.test(String(env[name]))) {
      throw new Error(`${name} is missing or still uses a placeholder.`);
    }
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.LICENSE_D1_DATABASE_ID)) {
    throw new Error('LICENSE_D1_DATABASE_ID must be a canonical Cloudflare D1 UUID.');
  }
  const serverUrl = new URL(env.LICENSE_SERVER_URL);
  if (serverUrl.protocol !== 'https:' || serverUrl.hostname.endsWith('.invalid')) {
    throw new Error('LICENSE_SERVER_URL must be the production HTTPS Worker URL.');
  }
  if (String(env.LICENSE_SERVER_ADMIN_TOKEN).length < 32 || String(env.EMAIL_LOOKUP_PEPPER).length < 16) {
    throw new Error('License server admin token or email lookup pepper is too short.');
  }

  const publicKeyBytes = decodeBase64Url(env.LICENSE_SIGNING_PUBLIC_KEY);
  const privateKeyBytes = decodeBase64Url(env.LICENSE_SIGNING_PRIVATE_KEY);
  if (publicKeyBytes.length !== 32) throw new Error('LICENSE_SIGNING_PUBLIC_KEY is not a raw Ed25519 public key.');
  const [publicKey, privateKey] = await Promise.all([
    globalThis.crypto.subtle.importKey('raw', publicKeyBytes, { name: 'Ed25519' }, false, ['verify']),
    globalThis.crypto.subtle.importKey('pkcs8', privateKeyBytes, { name: 'Ed25519' }, false, ['sign']),
  ]);
  const probe = new TextEncoder().encode('image-metahub-license-deployment-preflight');
  const signature = await globalThis.crypto.subtle.sign('Ed25519', privateKey, probe);
  if (!await globalThis.crypto.subtle.verify('Ed25519', publicKey, signature, probe)) {
    throw new Error('Configured Ed25519 public and private keys do not form a pair.');
  }

  const config = {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: 'image-metahub-license-server',
    main: 'src/worker.js',
    compatibility_date: '2026-08-13',
    d1_databases: [{
      binding: 'DB',
      database_name: 'image-metahub-licenses',
      database_id: env.LICENSE_D1_DATABASE_ID,
      migrations_dir: 'migrations',
    }],
    vars: { LICENSE_SIGNING_PUBLIC_KEY: env.LICENSE_SIGNING_PUBLIC_KEY },
  };
  const target = path.resolve(outputPath || path.join(repositoryRoot, 'packages/license-server/wrangler.production.generated.json'));
  await fs.writeFile(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputPath = await prepareLicenseServerDeployment({ outputPath: process.argv[2] });
  console.log(`Validated production Worker configuration: ${outputPath}`);
}
