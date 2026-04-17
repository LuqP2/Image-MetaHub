# Architecture Documentation

## Overview

**Image MetaHub** is an Electron + React desktop application for browsing and organizing large local libraries of AI-generated images and videos. The application is local-first: indexing, metadata extraction, filtering, caching, tagging, lineage, and most generation workflows run on the user's machine.

### Current Stack

* **Version:** 0.14.2
* **Renderer:** React 18 + TypeScript
* **Desktop shell:** Electron 38
* **State management:** Zustand
* **Build/dev:** Vite 7, TypeScript 5, ESLint 9, Vitest 3
* **Styling:** Tailwind CSS 3

## Application Shape

The renderer is centered around `App.tsx`, which coordinates:

* the main **Library** view
* the **Smart Library** view
* the **Model View**
* the **multi-window image viewer**
* the **comparison modal**
* the **analytics modal**
* generation modals and the shared generation queue sidebar

The app is designed so the heavy work happens outside the tight render loop:

* indexing and metadata parsing are incremental
* clustering and auto-tagging run in workers
* thumbnails are cached and loaded separately from the main image list
* stores use granular selectors to reduce renderer churn

## Major Runtime Subsystems

### 1. Renderer Shell and UI Surfaces

**Core entry points**

* `App.tsx` orchestrates folders, library state, global modals, and top-level view switching.
* `components/Header.tsx` exposes view mode switching, generation entry points, analytics access, safe mode, and Smart Library actions.
* `components/Sidebar.tsx` contains the current sidebar filter experience:
  * search
  * active filter chips
  * tags, favorites, and auto-tags
  * faceted include/exclude sections for checkpoints, LoRAs, samplers, and schedulers
  * advanced numeric/date filters
* `components/DirectoryList.tsx` handles indexed folder navigation, subfolder visibility, exclusion, and auto-watch controls.

**Main browsing surfaces**

* `components/ImageGrid.tsx` and `components/ImageTable.tsx` render the main library in grid/list form.
* `components/ImageModal.tsx` is now a windowed viewer surface with move, resize, minimize/maximize, and dock/collapse behavior.
* `components/ImagePreviewSidebar.tsx` shows metadata, telemetry, and generation actions in the side preview flow.
* `components/ImageLineageSection.tsx` resolves source and derived images for transformation workflows.

**Pro surfaces**

* `components/ComparisonModal.tsx` compares exactly two images with side-by-side, slider, and hover modes.
* `components/Analytics.tsx` renders usage and telemetry dashboards.
* `components/A1111GenerateModal.tsx` and `components/ComfyUIGenerateModal.tsx` expose generation controls.

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

The queue is synchronized by `hooks/useGenerationQueueSync.ts`.

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
* sidecar-style embedded JSON where applicable
* video container metadata and `ffprobe` output for supported video formats

The output is then normalized by `services/parsers/metadataParserFactory.ts`, which dispatches to generator-specific parsers such as:

* `services/parsers/automatic1111Parser.ts`
* `services/parsers/comfyUIParser.ts`
* `services/parsers/invokeAIParser.ts`
* `services/parsers/forgeParser.ts`
* `services/parsers/sdNextParser.ts`
* `services/parsers/drawThingsParser.ts`
* `services/parsers/videoMetaHubParser.ts`

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

**Thumbnail cache**

* `services/thumbnailManager.ts` generates and reuses thumbnails.
* Video thumbnails are generated from captured frames.
* Thumbnail state is intentionally decoupled from the main image collection to avoid full-list re-renders as thumbnails arrive.

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

This layer allows:

* favorites
* manual tags
* notes imported from MetaHub Save payloads
* shadow metadata overrides without overwriting the original file metadata

## Smart Library

The Smart Library is a separate browsing mode for similarity-based organization.

**Main pieces**

* `components/SmartLibrary.tsx`
* `components/StackCard.tsx`
* `components/StackExpandedView.tsx`
* `components/DeduplicationHelper.tsx`

**Engines**

* `services/clusteringEngine.ts`
* `services/workers/clusteringWorker.ts`
* `services/clusterCacheManager.ts`
* `services/autoTaggingEngine.ts`
* `services/workers/autoTaggingWorker.ts`
* `services/deduplicationEngine.ts`

Clustering and auto-tagging are deliberately offloaded to workers because they are CPU-heavy and operate over the full filtered image set.

## Comparison and Analytics

### Comparison

`components/ComparisonModal.tsx` compares two images and coordinates:

* synchronized zoom state
* side-by-side rendering
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
* `components/ComfyUIWorkflowVisualEditor.tsx`
* `hooks/useCopyToComfyUI.ts`
* `hooks/useGenerateWithComfyUI.ts`
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

## Desktop Integration

### Electron Main Process

`electron.mjs` owns:

* BrowserWindow lifecycle
* auto-update wiring
* settings file reads/writes with atomic replacement and recovery paths
* filesystem IPC handlers
* folder watching
* export/ZIP/transfer operations
* video metadata reading via `ffprobe`
* clipboard and drag-and-drop helpers

### Preload Bridge

`preload.js` exposes a constrained `window.electronAPI` surface for:

* directory discovery
* file reads and stats
* cache and thumbnail operations
* watcher events
* settings persistence
* export, transfer, and drag/drop helpers

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
