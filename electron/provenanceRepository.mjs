import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  PROVENANCE_DATABASE_NAME,
  PROVENANCE_DIRECTORY_NAME,
  resolveProvenanceCatalogPath,
} from './provenancePaths.mjs';
import { StableIdentityUserDataRepository } from './stableIdentityUserDataRepository.mjs';

export { PROVENANCE_DATABASE_NAME, PROVENANCE_DIRECTORY_NAME, resolveProvenanceCatalogPath };
export const PROVENANCE_SCHEMA_VERSION = 5;

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

function migrationThree(database) {
  const legacyLocationCount = Number(database.prepare('SELECT COUNT(*) AS count FROM asset_locations').get().count);
  if (legacyLocationCount > 0) {
    throw new ProvenanceRepositoryError(
      'PROVENANCE_LEGACY_LOCATIONS_UNMAPPABLE',
      'Schema-v2 locations cannot be associated with filesystem roots safely; the existing catalog was preserved.',
    );
  }
  database.exec(`
    CREATE TABLE library_roots (
      root_id TEXT PRIMARY KEY,
      absolute_path TEXT NOT NULL,
      path_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    ) STRICT;

    ALTER TABLE asset_locations ADD COLUMN relative_path_key TEXT;
    UPDATE asset_locations SET relative_path_key = relative_path;
    DROP INDEX asset_locations_present_path_idx;
    CREATE UNIQUE INDEX asset_locations_present_path_key_idx
      ON asset_locations(root_id, relative_path_key) WHERE state = 'present';
    CREATE INDEX asset_locations_root_path_key_idx
      ON asset_locations(root_id, relative_path_key);
  `);
}

function migrationFour(database) {
  database.exec(`
    CREATE TABLE provenance_operations (
      operation_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('rename', 'move', 'copy', 'save_as', 'overwrite', 'delete')),
      state TEXT NOT NULL CHECK (state IN ('intended', 'fs_applied', 'pending_recovery', 'completed', 'aborted')),
      payload_json TEXT NOT NULL,
      result_json TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    ) STRICT;

    CREATE INDEX provenance_operations_pending_idx
      ON provenance_operations(state, updated_at)
      WHERE state IN ('intended', 'fs_applied', 'pending_recovery');
  `);
}

function migrationFive(database) {
  database.exec(`
    CREATE TABLE user_data_profile_state (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      authority TEXT NOT NULL CHECK (authority IN ('legacy', 'sqlite')),
      activated_at TEXT,
      legacy_scan_complete INTEGER NOT NULL DEFAULT 0 CHECK (legacy_scan_complete IN (0, 1)),
      legacy_scan_completed_at TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;

    INSERT INTO user_data_profile_state (
      singleton_id, authority, activated_at, legacy_scan_complete, legacy_scan_completed_at, updated_at
    ) VALUES (1, 'legacy', NULL, 0, NULL, CURRENT_TIMESTAMP);

    CREATE TABLE user_data_sequence (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      next_value INTEGER NOT NULL CHECK (next_value >= 1)
    ) STRICT;

    INSERT INTO user_data_sequence (singleton_id, next_value) VALUES (1, 1);

    CREATE TABLE asset_user_data (
      asset_id TEXT NOT NULL,
      domain TEXT NOT NULL CHECK (domain IN ('annotation', 'shadow')),
      payload_json TEXT,
      tombstone INTEGER NOT NULL CHECK (tombstone IN (0, 1)),
      record_version INTEGER NOT NULL CHECK (record_version >= 1),
      field_versions_json TEXT NOT NULL,
      field_sequences_json TEXT NOT NULL,
      authority TEXT NOT NULL CHECK (authority IN ('legacy', 'sqlite')),
      legacy_source_version INTEGER NOT NULL DEFAULT -1,
      legacy_source_fingerprint TEXT,
      last_mutation_sequence INTEGER NOT NULL DEFAULT 0,
      migrated_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (asset_id, domain),
      FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE RESTRICT,
      CHECK ((tombstone = 1 AND payload_json IS NULL) OR (tombstone = 0 AND payload_json IS NOT NULL))
    ) STRICT;

    CREATE INDEX asset_user_data_domain_idx ON asset_user_data(domain, tombstone);

    CREATE TABLE legacy_user_data_aliases (
      domain TEXT NOT NULL CHECK (domain IN ('annotation', 'shadow')),
      legacy_image_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('bound', 'ambiguous')),
      first_bound_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (domain, legacy_image_id),
      FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE RESTRICT,
      FOREIGN KEY (location_id) REFERENCES asset_locations(location_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX legacy_user_data_alias_asset_idx
      ON legacy_user_data_aliases(asset_id, domain);

    CREATE TABLE legacy_user_data_pending (
      domain TEXT NOT NULL CHECK (domain IN ('annotation', 'shadow')),
      legacy_image_id TEXT NOT NULL,
      payload_json TEXT,
      tombstone INTEGER NOT NULL CHECK (tombstone IN (0, 1)),
      source_version INTEGER NOT NULL CHECK (source_version >= 0),
      source_fingerprint TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'ambiguous', 'imported')),
      updated_at TEXT NOT NULL,
      migrated_at TEXT,
      PRIMARY KEY (domain, legacy_image_id),
      CHECK ((tombstone = 1 AND payload_json IS NULL) OR (tombstone = 0 AND payload_json IS NOT NULL))
    ) STRICT;

    CREATE TABLE user_data_mutation_intents (
      mutation_id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL UNIQUE,
      domain TEXT NOT NULL CHECK (domain IN ('annotation', 'shadow')),
      legacy_image_id TEXT NOT NULL,
      patch_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('reserved', 'finalized', 'applied', 'ignored')),
      source_version INTEGER,
      source_fingerprint TEXT,
      result_payload_json TEXT,
      result_tombstone INTEGER CHECK (result_tombstone IS NULL OR result_tombstone IN (0, 1)),
      applied_asset_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (applied_asset_id) REFERENCES assets(asset_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX user_data_mutation_pending_idx
      ON user_data_mutation_intents(domain, legacy_image_id, sequence)
      WHERE state = 'finalized';
  `);
}

const MIGRATIONS = new Map([
  [1, migrationOne],
  [2, migrationTwo],
  [3, migrationThree],
  [4, migrationFour],
  [5, migrationFive],
]);

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
    relativePathKey: row.relative_path_key ?? row.relative_path,
    state: row.state,
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    missingAt: row.missing_at,
  } : null;
}

function serializeRoot(row) {
  return row ? {
    rootId: row.root_id,
    absolutePath: row.absolute_path,
    pathKey: row.path_key,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  } : null;
}

function parseStoredJson(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function escapeLikePattern(value) {
  return value.replace(/([\\%_])/g, '\\$1');
}

function serializeOperation(row) {
  return row ? {
    operationId: row.operation_id,
    kind: row.kind,
    state: row.state,
    payload: parseStoredJson(row.payload_json, {}),
    result: parseStoredJson(row.result_json),
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
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
    this.userData = null;
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
      if (readSchemaVersion(this.database) >= 5) {
        this.userData = new StableIdentityUserDataRepository({
          database: this.database,
          now: this.now,
        });
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
        const detail = error instanceof ProvenanceRepositoryError ? ` ${error.message}` : '';
        throw new ProvenanceRepositoryError(
          'PROVENANCE_MIGRATION_FAILED',
          `Migration to schema ${nextVersion} failed.${detail}`,
          error,
        );
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

  getUserDataAuthority() {
    this.#requireUserDataRepository();
    return this.userData.getAuthority();
  }

  activateUserDataAuthority() {
    this.#requireWritable();
    this.#requireUserDataRepository();
    return this.userData.activateAuthority();
  }

  completeLegacyUserDataScan() {
    this.#requireWritable();
    this.#requireUserDataRepository();
    return this.userData.completeLegacyScan();
  }

  syncLegacyUserDataBatch(entries) {
    this.#requireWritable();
    this.#requireUserDataRepository();
    return this.userData.syncLegacyBatch(entries);
  }

  mutateAssetUserData(input) {
    this.#requireWritable();
    this.#requireUserDataRepository();
    return this.userData.mutate(input);
  }

  reserveLegacyUserDataMutation(input) {
    this.#requireWritable();
    this.#requireUserDataRepository();
    return this.userData.reserveLegacyMutation(input);
  }

  finalizeLegacyUserDataMutation(input) {
    this.#requireWritable();
    this.#requireUserDataRepository();
    return this.userData.finalizeLegacyMutation(input);
  }

  mutateAnnotationTagGlobally(input) {
    this.#requireWritable();
    this.#requireUserDataRepository();
    return this.userData.mutateAnnotationTagGlobally(input);
  }

  getUserDataTagCounts() {
    this.#requireUserDataRepository();
    return this.userData.getTagCounts();
  }

  captureAssetUserDataSnapshot(assetId, copiedAt = this.now().getTime()) {
    this.#requireUserDataRepository();
    return this.userData.captureCopySnapshot(assetId, copiedAt);
  }

  createAssetWithRevisionAndLocation(input) {
    this.#requireWritable();
    const assetId = assertUuid(input.assetId || this.randomUUID(), 'assetId');
    const revisionId = assertUuid(input.revisionId || this.randomUUID(), 'revisionId');
    const locationId = assertUuid(input.locationId || this.randomUUID(), 'locationId');
    const rootId = assertNonBlank(input.rootId, 'rootId');
    const relativePath = assertNonBlank(input.relativePath, 'relativePath');
    const relativePathKey = assertNonBlank(input.relativePathKey || relativePath, 'relativePathKey');
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
          location_id, asset_id, revision_id, root_id, relative_path, relative_path_key, state,
          first_observed_at, last_observed_at, missing_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'present', ?, ?, NULL)
      `).run(locationId, assetId, revisionId, rootId, relativePath, relativePathKey, timestamp, timestamp);
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

  relocateLocation(locationId, { rootId, relativePath, relativePathKey = relativePath }) {
    this.#requireWritable();
    const timestamp = this.now().toISOString();
    return runTransaction(this.database, () => {
      const result = this.database.prepare(`
        UPDATE asset_locations
        SET root_id = ?, relative_path = ?, relative_path_key = ?, state = 'present', last_observed_at = ?, missing_at = NULL
        WHERE location_id = ? AND state != 'removed'
      `).run(
        assertNonBlank(rootId, 'rootId'),
        assertNonBlank(relativePath, 'relativePath'),
        assertNonBlank(relativePathKey, 'relativePathKey'),
        timestamp,
        locationId,
      );
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

  ensureLibraryRoot({ rootId = this.randomUUID(), absolutePath, pathKey }) {
    this.#requireWritable();
    const normalizedRootId = assertUuid(rootId, 'rootId');
    const storedPath = assertNonBlank(absolutePath, 'absolutePath');
    const normalizedPathKey = assertNonBlank(pathKey, 'pathKey');
    const timestamp = this.now().toISOString();
    return runTransaction(this.database, () => {
      const existing = this.database.prepare('SELECT * FROM library_roots WHERE path_key = ?').get(normalizedPathKey);
      if (existing) {
        this.database.prepare('UPDATE library_roots SET absolute_path = ?, last_seen_at = ? WHERE root_id = ?')
          .run(storedPath, timestamp, existing.root_id);
        return serializeRoot(this.database.prepare('SELECT * FROM library_roots WHERE root_id = ?').get(existing.root_id));
      }

      this.database.prepare('INSERT INTO library_roots VALUES (?, ?, ?, ?, ?)')
        .run(normalizedRootId, storedPath, normalizedPathKey, timestamp, timestamp);
      return serializeRoot(this.database.prepare('SELECT * FROM library_roots WHERE root_id = ?').get(normalizedRootId));
    });
  }

  markLocationMissingByRootPath(rootId, relativePathKey) {
    this.#requireWritable();
    const location = this.getLocationByRootPath(rootId, relativePathKey);
    if (!location) return null;
    return this.markLocationMissing(location.locationId);
  }

  listLibraryRoots() {
    this.#requireOpen();
    return this.database.prepare('SELECT * FROM library_roots ORDER BY length(absolute_path) DESC, path_key').all()
      .map(serializeRoot);
  }

  getLocationByRootPath(rootId, relativePathKey) {
    this.#requireOpen();
    const row = this.database.prepare(`
      SELECT * FROM asset_locations
      WHERE root_id = ? AND relative_path_key = ? AND state != 'removed'
      ORDER BY CASE state WHEN 'present' THEN 0 ELSE 1 END, last_observed_at DESC
      LIMIT 1
    `).get(assertUuid(rootId, 'rootId'), assertNonBlank(relativePathKey, 'relativePathKey'));
    return serializeLocation(row);
  }

  listPresentLocationsUnderPath(rootId, relativePathKey) {
    this.#requireOpen();
    const normalizedRootId = assertUuid(rootId, 'rootId');
    const normalizedPathKey = assertNonBlank(relativePathKey, 'relativePathKey');
    return this.database.prepare(`
      SELECT * FROM asset_locations
      WHERE root_id = ? AND state = 'present'
        AND (relative_path_key = ? OR relative_path_key LIKE ? ESCAPE '\\')
      ORDER BY relative_path_key
    `).all(normalizedRootId, normalizedPathKey, `${escapeLikePattern(normalizedPathKey)}/%`).map(serializeLocation);
  }

  listPresentLocations(rootId) {
    this.#requireOpen();
    return this.database.prepare(`
      SELECT * FROM asset_locations
      WHERE root_id = ? AND state = 'present'
      ORDER BY relative_path_key
    `).all(assertUuid(rootId, 'rootId')).map(serializeLocation);
  }

  createFileOperationIntent({ operationId = this.randomUUID(), kind, payload }) {
    this.#requireWritable();
    const normalizedOperationId = assertUuid(operationId, 'operationId');
    if (!['rename', 'move', 'copy', 'save_as', 'overwrite', 'delete'].includes(kind)) {
      throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', `Unsupported file operation kind: ${kind}.`);
    }
    let payloadJson;
    try { payloadJson = JSON.stringify(payload); } catch (error) {
      throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', 'File operation payload must be serializable.', error);
    }
    const timestamp = this.now().toISOString();
    this.database.prepare(`
      INSERT INTO provenance_operations (
        operation_id, kind, state, payload_json, result_json, last_error,
        created_at, updated_at, completed_at
      ) VALUES (?, ?, 'intended', ?, NULL, NULL, ?, ?, NULL)
    `).run(normalizedOperationId, kind, payloadJson, timestamp, timestamp);
    return this.getFileOperation(normalizedOperationId);
  }

  getFileOperation(operationId) {
    this.#requireOpen();
    return serializeOperation(this.database.prepare('SELECT * FROM provenance_operations WHERE operation_id = ?')
      .get(assertUuid(operationId, 'operationId')));
  }

  listPendingFileOperations() {
    this.#requireOpen();
    return this.database.prepare(`
      SELECT * FROM provenance_operations
      WHERE state IN ('intended', 'fs_applied', 'pending_recovery')
      ORDER BY created_at, operation_id
    `).all().map(serializeOperation);
  }

  markFileOperationFileSystemApplied(operationId) {
    return this.#setFileOperationState(operationId, 'fs_applied', null);
  }

  markFileOperationPending(operationId, error) {
    const existing = this.getFileOperation(operationId);
    return this.#setFileOperationState(
      operationId,
      existing?.state === 'fs_applied' ? 'fs_applied' : 'pending_recovery',
      error,
    );
  }

  abortFileOperation(operationId, error = null) {
    return this.#setFileOperationState(operationId, 'aborted', error);
  }

  completeFileOperation(operationId, { observation = null } = {}) {
    this.#requireWritable();
    const normalizedOperationId = assertUuid(operationId, 'operationId');
    const timestamp = this.now().toISOString();
    return runTransaction(this.database, () => {
      const operationRow = this.database.prepare('SELECT * FROM provenance_operations WHERE operation_id = ?')
        .get(normalizedOperationId);
      if (!operationRow) {
        throw new ProvenanceRepositoryError('PROVENANCE_OPERATION_NOT_FOUND', `File operation ${normalizedOperationId} was not found.`);
      }
      const operation = serializeOperation(operationRow);
      if (operation.state === 'completed') return operation;
      if (operation.state === 'aborted') {
        throw new ProvenanceRepositoryError('PROVENANCE_OPERATION_ABORTED', `File operation ${normalizedOperationId} was aborted.`);
      }

      const { source = null, destination = null, reserved = {}, directory = null } = operation.payload;
      let mapping = null;
      let mappings = null;
      if ((operation.kind === 'rename' || operation.kind === 'move') && directory) {
        mappings = this.#completeDirectoryRelocation(directory, timestamp);
      } else if (operation.kind === 'rename' || operation.kind === 'move') {
        if (!source?.locationId || !source?.assetId) {
          throw new ProvenanceRepositoryError('PROVENANCE_OPERATION_INVALID', 'A move or rename intent requires a known source location.');
        }
        if (destination?.rootId) {
          if (destination.existingLocationId && destination.existingLocationId !== source.locationId) {
            this.database.prepare(`
              UPDATE asset_locations
              SET state = 'removed', last_observed_at = ?, missing_at = COALESCE(missing_at, ?)
              WHERE location_id = ? AND state != 'removed'
            `).run(timestamp, timestamp, destination.existingLocationId);
            if (destination.existingAssetId) {
              const remainingDestinationLocations = Number(this.database.prepare(`
                SELECT COUNT(*) AS count FROM asset_locations WHERE asset_id = ? AND state = 'present'
              `).get(destination.existingAssetId).count);
              this.database.prepare('UPDATE assets SET state = ?, updated_at = ? WHERE asset_id = ?')
                .run(remainingDestinationLocations ? 'active' : 'deleted', timestamp, destination.existingAssetId);
            }
          }
          const moved = this.database.prepare(`
            UPDATE asset_locations
            SET root_id = ?, relative_path = ?, relative_path_key = ?, state = 'present',
                last_observed_at = ?, missing_at = NULL
            WHERE location_id = ? AND asset_id = ? AND state != 'removed'
          `).run(
            destination.rootId,
            destination.relativePath,
            destination.relativePathKey,
            timestamp,
            source.locationId,
            source.assetId,
          );
          if (Number(moved.changes) !== 1) {
            throw new ProvenanceRepositoryError('PROVENANCE_LOCATION_NOT_FOUND', `Source location ${source.locationId} was not available.`);
          }
          this.database.prepare("UPDATE assets SET state = 'active', updated_at = ? WHERE asset_id = ?")
            .run(timestamp, source.assetId);
          mapping = {
            rootId: destination.rootId,
            relativePath: destination.relativePath,
            relativePathKey: destination.relativePathKey,
            assetId: source.assetId,
            revisionId: source.revisionId,
            locationId: source.locationId,
          };
        } else {
          this.#markLocationMissingWithinTransaction(source.locationId, timestamp);
        }
      } else if (operation.kind === 'delete') {
        if (source?.assetId) {
          this.database.prepare("UPDATE assets SET state = 'deleted', updated_at = ? WHERE asset_id = ?")
            .run(timestamp, source.assetId);
          this.database.prepare(`
            UPDATE asset_locations
            SET state = 'removed', last_observed_at = ?, missing_at = COALESCE(missing_at, ?)
            WHERE asset_id = ?
          `).run(timestamp, timestamp, source.assetId);
        }
      } else if (destination?.rootId) {
        if (!observation || !Number.isSafeInteger(Number(observation.byteSize))) {
          throw new ProvenanceRepositoryError('PROVENANCE_OPERATION_INVALID', 'A completed write or copy requires a destination observation.');
        }
        const byteSize = Number(observation.byteSize);
        const contentModifiedMs = normalizeOptionalTimestamp(observation.contentModifiedMs, 'contentModifiedMs');
        const destinationAssetId = destination.existingAssetId || reserved.assetId;
        const destinationLocationId = destination.existingLocationId || reserved.locationId;
        const revisionId = reserved.revisionId;
        if (!destinationAssetId || !destinationLocationId || !revisionId) {
          throw new ProvenanceRepositoryError('PROVENANCE_OPERATION_INVALID', 'Reserved destination identities are missing.');
        }
        if (destination.existingAssetId) {
          this.#insertRevision({
            assetId: destinationAssetId,
            revisionId,
            sha256: null,
            hashState: 'pending',
            byteSize,
            mimeType: observation.mimeType ?? null,
            contentModifiedMs,
            timestamp,
          });
          this.database.prepare(`
            UPDATE asset_locations
            SET revision_id = ?, relative_path = ?, relative_path_key = ?, state = 'present',
                last_observed_at = ?, missing_at = NULL
            WHERE location_id = ? AND asset_id = ? AND state != 'removed'
          `).run(
            revisionId,
            destination.relativePath,
            destination.relativePathKey,
            timestamp,
            destinationLocationId,
            destinationAssetId,
          );
          this.database.prepare("UPDATE assets SET state = 'active', updated_at = ? WHERE asset_id = ?")
            .run(timestamp, destinationAssetId);
        } else {
          this.database.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)')
            .run(destinationAssetId, 'active', timestamp, timestamp);
          this.#insertRevision({
            assetId: destinationAssetId,
            revisionId,
            sha256: null,
            hashState: 'pending',
            byteSize,
            mimeType: observation.mimeType ?? null,
            contentModifiedMs,
            timestamp,
          });
          this.database.prepare(`
            INSERT INTO asset_locations (
              location_id, asset_id, revision_id, root_id, relative_path, relative_path_key, state,
              first_observed_at, last_observed_at, missing_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'present', ?, ?, NULL)
          `).run(
            destinationLocationId,
            destinationAssetId,
            revisionId,
            destination.rootId,
            destination.relativePath,
            destination.relativePathKey,
            timestamp,
            timestamp,
          );
        }
        mapping = {
          rootId: destination.rootId,
          relativePath: destination.relativePath,
          relativePathKey: destination.relativePathKey,
          assetId: destinationAssetId,
          revisionId,
          locationId: destinationLocationId,
        };
        if (operation.payload.userDataSnapshot) {
          this.#requireUserDataRepository();
          this.userData.applyCopySnapshot(operation.payload.userDataSnapshot, destinationAssetId);
        }
      }

      const result = {
        mapping,
        ...(mappings ? { mappings } : {}),
        destinationScope: directory
          ? (directory.destinationRootId || directory.mode === 'root' ? 'registered' : 'outside')
          : (destination?.rootId ? 'registered' : 'outside'),
      };
      this.database.prepare(`
        UPDATE provenance_operations
        SET state = 'completed', result_json = ?, last_error = NULL, updated_at = ?, completed_at = ?
        WHERE operation_id = ?
      `).run(JSON.stringify(result), timestamp, timestamp, normalizedOperationId);
      return serializeOperation(this.database.prepare('SELECT * FROM provenance_operations WHERE operation_id = ?')
        .get(normalizedOperationId));
    });
  }

  assignIndexedFile(input) {
    this.#requireWritable();
    const rootId = assertUuid(input.rootId, 'rootId');
    const relativePath = assertNonBlank(input.relativePath, 'relativePath');
    const relativePathKey = assertNonBlank(input.relativePathKey, 'relativePathKey');
    const byteSize = Number(input.byteSize);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw new ProvenanceRepositoryError('PROVENANCE_INVALID_INPUT', 'byteSize must be a non-negative safe integer.');
    }
    const contentModifiedMs = normalizeOptionalTimestamp(input.contentModifiedMs, 'contentModifiedMs');
    const timestamp = this.now().toISOString();

    return runTransaction(this.database, () => {
      const root = this.database.prepare('SELECT root_id FROM library_roots WHERE root_id = ?').get(rootId);
      if (!root) throw new ProvenanceRepositoryError('PROVENANCE_ROOT_NOT_FOUND', `Library root ${rootId} was not found.`);

      const location = this.database.prepare(`
        SELECT * FROM asset_locations
        WHERE root_id = ? AND relative_path_key = ? AND state != 'removed'
        ORDER BY CASE state WHEN 'present' THEN 0 ELSE 1 END, last_observed_at DESC
        LIMIT 1
      `).get(rootId, relativePathKey);

      if (!location) {
        const assetId = assertUuid(this.randomUUID(), 'assetId');
        const revisionId = assertUuid(this.randomUUID(), 'revisionId');
        const locationId = assertUuid(this.randomUUID(), 'locationId');
        this.database.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(assetId, 'active', timestamp, timestamp);
        this.#insertRevision({
          assetId,
          revisionId,
          sha256: null,
          hashState: 'pending',
          byteSize,
          mimeType: input.mimeType ?? null,
          contentModifiedMs,
          timestamp,
        });
        this.database.prepare(`
          INSERT INTO asset_locations (
            location_id, asset_id, revision_id, root_id, relative_path, relative_path_key, state,
            first_observed_at, last_observed_at, missing_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'present', ?, ?, NULL)
        `).run(locationId, assetId, revisionId, rootId, relativePath, relativePathKey, timestamp, timestamp);
        return {
          assetId,
          revisionId,
          locationId,
          needsHash: true,
        };
      }

      const revision = this.database.prepare('SELECT * FROM asset_revisions WHERE revision_id = ?').get(location.revision_id);
      const unchanged = revision
        && Number(revision.byte_size) === byteSize
        && (revision.content_modified_ms === null ? null : Number(revision.content_modified_ms)) === contentModifiedMs;

      if (unchanged) {
        this.database.prepare(`
          UPDATE asset_locations
          SET relative_path = ?, state = 'present', last_observed_at = ?, missing_at = NULL
          WHERE location_id = ?
        `).run(relativePath, timestamp, location.location_id);
        this.database.prepare("UPDATE assets SET state = 'active', updated_at = ? WHERE asset_id = ?")
          .run(timestamp, location.asset_id);
        return {
          assetId: location.asset_id,
          revisionId: location.revision_id,
          locationId: location.location_id,
          needsHash: revision.hash_state !== 'available',
        };
      }

      const revisionId = assertUuid(this.randomUUID(), 'revisionId');
      this.#insertRevision({
        assetId: location.asset_id,
        revisionId,
        sha256: null,
        hashState: 'pending',
        byteSize,
        mimeType: input.mimeType ?? null,
        contentModifiedMs,
        timestamp,
      });
      this.database.prepare(`
        UPDATE asset_locations
        SET revision_id = ?, relative_path = ?, state = 'present', last_observed_at = ?, missing_at = NULL
        WHERE location_id = ?
      `).run(revisionId, relativePath, timestamp, location.location_id);
      this.database.prepare("UPDATE assets SET state = 'active', updated_at = ? WHERE asset_id = ?")
        .run(timestamp, location.asset_id);
      return {
        assetId: location.asset_id,
        revisionId,
        locationId: location.location_id,
        needsHash: true,
      };
    });
  }

  completeRevisionHashIfUnchanged(revisionId, { sha256, byteSize, contentModifiedMs }) {
    this.#requireWritable();
    const normalizedRevisionId = assertUuid(revisionId, 'revisionId');
    const normalizedHash = normalizeHash(sha256, 'available');
    const normalizedModifiedMs = normalizeOptionalTimestamp(contentModifiedMs, 'contentModifiedMs');
    const result = this.database.prepare(`
      UPDATE asset_revisions
      SET sha256 = ?, hash_state = 'available'
      WHERE revision_id = ? AND byte_size = ? AND content_modified_ms IS ? AND hash_state != 'available'
    `).run(normalizedHash, normalizedRevisionId, byteSize, normalizedModifiedMs);
    return Number(result.changes) === 1;
  }

  reconcileRootLocations(rootId, seenRelativePathKeys) {
    this.#requireWritable();
    const normalizedRootId = assertUuid(rootId, 'rootId');
    const seen = new Set(seenRelativePathKeys);
    const timestamp = this.now().toISOString();
    return runTransaction(this.database, () => {
      const presentLocations = this.database.prepare(`
        SELECT location_id, asset_id, relative_path_key FROM asset_locations
        WHERE root_id = ? AND state = 'present'
      `).all(normalizedRootId);
      const missingAssetIds = new Set();
      let missingCount = 0;
      for (const location of presentLocations) {
        if (seen.has(location.relative_path_key)) continue;
        this.database.prepare(`
          UPDATE asset_locations SET state = 'missing', last_observed_at = ?, missing_at = ? WHERE location_id = ?
        `).run(timestamp, timestamp, location.location_id);
        missingAssetIds.add(location.asset_id);
        missingCount += 1;
      }
      for (const assetId of missingAssetIds) {
        const presentCount = Number(this.database.prepare(`
          SELECT COUNT(*) AS count FROM asset_locations WHERE asset_id = ? AND state = 'present'
        `).get(assetId).count);
        if (presentCount === 0) {
          this.database.prepare("UPDATE assets SET state = 'missing', updated_at = ? WHERE asset_id = ?")
            .run(timestamp, assetId);
        }
      }
      return { missingCount };
    });
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
    try { this.database.close(); } finally {
      this.database = null;
      this.userData = null;
    }
  }

  #setFileOperationState(operationId, state, error) {
    this.#requireWritable();
    const normalizedOperationId = assertUuid(operationId, 'operationId');
    const timestamp = this.now().toISOString();
    const result = this.database.prepare(`
      UPDATE provenance_operations
      SET state = ?, last_error = ?, updated_at = ?, completed_at = CASE WHEN ? = 'aborted' THEN ? ELSE completed_at END
      WHERE operation_id = ? AND state != 'completed'
    `).run(state, error ? String(error?.message || error) : null, timestamp, state, timestamp, normalizedOperationId);
    if (Number(result.changes) !== 1) {
      const existing = this.getFileOperation(normalizedOperationId);
      if (existing?.state === 'completed') return existing;
      throw new ProvenanceRepositoryError('PROVENANCE_OPERATION_NOT_FOUND', `Pending file operation ${normalizedOperationId} was not found.`);
    }
    return this.getFileOperation(normalizedOperationId);
  }

  #markLocationMissingWithinTransaction(locationId, timestamp) {
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
    this.database.prepare('UPDATE assets SET state = ?, updated_at = ? WHERE asset_id = ?')
      .run(presentCount ? 'active' : 'missing', timestamp, location.asset_id);
  }

  #completeDirectoryRelocation(directory, timestamp) {
    if (!directory || !['root', 'subtree'].includes(directory.mode) || !Array.isArray(directory.entries)) {
      throw new ProvenanceRepositoryError('PROVENANCE_OPERATION_INVALID', 'Directory relocation payload is invalid.');
    }
    const entries = directory.entries;
    if (directory.mode === 'root') {
      const rootRelocations = Array.isArray(directory.rootRelocations) && directory.rootRelocations.length > 0
        ? directory.rootRelocations
        : [{
            rootId: directory.sourceRootId,
            destinationRootPath: directory.destinationRootPath,
            destinationRootPathKey: directory.destinationRootPathKey,
          }];
      const relocatingRootIds = new Set(rootRelocations.map((relocation) => assertUuid(relocation.rootId, 'directory rootId')));
      for (const relocation of rootRelocations) {
        const rootId = assertUuid(relocation.rootId, 'directory rootId');
        assertNonBlank(relocation.destinationRootPath, 'directory destinationRootPath');
        const destinationPathKey = assertNonBlank(relocation.destinationRootPathKey, 'directory destinationRootPathKey');
        const currentRoot = this.database.prepare('SELECT * FROM library_roots WHERE root_id = ?').get(rootId);
        if (!currentRoot) {
          throw new ProvenanceRepositoryError('PROVENANCE_ROOT_NOT_FOUND', `Library root ${rootId} was not found.`);
        }
        const conflictingRoot = this.database.prepare('SELECT root_id FROM library_roots WHERE path_key = ? AND root_id != ?')
          .get(destinationPathKey, rootId);
        if (conflictingRoot && !relocatingRootIds.has(conflictingRoot.root_id)) {
          throw new ProvenanceRepositoryError('PROVENANCE_PATH_CONFLICT', 'The destination is already registered as another library root.');
        }
      }
      for (const relocation of rootRelocations) {
        this.database.prepare('UPDATE library_roots SET path_key = ? WHERE root_id = ?')
          .run(`__relocating__:${relocation.rootId}`, relocation.rootId);
      }
      for (const relocation of rootRelocations) {
        this.database.prepare(`
          UPDATE library_roots SET absolute_path = ?, path_key = ?, last_seen_at = ? WHERE root_id = ?
        `).run(
          relocation.destinationRootPath,
          relocation.destinationRootPathKey,
          timestamp,
          relocation.rootId,
        );
      }
    }

    const destinationRootId = directory.mode === 'root'
      ? null
      : (directory.destinationRootId ? assertUuid(directory.destinationRootId, 'directory.destinationRootId') : null);
    const movedLocationIds = new Set(entries.map((entry) => assertUuid(entry.locationId, 'directory entry locationId')));

    if (destinationRootId && directory.mode === 'subtree') {
      for (const entry of entries) {
        const destinationPathKey = assertNonBlank(entry.destinationRelativePathKey, 'directory entry destinationRelativePathKey');
        const conflict = this.database.prepare(`
          SELECT location_id FROM asset_locations
          WHERE root_id = ? AND relative_path_key = ? AND state = 'present'
          LIMIT 1
        `).get(destinationRootId, destinationPathKey);
        if (conflict && !movedLocationIds.has(conflict.location_id)) {
          throw new ProvenanceRepositoryError('PROVENANCE_PATH_CONFLICT', `A catalog location already occupies ${entry.destinationRelativePath}.`);
        }
      }
    }

    const mappings = [];
    for (const entry of entries) {
      const locationId = assertUuid(entry.locationId, 'directory entry locationId');
      const assetId = assertUuid(entry.assetId, 'directory entry assetId');
      const revisionId = assertUuid(entry.revisionId, 'directory entry revisionId');
      const current = this.database.prepare(`
        SELECT * FROM asset_locations
        WHERE location_id = ? AND asset_id = ? AND revision_id = ?
          AND root_id = ? AND relative_path_key = ? AND state != 'removed'
      `).get(
        locationId,
        assetId,
        revisionId,
        assertUuid(entry.sourceRootId, 'directory entry sourceRootId'),
        assertNonBlank(entry.sourceRelativePathKey, 'directory entry sourceRelativePathKey'),
      );
      if (!current) {
        throw new ProvenanceRepositoryError('PROVENANCE_LOCATION_NOT_FOUND', `Directory descendant location ${locationId} is no longer current.`);
      }

      const entryDestinationRootId = directory.mode === 'root'
        ? assertUuid(entry.destinationRootId, 'directory entry destinationRootId')
        : destinationRootId;
      if (!entryDestinationRootId) {
        this.#markLocationMissingWithinTransaction(locationId, timestamp);
        continue;
      }

      const relativePath = directory.mode === 'root'
        ? current.relative_path
        : assertNonBlank(entry.destinationRelativePath, 'directory entry destinationRelativePath');
      const relativePathKey = directory.mode === 'root'
        ? current.relative_path_key
        : assertNonBlank(entry.destinationRelativePathKey, 'directory entry destinationRelativePathKey');
      this.database.prepare(`
        UPDATE asset_locations
        SET root_id = ?, relative_path = ?, relative_path_key = ?, state = 'present',
            last_observed_at = ?, missing_at = NULL
        WHERE location_id = ? AND asset_id = ? AND revision_id = ? AND state != 'removed'
      `).run(entryDestinationRootId, relativePath, relativePathKey, timestamp, locationId, assetId, revisionId);
      this.database.prepare("UPDATE assets SET state = 'active', updated_at = ? WHERE asset_id = ?")
        .run(timestamp, assetId);
      mappings.push({
        rootId: entryDestinationRootId,
        relativePath,
        relativePathKey,
        assetId,
        revisionId,
        locationId,
      });
    }
    return mappings;
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

  #requireUserDataRepository() {
    if (!this.userData) {
      throw new ProvenanceRepositoryError(
        'PROVENANCE_USER_DATA_UNAVAILABLE',
        'Stable-identity user-data storage is unavailable for this catalog schema.',
      );
    }
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
