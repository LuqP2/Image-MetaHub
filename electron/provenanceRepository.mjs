import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  PROVENANCE_DATABASE_NAME,
  PROVENANCE_DIRECTORY_NAME,
  resolveProvenanceCatalogPath,
} from './provenancePaths.mjs';

export { PROVENANCE_DATABASE_NAME, PROVENANCE_DIRECTORY_NAME, resolveProvenanceCatalogPath };
export const PROVENANCE_SCHEMA_VERSION = 2;

export const ASSET_STATES = Object.freeze(['active', 'missing', 'deleted']);
export const LOCATION_STATES = Object.freeze(['present', 'missing', 'removed']);
export const REVISION_HASH_STATES = Object.freeze(['pending', 'available', 'failed']);

const HASH_STATE_SET = new Set(REVISION_HASH_STATES);

export class ProvenanceRepositoryError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProvenanceRepositoryError';
    this.code = code;
  }
}

function assertNonBlank(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', `${name} must be a non-empty string.`);
  }
  return value;
}

function normalizeOptionalTimestamp(value, name) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', `${name} must be a non-negative, finite timestamp.`);
  }
  const normalized = Math.trunc(value);
  if (!Number.isSafeInteger(normalized)) {
    throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', `${name} must be a non-negative, finite timestamp.`);
  }
  return normalized;
}

function assertUuid(value, name) {
  const normalized = assertNonBlank(value, name).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', `${name} must be a UUID.`);
  }
  return normalized;
}

function normalizeHash(hash, hashState) {
  if (!HASH_STATE_SET.has(hashState)) {
    throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', `Unsupported revision hash state: ${hashState}.`);
  }
  const normalized = typeof hash === 'string' && hash.trim() ? hash.trim().toLowerCase() : null;
  if (hashState === 'available' && !/^[a-f0-9]{64}$/.test(normalized || '')) {
    throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', 'An available revision hash must be a 64-character SHA-256 value.');
  }
  if (hashState !== 'available' && normalized !== null) {
    throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', `Revision hash must be null while its state is ${hashState}.`);
  }
  return normalized;
}

function readSchemaVersion(database) {
  return Number(database.prepare('PRAGMA user_version').get().user_version || 0);
}

function migrationOne(database) {
  database.exec(`
    CREATE TABLE provenance_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE assets (
      asset_id TEXT PRIMARY KEY,
      state TEXT NOT NULL CHECK (state IN ('active', 'missing', 'deleted')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE asset_revisions (
      revision_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      sha256 TEXT,
      hash_state TEXT NOT NULL CHECK (hash_state IN ('pending', 'available', 'failed')),
      byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
      mime_type TEXT,
      width INTEGER CHECK (width IS NULL OR width > 0),
      height INTEGER CHECK (height IS NULL OR height > 0),
      content_modified_ms INTEGER,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE RESTRICT,
      UNIQUE (asset_id, revision_id),
      CHECK (
        (hash_state = 'available' AND sha256 IS NOT NULL AND length(sha256) = 64)
        OR (hash_state != 'available' AND sha256 IS NULL)
      )
    ) STRICT;

    CREATE INDEX asset_revisions_asset_id_idx ON asset_revisions(asset_id);
    CREATE INDEX asset_revisions_sha256_idx ON asset_revisions(sha256) WHERE sha256 IS NOT NULL;
  `);
}

function migrationTwo(database) {
  database.exec(`
    CREATE TABLE asset_locations (
      location_id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      root_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('present', 'missing', 'removed')),
      first_observed_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL,
      missing_at TEXT,
      FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE RESTRICT,
      FOREIGN KEY (asset_id, revision_id) REFERENCES asset_revisions(asset_id, revision_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX asset_locations_asset_id_idx ON asset_locations(asset_id);
    CREATE INDEX asset_locations_revision_id_idx ON asset_locations(revision_id);
    CREATE UNIQUE INDEX asset_locations_present_path_idx
      ON asset_locations(root_id, relative_path) WHERE state = 'present';
  `);
}

const MIGRATIONS = new Map([[1, migrationOne], [2, migrationTwo]]);

function serializeAsset(row) {
  return row ? {
    assetId: row.asset_id,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null;
}

function serializeRevision(row) {
  return row ? {
    revisionId: row.revision_id,
    assetId: row.asset_id,
    sha256: row.sha256,
    hashState: row.hash_state,
    byteSize: Number(row.byte_size),
    mimeType: row.mime_type,
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    contentModifiedMs: row.content_modified_ms === null ? null : Number(row.content_modified_ms),
    observedAt: row.observed_at,
    createdAt: row.created_at,
  } : null;
}

function serializeLocation(row) {
  return row ? {
    locationId: row.location_id,
    assetId: row.asset_id,
    revisionId: row.revision_id,
    rootId: row.root_id,
    relativePath: row.relative_path,
    state: row.state,
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    missingAt: row.missing_at,
  } : null;
}

function runTransaction(database, operation) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* preserve the original failure */ }
    throw error;
  }
}

export class AssetProvenanceRepository {
  constructor({
    databasePath,
    readOnly = false,
    busyTimeoutMs = 1_000,
    randomUUID = () => crypto.randomUUID(),
    now = () => new Date(),
    backupDatabase = (database, destination) => database.prepare('VACUUM INTO ?').run(destination),
  }) {
    this.databasePath = databasePath;
    this.readOnly = readOnly;
    this.busyTimeoutMs = busyTimeoutMs;
    this.randomUUID = randomUUID;
    this.now = now;
    this.backupDatabase = backupDatabase;
    this.database = null;
  }

  open({ failMigrationVersion = null, targetSchemaVersion = PROVENANCE_SCHEMA_VERSION } = {}) {
    if (this.database) return this.getStatus();
    if (this.readOnly && !fs.existsSync(this.databasePath)) {
      throw new ProvenanceRepositoryError('PROVENANCE_CATALOG_NOT_FOUND', `Provenance catalog does not exist at ${this.databasePath}.`);
    }
    try {
      if (!this.readOnly) fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
      this.database = new DatabaseSync(this.databasePath, { readOnly: this.readOnly });
      this.database.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(this.busyTimeoutMs))}`);
      this.database.exec('PRAGMA foreign_keys = ON');
      if (this.readOnly) {
        const version = readSchemaVersion(this.database);
        if (version !== PROVENANCE_SCHEMA_VERSION) {
          throw new ProvenanceRepositoryError(
            'PROVENANCE_SCHEMA_INCOMPATIBLE',
            `Provenance catalog schema ${version} is incompatible with expected schema ${PROVENANCE_SCHEMA_VERSION}.`,
          );
        }
      } else {
        const journalMode = this.database.prepare('PRAGMA journal_mode = WAL').get().journal_mode;
        if (String(journalMode).toLowerCase() !== 'wal') {
          throw new ProvenanceRepositoryError('PROVENANCE_WAL_UNAVAILABLE', `SQLite selected journal mode ${journalMode} instead of WAL.`);
        }
        this.database.exec('PRAGMA synchronous = NORMAL');
        this.applyMigrations({ failMigrationVersion, targetSchemaVersion });
      }
      return this.getStatus();
    } catch (error) {
      this.close();
      if (error instanceof ProvenanceRepositoryError) throw error;
      throw new ProvenanceRepositoryError('PROVENANCE_OPEN_FAILED', `Could not open provenance catalog at ${this.databasePath}.`, error);
    }
  }

  applyMigrations({ failMigrationVersion = null, targetSchemaVersion = PROVENANCE_SCHEMA_VERSION } = {}) {
    this.#requireWritable();
    let currentVersion = readSchemaVersion(this.database);
    if (!Number.isInteger(targetSchemaVersion) || targetSchemaVersion < 0 || targetSchemaVersion > PROVENANCE_SCHEMA_VERSION) {
      throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', `Unsupported target schema version ${targetSchemaVersion}.`);
    }
    if (currentVersion > targetSchemaVersion) {
      throw new ProvenanceRepositoryError(
        'PROVENANCE_SCHEMA_INCOMPATIBLE',
        `Provenance catalog schema ${currentVersion} is newer than supported schema ${targetSchemaVersion}.`,
      );
    }
    while (currentVersion < targetSchemaVersion) {
      const nextVersion = currentVersion + 1;
      const migration = MIGRATIONS.get(nextVersion);
      if (!migration) throw new ProvenanceRepositoryError('PROVENANCE_MIGRATION_MISSING', `Migration ${nextVersion} is not defined.`);
      try {
        runTransaction(this.database, () => {
          migration(this.database);
          if (failMigrationVersion === nextVersion) throw new Error(`Injected migration ${nextVersion} failure.`);
          const appliedAt = this.now().toISOString();
          this.database.prepare('INSERT INTO provenance_schema_migrations (version, applied_at) VALUES (?, ?)').run(nextVersion, appliedAt);
          this.database.exec(`PRAGMA user_version = ${nextVersion}`);
        });
      } catch (error) {
        throw new ProvenanceRepositoryError('PROVENANCE_MIGRATION_FAILED', `Migration to schema ${nextVersion} failed.`, error);
      }
      currentVersion = nextVersion;
    }
    return currentVersion;
  }

  getStatus() {
    const open = Boolean(this.database);
    return {
      state: open ? (this.readOnly ? 'ready-read-only' : 'ready') : 'closed',
      available: open,
      readOnly: this.readOnly,
      databasePath: this.databasePath,
      schemaVersion: open ? readSchemaVersion(this.database) : null,
    };
  }

  createAssetWithRevisionAndLocation(input) {
    this.#requireWritable();
    const assetId = assertUuid(input.assetId || this.randomUUID(), 'assetId');
    const revisionId = assertUuid(input.revisionId || this.randomUUID(), 'revisionId');
    const locationId = assertUuid(input.locationId || this.randomUUID(), 'locationId');
    const rootId = assertNonBlank(input.rootId, 'rootId');
    const relativePath = assertNonBlank(input.relativePath, 'relativePath');
    const hashState = input.hashState || (input.sha256 ? 'available' : 'pending');
    const sha256 = normalizeHash(input.sha256, hashState);
    const byteSize = Number(input.byteSize);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', 'byteSize must be a non-negative safe integer.');
    }
    const timestamp = this.now().toISOString();
    runTransaction(this.database, () => {
      this.database.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(assetId, 'active', timestamp, timestamp);
      this.#insertRevision({ ...input, assetId, revisionId, sha256, hashState, byteSize, timestamp });
      this.database.prepare(`
        INSERT INTO asset_locations (
          location_id, asset_id, revision_id, root_id, relative_path, state,
          first_observed_at, last_observed_at, missing_at
        ) VALUES (?, ?, ?, ?, ?, 'present', ?, ?, NULL)
      `).run(locationId, assetId, revisionId, rootId, relativePath, timestamp, timestamp);
    });
    return this.getAsset(assetId);
  }

  addRevision(assetId, input) {
    this.#requireWritable();
    const existingAsset = this.#requireAsset(assetId);
    if (existingAsset.state === 'deleted') {
      throw new ProvenanceRepositoryError('PROVENANCE_ASSET_DELETED', `Asset ${assetId} is deleted.`);
    }
    const revisionId = assertUuid(input.revisionId || this.randomUUID(), 'revisionId');
    const hashState = input.hashState || (input.sha256 ? 'available' : 'pending');
    const sha256 = normalizeHash(input.sha256, hashState);
    const byteSize = Number(input.byteSize);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', 'byteSize must be a non-negative safe integer.');
    }
    const timestamp = this.now().toISOString();
    runTransaction(this.database, () => {
      this.#insertRevision({ ...input, assetId, revisionId, sha256, hashState, byteSize, timestamp });
      if (input.locationId) {
        const result = this.database.prepare(`
          UPDATE asset_locations
          SET revision_id = ?, state = 'present', last_observed_at = ?, missing_at = NULL
          WHERE location_id = ? AND asset_id = ? AND state != 'removed'
        `).run(revisionId, timestamp, input.locationId, assetId);
        if (Number(result.changes) !== 1) {
          throw new ProvenanceRepositoryError('PROVENANCE_LOCATION_NOT_FOUND', `Active location ${input.locationId} was not found for asset ${assetId}.`);
        }
      }
      this.database.prepare(`UPDATE assets SET state = CASE WHEN ? THEN 'active' ELSE state END, updated_at = ? WHERE asset_id = ?`)
        .run(input.locationId ? 1 : 0, timestamp, assetId);
    });
    return serializeRevision(this.database.prepare('SELECT * FROM asset_revisions WHERE revision_id = ?').get(revisionId));
  }

  completeRevisionHash(revisionId, { sha256, state = 'available' }) {
    this.#requireWritable();
    const normalizedHash = normalizeHash(sha256, state);
    const revision = this.database.prepare('SELECT * FROM asset_revisions WHERE revision_id = ?').get(revisionId);
    if (!revision) throw new ProvenanceRepositoryError('PROVENANCE_REVISION_NOT_FOUND', `Revision ${revisionId} was not found.`);
    if (revision.hash_state === 'available' && revision.sha256 !== normalizedHash) {
      throw new ProvenanceRepositoryError('PROVENANCE_REVISION_IMMUTABLE', `Revision ${revisionId} already has a different SHA-256 value.`);
    }
    this.database.prepare('UPDATE asset_revisions SET sha256 = ?, hash_state = ? WHERE revision_id = ?').run(normalizedHash, state, revisionId);
    return serializeRevision(this.database.prepare('SELECT * FROM asset_revisions WHERE revision_id = ?').get(revisionId));
  }

  relocateLocation(locationId, { rootId, relativePath }) {
    this.#requireWritable();
    const timestamp = this.now().toISOString();
    return runTransaction(this.database, () => {
      const result = this.database.prepare(`
        UPDATE asset_locations
        SET root_id = ?, relative_path = ?, state = 'present', last_observed_at = ?, missing_at = NULL
        WHERE location_id = ? AND state != 'removed'
      `).run(assertNonBlank(rootId, 'rootId'), assertNonBlank(relativePath, 'relativePath'), timestamp, locationId);
      if (Number(result.changes) !== 1) throw new ProvenanceRepositoryError('PROVENANCE_LOCATION_NOT_FOUND', `Active location ${locationId} was not found.`);
      const location = this.database.prepare('SELECT * FROM asset_locations WHERE location_id = ?').get(locationId);
      this.database.prepare(`UPDATE assets SET state = 'active', updated_at = ? WHERE asset_id = ?`).run(timestamp, location.asset_id);
      return serializeLocation(location);
    });
  }

  markLocationMissing(locationId) {
    this.#requireWritable();
    const timestamp = this.now().toISOString();
    return runTransaction(this.database, () => {
      const location = this.database.prepare('SELECT * FROM asset_locations WHERE location_id = ?').get(locationId);
      if (!location || location.state === 'removed') {
        throw new ProvenanceRepositoryError('PROVENANCE_LOCATION_NOT_FOUND', `Active location ${locationId} was not found.`);
      }
      this.database.prepare(`
        UPDATE asset_locations SET state = 'missing', last_observed_at = ?, missing_at = ? WHERE location_id = ?
      `).run(timestamp, timestamp, locationId);
      const presentCount = Number(this.database.prepare(`
        SELECT COUNT(*) AS count FROM asset_locations WHERE asset_id = ? AND state = 'present'
      `).get(location.asset_id).count);
      this.database.prepare(`UPDATE assets SET state = ?, updated_at = ? WHERE asset_id = ?`).run(presentCount ? 'active' : 'missing', timestamp, location.asset_id);
      return serializeLocation(this.database.prepare('SELECT * FROM asset_locations WHERE location_id = ?').get(locationId));
    });
  }

  markAssetDeleted(assetId) {
    this.#requireWritable();
    this.#requireAsset(assetId);
    const timestamp = this.now().toISOString();
    runTransaction(this.database, () => {
      this.database.prepare(`UPDATE assets SET state = 'deleted', updated_at = ? WHERE asset_id = ?`).run(timestamp, assetId);
      this.database.prepare(`
        UPDATE asset_locations SET state = 'removed', last_observed_at = ?, missing_at = COALESCE(missing_at, ?)
        WHERE asset_id = ?
      `).run(timestamp, timestamp, assetId);
    });
    return this.getAsset(assetId);
  }

  getAsset(assetId) {
    this.#requireOpen();
    const asset = serializeAsset(this.database.prepare('SELECT * FROM assets WHERE asset_id = ?').get(assetId));
    if (!asset) return null;
    return {
      ...asset,
      revisions: this.database.prepare('SELECT * FROM asset_revisions WHERE asset_id = ? ORDER BY created_at, revision_id').all(assetId).map(serializeRevision),
      locations: this.database.prepare('SELECT * FROM asset_locations WHERE asset_id = ? ORDER BY first_observed_at, location_id').all(assetId).map(serializeLocation),
    };
  }

  createBackup(destinationPath) {
    this.#requireWritable();
    const resolvedDestination = path.resolve(destinationPath);
    if (resolvedDestination === path.resolve(this.databasePath)) {
      throw new ProvenanceRepositoryError('PROVENANCE_BACKUP_INVALID_TARGET', 'Backup destination must differ from the live catalog.');
    }
    if (fs.existsSync(resolvedDestination)) {
      throw new ProvenanceRepositoryError('PROVENANCE_BACKUP_EXISTS', `Backup destination already exists at ${resolvedDestination}.`);
    }
    try {
      fs.mkdirSync(path.dirname(resolvedDestination), { recursive: true });
    } catch (error) {
      throw new ProvenanceRepositoryError('PROVENANCE_BACKUP_FAILED', `Could not prepare backup directory for ${resolvedDestination}.`, error);
    }
    const temporaryPath = `${resolvedDestination}.${this.randomUUID()}.tmp`;
    let backupCreated = false;
    try {
      this.backupDatabase(this.database, temporaryPath);
      const verification = new DatabaseSync(temporaryPath, { readOnly: true });
      try {
        const integrity = verification.prepare('PRAGMA integrity_check').get().integrity_check;
        const version = readSchemaVersion(verification);
        if (integrity !== 'ok' || version !== PROVENANCE_SCHEMA_VERSION) {
          throw new ProvenanceRepositoryError('PROVENANCE_BACKUP_INVALID', `Backup verification failed with integrity ${integrity} and schema ${version}.`);
        }
      } finally {
        verification.close();
      }
      fs.renameSync(temporaryPath, resolvedDestination);
      backupCreated = true;
    } catch (error) {
      if (error instanceof ProvenanceRepositoryError) throw error;
      throw new ProvenanceRepositoryError('PROVENANCE_BACKUP_FAILED', `Could not create provenance backup at ${resolvedDestination}.`, error);
    } finally {
      try { fs.unlinkSync(temporaryPath); } catch { /* best-effort cleanup of an incomplete snapshot */ }
    }
    return { path: resolvedDestination, schemaVersion: PROVENANCE_SCHEMA_VERSION, created: backupCreated };
  }

  close() {
    if (!this.database) return;
    try { this.database.close(); } finally { this.database = null; }
  }

  #insertRevision({ assetId, revisionId, sha256, hashState, byteSize, mimeType = null, width = null, height = null, contentModifiedMs = null, observedAt = null, timestamp }) {
    const normalizedContentModifiedMs = normalizeOptionalTimestamp(contentModifiedMs, 'contentModifiedMs');
    this.database.prepare(`
      INSERT INTO asset_revisions (
        revision_id, asset_id, sha256, hash_state, byte_size, mime_type,
        width, height, content_modified_ms, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revisionId, assetId, sha256, hashState, byteSize, mimeType,
      width, height, normalizedContentModifiedMs, observedAt || timestamp, timestamp,
    );
  }

  #requireAsset(assetId) {
    const asset = this.database.prepare('SELECT * FROM assets WHERE asset_id = ?').get(assetId);
    if (!asset) throw new ProvenanceRepositoryError('PROVENANCE_ASSET_NOT_FOUND', `Asset ${assetId} was not found.`);
    return asset;
  }

  #requireOpen() {
    if (!this.database) throw new ProvenanceRepositoryError('PROVENANCE_REPOSITORY_CLOSED', 'Provenance repository is closed.');
  }

  #requireWritable() {
    this.#requireOpen();
    if (this.readOnly) throw new ProvenanceRepositoryError('PROVENANCE_READ_ONLY', 'Provenance repository is read-only.');
  }

}

export class ProvenanceRepositoryLifecycle {
  constructor({ userDataPath, logger = console, repositoryOptions = {} }) {
    this.databasePath = resolveProvenanceCatalogPath(userDataPath);
    this.logger = logger;
    this.repositoryOptions = repositoryOptions;
    this.repository = null;
    this.status = {
      state: 'not-initialized',
      available: false,
      databasePath: this.databasePath,
      schemaVersion: null,
      error: null,
    };
  }

  initialize() {
    if (this.repository) return this.getStatus();
    try {
      const repository = new AssetProvenanceRepository({ databasePath: this.databasePath, ...this.repositoryOptions });
      const repositoryStatus = repository.open();
      this.repository = repository;
      this.status = { ...repositoryStatus, error: null };
    } catch (error) {
      this.repository = null;
      this.status = {
        state: 'unavailable',
        available: false,
        databasePath: this.databasePath,
        schemaVersion: null,
        error: { code: error?.code || 'PROVENANCE_INITIALIZATION_FAILED', message: error?.message || String(error) },
      };
      this.logger.error('Provenance catalog is unavailable; the library will continue without it.', error);
    }
    return this.getStatus();
  }

  run(operation) {
    if (!this.repository) {
      throw new ProvenanceRepositoryError('PROVENANCE_UNAVAILABLE', 'Provenance repository is unavailable.');
    }
    return operation(this.repository);
  }

  createBackup(destinationPath) {
    return this.run((repository) => repository.createBackup(destinationPath));
  }

  getStatus() {
    return JSON.parse(JSON.stringify(this.status));
  }

  close() {
    this.repository?.close();
    this.repository = null;
    this.status = { ...this.status, state: 'closed', available: false };
  }
}
