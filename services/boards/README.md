# Canvas implementation sequence

Canvas v1 is split into three dependent PRs. The complete user workflow ships after all three are integrated.

1. **Foundation (#607):** persistent document schema, pure layout/composition operations, desktop repository and IPC, import/export, reference-remap journal and cache-reset preservation.
2. **Editor (implemented):** React Flow v12, board sessions/store, history, autosave and safe application close, asset/text/frame nodes, connections, inspector shell and toolbar. `BoardWorkspace` receives explicit `editable`, asset resolution/open callbacks and panel slots; navigation and license wiring are supplied by PR 3.
3. **IMH integration:** asset browser/shared search, Add to Board, navigation, metadata/viewer/comparison, Pro/trial, keyboard scope, asset resolution and rename/move synchronization, packaged smoke and user documentation.

## Persistence contract

Canvas is an Electron-only workspace. `document.mjs` is the shared serialization boundary for the renderer and main process. It reconstructs a document using only supported persistent fields. Coordinates are absolute; React Flow state is an editor concern. Documents store asset references rather than media or metadata copies.

Desktop documents live in `<userData>/boards/<uuid>.json`. Writes are serialized and atomically replaced. An expected revision is required for save/delete; creation uses revision zero and the first committed document receives revision one. Revision conflicts preserve both the committed file and the caller's unsaved document.

`reference-remaps.json` is an append-ordered, idempotent operation journal, written atomically before a remap is acknowledged. Load and save apply the journal, including to stale snapshots. The editor integration must update in-memory history and await remap writes after successful file operations. An unreadable journal blocks resolution/writes instead of silently resetting references.

Each asset reference persists `appliedRemapIds`. Every observed operation, including a non-match, is recorded so load/save and undo cannot replay historical moves after filenames are reused. Newly captured references must be initialized with the current journal operation IDs; imported references retain their existing operation IDs.

The service requires the Electron bridge. Missing desktop APIs produce an explicit error; there is no browser storage implementation.

Boards are user documents. Desktop cache reset preserves their storage. `.imhboard.json` export contains a versioned document without media, transient URLs or history; import validates and creates an independent document.

## Follow-up obligations

PR 2 coordinates the Electron quit/close lifecycle, and an edit made during an in-flight save remains dirty until its own acknowledgement. A close handshake freezes document edits until the application closes or the user cancels. Errors retain the local document with retry/export and revision-conflict recovery. History is per session, groups gestures and text edits, and excludes viewport/name changes. Editor keyboard events isolate destructive commands; the hotkey manager leaves Space/modifiers available to React Flow while skipping library actions inside the editor.

PR 3 must add navigation and licensing, asset resolution/browser, viewer/comparison wiring and file-operation synchronization. It must also restore the correct keyboard scope when leaving an IMH modal and initialize newly captured asset references with the current remap baseline. Journal storage alone does not perform file-operation synchronization.
