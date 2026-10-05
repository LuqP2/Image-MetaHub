# Stable identity for directory operations

## Supported product flow and authority

The folder tree currently exposes **Rename Folder** for a registered root or a discovered subfolder. It calls the existing authorized `rename-file` IPC; the product does not expose folder drag/move or directory merging. The stable-identity coordinator accepts both `rename` and `move` so an existing authorized caller can preserve the same contract, but this work adds no UI operation and no new filesystem permission.

When stable identity is enabled, SQLite remains authoritative for asset, revision, location, annotation, and shadow identity. `IndexedImage.id` and renderer folder paths remain projections. When the flag is off for a profile that has not crossed the stable authority boundary, the existing filesystem and renderer behavior remains unchanged and no directory migration starts.

## Operation matrix

| Operation/API | Existing source and consumers | Stable-identity behavior |
| --- | --- | --- |
| Root or subfolder rename | `DirectoryList.tsx` -> preload `renameFile` -> `rename-file` IPC -> `fs.rename` | The existing coordinator snapshots every current descendant location before the rename. Catalog completion remaps the snapshot atomically and broadcasts confirmed mappings. |
| Registered-root rename | Same flow, followed by renderer root/path/watcher rebinding | The existing `rootId` moves to the new absolute path. Any separately registered roots below it move by the same prefix in the same transaction; descendant relative paths do not change. |
| Subtree rename/move inside a root | Coordinator `rename`/`move` boundary | Location IDs, asset IDs, revision IDs, and asset-owned user data are retained; only the root/relative-path projection changes. |
| Subtree move to another registered root | Existing coordinator `move` contract; no new folder UI | Descendant locations change root and path atomically. Equal bytes never create or merge assets. |
| Move outside registered roots | Existing authorization rules | Descendant locations become `missing`; no root is registered and no hash starts. |
| Destination conflict / permission failure | Existing `rename-file` preflight and filesystem errors | A directory destination is rejected before the journal/filesystem mutation. An unapplied failure aborts the intent and leaves source locations current. No directory merge policy is introduced. |
| Watcher add/remove and scans | Existing watcher observers and indexer scan generations | Source and destination prefixes are locked. Older scans are invalidated; descendant watcher observations are deferred and discarded after the atomic catalog remap. A late observation from a retired source is ignored while that path is absent. |
| Pending SHA-256 | Existing single hash queue | Every queued or active task under the affected prefixes is version-invalidated. A result opened at the old path cannot commit; a later authorized scan at the new path resumes the pending revision. |
| Annotations and shadow metadata | Stable user-data repository/adapter keyed by `assetId` | No copy/delete is performed. The same assets continue to own the same records and tombstones. Legacy aliases remain bound to location/asset identity, not to a reused pathname. |

## Journal and recovery contract

Directory operations reuse `provenance_operations`; the schema remains version 5 because the journal payload is internal JSON and the existing operation kinds already include `rename` and `move`. An intent contains the source/destination directories, pre-operation filesystem evidence, all affected registered roots, and the exact descendant location snapshot. SQLite validates every recorded asset/location/revision/root/path relation again before completion.

Filesystem work never runs in a SQLite transaction. After the authorized filesystem call returns, catalog remapping and journal completion share one SQLite transaction. If the filesystem succeeded and catalog completion failed, `fs_applied` allows idempotent recovery. Recovery only inspects the recorded paths and completes the catalog; it never repeats a rename, copy, delete, or cross-volume cleanup.

For an `intended` journal entry, source-missing/destination-present recovery requires matching filesystem identity evidence. Both paths present, both absent, mismatched evidence, inaccessible paths, or a partially copied cross-volume directory remain `pending_recovery`. That state blocks descendant operations and ordinary assignment rather than claiming the move completed.

## Boundaries

Destinations outside registered roots remain outside the catalog. The coordinator does not register roots, initiate scans, or start hashes for them. Directory merge, new folder-move UI, lineage edges, audit history, C2PA, IPTC, MCP, parser changes, and redesign are not part of this work.

`IMH_ENABLE_PROVENANCE_INDEXING` remains off by default. Windows packaged validation uses only a generated temporary profile and synthetic folders/files. Visual validation remains manual; Linux and macOS remain separate activation gates until their packaged tests are executed.

## Validation executed on 2026-09-08

- Stable file-operation suite: 47 tests passed and one platform-specific test was skipped. The directory matrix covers nested trees, registered and nested roots, cross-root/out-of-scope moves, spaces/accents/`..archive`, destination conflict, permission failure, watcher/backfill interleavings, an in-flight hash, catalog failure after filesystem success, repeated recovery, partial copy-then-delete, user data, and flag-off behavior.
- Repository, indexer, and stable user-data suites: 26 tests passed when run as separate suites. A parallel aggregate run produced only known Windows five-second resource-contention timeouts; the same files passed separately.
- TypeScript, JavaScript syntax, focused ESLint, and the production renderer build passed. ESLint retained only non-blocking test-file `no-explicit-any` warnings.
- Windows unpacked and real portable packaged smokes passed using generated temporary paths with spaces and `ç`. Both preserved a directory descendant's asset/revision/location and annotation across reopen with an empty recovery queue.
- Packaged runtime: Electron 38.8.6, Node 22.22.0, SQLite 3.50.4.
- Visual validation was not automated. Linux and macOS were not executed.
