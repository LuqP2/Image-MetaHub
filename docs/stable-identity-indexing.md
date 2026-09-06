# Stable identity indexing and resumable backfill

## Status

The integration is intentionally disabled by default. It can be enabled for synthetic or controlled validation with `IMH_ENABLE_PROVENANCE_INDEXING=1`. It must not become a normal product default until rename, move, copy, and overwrite operations update the catalog atomically with their filesystem changes.

## Identity contract

- `IndexedImage.id` remains the existing directory-and-relative-path UI/cache key.
- `assetId`, `revisionId`, `provenanceLocationId`, and `provenanceRootId` are separate durable identifiers supplied by the provenance catalog.
- Library roots receive a stored UUID keyed by a normalized absolute path. Windows comparison keys are case-insensitive; stored paths retain their exact filesystem spelling.
- Relative paths use forward slashes, lexical dot-segment normalization, and a platform-aware comparison key. Unicode spelling is preserved so canonically distinct names remain distinct on case-sensitive filesystems. Absolute paths and paths escaping the root are rejected.
- A location reuses its asset and revision when byte size and content modification time are unchanged. A changed signature creates a revision on the same asset.
- Equal SHA-256 values never merge assets. Hashes describe revisions; they do not define asset identity.
- Schema v2 was never connected to product indexing and therefore has no reliable mapping from its opaque root IDs to filesystem paths. Empty v2 catalogs migrate normally; a populated v2 catalog is preserved and rejected explicitly instead of guessing a mapping or duplicating assets.

## Runtime flow

Directory enumeration returns to the renderer before catalog work starts. The main process then assigns identities in bounded batches and emits mappings to the renderer. The renderer attaches those identifiers without changing `IndexedImage.id`, and new cache records can retain them as an optimization. SQLite remains authoritative after cache deletion.

SHA-256 work uses a streaming reader in a single background queue. Pending revisions are naturally resumable: a later scan reuses the pending revision and queues it again. The worker compares byte size and modification time before and after reading, and commits the digest only when both still match the revision. Pausing stops between batches/files; shutdown aborts the active stream without replacing existing catalog data.

## Absence safety

Identity assignment is allowed for complete or partial scans. Each root has a scan generation; starting a newer scan makes every older scan stale before it can assign another batch or reconcile. Missing-state reconciliation is allowed only for the current generation after a successful recursive scan of the entire registered root. A scoped refresh, flat scan, unreadable subdirectory, cancelled job, unavailable root, or superseded scan never turns unseen locations into missing assets.

Auto-watch discoveries and filesystem mutations are intentionally outside this disabled integration. They will use the same catalog-assignment boundary in the follow-up that connects rename, move, copy, overwrite, and live watcher events before the feature flag can become a product default.

## Validation boundary

Automated coverage uses synthetic files under temporary directories. It verifies stable IDs across restart and cache reset, distinct assets for identical bytes, hash retry after a stale read, pause/resume, path normalization, migration, and the complete-scan reconciliation gate. No personal library, media, metadata cache, prompt, or generation parameters are read.
