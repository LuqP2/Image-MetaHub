# Canvas usability corrections — validation record

## Delivery order

1. Geometry and viewport: PR #618, merged into main.
2. Exploration and assisted filters: PR #619, based on main.
3. Identification and first use: branch `fix/canvas-first-use`, based on `fix/canvas-exploration` so the third PR contains only this delivery.

Schema v2, query identities, raw group constraints and import/export formats remain unchanged. The unrelated local change in `scripts/start-dev.js` is excluded.

## Automated verification

- Final Canvas regression on 2026-10-29: 176 tests passed across 44 files, covering documents, persistence, undo/redo, import/export, query lifecycle, geometry, filters and result layouts.
- First-use coverage checks source explanations, selection availability, initial focus, Tab containment, focus restoration, reference-library focus and query creation entry points.
- Presentation coverage checks distinct Python object representations sharing the same display label without merging groups or changing exported constraints, optional branch titles and preservation of existing titles.
- Preview coverage checks visibility-triggered document reads, manual reference resolution, release of thumbnail subscriptions offscreen, sensitive-file hiding, rename/move invalidation without board revision changes, reused old paths and stale in-flight reads. Previews subscribe to already-resolved thumbnails; they do not execute Smart Frame queries or generate preview files.
- Source-facet coverage checks counts before local predicates, visibility rules and reuse across layout changes.
- TypeScript, scoped ESLint and the production build were checked. Build warnings about browser data age, existing zlib externalization and chunk sizes remain informational.

## PR #620 review follow-up

Reference remaps now advance a session-only preview revision. Visible saved previews discard older revisions immediately and reload, while hidden cards remain unloaded. Preview cache keys include that revision; a read that began before a remap cannot populate the current cache. Loaded documents are reconciled with observed successful file moves before references are resolved, including while the remap journal write is pending or retrying. The board document revision and timestamp are not changed by this invalidation.

## Supplemental measurement

A synthetic fixture of 10,000 projected library items exercises one frame with 500 models, 200 LoRAs and ComfyUI generator labels. In the targeted run on 2026-10-29, medians of three samples were:

| Operation | Time |
| --- | ---: |
| Initial grid query plus source facets | 41.4 ms |
| Switch to groups with query/facet cache | 19.9 ms |
| Switch to sparse matrix with query/facet cache | 30.7 ms |

The runnable measurement is `__tests__/boardCanvasUsability.performance.test.ts`. Times depend on machine load. This measures evaluator/layout preparation, not Electron paint time, real embedded ComfyUI metadata parsing, or end-to-end interaction latency. Query lifecycle tests separately verify that geometry changes do not resubmit the dataset.

## Electron observations before computer-use interruption

Using the existing development instance, dark theme, captured window size 1386 × 893, with 4,664 indexed items:

- Adding a Smart Frame preserved the current zoom; explicit Fit selection reached 100%.
- Matrix used separate headers and cells and defaulted to Generator × Rating.
- A1111 × 5 stars opened a 25-image subset and returned to the overview.
- Board cards displayed existing reference previews and singular object counts.
- Empty-board Explore library opened the source dialog, with initial focus and a dynamic-source explanation.
- Creating from that entry point produced a visible Library / Dynamic frame at 100%, with the total of 4,664 images.

Computer use was stopped with physical Esc. Subsequent implementation and verification continue through source and test tools, leaving the desktop available to the user.

## Acceptance still pending

- Full flow at both 1920 × 1080 and 1366 × 768, in light and dark themes.
- Complete viewer navigation and return, empty-cell branching and scrolling checks in Electron; automated coverage does not substitute for these visual checks.
- End-to-end timing with a real library of at least 10,000 items containing ComfyUI metadata; renderer profiling during pan/zoom.
- Lineage and previously unverified external/source-specific flows. No functional Lineage changes are included.
- The deterministic 15,000-item / 10-Smart-Frame benchmark and packaged Electron/ASAR smoke remain the separate stage-6 work and are not marked complete here.


## Smart Guides and Snap to Grid — 2026-11-03

- Global preferences: Smart Guides on by default, Snap to Grid off. Shift inverts only Smart Guides during an eligible image-card drag; regular multi-selection modifiers are preserved.
- Snapping uses initial absolute card geometry and the free pointer displacement, independently of React Flow's proposed positions. Image-only selections move as a rigid block; mixed selections retain their previous movement.
- Image cards, frames and Smart Frames provide edge/center references within six screen pixels. Object alignment wins per axis; grid fallback rounds the selection's top-left corner to 24 px from the board origin.
- Focused regression: 62 tests across eight files passed, covering geometry, Shift, cancellation, board switching, frame-relative coordinates, history, controls and preference hydration. TypeScript passed; scoped lint has no errors and three existing settings-store warnings.
- `node scripts/runCanvasSnappingSmoke.mjs` builds an isolated fixture and exercises real React Flow mouse/key events in a hidden Electron window. It checks stationary Shift, continued free movement, multi-image and mixed selections, cards within frames, guide cleanup and one undo operation with redo. Screenshot and results are written beneath `build/canvas-smoke-local/snapping/`.
- Synthetic geometry-only measurement with 10,000 references took approximately 6–14 ms per movement across local runs. This excludes rendering and document-update costs.
