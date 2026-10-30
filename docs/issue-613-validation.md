# Issue #613 implementation and validation

Issue: https://github.com/LuqP2/Image-MetaHub/issues/613

## Deliveries

1. EXR toolbar placement and viewport-only navigation; Move/Copy destination state retained in renderer session memory across remounts.
2. One-level Prompt Library folders shared by prompts and blocks. SQLite schema 9, browser IndexedDB version 4, portable JSON schema 2 with schema 1 import compatibility. Folder IDs live in optional editor metadata; content deduplication excludes folder membership.
3. Shared comparison surface with a dedicated Electron window, cloneable bounded snapshots, applied-renderer readiness, fallback to inline, and commands routed to the main renderer. Browser comparison remains inline.
4. Existing 3D viewers in comparison panes, optional camera synchronization normalized to each model's bounding sphere, independent 2D zoom, and side-by-side-only modes for selections containing models.

## Automated evidence (Windows, 2026-10-30)

- Production build (`npm run build`) and TypeScript passed.
- 176 tests passed across 24 affected Vitest suites. Coverage includes legacy prompt migration, browser and Electron persistence, portable import/deduplication, folder UI, transfer state across remounts, EXR click/keyboard isolation, comparison host state transfer/fallback, IPC sender checks/lifecycle, camera normalization and 3D toggle behavior.
- Windows unpacked distribution built with electron-builder using the installed Electron runtime and `npmRebuild=false`.
- Run packaged comparison verification with `node scripts/runPackagedComparisonSmoke.mjs "<absolute path to Image MetaHub.exe>"`.
- The smoke uses a temporary portable profile, synthetic image/model files, hidden native windows, the packaged production renderer/preload/comparison IPC and WebGL loaders. Settings and synthetic-file URL handlers are provided by the harness; this does not exercise a real user library, licensing, or the standard main-window UI.
- Main-window comparison handoff and restoration of mode, zoom and metadata state are covered by `ComparisonHost.test.tsx`; the packaged smoke checks renderer startup, two images, four mixed panels, two STL viewers, the sync toggle, metadata mode, return events, and captures.

## Required macOS packaged acceptance

- Open EXRs in both inline and separate viewers. At narrow and short window sizes, select parts/channels/OCIO options, adjust exposure, and open EXR settings. Confirm the counter and general controls remain separate, and toolbar interactions never navigate files.
- Repeatedly move/copy files to nested destinations. Collapse Input, select an Output subfolder and scroll; reopen and confirm all three states remain. Remove a saved destination and confirm safe fallback after the fresh scan.
- Create an empty prompt folder, restart, assign prompts and blocks, rename it, export/import JSON, then delete it and confirm its items remain Unfiled.
- Detach a comparison, change zoom/mode/metadata, return, reopen, swap/remove items, and close the native window. Repeat with paths containing spaces and accents, and with two to four items.
- Compare supported 3D formats, including a model with local sidecar resources, at different scales. Toggle camera sync, orbit/pan/zoom and change projection. Confirm image zoom and material/light settings stay independent and resources release on close.

The original macOS report remains pending this platform-specific acceptance. No sequence playback or Cryptomatte object selection is included. Before estimating sequence work, clarify preview versus real-time playback, typical format/resolution, and intended FPS.
