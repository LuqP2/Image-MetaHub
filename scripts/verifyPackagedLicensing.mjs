import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const requiredEntries = [
  'electron.mjs',
  'electron/licenseManager.mjs',
  'electron/licenseClientConfig.generated.mjs',
  'electron/licenseRuntimeConfig.mjs',
  'electron/cacheReset.mjs',
  'utils/licenseCertificate.mjs',
];

const sensitiveIdentifiers = [
  'IMH_LICENSE_SECRET',
  'VITE_IMH_LICENSE_SECRET',
  'LICENSE_SIGNING_PRIVATE_KEY',
  'LICENSE_SERVER_ADMIN_TOKEN',
  'EMAIL_LOOKUP_PEPPER',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_RESTRICTED_API_KEY',
  'LICENSE_DELIVERY_ENCRYPTION_KEY',
  'RESEND_API_KEY',
  'CLOUDFLARE_API_TOKEN',
];

const forbiddenMarkers = [
  '-----BEGIN PRIVATE KEY-----',
];

export function getConfiguredSensitiveValues(env = process.env) {
  return [
    env.IMH_LICENSE_SECRET,
    env.VITE_IMH_LICENSE_SECRET,
    env.LICENSE_SIGNING_PRIVATE_KEY,
    env.LICENSE_SERVER_ADMIN_TOKEN,
    env.EMAIL_LOOKUP_PEPPER,
    env.STRIPE_WEBHOOK_SECRET,
    env.STRIPE_RESTRICTED_API_KEY,
    env.LICENSE_DELIVERY_ENCRYPTION_KEY,
    env.RESEND_API_KEY,
    env.CLOUDFLARE_API_TOKEN,
  ].filter((value) => typeof value === 'string' && value.length >= 8);
}

async function findAppAsar(root) {
  const candidates = [];
  async function visit(directory, depth = 0) {
    if (depth > 5) return;
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const target = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === 'app.asar') candidates.push(target);
      if (entry.isDirectory()) await visit(target, depth + 1);
    }
  }
  await visit(root);
  if (candidates.length === 0) throw new Error(`No packaged app.asar found under ${root}.`);
  candidates.sort((left, right) => right.localeCompare(left));
  return candidates[0];
}

export async function verifyPackagedLicensing(appAsarPath) {
  const entries = new Set(asar.listPackage(appAsarPath).map((entry) => entry.replace(/^[/\\]+/, '').replace(/\\/g, '/')));
  const missing = requiredEntries.filter((entry) => !entries.has(entry));
  if (missing.length > 0) throw new Error(`Packaged licensing files are missing: ${missing.join(', ')}`);

  const actualSecretValues = getConfiguredSensitiveValues();
  const findings = [];
  const runtimeIdentifierFindings = [];
  const documentationIdentifierFindings = [];
  for (const entry of entries) {
    let contents;
    try {
      contents = asar.extractFile(appAsarPath, entry);
    } catch {
      continue;
    }
    const text = contents.toString('utf8');
    for (const marker of [...forbiddenMarkers, ...actualSecretValues]) {
      if (text.includes(marker)) findings.push(`${entry}: ${forbiddenMarkers.includes(marker) ? marker : 'configured secret value'}`);
    }
    for (const identifier of sensitiveIdentifiers) {
      if (!text.includes(identifier)) continue;
      const target = /\.(?:md|txt)$/i.test(entry) ? documentationIdentifierFindings : runtimeIdentifierFindings;
      target.push(`${entry}: ${identifier}`);
    }
  }
  if (findings.length > 0 || runtimeIdentifierFindings.length > 0) {
    throw new Error(`Sensitive licensing material found in app.asar:\n${[...findings, ...runtimeIdentifierFindings].join('\n')}`);
  }
  return { appAsarPath, requiredEntries, documentationIdentifierFindings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const explicitPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
  const appAsarPath = explicitPath || await findAppAsar(path.join(repositoryRoot, 'dist-electron'));
  const result = await verifyPackagedLicensing(appAsarPath);
  console.log(`Packaged licensing verification passed: ${result.appAsarPath}`);
  console.log(`Required runtime files: ${result.requiredEntries.join(', ')}`);
  console.log('Sensitive licensing marker/value scan: clean.');
  if (result.documentationIdentifierFindings.length > 0) {
    console.log(`Historical identifier names found only in packaged documentation: ${result.documentationIdentifierFindings.join(', ')}`);
  }
}
