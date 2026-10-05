# Stable identity user-data migration

## Authority and data ownership

`ImageAnnotations` (`isFavorite`, `tags`, `rating`, `addedAt`, and `updatedAt`) and `ShadowMetadata` overrides belong to the logical asset. `IndexedImage.id` remains the renderer/UI key; the persistence boundary resolves it to the catalog `assetId` and validates the supplied location and revision.

The browser and a desktop profile that has never opted into stable identity continue to use IndexedDB only. Enabling `IMH_ENABLE_PROVENANCE_INDEXING` explicitly activates SQLite user-data authority for that profile. Once activated, SQLite remains authoritative even if indexing is later disabled; this does not restart scans or hashing. If that catalog is unavailable, persistence reports an error instead of reading stale legacy values.

Legacy IndexedDB records are read without automatic database reset. Import is non-destructive and idempotent. The first activated-profile read stages every readable annotation, shadow, and migration outbox in bounded batches before recording the durable full-scan checkpoint. Each batch commits its payload and per-record pending/import state together; the profile checkpoint is written only after every batch is acknowledged. A record is bound only through a validated catalog location/asset/revision. Unmapped records remain pending in SQLite, and an old alias already bound to another asset is ambiguous rather than reassigned. Once the full scan is checkpointed, a missing SQLite row is authoritative absence and does not require IndexedDB to remain available.

Annotations and shadows use record versions plus per-field versions. Renderer writes are semantic patches with an expected version: non-overlapping stale patches may rebase, while a stale patch to a field changed since its base version returns a conflict. Whole-record removal is a tombstone. Legacy writes made before a mapping is available receive a durable main-process sequence before their IndexedDB transaction and are finalized only after `transaction.oncomplete`; a later SQLite mutation therefore cannot be overwritten by an older import. Source timestamps are preserved, with migration time stored separately.

Shadow metadata remains a set of local overrides, not byte history. Missing fields and explicit removals remain distinct, and valid `false`, zero, empty strings, and empty arrays are preserved. “Original” and “revert” continue to expose the current file metadata without the overlay.

## API migration matrix

| Flow/API | Previous source and consumers | Stable destination/behavior |
| --- | --- | --- |
| Load all / load one annotation | `loadAllAnnotations`, `getAnnotation`; image store, filters, counts | Adapter routes legacy profiles to IndexedDB; activated profiles hydrate validated assets from SQLite without double-counting aliases. |
| Save annotation / favorite / rating | `saveAnnotation`, `bulkSaveAnnotations`; image store and detached viewer commands | Semantic main-process patches keyed by `assetId`; field-version conflict detection and confirmed broadcasts. |
| Add/remove/bulk tags | Image-store annotation snapshots | Semantic tag patches; explicit removals suppress automatic re-import of the removed metadata tag. |
| Automatic metadata-tag import | `importMetadataTags` union into IndexedDB | Idempotent import patch respecting suppression and SQLite authority. |
| Global rename/clear/purge and counts | Iterate renderer annotation map plus manual-tag store | SQLite mutates current and historical asset annotations transactionally, while counts include only present assets; the manual-tag catalog and smart-collection rules remain IndexedDB entities. |
| Delete annotation | `deleteAnnotation`, `bulkDeleteAnnotations` | Durable asset tombstone; legacy source is retained. |
| Load/save/revert shadow | `useShadowMetadata`, metadata editors, preview and modal | Versioned SQLite override keyed by `assetId`; revert writes a tombstone so legacy data cannot return. |
| Batch shadow apply | Metadata editors | Bounded per-asset patches; partial success updates only confirmed items. |
| Batch export shadow read | `BatchExportModal` | Adapter reads the authoritative override for each validated image; effective/original composition is unchanged. |
| Rename/move | `transferImagePersistence` copied then deleted legacy IDs | Same asset row; only the UI projection changes. The durable record is never copied or deleted. |
| Transfer copy | Renderer callback before/after watcher | The existing filesystem journal captures one source snapshot and clones it once to the reserved destination asset. Retry never overwrites a later destination edit. |
| Save As / folder export | Existing write/export coordinators | Existing policy is preserved; no general annotation/shadow clone is introduced. |
| Overwrite | Existing write coordinator | Same asset, new byte revision, unchanged asset-owned user data. |

## Recovery and activation boundary

File-operation recovery reuses `provenance_operations`; no second filesystem coordinator is introduced. A transfer intent can bind pending legacy data before mutation and carries the source user-data snapshot needed to finish a copy after renderer exit. Missing library entries never delete durable rows, and a deleted asset retains its tombstoned or historical user data without exposing it to a new asset at the same path.

The feature flag remains off by default. Directory/subtree rename is implemented by the follow-up directory-operation contract; Linux/macOS packaged validation and public activation remain separate gates. This phase does not add provenance edges, audit history, generation runs, C2PA, IPTC, MCP, parser changes, or UI redesign.

## Acceptance evidence

All automated fixtures use generated temporary profiles, SQLite catalogs, IndexedDB stores, and synthetic files. No personal library, real cache, sidecar, or generation-parameter payload was opened.

| Acceptance area | Deterministic evidence |
| --- | --- |
| Valid, unmapped, and ambiguous legacy bindings | `stableIdentityUserData.test.ts`; `userDataPersistenceAdapter.test.ts` full-source staging and path-reuse cases. |
| Retry, lost acknowledgement, and two-window serialization | Repository idempotency, main-process sequencing, finalized-outbox retry, and stale-version tests in `stableIdentityUserData.test.ts`; all windows share this transactional main boundary. |
| Failure before commit, committed source without ACK, and restart | Fake IndexedDB transaction barriers in `legacyUserDataMigrationSource.test.ts`; journal recovery and reopen tests in `stableIdentityFileOperations.test.ts`. |
| Edits/removals during import and delayed retry | Reserved/finalized sequence interleavings, annotation/shadow tombstones, and suppressed metadata-tag cases in the repository and adapter suites. |
| Distinct-field concurrency and same-field conflict | `stableIdentityUserData.test.ts` rebases independent fields and returns `USER_DATA_CONFLICT` with the current record for overlapping stale patches. |
| Rename, move, copy, delete/path reuse, overwrite, and Save As | `stableIdentityFileOperations.test.ts`, `provenanceRepository.test.ts`, and packaged smoke. Copy recovery proves renderer loss does not repeat filesystem work or overwrite a later destination edit. |
| Partial batches and persistence failure | Store batch helpers apply only fulfilled records; a coordinator test proves a required unavailable user-data journal leaves the source filesystem unchanged. |
| Late mapping and rapid identity change | `useImageLoader` rehydrates on mapping broadcasts; store and shadow hooks key responses by UI id plus stable identity/revision and reject stale generations. |
| False, removed rating, zero, empty strings, and empty arrays | Repository, adapter, rating-storage, and editable-metadata tests cover these values without truthy fallback. |
| Filters, counts, global tags, automatic tag suppression, and batch export | Store filters/tags, tag suggestions, editable metadata, historical global-tag, and adapter-backed batch-export paths use one authoritative record per asset. |
| Reset, backup, reopen, and schema preservation | `provenanceRepository.test.ts` verifies new rows in checkpointed backup and across cache reset; packaged smoke reopens schema v5 and copied overlays. |
| Browser/new flag-off, migrated flag-off, and unavailable catalog | Authority and adapter tests verify explicit routing, no migration for a new profile, durable SQLite authority after opt-out, and errors instead of stale fallback. |

### Validation executed on 2026-09-08

- Focused persistence and consumer suites: 123 tests passed and one platform-specific test was skipped. A parallel aggregate run hit five 5-second Windows resource-contention timeouts; the same repository/file-operation files passed when rerun separately (54 passed, one platform skip), so no functional failure remained.
- TypeScript: `npx tsc --noEmit` passed.
- JavaScript syntax: `node --check` passed for the main entry, preload, repository, service, coordinator, smoke, and runner.
- Focused ESLint: completed with zero errors; warnings were reported only under the repository's non-blocking warning rules.
- Production renderer build: `npm run build` passed.
- Windows unpacked packaged smoke: passed inside ASAR with an isolated `--user-data-dir` and synthetic library.
- Windows portable launcher smoke: passed from a temporary path containing spaces and `ç`; durable data reopened from adjacent `ImageMetaHubData`.
- Packaged runtime: Electron 38.8.6, Node 22.22.0, SQLite 3.50.4.
- Visual acceptance was not automated. Linux and macOS were not executed.

## Roadmap state

The user-data migration and directory/subtree operation follow-up close the implementation portions of phase 2 **Stable asset identity foundation**. Public activation remains gated separately by platform validation and manual visual acceptance. Phase 3 remains lineage/provenance/audit. C2PA, IPTC, and MCP were not implemented here.
