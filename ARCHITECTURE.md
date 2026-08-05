# Architecture Documentation

## Overview

**Image MetaHub** is an Electron + React desktop application for browsing and organizing large local libraries of AI-generated images and videos. The application is local-first: indexing, metadata extraction, filtering, caching, tagging, lineage, and most generation workflows run on the user's machine.

### Current Stack

* **Version:** 0.18.1
* **Renderer:** React 18 + TypeScript
* **Desktop shell:** Electron 38
* **State management:** Zustand
* **Build/dev:** Vite 7, TypeScript 5, ESLint 9, Vitest 3
* **Styling:** Tailwind CSS 3

## Application Shape

The renderer is centered around `App.tsx`, which coordinates four primary
navigation contexts — **Library**, **Explore**, **Image Editor**, and
**ComfyUI** — plus:

* the main **Library** grid (grid/list)
* the **Explore** surface, which unifies model, cluster, and collection
  browsing behind one dimension picker (`components/ExploreWorkspace.tsx`)
* the **multi-window image viewer**
* the **comparison modal**
* the **analytics modal**
* the **embedded ComfyUI Workspace**
* generation modals and the shared generation queue sidebar

Drilling into a model/cluster/collection sets an **image scope** (a
`{ type, id, label }` descriptor in `useImageStore`) that filters the Library
grid and appears as a fixed chip in `components/ActiveFilters.tsx`; cumulative
filters continue to apply within the scope. "Classic mode" (a setting) restores
the old Model View / Smart Library / Collections / Node View labels as
deep-links into Explore — it changes navigation labels only, never surfaces.

The app is designed so the heavy work happens outside the tight render loop:

* indexing and metadata parsing are incremental
* clustering and auto-tagging run in workers
* thumbnails are cached and loaded separately from the main image list
* stores use granular selectors to reduce renderer churn

## Major Runtime Subsystems

### 1. Renderer Shell and UI Surfaces

**Core entry points**

* `App.tsx` orchestrates folders, library state, global modals, and top-level view switching.
* `components/Header.tsx` exposes the four-context navigation (plus optional Classic-mode deep-links), generation entry points, analytics access, and safe mode.
* `components/Sidebar.tsx` contains the sidebar experience, organized into **Navigate** (Folders, Collections, Clusters actions) and **Filter** categories:
  * search
  * active filter chips (including the scope chip)
  * tags, favorites, and auto-tags
  * faceted include/exclude sections for checkpoints, LoRAs, samplers, and schedulers, plus an include-only **ComfyUI Nodes** (OR) facet
  * advanced numeric/date filters
* Sort Order and Group By live in the grid **Footer** (`components/Footer.tsx`); Group By supports date/name/session and now **model**/**cluster** sectioning (which sections over the whole filtered set and suspends pagination).
* `components/DirectoryList.tsx` handles indexed folder navigation, subfolder visibility, exclusion, and auto-watch controls.

**Main browsing surfaces**

* `components/ImageGrid.tsx` and `components/ImageTable.tsx` render the main library in grid/list form.
* `components/ExploreWorkspace.tsx` is the unified browsing surface (Models | Clusters | Collections) built on the generic `components/ScopeCard.tsx` (which owns the shared hover-scrub via `hooks/useHoverScrub.ts`). Card clicks set the active scope and navigate to the Library.
* `components/ImageModal.tsx` is now a windowed viewer surface with move, resize, minimize/maximize, and dock/collapse behavior.
* `components/ImageAdjustmentPanel.tsx` provides metadata-preserving PNG adjustment/export controls for brightness, contrast, saturation, and hue.
* `components/ImagePreviewSidebar.tsx` shows metadata, telemetry, and generation actions in the side preview flow.
* `components/ImageLineageSection.tsx` resolves source and derived images for transformation workflows.

**Pro surfaces**

* `components/ComparisonModal.tsx` compares 2-4 images with side-by-side/compare, side strip, grid, slider, and hover modes depending on selection size.
* `components/Analytics.tsx` renders usage and telemetry dashboards.
* `components/A1111GenerateModal.tsx` and `components/ComfyUIGenerateModal.tsx` expose generation controls.
* `components/ComfyUIWorkspace.tsx` embeds a local ComfyUI browser in Electron and pairs it with library thumbnails, image context, workflow metadata, and quick generation actions.

### 2. State Stores

The app uses several focused Zustand stores rather than a single monolith.

**`store/useImageStore.ts`**

This is the core application store. It owns:

* indexed images and directory metadata
* filter state and filtered results
* selected images and navigation context
* thumbnail status
* stacking and Smart Library state
* comparison state
* annotations, favorites, tags, and shadow metadata
* directory progress, enrichment progress, and transfer progress
* clustering and auto-tagging worker state

It also contains the central filter pipeline, including:

* search terms
* include/exclude facets
* auto-tag filters
* favorite mode
* safe mode
* advanced filters such as dimensions, steps, CFG, dates, and verified telemetry

The pipeline has two paths:

* **Full recompute** (`filterAndSort`) runs the whole filter chain and re-sorts. Used for structural changes — setting or clearing images, replacing a directory, and any change to a filter or sort parameter.
* **Incremental** (`_updateStateIncremental`) handles add / remove / merge. It compiles the active filters into a single-image predicate, evaluates only the touched images, and inserts matches into the already-sorted list rather than re-sorting. Facet counts, collection counts and available-filter lists are reconciled on a debounced pass afterwards, capped so a sustained burst still gets periodic updates. That pass compares its result against a full recompute and falls back to it on any divergence.

Two consequences worth knowing before changing this area: `compileImageFilter` duplicates `filterAndSort`'s filter chain, so a new filter has to be added in both or the two silently disagree; and search text is memoized in a `WeakMap` keyed by the image object, which is only sound because every store path replaces `IndexedImage` objects instead of mutating them in place.

**`store/useSettingsStore.ts`**

Persists user preferences such as:

* sort order and view mode
* thumbnail/file path display settings
* indexing concurrency
* global auto-watch
* safe mode preferences
* theme
* keyboard shortcuts
* A1111 and ComfyUI endpoints
* ComfyUI Workspace URL/panel preferences and queue monitoring

In Electron, this store persists through the settings IPC bridge rather than plain browser storage.

**`store/useLicenseStore.ts`**

Owns the offline license and trial state:

* free / trial / expired / pro / lifetime status
* 3-day trial activation
* offline license key validation

**`store/useGenerationQueueStore.ts`**

Tracks generation jobs across providers:

* queued, processing, done, failed, and canceled states
* provider-specific payload needed for retry
* currently active provider job
* ComfyUI jobs detected from outside Image MetaHub

The queue is synchronized by `hooks/useGenerationQueueSync.ts`.

**`store/useSemanticStore.ts`**

Orchestrates the opt-in local visual-search feature, kept out of `useImageStore` so its heavy, opt-in machinery does not weigh on the hot filter/render path:

* CLIP model download and installed/GPU-installed status
* the resumable backfill job (progress, pause/resume/cancel)
* running a text or "find similar" query and publishing the score map
* backend selection (WASM/CPU baseline vs. opt-in WebGPU/fp16)

The only thing it pushes into `useImageStore` is the finished result, via `applySemanticResult(scoreById)`. See [Visual (Semantic) Search](#visual-semantic-search) below.

## Indexing and Metadata Pipeline

### Discovery and File Scanning

Folder discovery starts in the renderer but uses Electron IPC for filesystem-heavy work. The app can scan flat or recursive directory trees and maintains per-directory progress feedback.

Key pieces:

* `services/fileIndexer.ts`
* `hooks/useImageLoader.ts`
* `electron.mjs`
* `preload.js`

The pipeline supports:

* incremental indexing
* cache hydration on startup
* progressive batch delivery to the renderer
* directory-scoped progress reporting
* watcher-driven refreshes

### Metadata Engine

Raw metadata extraction is handled by `services/metadataEngine.ts`.

It reads:

* PNG `tEXt` / `iTXt`
* JPEG/WEBP EXIF/XMP/comment payloads
* AVIF XMP item extents and legacy AVIF EXIF workflow fields
* sidecar-style embedded JSON where applicable
* video/audio container metadata and `ffprobe` output for supported media formats

The output is then normalized by `services/parsers/metadataParserFactory.ts`, which dispatches to generator-specific parsers such as:

* `services/parsers/automatic1111Parser.ts`
* `services/parsers/comfyUIParser.ts`
* `services/parsers/invokeAIParser.ts`
* `services/parsers/forgeParser.ts`
* `services/parsers/sdNextParser.ts`
* `services/parsers/drawThingsParser.ts`
* `services/parsers/videoMetaHubParser.ts`

AVIF container behavior is isolated in `utils/avifMetadata.mjs`. The module resolves ISO-BMFF item locations, joins split metadata extents, delegates raw XMP/EXIF parsing to `exifr`, and reports disagreements between standalone and legacy nested workflow documents. `utils/imageMetaHubAvifExtension.mjs` owns the compact Image MetaHub extension schema. AVIF rewrites reuse the existing XMP extent when the compact payload fits, or append a new payload and repoint the item location when it does not, without decoding or re-encoding AV1 pixels. Files without exactly one writable standard XMP item are rejected instead of being rewritten unsafely.

### ComfyUI Parser

ComfyUI parsing is the most sophisticated parser path and combines two layers:

* `services/parsers/comfyUIParser.ts` for top-level detection, workflow/prompt merging, lineage extraction, and normalization
* `services/parsers/comfyui/` for the declarative graph traversal system

The `services/parsers/comfyui/` subsystem includes:

* `nodeRegistry.ts` for node definitions and parameter mapping
* `traversalEngine.ts` for backward graph traversal and fact resolution
* `extractors.ts` for reusable prompt/LoRA/wildcard extraction helpers
* `types.ts` for `WorkflowFacts` and parser graph types

This parser feeds:

* prompt/model/sampler extraction
* richer LoRA detection
* parser telemetry
* lineage data for transformed images
* workflow-native ComfyUI regeneration

### Cache and Thumbnails

Metadata and thumbnails are cached separately.

**Metadata cache**

* `services/cacheManager.ts` stores normalized image metadata in chunked cache files.
* Parser/cache versioning is used to invalidate stale cache when metadata logic changes.
* Writes are incremental to avoid large all-at-once cache flushes.
* Chunks are bounded by **both** an entry count and a byte budget. The byte budget is the load-bearing one: a single ComfyUI entry carries a whole workflow graph, so sizing purely by entry count produced chunk files of tens of MB. Chunk files are always read and rewritten whole, so their size directly sets the cost of every single-image edit.
* A sidecar `{cacheId}_index.json` maps image id → chunk index, so patching an image reads just the chunk holding it instead of scanning the cache. The index is validated against the record's `chunkCount` and `lastScan` on every use, and rejected if either differs. **Every path that finalizes a cache write must rewrite the index with the same `lastScan` it finalized the record with** — an index left behind at an older `lastScan` is silently rejected forever, which quietly degrades every later edit into a full rewrite. The one deliberate exception is a tombstoned delete (below): it moves no entry between chunks, so it leaves both `lastScan` and the index alone and stays valid by not changing anything.
* Removals resolve bare filenames against the index keys (entry ids encode the relative path) rather than reading chunks, so watcher-driven removals also take the fast path.
* **Deletes are tombstoned, not applied.** Removing an image appends its id to a second sidecar, `{cacheId}_removed.json`, and adjusts the record — no chunk file is touched, so a delete costs the same on any library size. Read paths (`getCachedData`, `iterateCachedMetadata`) skip the listed ids. The entries are physically dropped by the next full rewrite, which is forced once the sidecar passes `MAX_TOMBSTONES_BEFORE_COMPACTION` ids and also happens on any reindex. `imageCount` counts live entries, so the chunks physically hold `imageCount + tombstoneCount`.
* The invariant that holds the two files together is that the record's `tombstoneCount` equals the sidecar's length; readers also require the sidecar's `chunkCount` to match. **On any disagreement the sidecar is ignored and the cache is served exactly as it sits on disk** — an already-deleted image can reappear until the next scan removes it again, which is the acceptable direction; trusting a stale sidecar would hide images that are still on disk, which is not. The mismatch is left visible on purpose so the next delete or append still forces the repairing rewrite, which recomputes `imageCount` from the actual chunk contents.
* Because of that, `finalize-cache-write` makes every caller declare what happens to the sidecar: omitted drops it (a full rewrite), `'preserve'` touches neither file and carries the record's existing count forward, and an explicit `{ chunkCount, ids }` replaces it. The main process derives `tombstoneCount` from what it actually wrote, so the two cannot disagree by accident, and the default for a caller that says nothing is the safe one. The rule lives in `utils/cacheTombstones.mjs` — **nothing may quietly make a broken pair agree again**, including by mapping a failed read to zero. Both bugs found in review of this design were exactly that.
* Appending cannot undo a tombstone, since the dead entry is still in its chunk: re-adding a still-tombstoned id would leave two entries for it. `appendToCache` detects this before writing anything and hands the whole append to the full rewrite instead.
* Raw metadata above a small threshold is not stored inline. Entries keep `normalizedMetadata` plus previews, and `services/rawMetadataHydration.ts` re-reads the full text from the image file on demand for the metadata, editor and ComfyUI workflow views. This keeps both the on-disk cache and renderer memory small; the derived fields the cache does keep are what drive search, filters and facets.

**Thumbnail cache**

* `services/thumbnailManager.ts` generates and reuses thumbnails.
* Video thumbnails are generated from captured frames.
* Thumbnail state is intentionally decoupled from the main image collection to avoid full-list re-renders as thumbnails arrive.

**Viewer media cache**

* `services/mediaSourceCache.ts` turns an image into a URL the renderer can display — an `imh-media://` stream URL in Electron, an object or data URL otherwise — keyed by `directoryPath::id::lastModified` and LRU-capped separately per kind.
* **Resolving a source yields a string, not bytes.** On the Electron path it is a path resolution plus an `fs.access`; nothing is read and nothing is decoded. That fetch and decode is precisely what cannot fit in the frame where the viewer's `<img src>` changes, so warming a neighbour means decoding it, not resolving it.
* `services/mediaDecodeCache.ts` is that second layer: a small LRU of decoded bitmaps keyed **by URL only**, with no knowledge of `IndexedImage` or directories. Holding the `HTMLImageElement` is what keeps Chromium from dropping the decoded copy. `ImageModal` warms two neighbours ahead in the direction of travel and one behind, serialized on `requestIdleCallback`, and deliberately without `prioritize` so it never pauses the grid's background thumbnail work. It only does so when the store's navigation list is the one the viewer is actually walking — a modal opened from Find Similar, a ComfyUI workflow or a scope steps through its own id list, and `currentIndex`/`totalImages` are what say so.
* The viewer reads `mediaSourceCache.peek()` and `mediaDecodeCache.isWarm()` **during render**, not in an effect: an effect runs after paint, which would cost the frame the whole path exists to save. A warm source is swapped in the same commit as the image id change, skipping the thumbnail step entirely; a cold one falls back to thumbnail-then-full as before.
* Both `peek()` and `isWarm()` are side-effect free on purpose. They run on every render, and touching LRU recency there would rank entries by how often a component re-rendered rather than by use.
* The decode cache is refcounted (`retain`/`release`) because several viewer windows can be open at once — the last one to close is what drops the bitmaps.

## Filtering, Tags, and Curation

The current filter system is intentionally explicit rather than implicit.

### Sidebar Facets

`components/FacetFilterSection.tsx` powers the current include/exclude facet UI for:

* checkpoints
* LoRAs
* samplers
* schedulers

Each facet supports:

* include and exclude actions per value
* per-value result counts
* local search inside the facet
* pinning of active values at the top

### Tags and Favorites

`components/TagsAndFavorites.tsx` surfaces:

* favorites include/exclude mode
* manual tags
* TF-IDF auto-tags

Auto-tags support include/exclude cycling. Manual tags and favorites are persisted through the image annotation storage layer.

### Annotations and Shadow Metadata

Non-destructive metadata editing and annotations are split across:

* `hooks/useShadowMetadata.ts`
* `components/MetadataEditorModal.tsx`
* `services/imageAnnotationsStorage.ts`
* `services/imageEditingService.ts`

This layer allows:

* favorites
* manual tags
* notes imported from MetaHub Save payloads
* shadow metadata overrides without overwriting the original file metadata
* image adjustment export metadata for edited PNG copies

## Clustering (Clusters dimension)

Similarity-based organization is exposed through the **Clusters** dimension of
the Explore surface (it was previously a standalone Smart Library view). Cluster
cards are rendered via `ScopeCard`; opening one scopes the Library to that
cluster. Cluster generation and auto-tagging are triggered from Explore's
Clusters dimension and the sidebar's Navigate → Clusters section.

**Main pieces**

* `components/ExploreWorkspace.tsx` (Clusters dimension)
* `components/ClusterUpgradeBanner.tsx` (free-tier upsell shown in the Clusters
  dimension when `clusteringMetadata.isLimited`)
* `utils/smartLibraryClusterState.ts` (access gating, cluster state signatures)

> The in-cluster deduplication workflow (mark best / archive) was removed when
> cluster drill-in moved to the scoped Library grid; only the free-tier upgrade
> banner is retained.

**Engines**

* `services/clusteringEngine.ts`
* `services/workers/clusteringWorker.ts`
* `services/clusterCacheManager.ts`
* `services/autoTaggingEngine.ts`
* `services/workers/autoTaggingWorker.ts`

Clustering and auto-tagging are deliberately offloaded to workers because they are CPU-heavy and operate over the full filtered image set.

## Visual (Semantic) Search

Opt-in, fully local search by what an image shows — including images with no generation metadata at all (screenshots, downloads) — built on a CLIP model run entirely on-device. The master switch (`settings.semanticSearchEnabled`) defaults **off**: while off, no model status check runs, no index is opened, and no file is written. The onboarding card above the Library grid (`components/VisualSearchOnboarding.tsx`) and the Settings tab stay visible regardless, so the feature is still discoverable while inactive.

**Storage**

* `services/embeddings/embeddingFormat.ts` defines the on-disk layout: vectors are int8-quantized with a per-vector scale, written into append-only segment files (`${safeCacheId}_emb_seg_*.bin`, ~4MB each) next to the metadata cache, plus JSON row-index chunks and a manifest that is the durability source of truth. A manifest written by a different model, dimension, or format is treated as unreadable and the index is rebuilt rather than migrated — embeddings are pure derived data.
* `services/embeddings/embeddingStore.ts` (`EmbeddingIndex`) owns one library-wide index keyed by the fixed id `SEMANTIC_CACHE_ID = 'imh-visual-search'` — not per-directory, since the store flattens every directory into a single `images[]` array. Handles append, flush (segment-append-then-manifest-write ordering, so a crash mid-flush is discovered and discarded on the next load), tombstone, and rename (an in-app rename rebinds the row to the new image id instead of orphaning the vector).
* Reconciling the index against images that have left the library (tombstoning their vectors) happens **only** from the backfill job below, which is the only caller holding the authoritative, fully-hydrated image array. It deliberately does not run from a mount effect, where a still-loading (empty or partial) image list would otherwise read as "the library is empty" and wipe every live vector.

**Indexing**

* `services/embeddings/embeddingIndexer.ts` (`runBackfill`) is a resumable, newest-first backfill: pause/resume/cancel, periodic flush so a crash costs at most one flush window, and a Free-tier cap (`SEMANTIC_FREE_TIER_LIMIT` = 2,000 most-recent images, `hooks/useFeatureAccess.ts`) that Pro removes.
* `services/workers/embeddingWorker.ts` + `services/embeddings/embeddingService.ts` run the CLIP towers (`@huggingface/transformers`) off the main thread. WASM/q8 is the always-present CPU baseline so the app never competes with an image generator for VRAM by default; an opt-in WebGPU/fp16 accelerator (`settings.semanticSearchDevice`) falls back to CPU automatically on adapter or `shader-f16` load failure.
* Model weights are downloaded once from Hugging Face on explicit opt-in (`download-embedding-model` IPC handler in `electron.mjs`) into `<userData>/models/`, verified against the LFS object hash reported in Hugging Face's `x-linked-etag` header, and served to the worker over a dedicated `imh-model://` protocol — this is the only network request the feature ever makes.

**Search**

* `services/embeddings/semanticSearchEngine.ts` + `services/workers/vectorSearchWorker.ts`: a long-lived worker holds the quantized vector matrix in memory (reloading it per query is not viable at scale) and ranks it by brute-force cosine, top-K via a fixed-size min-heap. Only segments whose row count changed since the last sync are re-read and re-sent.
* Relevance is decided by a z-score cutoff over the query's own score distribution rather than a fixed cosine threshold — CLIP text↔image cosines are compressed and query-dependent (roughly 0.22–0.25 regardless of the query), so an absolute floor cannot separate a real match from noise.
* Negative terms (`beach -people`) push the query embedding away from the unwanted concept(s) before ranking.
* "Find visually similar" (grid/table context menu) reuses the same ranking worker against a row already in the matrix, embedding the source image on demand if it has no vector yet — this is what makes it work on images the backfill never reached.

**UI and store integration**

* `components/SemanticSearchBar.tsx` (sidebar toggle + query input), `components/settings/VisualSearchSettingsPanel.tsx` (model download, index build/pause/resume, GPU toggle), `components/VisualSearchOnboarding.tsx` (dismissible intro card).
* A visual query lives in `useImageStore.semanticResult.scoreById` — a `Map`, never written onto `IndexedImage` — and *replaces* the text-search predicate rather than combining with it (searching by content is a different question than matching prompt text), driving a `'relevance'` sort order that Group By treats the same as `'random'` (no stable buckets to group by).

## Comparison and Analytics

### Comparison

`components/ComparisonModal.tsx` compares up to four images and coordinates:

* synchronized zoom state
* side-by-side, side strip, and grid rendering
* overlay-based slider and hover modes
* metadata diff vs standard view

### Analytics

`components/Analytics.tsx` uses `utils/analyticsUtils.ts` to compute:

* period-based counts
* top checkpoints / LoRAs / samplers
* usage trends over time
* habits by day/hour
* telemetry coverage
* performance by GPU
* generation time distributions

Telemetry detection itself is centralized in `utils/telemetryDetection.ts`.

## Generation Integrations

### Automatic1111

The A1111 integration is built around:

* `services/a1111ApiClient.ts`
* `hooks/useCopyToA1111.ts`
* `hooks/useGenerateWithA1111.ts`
* `utils/a1111Formatter.ts`

Two workflows are supported:

* copy normalized parameters for manual import into A1111
* call the A1111 API directly for quick regeneration

### ComfyUI

The ComfyUI integration is broader and currently spans:

* `services/comfyUIApiClient.ts`
* `services/comfyUIWorkflowBuilder.ts`
* `services/comfyUIVisualWorkflow.ts`
* `components/ComfyUIGenerateModal.tsx`
* `components/ComfyUIWorkspace.tsx`
* `components/ComfyUIWorkflowVisualEditor.tsx`
* `hooks/useCopyToComfyUI.ts`
* `hooks/useGenerateWithComfyUI.ts`
* `hooks/useComfyUIQueueMonitor.ts`
* `hooks/useComfyUIModels.ts`
* `contexts/ComfyUIProgressContext.tsx`

The current behavior supports:

* `original` workflow mode when an executable prompt graph exists
* `simple` rebuild mode from normalized metadata
* workflow patching with model/LoRA/source-image overrides
* visual editing of supported node fields
* advanced JSON editing for edge cases
* WebSocket progress updates
* queue persistence and retry
* optional monitoring of external ComfyUI prompt jobs
* embedded Electron workspace browsing with external-browser fallback in non-desktop builds

## Desktop Integration

### Electron Main Process

`electron.mjs` owns:

* BrowserWindow lifecycle
* auto-update wiring
* settings file reads/writes with atomic replacement and recovery paths
* filesystem IPC handlers
* folder watching
* export/ZIP/transfer operations
* metadata-preserving edited image save/overwrite operations
* video metadata reading via `ffprobe`
* clipboard and drag-and-drop helpers
* visual-search embedding sidecar IPC (read/write/append segment, stat, delete) and CLIP model download/status/delete, plus the `imh-model://` protocol that serves the downloaded weights to the embedding worker

### Preload Bridge

`preload.js` exposes a constrained `window.electronAPI` surface for:

* directory discovery
* file reads and stats
* cache and thumbnail operations
* watcher events
* settings persistence
* export, transfer, and drag/drop helpers
* visual-search embedding storage and model download/progress

The renderer does not access Node APIs directly.

### CLI

`cli.ts` exposes a small command-line interface for:

* `parse` to inspect metadata for a single file
* `index` to emit JSONL for a directory

Both commands reuse the same metadata engine as the desktop app.

## Project Layout

```text
.
├── App.tsx
├── components/        # UI components and modal surfaces
├── contexts/          # A1111 / ComfyUI progress contexts
├── hooks/             # Renderer hooks and integration adapters
├── services/          # Indexing, parsing, generation, caching, workers
├── store/             # Zustand stores
├── utils/             # Formatting, lineage, analytics, telemetry helpers
├── __tests__/         # Vitest coverage
├── electron.mjs       # Electron main process
├── preload.js         # Electron preload bridge
├── cli.ts             # CLI entry point
└── scripts/           # Release, sync, and maintenance automation
```

## Testing and Release Notes

**Testing**

* Vitest is used for parser, workflow-builder, lineage, and store/filter tests.
* The heaviest regression surface is metadata parsing, especially ComfyUI graph handling and normalization.

**Release workflow**

Top-level release automation lives in:

* `generate-release.js`
* `scripts/auto-release.js`
* `scripts/release-workflow.js`
* `scripts/sync-changelog.js`

For release documentation, see:

* `CHANGELOG.md`
* `RELEASE-GUIDE.md`
* `RELEASE-AUTOMATION.md`
