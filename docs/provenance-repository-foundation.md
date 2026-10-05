# Provenance repository foundation

## Purpose and ownership

The provenance catalog is durable application data stored at `<userData>/provenance/catalog.sqlite`. It is independent from parser and thumbnail caches. Clearing cache must preserve the entire top-level `provenance` directory.

The Electron main process owns the only writable `AssetProvenanceRepository`. It opens the database, enables foreign keys and WAL, applies migrations transactionally, coordinates backups, and closes the connection before application exit. No renderer IPC or library-indexing integration is part of this foundation.

`node:sqlite` stays private to `electron/provenanceRepository.mjs`. Callers receive plain serializable objects. A catalog open or migration failure is reported by `ProvenanceRepositoryLifecycle` as an unavailable status and does not reject application startup, delete the database, or recreate it.

## Identity contract

- An **asset** is a logical library item with a stable UUID. Its state is `active`, `missing`, or `deleted`.
- A **revision** is one observed byte version of an asset with its own UUID. Revisions are not merged when SHA-256 values match. A hash can be `pending`, `available`, or `failed`; once available, it cannot be replaced with a different hash.
- A **location** has its own UUID and points to the revision currently observed at an opaque root ID plus relative path. Its state is `present`, `missing`, or `removed`.
- A known rename or move updates the existing location and preserves its ID. An overwrite creates a revision and advances the location. Explicit deletion keeps the asset and revision records and marks locations removed.
- Copy and Save As will create a new asset when library integration is added. Their relationship belongs in the later provenance-edge schema.

Only present locations are unique by root and relative path. Missing or removed records keep history without preventing a newly observed asset from occupying the same path. The future indexer adapter owns root identity and relative-path normalization.

The repository supports creating an asset with its first revision and location, adding a revision, completing a hash, relocating or marking a location missing, marking an asset deleted, and loading the serialized aggregate. The indexing integration will call these operations in the next PR.

## Schema and migrations

Schema v1 introduces `assets`, `asset_revisions`, and the migration ledger. Schema v2 introduces `asset_locations` and lookup indexes. The hash index is deliberately non-unique because identical bytes do not prove logical identity.

Each migration runs in `BEGIN IMMEDIATE` and updates both the migration ledger and `PRAGMA user_version` in the same transaction. A failed migration rolls back without advancing the version. A database newer than the supported schema is left in place and reported as incompatible.

## Backup and recovery

`createBackup` runs through the writer-owned repository. It uses SQLite `VACUUM INTO` to create a consistent snapshot at a unique temporary destination, verifies schema and `PRAGMA integrity_check`, and atomically renames the verified copy. The destination must not already exist. This remains correct when a separate read-only connection holds an older WAL snapshot.

If snapshot creation or validation fails, the incomplete temporary file is discarded and the live writer remains open. The original database is never replaced. Directly copying an active database and its sidecars is not a supported backup procedure.

## Current boundary

This PR installs an empty durable catalog and its lifecycle. It does not read the image library, hash files, migrate annotations, create provenance edges or audit events, expose MCP/IPC, or change the Provenance Summary UI. Linux and macOS packaged validation remain adoption gates inherited from the feasibility spike.
