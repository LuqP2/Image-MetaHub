# Stable identity file operations and watcher integration

## Mutation inventory

| Operation | Renderer entry | Filesystem mutation | Provenance integration |
| --- | --- | --- | --- |
| File rename, including case-only | `services/imageRenameService.ts` -> `services/fileOperations.ts` | `rename-file` in `electron.mjs` -> `fs.rename` / model sidecar helper | Coordinated `rename`; retain the source asset, revision, and location ID. Directory renames explicitly bypass the file-only coordinator so a directory is never registered as a media asset; subtree identity migration remains a later activation gate. |
| Move between folders/roots/volumes | `services/fileTransferService.ts` | `transfer-indexed-images` -> `fs.rename`, or copy plus `fs.unlink` after `EXDEV` | Coordinated `move`; relocate only after the source disappeared and destination exists. A failed cross-volume delete remains pending with both files unassociated as a completed move. |
| Copy | `services/fileTransferService.ts` | `transfer-indexed-images` -> timestamp-preserving copy | Coordinated `copy`; reserve and create a distinct asset/revision/location. Existing destinations use overwrite semantics. |
| Editor Save As | `ImageModal.tsx`, `ImageEditorWorkspace.tsx` | `write-file` -> `fs.writeFile` | Coordinated `save_as`; create a distinct asset inside a registered root, or advance the existing destination asset when the OS-approved path already exists. |
| Editor overwrite | `ImageModal.tsx`, `ImageEditorWorkspace.tsx` | `write-file` -> `fs.writeFile` | Coordinated `overwrite`; reserve a revision before writing and advance the destination even when size and mtime are unchanged. |
| Folder export / metadata rewrite | `BatchExportModal.tsx` | `export-images-batch` -> `fs.writeFile` / model sidecar helper | Each output is coordinated as a copy/new asset when it lands in a registered root. ZIP output and shadow metadata are outside the media catalog. |
| 3D Save As/export | `Model3DViewer.tsx` | `write-model3d-export` -> model plus sidecar helper | Coordinate the primary model path; sidecar-only bytes do not create a primary-file revision. |
| Trash and confirmed permanent deletion | `services/fileOperations.ts` | `trash-file` -> `shell.trashItem`; fallback `confirm-permanent-delete` -> verified `fs.unlink` helpers | Record deletion only after the primary path is absent. A sidecar failure with confirmed primary deletion completes and unlocks the primary journal entry; in that case the separately authorized fallback handles only preserved associated files. Cancellation preserves those files. |
| External add/change | `services/fileWatcher.mjs` -> `new-images-detected` | Chokidar observation; renderer continues its current indexing path | Feed the same observed-file assignment used by scans. Repeated signatures reuse the revision. Sidecar-triggered refreshes do not force a byte revision. |
| External removal | `services/fileWatcher.mjs` -> `watched-files-removed` | Chokidar observation | Confirm absence and invalidate the affected scan generation before marking locations missing, never explicitly deleted. An empty `unlinkDir` relative path means the watched root and covers every present location under it. |

`write-file` is intentionally contextual: non-library writes keep their existing behavior, while editor callers identify Save As versus overwrite. Destinations outside registered roots never register a root, start hashing, or receive a catalog location. A known move out of all roots marks the prior location missing; a copy out of scope leaves the source identity unchanged.

## Coordination and recovery contract

The Electron main process owns `StableIdentityFileOperationCoordinator`. It orders locks by normalized absolute path, invalidates older scan/hash observations before filesystem mutation, and defers watcher observations for locked or recovery-blocked paths. SQLite transactions cover only intent creation or catalog completion; filesystem work never runs inside a database transaction.

Schema v4 adds the internal `provenance_operations` recovery journal. An intent stores the operation kind, involved catalog identities, normalized paths, pre-operation signatures, expected output evidence when available, and reserved UUIDs. After filesystem completion the coordinator records `fs_applied`, commits catalog changes and marks the journal row complete in one transaction. Replaying a completed or pending operation is idempotent because the reserved IDs are stable.

Recovery only examines the recorded paths. It never repeats copy, rename, or deletion. A source-missing/destination-present move with matching evidence, a deleted path whose journal reached `fs_applied`, or output matching a recorded digest can finish catalog reconciliation. Both paths present after a cross-volume move, both absent, a deletion without durable completion evidence, or mismatched output evidence remain pending and block ordinary assignment for those paths.

If intent persistence is unavailable, the existing authorized filesystem operation still runs and its result reports provenance as unavailable; no consistency guarantee is claimed. If filesystem work succeeds but catalog completion fails, the filesystem result remains successful, the journal stays pending, and common indexing cannot invent another identity at the involved paths.

## Activation boundary

`IMH_ENABLE_PROVENANCE_INDEXING` remains off by default. No annotation/shadow-metadata migration, provenance graph, product audit history, C2PA, IPTC, MCP, or UI redesign is introduced here. Visual acceptance remains manual. Linux and macOS packaged validation remain pending until executed on those platforms.

## Reproducible packaged smoke

Build an unpacked Windows application and the real portable launcher, then run both against generated temporary profiles and synthetic `.bin` files:

```powershell
npm run build
npx electron-builder --win --dir --publish=never
node scripts/runPackagedStableIdentityFileOperationsSmoke.mjs "dist-electron/win-unpacked/Image MetaHub.exe" installed
npx electron-builder --win portable --publish=never
node scripts/runPackagedStableIdentityFileOperationsSmoke.mjs "dist-electron/ImageMetaHub-Portable-0.19.2-x64.exe" portable
```

The opt-in packaged mode runs before license initialization or window creation and exits after writing its machine-readable result. The runner creates a temporary path containing spaces and `ç`, checks schema v4, rename/copy/overwrite identity contracts, an empty recovery queue, the installed-equivalent `--user-data-dir`, and the portable launcher's adjacent `ImageMetaHubData` location. It also verifies that portable catalog data is outside Electron's extraction/resources directory and removes the generated profile and synthetic files afterward.

## Verified evidence and pending gates

| Check | Result |
| --- | --- |
| Focused repository/indexer/watcher/file-operation suite | 40 tests passed on Windows. |
| Review regression subset | 29 tests passed on Windows, covering directory-rename bypass, pending-delete reuse, stale watcher removals, permanent-delete grants, and affected deletion flows. |
| Static checks | TypeScript and JavaScript syntax passed; focused ESLint completed with no errors. |
| Production renderer build | Passed. |
| Packaged installed-equivalent smoke | Passed inside ASAR with a temporary `--user-data-dir`. |
| Real portable launcher smoke | Passed from a temporary path with spaces and `ç`; catalog resolved to adjacent `ImageMetaHubData`, outside the extraction directory. |
| Packaged runtime versions | Electron 38.8.6, Node 22.22.0, SQLite 3.50.4. |
| Linux and macOS | Not executed; required gates before enabling the integration on those platforms. |
| Visual application acceptance | Not automated; remains a manual gate. |
