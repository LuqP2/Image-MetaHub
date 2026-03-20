import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DB_PATH = process.env.IMH_LICENSE_DB_PATH || path.join(__dirname, 'data', 'license-db.json');
const DEFAULT_PRIVATE_KEY_PATH = process.env.IMH_LICENSE_PRIVATE_KEY_PATH || path.join(__dirname, 'data', 'license-private.pem');
const DEFAULT_PUBLIC_KEY_PATH = process.env.IMH_LICENSE_PUBLIC_KEY_PATH || path.join(__dirname, 'data', 'license-public.pem');
const DEFAULT_OFFLINE_GRACE_DAYS = Number(process.env.IMH_LICENSE_OFFLINE_GRACE_DAYS || 14);
const DEFAULT_REFRESH_DAYS = Number(process.env.IMH_LICENSE_REFRESH_DAYS || 7);
const DEFAULT_TRIAL_DAYS = 7;

export const paths = {
  dbPath: DEFAULT_DB_PATH,
  privateKeyPath: DEFAULT_PRIVATE_KEY_PATH,
  publicKeyPath: DEFAULT_PUBLIC_KEY_PATH,
};

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

export async function ensureDataDir() {
  await fs.mkdir(path.dirname(paths.dbPath), { recursive: true });
}

export async function loadDb() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(paths.dbPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        version: 1,
        licenses: [],
        activations: [],
        trials: [],
      };
    }
    throw error;
  }
}

export async function saveDb(db) {
  await ensureDataDir();
  await fs.writeFile(paths.dbPath, JSON.stringify(db, null, 2), 'utf8');
}

export async function ensureKeypair() {
  await ensureDataDir();

  if (fsSync.existsSync(paths.privateKeyPath) && fsSync.existsSync(paths.publicKeyPath)) {
    const privateKeyPem = await fs.readFile(paths.privateKeyPath, 'utf8');
    const publicKeyPem = await fs.readFile(paths.publicKeyPath, 'utf8');
    return { privateKeyPem, publicKeyPem };
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

  await fs.writeFile(paths.privateKeyPath, privateKeyPem, 'utf8');
  await fs.writeFile(paths.publicKeyPath, publicKeyPem, 'utf8');

  return { privateKeyPem, publicKeyPem };
}

export function generateLicenseKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = Array.from(crypto.randomBytes(20), (byte) => alphabet[byte % alphabet.length]).join('');
  return chars.match(/.{1,4}/g).join('-');
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

export function getLicenseStatus(license) {
  if (license.status === 'revoked') {
    return 'revoked';
  }
  if (license.plan === 'lifetime') {
    return 'active';
  }
  if (!license.expiresAt) {
    return 'expired';
  }

  const now = Date.now();
  const expiresAtMs = new Date(license.expiresAt).getTime();
  const graceEndsAt = expiresAtMs + DEFAULT_OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000;

  if (now <= expiresAtMs) {
    return 'active';
  }
  if (now <= graceEndsAt) {
    return 'grace';
  }
  return 'expired';
}

export function buildEntitlement({ license, activation, featureSet = 'pro', trial = null }) {
  const issuedAt = new Date().toISOString();

  if (trial) {
    return {
      licenseId: trial.trialId,
      activationId: activation.activationId,
      customerEmail: trial.email ?? null,
      plan: 'trial',
      status: Date.now() <= new Date(trial.expiresAt).getTime() ? 'active' : 'expired',
      featureSet: Date.now() <= new Date(trial.expiresAt).getTime() ? 'pro' : 'free',
      deviceId: activation.deviceId,
      maxDevices: 1,
      issuedAt,
      expiresAt: trial.expiresAt,
      offlineValidUntil: trial.expiresAt,
      nextRefreshAt: new Date(Date.now() + Math.min(DEFAULT_REFRESH_DAYS, DEFAULT_TRIAL_DAYS) * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  const status = getLicenseStatus(license);
  const feature = status === 'active' || status === 'grace' ? featureSet : 'free';
  const offlineValidUntil = license.plan === 'annual' && license.expiresAt
    ? new Date(Math.min(
        new Date(license.expiresAt).getTime() + DEFAULT_OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000,
        Date.now() + DEFAULT_OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000,
      )).toISOString()
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    licenseId: license.licenseId,
    activationId: activation.activationId,
    customerEmail: license.email,
    plan: license.plan,
    status,
    featureSet: feature,
    deviceId: activation.deviceId,
    maxDevices: license.maxDevices,
    issuedAt,
    expiresAt: license.expiresAt ?? null,
    offlineValidUntil,
    nextRefreshAt: new Date(Date.now() + DEFAULT_REFRESH_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function signEntitlement(entitlement, privateKeyPem) {
  const data = Buffer.from(stableStringify(entitlement), 'utf8');
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, data, privateKey).toString('base64');
  return {
    ...entitlement,
    signature,
  };
}

export function createActivation({ licenseId, deviceId, deviceLabel }) {
  return {
    activationId: crypto.randomUUID(),
    licenseId,
    deviceId,
    deviceLabel: deviceLabel || 'Unknown Device',
    status: 'active',
    createdAt: new Date().toISOString(),
    lastValidatedAt: new Date().toISOString(),
    deactivatedAt: null,
  };
}

export async function createLicenseRecord({ email, plan, days, maxDevices }) {
  const db = await loadDb();
  const normalizedEmail = normalizeEmail(email);
  const license = {
    licenseId: crypto.randomUUID(),
    email: normalizedEmail,
    licenseKey: generateLicenseKey(),
    plan: plan === 'lifetime' ? 'lifetime' : 'annual',
    status: 'active',
    maxDevices: Number.isFinite(Number(maxDevices)) ? Number(maxDevices) : 2,
    createdAt: new Date().toISOString(),
    expiresAt: plan === 'lifetime'
      ? null
      : new Date(Date.now() + (Number(days) || 365) * 24 * 60 * 60 * 1000).toISOString(),
  };
  db.licenses.push(license);
  await saveDb(db);
  return license;
}
