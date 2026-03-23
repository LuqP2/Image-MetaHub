import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { daysToMs, resolveLicensePolicy } from '../../shared/licensePolicy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DB_PATH = process.env.IMH_LICENSE_DB_PATH || path.join(__dirname, 'data', 'license-db.sqlite');
const DEFAULT_PRIVATE_KEY_PATH = process.env.IMH_LICENSE_PRIVATE_KEY_PATH || path.join(__dirname, 'data', 'license-private.pem');
const DEFAULT_PUBLIC_KEY_PATH = process.env.IMH_LICENSE_PUBLIC_KEY_PATH || path.join(__dirname, 'data', 'license-public.pem');
const LEGACY_LICENSE_SECRET = process.env.IMH_LICENSE_SECRET || 'CHANGE-ME-BEFORE-RELEASE';

export const LICENSE_POLICY = resolveLicensePolicy({
  annualRefreshDays: process.env.IMH_LICENSE_ANNUAL_REFRESH_DAYS,
  annualGraceDays: process.env.IMH_LICENSE_ANNUAL_GRACE_DAYS,
  lifetimeRefreshDays: process.env.IMH_LICENSE_LIFETIME_REFRESH_DAYS,
  lifetimeGraceDays: process.env.IMH_LICENSE_LIFETIME_GRACE_DAYS,
  trialDays: process.env.IMH_LICENSE_TRIAL_DAYS,
  defaultMaxDevices: process.env.IMH_LICENSE_DEFAULT_MAX_DEVICES,
});

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

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeLicenseKey(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatLicenseKey(value) {
  const normalized = normalizeLicenseKey(value);
  return normalized.match(/.{1,4}/g)?.join('-') ?? normalized;
}

export function generateLegacyLicenseKeyFromEmail(email) {
  if (!LEGACY_LICENSE_SECRET || LEGACY_LICENSE_SECRET === 'CHANGE-ME-BEFORE-RELEASE') {
    throw new Error('IMH_LICENSE_SECRET is required to preserve legacy customer keys');
  }

  const normalizedEmail = normalizeEmail(email);
  const hmac = crypto
    .createHmac('sha256', LEGACY_LICENSE_SECRET)
    .update(normalizedEmail)
    .digest('hex')
    .toUpperCase();

  return normalizeLicenseKey(hmac.slice(0, 20));
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

export function generateLicenseKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = Array.from(crypto.randomBytes(20), (byte) => alphabet[byte % alphabet.length]).join('');
  return chars.match(/.{1,4}/g).join('-');
}

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function mapLicenseRow(row) {
  if (!row) return null;
  return {
    licenseId: row.id,
    customerId: row.customer_id,
    email: row.email,
    licenseKey: row.license_key,
    plan: row.plan,
    status: row.status,
    maxDevices: row.max_devices,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActivationRow(row) {
  if (!row) return null;
  return {
    activationId: row.id,
    licenseId: row.license_id,
    deviceId: row.device_id,
    deviceLabel: row.device_label,
    status: row.status,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    deactivatedAt: row.deactivated_at,
  };
}

function mapTrialRow(row) {
  if (!row) return null;
  return {
    trialId: row.id,
    email: row.email,
    deviceId: row.device_id,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

let database = null;

export async function getDb() {
  if (database) return database;
  await ensureDataDir();
  database = new DatabaseSync(paths.dbPath);
  database.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      email TEXT NOT NULL,
      license_key TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL CHECK (plan IN ('annual', 'lifetime')),
      status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
      max_devices INTEGER NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS activations (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_label TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'deactivated')),
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deactivated_at TEXT,
      FOREIGN KEY (license_id) REFERENCES licenses(id)
    );

    CREATE TABLE IF NOT EXISTS trials (
      id TEXT PRIMARY KEY,
      email TEXT,
      device_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('active', 'expired')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_activations_license_device
      ON activations (license_id, device_id);

    CREATE INDEX IF NOT EXISTS idx_activations_active_by_license
      ON activations (license_id, status);

    CREATE INDEX IF NOT EXISTS idx_licenses_email
      ON licenses (email);
  `);

  return database;
}

export function closeDb() {
  if (database) {
    database.close();
    database = null;
  }
}

export function getLicenseStatus(license) {
  if (license.status === 'revoked') return 'revoked';
  if (license.plan === 'lifetime') return 'active';
  if (!license.expiresAt) return 'expired';

  const now = Date.now();
  const expiresAtMs = new Date(license.expiresAt).getTime();
  const graceEndsAt = expiresAtMs + daysToMs(LICENSE_POLICY.annualGraceDays);

  if (now <= expiresAtMs) return 'active';
  if (now <= graceEndsAt) return 'grace';
  return 'expired';
}

export function buildEntitlement({ license, activation, trial = null }) {
  const issuedAt = nowIso();

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
      nextRefreshAt: null,
    };
  }

  const status = getLicenseStatus(license);
  const refreshDays = license.plan === 'lifetime' ? LICENSE_POLICY.lifetimeRefreshDays : LICENSE_POLICY.annualRefreshDays;
  const graceDays = license.plan === 'lifetime' ? LICENSE_POLICY.lifetimeGraceDays : LICENSE_POLICY.annualGraceDays;
  const offlineValidUntil = license.expiresAt
    ? new Date(Math.min(
        new Date(license.expiresAt).getTime() + daysToMs(graceDays),
        Date.now() + daysToMs(graceDays),
      )).toISOString()
    : addDaysIso(graceDays);

  return {
    licenseId: license.licenseId,
    activationId: activation.activationId,
    customerEmail: license.email,
    plan: license.plan,
    status,
    featureSet: status === 'active' || status === 'grace' ? 'pro' : 'free',
    deviceId: activation.deviceId,
    maxDevices: license.maxDevices,
    issuedAt,
    expiresAt: license.expiresAt ?? null,
    offlineValidUntil,
    nextRefreshAt: addDaysIso(refreshDays),
  };
}

export function signEntitlement(entitlement, privateKeyPem) {
  const data = Buffer.from(stableStringify(entitlement), 'utf8');
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, data, privateKey).toString('base64');
  return { ...entitlement, signature };
}

export async function createLicenseRecord({ email, plan, days, maxDevices }) {
  const db = await getDb();
  const normalizedEmail = normalizeEmail(email);
  const createdAt = nowIso();
  const customerId = crypto.randomUUID();
  const licenseId = crypto.randomUUID();
  const effectivePlan = plan === 'lifetime' ? 'lifetime' : 'annual';
  const expiresAt = effectivePlan === 'lifetime' ? null : addDaysIso(Number(days) || 365);
  const effectiveMaxDevices = Number.isFinite(Number(maxDevices)) ? Number(maxDevices) : LICENSE_POLICY.defaultMaxDevices;

  db.exec('BEGIN IMMEDIATE');
  try {
    const existingCustomer = db.prepare('SELECT id FROM customers WHERE email = ?').get(normalizedEmail);
    const finalCustomerId = existingCustomer?.id || customerId;

    if (!existingCustomer) {
      db.prepare(`
        INSERT INTO customers (id, email, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(finalCustomerId, normalizedEmail, createdAt, createdAt);
    } else {
      db.prepare('UPDATE customers SET updated_at = ? WHERE id = ?').run(createdAt, finalCustomerId);
    }

    db.prepare(`
      INSERT INTO licenses (id, customer_id, email, license_key, plan, status, max_devices, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(
      licenseId,
      finalCustomerId,
      normalizedEmail,
      generateLicenseKey(),
      effectivePlan,
      effectiveMaxDevices,
      expiresAt,
      createdAt,
      createdAt,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return getLicenseById(licenseId);
}

export async function listLicenses() {
  const db = await getDb();
  return db.prepare('SELECT * FROM licenses ORDER BY created_at DESC').all().map(mapLicenseRow);
}

export async function findLicensesByEmail(email) {
  const db = await getDb();
  return db.prepare(`
    SELECT *
    FROM licenses
    WHERE email = ?
    ORDER BY created_at DESC
  `).all(normalizeEmail(email)).map(mapLicenseRow);
}

export async function getLicenseById(licenseId) {
  const db = await getDb();
  return mapLicenseRow(db.prepare('SELECT * FROM licenses WHERE id = ?').get(licenseId));
}

export async function findLicenseByEmailAndKey(email, licenseKey) {
  const db = await getDb();
  const rows = db.prepare(`
    SELECT *
    FROM licenses
    WHERE email = ? AND license_key = ? AND status != 'revoked'
  `).all(normalizeEmail(email), String(licenseKey || '').trim().toUpperCase());

  if (rows.length > 0) {
    return mapLicenseRow(rows[0]);
  }

  const normalizedRequestedKey = normalizeLicenseKey(licenseKey);
  const fallbackRows = db.prepare(`
    SELECT *
    FROM licenses
    WHERE email = ? AND status != 'revoked'
    ORDER BY created_at DESC
  `).all(normalizeEmail(email));

  const matchingRow = fallbackRows.find((row) => normalizeLicenseKey(row.license_key) === normalizedRequestedKey);
  return mapLicenseRow(matchingRow);
}

export async function updateLicenseMaxDevicesByEmail({ email, maxDevices }) {
  const db = await getDb();
  const normalizedEmail = normalizeEmail(email);
  const timestamp = nowIso();
  const effectiveMaxDevices = Number.isFinite(Number(maxDevices)) ? Number(maxDevices) : LICENSE_POLICY.defaultMaxDevices;

  const existingRows = db.prepare(`
    SELECT *
    FROM licenses
    WHERE email = ? AND status != 'revoked'
    ORDER BY created_at DESC
  `).all(normalizedEmail);

  if (existingRows.length === 0) {
    return null;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE licenses
      SET max_devices = ?, updated_at = ?
      WHERE email = ? AND status != 'revoked'
    `).run(effectiveMaxDevices, timestamp, normalizedEmail);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return db.prepare(`
    SELECT *
    FROM licenses
    WHERE email = ? AND status != 'revoked'
    ORDER BY created_at DESC
  `).all(normalizedEmail).map(mapLicenseRow);
}

export async function upsertImportedLifetimeLicense({
  email,
  maxDevices = LICENSE_POLICY.defaultMaxDevices,
  licenseKey = null,
}) {
  const db = await getDb();
  const normalizedEmail = normalizeEmail(email);
  const timestamp = nowIso();
  const customerId = crypto.randomUUID();
  const licenseId = crypto.randomUUID();
  const effectiveMaxDevices = Number.isFinite(Number(maxDevices)) ? Number(maxDevices) : LICENSE_POLICY.defaultMaxDevices;
  const effectiveLicenseKey = normalizeLicenseKey(licenseKey || generateLegacyLicenseKeyFromEmail(normalizedEmail));

  db.exec('BEGIN IMMEDIATE');
  try {
    const existingCustomer = db.prepare('SELECT id FROM customers WHERE email = ?').get(normalizedEmail);
    const finalCustomerId = existingCustomer?.id || customerId;

    if (!existingCustomer) {
      db.prepare(`
        INSERT INTO customers (id, email, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(finalCustomerId, normalizedEmail, timestamp, timestamp);
    } else {
      db.prepare('UPDATE customers SET updated_at = ? WHERE id = ?').run(timestamp, finalCustomerId);
    }

    const existingLicenseRow = db.prepare(`
      SELECT *
      FROM licenses
      WHERE email = ? AND status != 'revoked'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(normalizedEmail);

    if (existingLicenseRow) {
      db.prepare(`
        UPDATE licenses
        SET license_key = ?,
            plan = 'lifetime',
            max_devices = ?,
            expires_at = NULL,
            updated_at = ?
        WHERE id = ?
      `).run(effectiveLicenseKey, effectiveMaxDevices, timestamp, existingLicenseRow.id);
      db.exec('COMMIT');
      return {
        created: false,
        license: mapLicenseRow({
          ...existingLicenseRow,
          license_key: effectiveLicenseKey,
          plan: 'lifetime',
          max_devices: effectiveMaxDevices,
          expires_at: null,
          updated_at: timestamp,
        }),
      };
    }

    db.prepare(`
      INSERT INTO licenses (id, customer_id, email, license_key, plan, status, max_devices, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'lifetime', 'active', ?, NULL, ?, ?)
    `).run(
      licenseId,
      finalCustomerId,
      normalizedEmail,
      effectiveLicenseKey,
      effectiveMaxDevices,
      timestamp,
      timestamp,
    );

    db.exec('COMMIT');
    return { created: true, license: await getLicenseById(licenseId) };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function activateLicenseForDevice({ license, deviceId, deviceLabel }) {
  const db = await getDb();
  const now = nowIso();
  let activationId = null;

  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare(`
      SELECT id
      FROM activations
      WHERE license_id = ? AND device_id = ?
    `).get(license.licenseId, deviceId);

    if (existing?.id) {
      activationId = existing.id;
      db.prepare(`
        UPDATE activations
        SET status = 'active',
            device_label = ?,
            last_seen_at = ?,
            deactivated_at = NULL
        WHERE id = ?
      `).run(deviceLabel || 'Unknown Device', now, activationId);
    } else {
      const activeCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM activations
        WHERE license_id = ? AND status = 'active'
      `).get(license.licenseId).count;

      if (activeCount >= license.maxDevices) {
        throw new Error('device_limit_reached');
      }

      activationId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO activations (id, license_id, device_id, device_label, status, last_seen_at, created_at, deactivated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, NULL)
      `).run(activationId, license.licenseId, deviceId, deviceLabel || 'Unknown Device', now, now);
    }

    db.prepare('UPDATE licenses SET updated_at = ? WHERE id = ?').run(now, license.licenseId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return mapActivationRow(db.prepare('SELECT * FROM activations WHERE id = ?').get(activationId));
}

export async function refreshActivation({ activationId, licenseId, deviceId }) {
  const db = await getDb();
  const now = nowIso();
  const result = db.prepare(`
    UPDATE activations
    SET last_seen_at = ?
    WHERE id = ? AND license_id = ? AND device_id = ? AND status = 'active'
  `).run(now, activationId, licenseId, deviceId);

  if (!result.changes) {
    return null;
  }

  db.prepare('UPDATE licenses SET updated_at = ? WHERE id = ?').run(now, licenseId);
  return mapActivationRow(db.prepare('SELECT * FROM activations WHERE id = ?').get(activationId));
}

export async function findActivationByIdentity({ activationId, licenseId, deviceId }) {
  const db = await getDb();
  return mapActivationRow(db.prepare(`
    SELECT *
    FROM activations
    WHERE id = ? AND license_id = ? AND device_id = ?
  `).get(activationId, licenseId, deviceId));
}

export async function deactivateActivation({ activationId, licenseId, deviceId }) {
  const db = await getDb();
  const now = nowIso();
  db.prepare(`
    UPDATE activations
    SET status = 'deactivated', deactivated_at = ?
    WHERE id = ? AND license_id = ? AND device_id = ? AND status = 'active'
  `).run(now, activationId, licenseId, deviceId);

  return findActivationByIdentity({ activationId, licenseId, deviceId });
}

export async function listLicenseDevices({ licenseId }) {
  const db = await getDb();
  return db.prepare(`
    SELECT *
    FROM activations
    WHERE license_id = ?
    ORDER BY created_at DESC
  `).all(licenseId).map(mapActivationRow);
}

export async function deactivateLicenseDevice({ licenseId, activationId }) {
  const db = await getDb();
  const now = nowIso();
  db.prepare(`
    UPDATE activations
    SET status = 'deactivated', deactivated_at = ?
    WHERE license_id = ? AND id = ? AND status = 'active'
  `).run(now, licenseId, activationId);

  return mapActivationRow(db.prepare(`
    SELECT *
    FROM activations
    WHERE id = ? AND license_id = ?
  `).get(activationId, licenseId));
}

export async function startTrial({ email, deviceId }) {
  const db = await getDb();
  const normalizedEmail = email ? normalizeEmail(email) : null;
  const existing = db.prepare('SELECT * FROM trials WHERE device_id = ?').get(deviceId);
  if (existing) {
    throw new Error('trial_already_used');
  }

  const trialId = `trial-${crypto.randomUUID()}`;
  const createdAt = nowIso();
  const expiresAt = addDaysIso(LICENSE_POLICY.trialDays);

  db.prepare(`
    INSERT INTO trials (id, email, device_id, status, created_at, expires_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run(trialId, normalizedEmail, deviceId, createdAt, expiresAt);

  return mapTrialRow(db.prepare('SELECT * FROM trials WHERE id = ?').get(trialId));
}
