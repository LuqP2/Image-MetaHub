import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function runTransaction(database, operation) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Preserve original error.
    }
    throw error;
  }
}

export class TeamWorkspaceRepository {
  constructor({ dbPath }) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.#initializeSchema();
  }

  #initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS team_workspaces (
        workspace_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS team_local_cursors (
        workspace_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        next_seq INTEGER NOT NULL DEFAULT 1,
        last_lamport_clock INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (workspace_id, device_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS team_applied_files (
        workspace_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, device_id, filename)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS team_ops (
        workspace_id TEXT NOT NULL,
        op_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        asset_key TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        content_hash TEXT,
        op_type TEXT NOT NULL,
        lamport_clock INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (workspace_id, op_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_team_ops_workspace_clock
        ON team_ops(workspace_id, lamport_clock, op_id);

      CREATE INDEX IF NOT EXISTS idx_team_ops_workspace_asset
        ON team_ops(workspace_id, asset_key);

      CREATE TABLE IF NOT EXISTS team_asset_identities (
        workspace_id TEXT NOT NULL,
        workspace_asset_key TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        content_hash TEXT,
        file_size INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, workspace_asset_key)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_team_asset_identities_path
        ON team_asset_identities(workspace_id, relative_path);
    `);
  }

  registerWorkspace({ workspaceId, rootPath, name, nowIso = new Date().toISOString() }) {
    const normalizedRoot = path.resolve(rootPath);
    this.db.prepare(`
      INSERT INTO team_workspaces (workspace_id, root_path, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        root_path = excluded.root_path,
        name = excluded.name,
        updated_at = excluded.updated_at
    `).run(workspaceId, normalizedRoot, name, nowIso, nowIso);
  }

  getWorkspaceById(workspaceId) {
    const row = this.db.prepare(`
      SELECT workspace_id AS workspaceId, root_path AS rootPath, name, created_at AS createdAt, updated_at AS updatedAt
      FROM team_workspaces
      WHERE workspace_id = ?
    `).get(workspaceId);
    return row ?? null;
  }

  getWorkspaceByRootPath(rootPath) {
    const normalizedRoot = path.resolve(rootPath);
    const row = this.db.prepare(`
      SELECT workspace_id AS workspaceId, root_path AS rootPath, name, created_at AS createdAt, updated_at AS updatedAt
      FROM team_workspaces
      WHERE root_path = ?
    `).get(normalizedRoot);
    return row ?? null;
  }

  listWorkspaces() {
    return this.db.prepare(`
      SELECT workspace_id AS workspaceId, root_path AS rootPath, name, created_at AS createdAt, updated_at AS updatedAt
      FROM team_workspaces
      ORDER BY updated_at DESC
    `).all();
  }

  getCursor(workspaceId, deviceId) {
    const row = this.db.prepare(`
      SELECT next_seq AS nextSeq, last_lamport_clock AS lastLamportClock
      FROM team_local_cursors
      WHERE workspace_id = ? AND device_id = ?
    `).get(workspaceId, deviceId);
    if (!row) {
      return { nextSeq: 1, lastLamportClock: 0 };
    }
    return {
      nextSeq: Number(row.nextSeq),
      lastLamportClock: Number(row.lastLamportClock),
    };
  }

  advanceCursor(workspaceId, deviceId, { nextSeq, lastLamportClock }) {
    this.db.prepare(`
      INSERT INTO team_local_cursors (workspace_id, device_id, next_seq, last_lamport_clock)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id, device_id) DO UPDATE SET
        next_seq = MAX(team_local_cursors.next_seq, excluded.next_seq),
        last_lamport_clock = MAX(team_local_cursors.last_lamport_clock, excluded.last_lamport_clock)
    `).run(workspaceId, deviceId, nextSeq, lastLamportClock);
  }

  hasAppliedFile(workspaceId, deviceId, filename) {
    const row = this.db.prepare(`
      SELECT 1 AS ok
      FROM team_applied_files
      WHERE workspace_id = ? AND device_id = ? AND filename = ?
    `).get(workspaceId, deviceId, filename);
    return Boolean(row);
  }

  applyBatchFile({ workspaceId, deviceId, filename, ops, localDeviceId, nowIso = new Date().toISOString() }) {
    return runTransaction(this.db, () => {
      const alreadyApplied = this.hasAppliedFile(workspaceId, deviceId, filename);
      if (alreadyApplied) {
        return { appliedOps: 0, alreadyApplied: true };
      }

      const insertOp = this.db.prepare(`
        INSERT OR IGNORE INTO team_ops (
          workspace_id, op_id, device_id, asset_key, relative_path,
          content_hash, op_type, lamport_clock, created_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let appliedOps = 0;
      let maxClock = 0;
      for (const op of ops) {
        if (!op || typeof op.opId !== 'string' || typeof op.type !== 'string') continue;
        const clock = Number.isFinite(Number(op.lamportClock)) ? Math.trunc(Number(op.lamportClock)) : 0;
        if (clock > maxClock) maxClock = clock;
        const result = insertOp.run(
          workspaceId,
          op.opId,
          String(op.deviceId || deviceId),
          String(op.assetKey || ''),
          String(op.relativePath || ''),
          typeof op.contentHash === 'string' ? op.contentHash : null,
          op.type,
          clock,
          String(op.createdAt || nowIso),
          JSON.stringify(op),
        );
        if (result.changes > 0) {
          appliedOps += 1;
        }
      }

      this.db.prepare(`
        INSERT OR IGNORE INTO team_applied_files (workspace_id, device_id, filename, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(workspaceId, deviceId, filename, nowIso);

      if (localDeviceId && maxClock > 0) {
        const current = this.getCursor(workspaceId, localDeviceId);
        if (maxClock > current.lastLamportClock) {
          this.advanceCursor(workspaceId, localDeviceId, {
            nextSeq: current.nextSeq,
            lastLamportClock: maxClock,
          });
        }
      }

      return { appliedOps, alreadyApplied: false };
    });
  }

  listOps(workspaceId) {
    const rows = this.db.prepare(`
      SELECT payload_json AS payloadJson
      FROM team_ops
      WHERE workspace_id = ?
      ORDER BY lamport_clock ASC, op_id ASC
    `).all(workspaceId);
    const ops = [];
    for (const row of rows) {
      try {
        ops.push(JSON.parse(row.payloadJson));
      } catch {
        // Ignore corrupted JSON rows defensively.
      }
    }
    return ops;
  }

  upsertAssetIdentities(workspaceId, identities, nowIso = new Date().toISOString()) {
    return runTransaction(this.db, () => {
      const stmt = this.db.prepare(`
        INSERT INTO team_asset_identities (
          workspace_id, workspace_asset_key, relative_path, content_hash, file_size, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, workspace_asset_key) DO UPDATE SET
          relative_path = excluded.relative_path,
          content_hash = COALESCE(excluded.content_hash, team_asset_identities.content_hash),
          file_size = COALESCE(excluded.file_size, team_asset_identities.file_size),
          updated_at = excluded.updated_at
      `);
      for (const item of identities) {
        stmt.run(
          workspaceId,
          item.workspaceAssetKey,
          item.relativePath,
          item.contentHash ?? null,
          typeof item.fileSize === 'number' && Number.isFinite(item.fileSize) ? Math.trunc(item.fileSize) : null,
          nowIso,
        );
      }
    });
  }

  listAssetIdentities(workspaceId) {
    return this.db.prepare(`
      SELECT
        workspace_asset_key AS workspaceAssetKey,
        relative_path AS relativePath,
        content_hash AS contentHash,
        file_size AS fileSize
      FROM team_asset_identities
      WHERE workspace_id = ?
    `).all(workspaceId);
  }

  getWorkspaceStats(workspaceId) {
    const filesRow = this.db.prepare(`
      SELECT COUNT(*) AS count FROM team_applied_files WHERE workspace_id = ?
    `).get(workspaceId);
    const opsRow = this.db.prepare(`
      SELECT COUNT(*) AS count FROM team_ops WHERE workspace_id = ?
    `).get(workspaceId);
    return {
      appliedFileCount: Number(filesRow?.count ?? 0),
      appliedOpCount: Number(opsRow?.count ?? 0),
    };
  }

  close() {
    this.db.close();
  }
}
