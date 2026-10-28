# Canvas implementation sequence

Canvas v1 is split into three dependent PRs. The complete user workflow ships after all three are integrated.

1. **Foundation (#607):** persistent document schema, pure layout/composition operations, desktop repository and IPC, import/export, reference-remap journal and cache-reset preservation.
2. **Editor (implemented):** React Flow v12, board sessions/store, history, autosave and safe application close, asset/text/frame nodes, connections, inspector shell and toolbar. `BoardWorkspace` receives explicit `editable`, asset resolution/open callbacks and panel slots; navigation and license wiring are supplied by PR 3.
3. **IMH integration (implemented):** asset browser/shared search, Add to Board, navigation, metadata/viewer/comparison, Pro/trial, keyboard scope, asset resolution and rename/move synchronization, packaged smoke and user documentation.

## Persistence contract

### Explorer document foundation (schema v2)

The shared document boundary reads schemas v1 and v2 and returns v2 in memory. Loading a v1 file preserves its revision and does not write it back; the next explicit save writes v2 using the existing expected-revision contract. File envelopes are exported as version 2, with both envelope versions accepted by the shared renderer/Electron parser.

Smart Frames persist their source expression, independent query criteria, group constraints and layout. Results and visibility settings are runtime concerns. Missing frame/collection sources remain reconnectable; cycles, incompatible existing frame targets, invalid layouts and excessive expression depth/size are rejected. Smart Frames are top-level objects and do not adopt manual cards as children.

`smartFrameOperations.ts` provides pure creation, query/layout changes, branching, detached duplication, intersection, directional difference, Snapshot conversion and reconnection. Detached duplicates inline frame dependencies while retaining live library/collection sources. Snapshot conversion retains ordering/layout and clears incorporated local predicates. Reference remaps traverse snapshots inside nested source expressions and the existing session/history remapping path.

This schema foundation does not introduce Smart Frame rendering or query execution in the editor; those are the following Explorer stages.

Canvas is an Electron-only workspace. `document.mjs` is the shared serialization boundary for the renderer and main process. It reconstructs a document using only supported persistent fields. Coordinates are absolute; React Flow state is an editor concern. Documents store asset references rather than media or metadata copies.

Desktop documents live in `<userData>/boards/<uuid>.json`. Writes are serialized and atomically replaced. An expected revision is required for save/delete; creation uses revision zero and the first committed document receives revision one. Revision conflicts preserve both the committed file and the caller's unsaved document.

`reference-remaps.json` is an append-ordered, idempotent operation journal, written atomically before a remap is acknowledged. Load and save apply the journal, including to stale snapshots. The editor integration must update in-memory history and await remap writes after successful file operations. An unreadable journal blocks resolution/writes instead of silently resetting references.

Each asset reference persists `appliedRemapIds`. Every observed operation, including a non-match, is recorded so load/save and undo cannot replay historical moves after filenames are reused. Newly captured references must be initialized with the current journal operation IDs; imported references retain their existing operation IDs.

The service requires the Electron bridge. Missing desktop APIs produce an explicit error; there is no browser storage implementation.

Boards are user documents. Desktop cache reset preserves their storage. `.imhboard.json` export contains a versioned document without media, transient URLs or history; import validates and creates an independent document.

## Follow-up obligations

PR 2 coordinates the Electron quit/close lifecycle, and an edit made during an in-flight save remains dirty until its own acknowledgement. A close handshake freezes document edits until the application closes or the user cancels. Errors retain the local document with retry/export and revision-conflict recovery. History is per session, groups gestures and text edits, and excludes viewport/name changes. Editor keyboard events isolate destructive commands; the hotkey manager leaves Space/modifiers available to React Flow while skipping library actions inside the editor.

PR 3 provides navigation and licensing, asset resolution/browser, viewer/comparison wiring and file-operation synchronization. The application restores the Canvas keyboard scope after an IMH modal closes. Fresh references capture the current persisted baseline before insertion; assets that leave the library during that operation must be selected again. Pending remaps are flushed before close, and newly adopted clean sessions are reconciled with observed operations.

## Acceptance

Run the focused board tests, existing search/filter/rename/menu tests, TypeScript, lint and production build. Build a desktop directory and run `node scripts/runPackagedCanvasSmoke.mjs <packaged executable>` against a synthetic profile. This smoke is functional, not visual acceptance.

Manual acceptance covers empty-library board creation; adding multiple assets from grid, table and the Canvas panel; resize/frame/connection gestures and undo; inline/detached viewer return; comparison; rename/move with open and closed boards; unavailable references and relink; import/export/restart; Pro expiry; macOS internal drag; and a 300-card board with mouse and touchpad.

### Explorer runtime and basic UI (stage 3, local implementation)

`boardQueryWorker.ts` evaluates the active board from one versioned dataset. `queryRuntime.ts` debounces edits, drops outdated replies, supports worker recreation and releases resources when the board closes. The worker retains only query cache entries used by the latest evaluation; dataset replacement invalidates that cache. Geometry, title, color and selection do not invalidate query definitions. Results live exclusively in `useBoardQueryStore`, outside persistence and history.

The Smart Frame tool creates a library query, a Live collection source or a Snapshot of selected library images. Its inspector edits independent criteria and supports explicit copying from the current library view. Scoped, workflow-node-filtered and visual-search views are currently captured as Snapshots. Preview is capped at 12 thumbnails; expanded browsing uses `react-window`. Viewer navigation follows the frame's ordered results, and thumbnails can be dragged out as free cards. Snapshot capture checks query and dataset freshness across the asynchronous reference-baseline operation.

Grouping constraints and layouts are persisted but their execution/rendering belongs to the grouping stage. Until that engine is integrated, queries containing group constraints report an explicit error. Spatial branching controls and dependency edges belong to stage 4.
