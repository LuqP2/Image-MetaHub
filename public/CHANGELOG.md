# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.13.0] - 2026-02-02

### Added

- **Metadata Editing**: Enable direct editing of image metadata (positive/negative prompts, parameters) within the ImageModal. Includes "View Original" and "Revert" functionality to manage edits safely.
- **Image Stacking Navigation**: Fully implemented stack navigation, allowing users to browse clustered images, drill down into stacks, and navigate back to the main view seamlessly.
- **Video & GIF Support**: Complete support for video formats (MP4, WEBM) and GIFs, ensuring they are correctly indexed, displayed with thumbnails, and playable within the viewer.
- **Subfolder Removal**: Added ability to exclude specific subfolders from the index directly from the directory tree context menu.
- **Random Sort**: New "Random" sort order with a "Reshuffle" option for rediscovering copies.
- **UI & UX Improvements**:
  - Added dedicated "Back" button to Compare Mode header.
  - Added "Copy Raw Metadata" to context menus.
  - Optimized header layout to prevent UI element overlap on smaller screens.

### Improved

- **Indexing Performance**: Major underlying optimization to file indexing (Phase B), significantly reducing time and UI lag for large libraries.

### Fixed

- **Thumbnail Staling**: Resolved issue where thumbnails stuck to old versions after overwriting files.
- **Prompt Library**: Fixed crashes/instability in the Prompt Library (IndexedDB errors).
- **Cache Management**: Refactored cache manager code to adhere to best practices.

## [0.12.3] - 2026-01-26

### Fixed

- **Indexing Resiliency**: Fixed an issue where interrupted indexing operations left files with incomplete metadata (stubs) in the cache that never got re-indexed. The system now automatically detects these incomplete entries on startup/refresh and forces them to be fully enriched, eliminating the need to clear cache after an interrupted scan.

## [0.12.2] - 2026-01-24

### Improved

- **Indexing Performance**: Faster Phase B indexing with head-only reads, deferred cache flushes, and batched UI merges/filter refresh to reduce stalls.
- **Image Loading Speed**: Modal and preview images now load faster via thumbnail placeholders and Blob URLs instead of base64.
- **ComfyUI LoRA Selection**: Added a searchable field for LoRAs in the "Generate with ComfyUI" modal.
- **Recent Tag Suggestions**: Newly added tags now show in suggestions and the list remains available when adding multiple tags.
- **External Drag & Drop**: Enabled dragging images from ImageModal to other programs.

### Added

- **Batch Export**: Export selected or filtered images in bulk to a folder or ZIP with progress tracking (desktop only).
- **Privacy Settings Tab**: New Privacy tab with content filtering controls for sensitive tags and blur behavior.

## [0.12.1] - 2025-01-13

### Fixed

- **V8 Cache Serializer Chunking**: Implemented size-based chunking to prevent oversized cache writes.

### Added

- **Grid Toolbar Selection Actions**: Added GridToolbar with selection actions for faster multi-image workflows.
- **Settings Modal Double-Click Toggle**: Added double-click toggle behavior for the settings modal.

## [0.12.0] - 2025-01-12

### Added

- **Smart Library Foundation - Image Clustering**: Revolutionary clustering system that organizes images into prompt-similarity stacks:
  - Background clustering worker with TF-IDF vectorization and hierarchical clustering
  - Multiple similarity metrics: Jaccard (token-based), Levenshtein (character-based), and hybrid scoring
  - Prompt normalization and FNV-1a hashing for efficient deduplication
  - Stack cards showing cover image, prompt preview, and image counts
  - StackExpandedView for browsing images within each cluster
  - Real-time progress streaming across clustering phases
  - File watcher integration: deletions automatically update clusters and remove empty ones

- **TF-IDF Auto-Tagging Engine**: Intelligent automatic tag generation from image metadata:
  - Metadata-weighted boosts for model and LoRA names for more relevant tags
  - ComfyUI workflow facts resolver for enhanced metadata extraction
  - Displayed in ImageModal and ImagePreviewSidebar
  - Auto-tag filtering with frequency counts
  - "Promote to tag" workflow to convert auto-tags into permanent tags
  - Per-tag removal capability

- **Enhanced Generation Workflow**: Comprehensive improvements to image generation modals and accessibility:
  - Generate dropdown in header for quick access to A1111 and ComfyUI generation from anywhere
  - Support for generation from scratch without requiring a base image
  - "Generate" option added to gallery context menu
  - Parameter persistence across sessions: model, LoRAs, cfg_scale, steps, randomSeed, and sampler/scheduler
  - "Load from Image" button to restore original image parameters after adjusting persisted values
  - Separated Sampler and Scheduler into distinct fields in ComfyUI modal (matching ComfyUI interface)

- **Smart Library UI**: Complete browsing interface for clustered images:
  - SmartLibrary.tsx with grid layout for stack cards
  - StackCard.tsx showing cover, prompt, and counts
  - Collections sidebar with filtering capabilities
  - Loading and empty states for better UX
  - Aligned with Gallery view for consistent experience
  - Reuses ImageGrid component for efficiency

- **Intelligent Deduplication Helper (Beta)**: Foundation for managing duplicate images:
  - Heuristic ranking: favorites -> file size -> creation date
  - Visual badges in ImageGrid for "best" vs "archived" images
  - Manual selection override support
  - Disk space savings estimation
  - Persistent deduplication preferences

### Changed

- **Directory Navigation**
- Refactored root folder behavior to align with standard Explorer patterns. Clicking a root folder row now selects and filters its content directly instead of opening the system file explorer.
- "Auto-watch" and recursive subfolder scanning are now enabled by default. New folders automatically index and watch all nested subdirectories.

### Improved

- **Performance Optimizations**:
  - Lazy thumbnail loading with IntersectionObserver for faster stack rendering
  - Increased thumbnail concurrency in thumbnailManager
  - Precomputed token/Jaccard filter to skip expensive Levenshtein comparisons
  - Efficient background worker architecture for non-blocking operations

- **Enhanced IPC & Cache Management**:
  - Exposed userData and FS helpers via IPC for cache operations
  - Stream progress updates across all clustering phases
  - Multiple cache path fallbacks for increased reliability
  - IndexedDB version bump to resolve mismatch issues
  - Guarded cache IPC writes against oversized metadata payloads to prevent scan crashes

### Technical Improvements

- **ComfyUI Integration**: Extended comfyUIParser.ts with workflow facts resolver for better metadata extraction

## [0.11.1] - 2025-01-10

### Added

- **External Drag & Drop**: Enabled native drag and drop support for images in the Gallery View. Users can now directly drag images from the application to external programs (ComfyUI, Photoshop, Discord, file explorer, etc.) for a seamless workflow.

### Fixed

- **Forge Metadata Parsing**: Fixed "No normalized metadata available" issue for images created with newer Forge versions (f2.0.1+). The Forge backend update removed "Forge"/"Gradio" keywords from metadata, causing images to fall through to A1111 parser. Updated detection logic to recognize Forge version patterns (`/Version:\s*f\d+\./i`) in addition to keyword matching. (Issue #108)
- **Image Compare Mode - Hover & Slider**: Fixed critical rendering bug where images appeared as black screen in Hover and Slider comparison modes. The issue was caused by `react-zoom-pan-pinch` wrapper not receiving explicit height styles, causing the container to collapse to 0px height. Added `wrapperStyle` and `contentStyle` inline styles to force proper dimensions.

### Improved

- **Auto-Watch Instant Sync**: Activating auto-watch now triggers an immediate folder refresh, ensuring the gallery is instantly synchronized with the current directory state without waiting for the next file change event.
- **Image Compare Mode - Slider Interaction**: Significantly improved slider usability:
  - Expanded clickable area from 1px to 40px (20px on each side of the divider line) for much easier dragging
  - Removed 180ms transition delay during drag operations for instant response
  - Smooth transitions still apply when using keyboard or range input for fine adjustments

## [0.11.0] - 2025-01-07

### Added

- **MetaHub Save Node for ComfyUI**: Official companion custom node released alongside this version:
  - Custom node that auto-extracts all generation parameters from ComfyUI workflows
  - Saves metadata in both A1111 and Image MetaHub formats for maximum compatibility
  - Includes MetaHub Timer Node for accurate performance tracking
  - Available on [ComfyUI Registry](https://registry.comfy.org/publishers/image-metahub/nodes/imagemetahub-comfyui-save) and [GitHub](https://github.com/LuqP2/ImageMetaHub-ComfyUI-Save)
  - Enables instant parsing (10-20x faster) and future-proof ComfyUI support without nodeRegistry maintenance
- **Auto-Watch Functionality**: Automatic folder monitoring for real-time image detection:
  - Individual toggle per directory with eye icon in directory list
  - Real-time file monitoring using chokidar for instant detection
  - Intelligent debouncing (500ms) and batch processing for optimal performance
  - Silent background processing without notifications or interruptions
  - State persistence - watchers automatically restored on app restart
  - Support for PNG, JPG, JPEG, and WEBP formats
  - Filters cache folders and system directories automatically
  - Perfect for monitoring ComfyUI/A1111 output folders during generation
  - **ComfyUI Generation Integration**: Complete workflow-based image generation directly from Image MetaHub:
    - "Generate with ComfyUI" button in ImageModal for creating variations
    - Full parameter customization (model, LoRAs, seed, steps, CFG, size)
    - Real-time WebSocket-based progress tracking during generation
    - Copy workflow JSON to clipboard functionality
    - Automatic integration with MetaHub Save Node for metadata preservation
    - Purple-themed UI distinct from A1111 integration
    - Connection testing and settings persistence
  - **Unified Generation Queue**: New queue sidebar for tracking A1111 and ComfyUI jobs:
    - Toggle queue from footer with badge count
    - Per-item progress with steps/images and overall progress bar
    - Actions for cancel, retry, remove, clear finished, and clear all
  - **Enhanced A1111 Generation**: Major improvements to Automatic1111 integration:
    - Model and LoRA selection with search filters in generation modal
    - Image size controls (width/height inputs)
    - "Remember last selected model" - automatically selects previously used model
    - Renamed "Generate Variation" to "Generate with A1111" for clarity
- **WebP Image Support**: Full support for WebP format across the application:
  - WebP indexing, parsing, and preview generation
  - MetaHub Save Node metadata detection in WebP files
  - Extends compatibility beyond PNG and JPEG
- **MetaHub Save Node Extended Support**: Enhanced integration with ComfyUI MetaHub Save Node:
  - **Automatic Tags Import**: Tags from `imh_pro.user_tags` are automatically imported into ImageAnnotations system for filtering
  - **Notes Display**: Notes from `imh_pro.notes` shown as read-only metadata in ImageModal and sidebar
  - **Performance Metrics**: GPU/performance analytics display with three-tier metric system:
    - Tier 1: VRAM peak usage, GPU device, generation time
    - Tier 2: Steps/second, ComfyUI version
    - Tier 3: PyTorch and Python versions
  - **Verified Telemetry Badges**: Visual badges and filter for images with verified analytics data
  - **Timer Node Support**: Integration with MetaHub Timer Node for accurate performance tracking
  - Support for both `analytics` and `_analytics` field naming conventions
- **Performance Analytics Dashboard**: New analytics visualizations for images with MetaHub Save Node telemetry data:
  - **Overview Cards**: Average speed (it/s), VRAM usage (GB), generation time, and telemetry coverage percentage
  - **Generation Time Distribution**: Histogram showing distribution of generation times across time buckets (< 1s, 1-5s, 5-10s, etc.)
  - **Performance by GPU Device**: Dual-axis bar chart comparing average speed and VRAM usage across different GPU devices
  - **Performance Over Time**: Timeline chart tracking generation speed and VRAM trends over days/weeks/months
  - **Dismissible Promo Banner**: Top banner with links to MetaHub Save Node (ComfyUI Registry and GitHub) for users without telemetry data
  - **Subtle Footer Reminder**: Always-visible footer link encouraging adoption of MetaHub Save Node
  - **localStorage Persistence**: Banner dismissal preference saved to avoid repeated prompts
- **Standalone Metadata Engine Package**: Extracted `@image-metahub/metadata-engine` v1.0.0-beta.1 as publishable npm package:
  - Parse metadata from 15+ AI generators (ComfyUI, InvokeAI, A1111, DALL-E, Adobe Firefly, Midjourney, etc.)
  - Dual build: CommonJS + ESM with TypeScript declarations
  - Normalized BaseMetadata schema for all formats
  - SHA-256 hashing and dimension extraction
  - Apache-2.0 license, ready for ecosystem adoption
  - Package size: 65.6 KB compressed, 353.1 KB unpacked
- **CLI Enhancements**: Improved command-line interface capabilities:
  - `--concurrency <n>` flag for parallel processing (defaults to CPU cores)
  - `--quiet` flag to suppress informational logs during bulk operations
  - Schema versioning (`schema_version: "1.0.0"`) in output
  - Standardized telemetry blocks in metadata output
  - JSONL indexing support
- **VAE and Denoise Display**: Added visual display of VAE model and denoise strength in metadata panels
- **Metadata Comparison Diff View**: Enhanced comparison modal with intelligent difference highlighting for iterating through generation variations:
  - **Toggle between Standard and Diff views**: New view mode button in comparison metadata panel
  - **Word-level diff for prompts**: Only changed words are highlighted (e.g., "brick" vs "wooden" or "yellow" vs "red")
  - **Smart field comparison**: Automatically detects differences in models, LoRAs, seeds, CFG, clip skip, steps, sampler, and other generation parameters
  - **Neutral visual design**: Subtle blue highlighting for differences, no intrusive badges
  - **Clip Skip field added**: Now displays clip_skip values in comparison view (previously missing)
  - **Array comparison**: Deep comparison for LoRAs arrays with weights
- **LoRA Weight Display**: ImageModal and ImagePreviewSidebar now display LoRA weights when available (e.g., `style_lora_v1.safetensors (0.8)`), providing better visibility of LoRA strength used in generation
- **Shared LoRA Extraction Helper**: Added `extractLoRAsWithWeights()` utility function in `promptCleaner.ts` to standardize LoRA extraction with weight parsing across all parsers

### Changed

- **Enhanced LoRA Type Support**: Updated `BaseMetadata` interface to support both string and detailed LoRA info (`LoRAInfo`) with `name`, `model_name`, `weight`, `model_weight`, and `clip_weight` fields for comprehensive LoRA metadata handling
- **LoRA Weight Extraction**: All parsers (Automatic1111, Forge, SDNext, Fooocus, EasyDiffusion, DreamStudio, InvokeAI) now extract LoRA weights from `<lora:name:weight>` syntax and return structured `LoRAInfo` objects instead of plain strings
- **InvokeAI LoRA Weight Support**: InvokeAI parser now extracts weights from both prompt tags (`<lora:...>`, `<lyco:...>`) and InvokeAI's native metadata structure `{ model: { name }, weight }`
- **Preserve Original Prompts**: Removed automatic stripping of `<lora:...>` tags from prompts to preserve the user's original prompt text exactly as written. LoRAs are still extracted separately to the dedicated LoRAs field
- **ComfyUI Hybrid Parser Architecture**: Parser now uses a priority-based extraction system: (1) MetaHub chunk (instant, zero dependencies), (2) Graph traversal (fallback for standard ComfyUI exports), (3) Regex extraction (last resort). This eliminates the maintenance burden of updating nodeRegistry for new custom nodes
- **A1111 API Resource Fetching**: A1111 client now fetches and caches model and LoRA lists to power selection in the generation UI
- **Prioritized MetaHub Chunk Detection**: PNG parser now prioritizes MetaHub chunk detection for faster parsing of images saved with MetaHub Save Node
- **Async Parser Support**: Updated ParserModule interface to support asynchronous parsers for better performance

### Improved

- **ComfyUI Parsing Performance**: Images saved with MetaHub Save Node now parse instantly without graph traversal, reducing parsing time from ~50-100ms to <5ms per image (10-20x faster)
- **Future-Proof ComfyUI Support**: Parser works with ANY ComfyUI custom node when using MetaHub Save Node, no nodeRegistry updates required
- **Zero NodeRegistry Maintenance**: MetaHub chunk extraction bypasses the need to reverse-engineer `widget_order` for new custom nodes, solving the long-standing maintenance burden documented in DEVELOPMENT.md

### Technical Improvements

- Created `utils/metadataComparison.ts` with LCS-based word-level diff algorithm for intelligent prompt comparison
- Enhanced metadata display helpers: `formatGenerationTime()`, `formatVRAM()` with GPU percentage calculation
- Improved tag normalization and deduplication before import from MetaHub Save Node
- Fixed timing issues: tags now imported after images are added to store (flushPendingImages)
- Docker build improvements with LICENSE file inclusion and normalized image tags
- Updated CLI documentation with new output contracts and performance usage examples

## [0.10.5] - 2025-12-16

### Major Performance Improvements

- **3-5x Faster Loading**: Batch IPC operations reduce 1000+ individual calls to a single batch in cache loading and file operations
- **40-60% Fewer Re-renders**: Granular Zustand selectors optimize component updates across App.tsx, ComparisonModal.tsx, and ImageGrid.tsx
- **Phase B Optimizations**: Metadata enrichment now ~13ms per file (down from ~30ms) with header-based dimension reading, batch tuning, and optimized buffer reuse
- **Smoother Navigation**: Bounded thumbnail queue with stale request cancellation prevents outdated jobs from overwriting newer loads

### Added

- **Compare Modes: Slider & Hover**: New comparison modes alongside side-by-side: drag a divider to reveal each image or hover to flip between them, selectable via the mode toggle in the comparison header.
- **Mode-Aware Sync Controls**: Sync toggle is now clearly tied to side-by-side mode, with contextual hints per mode.

### Changed

- **Bounded Thumbnail Queue**: Thumbnail loading now uses a max-concurrency queue with cancellation of stale requests, preventing outdated jobs from overwriting newer loads during rapid navigation.
- **Debounced Full-Image Fallbacks**: Grid and table views delay heavy fallback reads by ~180ms when thumbnails aren't ready, reducing bursty I/O when paginating quickly.
- **Phase B Header Dimensions**: Metadata enrichment reads PNG/JPEG dimensions directly from file headers, skipping full image decode for width/height.
- **Phase B Batch Tuning**: Larger enrichment batches, timed dirty-chunk flushing, and parallel cache rewrites cut IPC/disk churn during metadata extraction.
- **Phase B Throughput Gains**: Optimized buffer reuse and looser flush thresholds dropped average Phase B time per file to ~13 ms on test sets

### Performance

- **Batch Path Joins**: Implemented batch IPC handler `join-paths-batch` for path joining operations, reducing 1000+ individual IPC calls to a single batch call in cache loading and file handle operations (3-5x faster).
- **Reduced JSON Operations**: Optimized `fileIndexer.ts` to skip `JSON.stringify` for empty rawMetadata objects, avoiding unnecessary serialization overhead.
- **Component Memoization**: Added `React.memo` to `Sidebar.tsx` and `ImagePreviewSidebar.tsx` components to prevent unnecessary re-renders when props haven't changed.
- **Granular Store Selectors**: Refactored `App.tsx`, `ComparisonModal.tsx`, and `ImageGrid.tsx` to use granular Zustand selectors instead of mass destructuring, reducing unnecessary re-renders by 40-60%.
- **Optimized ImageCard Memoization**: Replaced expensive `JSON.stringify()` tag comparison with efficient `join()` method in `ImageGrid.tsx`, improving grid rendering performance.
- **Memoized ImageTableRow**: Added `React.memo` with custom comparison to `ImageTableRow` component, preventing unnecessary re-renders in table view.
- **Optimized Table Sorting**: Wrapped `applySorting` function in `useCallback` to avoid recreation on every render, improving sorting performance for large datasets.
- **Throttled Drag-to-Select**: Implemented `requestAnimationFrame` throttling for drag-to-select intersection calculations, providing smoother UX without UI blocking.
- **Debounced Filter Inputs**: Added 300ms debounce to advanced filter inputs, reducing filter recalculations by ~70% during user input while maintaining responsive UI.

## [0.10.4] - 2025-12-10

### Added

- **GitHub Action: License Key Generator**: New workflow `Generate license key` that uses the repository secret `IMH_LICENSE_SECRET` to produce customer keys via Actions UI without exposing the secret locally.

### Changed

- **Build Guard for Licenses**: Builds now fail early if `IMH_LICENSE_SECRET` is missing or still the placeholder, preventing broken Pro activations in shipped binaries.

### Fixed

- **ComfyUI Compressed Workflow Parsing**: Fixed ComfyUI prompt parsing from compressed iTXt PNG chunks and added case-insensitive workflow detection for better compatibility.
- **PNG iTXt Decompression**: Ensure deflate chunks are copied into a real `ArrayBuffer` before piping through `DecompressionStream`, avoiding `SharedArrayBuffer`/Blob type errors in builds.
- **Zlib Fallback**: Use dynamic `import('zlib')` in the renderer fallback path to keep eslint happy and avoid `require` in ESM.

### Developer

- **WebCrypto License Validation**: License validation now runs in the renderer using WebCrypto, with Node fallback for CLI/scripts, removing the browser `crypto` externalization error.

## [0.10.3] - 2025-12-09

### Added

- **Opt-in Pro Trial Trigger**: Trial now starts only when the user opts in after attempting a Pro feature, preventing silent trial burn.
- **Pro Badges & Gating**: Added subtle PRO badges to Pro-only actions (including context menu A1111 actions and comparison) with tooltip cues when locked.
- **Persistent Status Indicator**: Header now shows Free / Pro Trial / Pro License / Expired with color cues and click-through to license settings.
- **License Deep-Link**: Header status opens Settings directly to the License section for quicker activation and purchases.

### Changed

- **Trial Reset for 0.10.x Users**: One-time migration resets previously auto-started trials to Free; users can start a fresh 7-day trial.

### Fixed

- **Thumbnail Flashing During Indexing**: Batching cached image inserts and debouncing filter updates to stop rapid re-renders while keeping the grid usable mid-indexing (notably improves Linux/AppImage experience).
- **ComfyUI Multiline Prompts**: Extract prompts when `PrimitiveStringMultiline`/`String (Multiline)` feeds `CLIP Text Encode`, so prompts from those workflows show up instead of “(there is no prompt)”.

## [0.10.2] - 2025-12-08

### Fixed

- **Analytics Blank Screen**: Prevented Analytics dashboard crash when metadata contains non-string model/LoRA/scheduler values by normalizing inputs and hardening string truncation.

### Added

- **Generate Variation from ImageCompare Panel**

## [0.10.1] - 2025-12-07

### Added

- **Offline License Activation**: Added support for offline license activation with manual key entry for users without internet access or firewall restrictions
- **Pro Purchase Links**: Added direct links to purchase Pro licenses in the header and licensing interface for easier access

### Fixed

- **Refresh Performance**: Fixed folder refresh to reuse Phase A catalog data, significantly improving refresh speed by skipping redundant file system scans

## [0.10.0] - 2025-12-04

### Added

- **A1111 Image Generation Integration**: Revolutionary new feature that enables direct image generation from Image MetaHub using Automatic1111 API:
  - "Generate Variation" button in ImageModal and ImagePreviewSidebar
  - Full-featured generation modal with editable prompts, negative prompts, CFG Scale, Steps, and Seed control
  - Support for both fixed and random seed generation
  - Real-time generation status feedback and progress tracking
  - Seamless workflow: browse images → customize parameters → generate variations directly within the app
  - Transforms Image MetaHub from a viewer/organizer into a complete AI image generation workflow tool
  - Real-time progress tracking in footer with polling of A1111's `/sdapi/v1/progress` endpoint every 500ms for live updates
  - Shows total batch progress (e.g., "2/3" for batch generations, "67%" for single images)
  - Green-themed progress indicator distinct from blue enrichment progress
  - Automatically clears 2 seconds after generation completes
  - Progress bar persistent across all app navigation
  - Resizable prompt fields: Generate Variation modal prompt textareas support vertical resizing by dragging the bottom-right corner for better handling of long prompts

- **Tags System**: Comprehensive tagging system for organizing and filtering images:
  - Add custom tags to images with lowercase normalization to prevent duplicates
  - Tag filtering with OR logic (matches ANY selected tag) consistent with model/LoRA filters
  - Tag autocomplete showing top 5 existing tags when typing in ImageModal
  - Tag search input (appears when folder has > 5 tags) to quickly find specific tags
  - Visual tag display on image cards (shows first 2 tags + counter for remaining)
  - Full tag management in ImageModal with add/remove capabilities
  - Bulk tag operations for adding/removing tags from multiple images at once
  - Tag counts showing number of images per tag in current folder
  - Selected tags counter with clear button to reset all tag filters

- **Favorites System**: Mark and filter favorite images with star icons:
  - Star button on image cards (visible on hover, always visible when favorited)
  - "Show Favorites Only" filter toggle in sidebar
  - Favorite count badge showing number of favorites in current folder
  - Yellow star icon with fill state for visual feedback
  - Bulk favorite operations for marking multiple images at once
  - Persistent favorite status across folder reloads

- **Side-by-Side Image Comparison**: Professional comparison tool for analyzing image quality differences:
  - Compare 2 images side-by-side with synchronized zoom and pan controls
  - Three entry points: Footer button (when 2+ images selected), Context menu ("Select for Comparison"), ImageModal ("Add to Compare")
  - Synchronized zoom with toggle control (press `S` to enable/disable sync)
  - Collapsible metadata panels that expand/collapse together for both images
  - Full-screen modal with responsive layout (side-by-side on desktop, stacked on mobile)
  - Keyboard shortcuts: `Escape` to close, `S` to toggle sync, `Space` to swap images
  - Visual indicator shows "Compare #1" badge when first image is selected via context menu
  - Built with `react-zoom-pan-pinch` for smooth zoom/pan gestures including mobile pinch-to-zoom
  - Perfect for comparing upscalers, checkpoints, samplers, or generation parameters

- **Enhanced Image Selection**: Multiple intuitive ways to select images without keyboard modifiers:
  - Clickable checkbox in top-left corner of each image (appears on hover, always visible when selected)
  - Drag-to-select: Click and drag on empty grid area to draw a selection box
  - Selection box shows semi-transparent blue overlay with all intersecting images selected
  - Shift+Drag to add to existing selection instead of replacing it
  - Maintains existing Ctrl+Click and Shift+Click selection methods
  - Visual feedback with blue checkmark icon when images are selected

- **Smart Conditional Rendering**: Tags & Favorites sidebar section only appears when current folder contains tagged or favorited images, keeping UI clean and relevant

- **IndexedDB Persistence**: Upgraded IndexedDB to v2 with new `imageAnnotations` store:
  - Separate storage for user annotations (favorites, tags) independent of metadata
  - Multi-entry index on tags for efficient tag-based queries
  - Index on `isFavorite` for fast favorite filtering
  - Auto-load annotations on app startup
  - Denormalization pattern: annotations stored separately but copied to `IndexedImage` for optimal read performance

- **Multiple Themes & Light Mode**: Comprehensive theming system with multiple color schemes:
  - Light mode for bright environments with optimized contrast and readability
  - Multiple dark themes including the original dark theme and alternative dark variants
  - Theme switcher in settings for easy switching between themes
  - Persistent theme preference stored locally
  - All UI components adapted to support multiple themes seamlessly

### Technical Improvements

- Created `services/imageAnnotationsStorage.ts` following established storage patterns from `folderSelectionStorage.ts`
- Enhanced `useImageStore` with annotations state management and filtering integration
- Implemented `applyAnnotationsToImages()` helper to ensure annotations persist across image state updates
- Added batch operations (`bulkSaveAnnotations`, `bulkToggleFavorite`, `bulkAddTag`, `bulkRemoveTag`) for performance
- Integrated favorites and tags filters into existing `filterAndSort()` pipeline
- Used `React.useMemo` for tag counting optimization in `TagsAndFavorites` component
- Maintained backward compatibility with existing IndexedDB v1 folderSelection store

## [0.9.6-rc] - 2025-11-29

### Fixed

- **Critical Search Crash**: Fixed application crash when searching with multiple folders due to non-string values in models/loras arrays. Added comprehensive type guards in search, filter, and enrichment logic to handle all edge cases robustly.
- **LoRA Categorization (Issue #45)**: Fixed LoRAs appearing incorrectly in the Models dropdown filter. InvokeAI parser now properly excludes LoRA fields during model detection, ensuring clean separation between Models and LoRAs.
- **Image Flickering During Indexing**: Fixed images reloading/flickering when viewing in modal during Phase B metadata enrichment. Implemented `React.memo` with custom prop comparator and memoized callbacks to prevent unnecessary component re-renders when other images are being indexed.
- **Cache Reset Crash**: Fixed blank screen with `ERR_CACHE_READ_FAILURE` after clearing cache. Now performs complete app restart using `app.relaunch()` instead of `window.reload()`, ensuring clean state recovery.
- **Console Warnings**: Fixed excessive PNG debug console messages and maximum update depth warning in `useImageStore`.
- **Thumbnail Performance**: Fixed slow thumbnail loading and misaligned header items during indexing.
- **Pagination Input**: Fixed pagination input field not responding to Enter key press.

### Added

- **Copy Prompt Button**: Added quick copy prompt button to image grid for faster workflow copying.
- **Copy Seed Button**: Added hover-activated copy button to Seed field in ImageModal for quick seed copying.
- **Open Cache Directory**: New option in Settings to open cache directory in system file explorer for manual cache inspection.
- **Analytics Dashboard Redesign**:
  - Vertical bar charts for Models, LoRAs, and Samplers with angled labels for better readability
  - Resolution distribution with side-by-side pie chart and percentage list with color indicators
  - Mobile-responsive design with stacked charts on small screens
- **Filenames in Grid**: New option in display settings to show filenames below thumbnails in grid view.
- **Cache Reset Functionality**: Comprehensive cache and storage reset tool that clears:
  - Electron disk caches (metadata, thumbnails)
  - IndexedDB databases
  - `localStorage` and `sessionStorage`
  - Zustand store state and persistence  
    Now triggers complete app restart for clean recovery.
- **ComfyUI Parser Enhancements**:
  - Added support for SDXL Loader and Unpacker nodes
  - Parser now skips muted nodes in terminal node search
  - Improved LoRA stack widget handling

### Improved

- **Simplified Search**: Removed search field dropdown – search now always queries across all fields (prompt, model, LoRA, seed, settings) by default. Search bar now occupies full sidebar width for better UX.
- **Case-Insensitive Sorting**: All filter dropdowns now sort naturally (alfa → Amarelo → Azul) regardless of case.
- **Phase B Progress Visibility**: Enhanced Phase B progress bar display with throttled updates (1000ms) and 2-second visibility after completion.
- **Indexing Concurrency**: Increased default Phase B concurrency from 4–8 to 8 workers with configurable maximum of 16 (previously 8) for faster metadata enrichment.
- **Fullscreen Handling**: Refactored fullscreen toggle functionality in ImageModal for better Electron integration and streamlined event listeners.

### Changed

- **Dependencies Cleanup**: Removed unused dependencies (`cbor-web`, `react-masonry-css`, `cross-env`, `react-virtualized`) reducing bundle size.

## [0.9.5] - 2025-11-08

### Added

- **Configurable Indexing Concurrency**: Added "Parallel workers" control in Settings to allow users to tune metadata enrichment throughput. Auto-detects optimal default based on CPU cores (up to 8, configurable to 16).
- **Refined Folder Tree**: Implemented tri-state folder checkboxes with inherited selection rules, making it easy to combine root folders with individual subfolders.
- **Persistent Folder Visibility**: Folder inclusion state now survives restarts through IndexedDB-backed storage, ensuring directory preferences stick between sessions.
- **Updated Branding**: Replaced the stock assets with the new `logo1.svg` splash illustration and matching application icon for Windows builds.

### Changed

- **Default Subfolder Scanning**: Recursive scanning is now enabled by default and enforced on first-run to provide a complete library immediately.
- **Simplified Folder Selector**: Removed the initial "Scan Subfolders" toggle—subfolder indexing is always on and folder visibility is now managed directly from the sidebar tree.
- **Unified Version Display**: Updated all visible version strings (header, welcome screen, Electron window title, CLI, and status bar) to `0.9.5`.

### Fixed

- Resolved folder selection inconsistencies that hid images when expanding directories by introducing tri-state hierarchy rules and persistent IndexedDB-backed folder selection state.
- Addressed directory selection regressions where newly expanded subfolders could hide their images until the view was refreshed.

### Performance Improvements

- **Optimized Indexing Phase B**:
  - Propagated file size, type, and birthtime details from Electron's directory listing through the entire indexing pipeline to eliminate per-file IPC calls for stat information during enrichment phase.
  - Increased enrichment batch size from 128 to 256 to reduce cache flushes while maintaining UI responsiveness.
  - Skip unnecessary Easy Diffusion sidecar reads when metadata is already detected from PNG chunks.
  - Muted verbose debug logs (`[PNG DEBUG]`, `[FILE DEBUG]`, `[SwarmUI DEBUG]`) in production builds to reduce console overhead.
  - These optimizations reduce Phase B overhead without affecting processing logic or making phase B optional.

## [0.9.4] - 2025-10-20

### Fixed

- **CRITICAL Linux Bug**: Fixed images not displaying on Linux systems when selecting root + subfolders. The issue was caused by hardcoded Windows path separators (`\`) that didn't match Linux paths (`/`). Now automatically detects and uses the correct path separator for each platform.
- **Auto-marking Aggressive Behavior**: Fixed subfolders being re-marked automatically every time the folder was expanded. Auto-marking now only happens once (first time the folder is loaded).

### Added

- **Select All / Clear Buttons**: Added bulk selection buttons for subfolders, making it easier to manage large directory trees.

### Improved

- **Compact UI**: Reduced vertical padding on status and action toolbars for better space utilization. (Thanks to [Taruvi](https://github.com/Taruvi) for the suggestion)
- **Integrated Status Display**: Moved image count display into the action toolbar to reduce vertical space usage and improve information density.

### Changed

- **Version Display**: Updated version number to 0.9.4 across all UI elements (Header, Window Title, About dialog).

## [0.9.3] - 2025-10-19

### Fixed

- **Critical Bug**: Fixed images not displaying when multiple folders/subfolders were selected. The filtering logic was too restrictive and failed to aggregate images from all selected directories.
- **Sidebar Scroll Issue**: Fixed DirectoryList occupying entire sidebar height when many subfolders were expanded, making filters inaccessible. DirectoryList now shares the sidebar's unified scroll with filters.

### Improved

- **Consistent UI Design**: DirectoryList now follows the same collapsible design pattern as filter sections (Models, LoRAs, Schedulers) with expand/collapse button and item counter.
- **Better Navigation**: Single unified scrollbar for the entire sidebar improves navigation between folders and filters.

## [0.9.2] - 2025-10-19

### Features

- **Redesigned User Interface**: The application has been rebuilt for a more modern, performant, and intuitive experience. The image grid is now faster and more stable, even with tens of thousands of images.
- **Advanced Metadata Filters**: Filter your images with precision. New filters include:
  - **CFG Scale**
  - **Steps**
  - **Image Dimensions** (width and height)
  - **Creation Date**
- **Indexing Control**: Added ability to use application during indexing, pause indexing operations, and cancel indexing processes.
- **Expanded AI Platform Support**: Added metadata parsers for a wide range of new tools:
  - Fooocus
  - SwarmUI
  - Midjourney
  - SD.Next
  - Forge
  - Niji Journey
  - Draw Things
- **Hotkeys and Productivity**: A comprehensive hotkey system has been implemented for power users. Right-click context menus are now available in the image grid, providing quick access to common actions.
- **Subfolder Scanning Control**: You can now toggle whether the application scans through subdirectories, giving you more control over which images are displayed.
- **List View Mode**: Added a new table/list view mode for browsing images, in addition to the standard grid view.
- **"What's New" Changelog**: A changelog modal now appears on the first startup after an update so you can easily see what's new.

### Fixes

- **Improved Performance**: Replaced the image grid rendering engine to fix numerous layout bugs and dramatically improve scrolling performance and stability, especially with large image collections.
- **Filter Persistence**: Fixed an issue where sidebar filters would disappear during a folder refresh.
- **UI Polish**: Corrected various UI issues, including context menus not closing properly.
- **Full Screen**: Fixed full screen mode to properly use the entire screen instead of being limited to the application window.

### Technical Improvements

- Migrated testing framework to Vitest for more robust unit testing.
- Implemented ESLint for improved code quality and consistency.
- Significantly enhanced the ComfyUI parser for more reliable and comprehensive metadata extraction.
- Refactored the parser architecture to be more modular and easily extensible.

## [0.9.1] - 2025-10-08

### Added

- **Right Sidebar Image Preview**: New collapsible sidebar that displays image preview and metadata when hovering over thumbnails in the grid
- **Enhanced Cache Management**: Added "Clear All Cache" button in Settings modal with confirmation dialog and automatic state reset
- **Improved ComfyUI Support**: Enhanced grouped workflow parsing with proper widget value extraction and custom node extractors

### Fixed

- **ComfyUI NaN Parsing**: Fixed "Unexpected token 'N', ...\"changed\": NaN..." JSON parsing errors for ComfyUI workflows with invalid numeric values
- **Cache Clearing**: Fixed cache clearing functionality to properly reset application state and reload the page
- **Grouped Workflows**: Fixed parsing of ComfyUI grouped workflow nodes (e.g., "workflow>Load Model - Flux") by using prompt.inputs data directly
- **Stack Overflow Fix**: Prevented infinite recursion in ImageModal when directory path is undefined
- **CLI Directory Loading**: Fixed command-line directory loading to properly initialize Directory objects

### Changed

- **Version Numbering**: Reset version to 0.9.x series, indicating pre-1.0 beta status

### Technical Improvements

- Enhanced ComfyUI traversal engine with better link following and custom extractors for complex nodes (ttN concat, CFGGuider)
- Improved error handling and validation in ImageModal to prevent crashes
- Better state management and cleanup for orphaned image references

## [1.9.0] - 2025-10-03

### Added

- Multiple Directory Support: Add and manage multiple image directories simultaneously
- New Settings Modal: Configure cache location and automatic update preferences
- Resizable Image Grid: Adjustable thumbnail sizes for better display on high-resolution screens
- Command-Line Directory Support: Specify startup directory via command-line arguments
- Exposed Development Server: Access dev server from local network devices

### Fixed

- Cross-platform path construction issues resolved
- Improved file operations reliability
- Fixed cached image loading problems

## [1.8.1] - 2025-09-30

### Added

- **Subfolder Scanning Control**: Added configurable subfolder scanning with checkbox in folder selector and toggle in header, allowing users to choose whether to scan subdirectories or limit to selected folder only

## [1.8.0] - 2025-09-30

### Major Architectural Changes

- **Complete Application Refactoring**: Migrated from monolithic App.tsx to modular architecture with Zustand state management, custom hooks, and component modularization for improved maintainability and LLM-friendliness
- **Parser Modularization**: Split monolithic fileIndexer.ts into modular parsers (InvokeAI, A1111, ComfyUI) with factory pattern for automatic format detection
- **State Management Migration**: All component state migrated to centralized Zustand store (useImageStore.ts) for better predictability and debugging

### New Features

- **Automatic1111 Support**: Full PNG and JPEG metadata parsing with model, LoRA, and generation parameter extraction
- **ComfyUI Support (Partial)**: Workflow detection and basic metadata parsing for ComfyUI-generated images
- **JPEG File Support**: Added support for .jpg/.jpeg files with EXIF metadata extraction using exifr library
- **Advanced Filters**: Range filters for Steps, CFG Scale, Dimensions, and Date with real-time UI updates
- **Right-Click Context Menu**: Copy Prompt, Copy Negative Prompt, Copy Seed, Copy Model options in ImageModal
- **Copy to Clipboard**: Copy actual image files to clipboard for use in other applications
- **File Operations**: "Show in Folder" and "Export Image" functionality with proper cross-platform path handling
- **Multi-Format Support**: Unified filtering system working seamlessly across InvokeAI, A1111, and ComfyUI formats

### Performance Improvements

- **🚀 Record Performance**: Successfully indexed 18,000 images in 3.5 minutes (~85 images/second)
- **Async Pool Concurrency**: 10 simultaneous file operations with memory safety controls
- **Throttled Progress Updates**: UI updates at 5Hz (200ms intervals) to prevent interface freezing
- **Optimized File Processing**: Eliminated duplicate file processing and improved batch reading
- **Memory Management**: File handles instead of blob storage for better memory efficiency

### Technical Improvements

- **Enhanced Metadata Parsing**: Intelligent detection prioritizing ComfyUI workflow > InvokeAI metadata > A1111 parameters
- **Cross-Platform Compatibility**: Improved Electron/browser environment detection and path handling
- **Date Sorting Accuracy**: Uses file creation date (birthtime) instead of modification date for AI-generated images
- **Error Handling**: Comprehensive error handling for malformed metadata and file system operations
- **Console Optimization**: Cleaned up excessive logging for better performance and debugging experience

### Fixed

- **Cache Collision Bug**: Fixed cache system incorrectly treating folders with same names as identical entries, causing unnecessary re-indexing when switching between different folders with similar names
- **Refresh Re-indexing Bug**: Fixed refresh functionality re-indexing entire folders instead of only changed files due to timestamp inconsistency between initial indexing (creation time) and refresh (modification time)
- **Show in Folder Button**: Fixed "Show in Folder" button in image modal interface that was failing due to incorrect async handling and parameter passing
- **Advanced Filters Bug**: Fixed disconnected state between App.tsx and useImageStore preventing filter application
- **Filter Data Extraction**: Corrected sidebar reading from raw metadata instead of normalized IndexedImage properties
- **Range Filter Logic**: Fixed images with undefined steps/cfg being incorrectly included in range filters
- **Export Functionality**: Fixed images being exported to source folder instead of selected destination
- **Image Duplication**: Resolved critical bug causing double processing of files (36k instead of 18k images)
- **Syntax Errors**: Fixed critical syntax errors in electron.mjs preventing app startup
- **Format Detection**: Fixed ComfyUI images with A1111 parameters being incorrectly detected as A1111 format
- **Model Filter Issues**: Enhanced InvokeAI model extraction to work across multiple field names and formats

### Dependencies Updated

- **Tailwind CSS v4**: Updated PostCSS configuration and styling system
- **Zustand v5**: Migrated to latest version with improved TypeScript support
- **exifr Library**: Added for professional JPEG EXIF metadata extraction

## [1.7.6] - 2025-09-28

### Fixed

- **Critical Performance Issue**: Eliminated console logging spam that was generating 40,000+ messages and severely impacting UI responsiveness
- **Image Duplication Bug**: Fixed critical bug where processDirectory was calling getFileHandlesRecursive redundantly, causing 36,884 images to be processed instead of the actual 18,452 files
- **Syntax Errors**: Resolved critical syntax errors in electron.mjs that were preventing the application from starting
- **File Processing**: Corrected image counting logic to prevent double-processing of files

### Technical Improvements

- **Automated Release Workflow**: Added complete automated release system with multi-platform builds (Windows, macOS, Linux)
- **GitHub Actions**: Enhanced CI/CD pipeline for automatic installer generation and release publishing
- **Error Handling**: Improved error handling in file operations and metadata extraction
- **Performance Optimization**: Reduced memory usage and improved startup time

## [1.7.5] - 2025-09-28

### Added

- **Automatic1111 Integration**: Parse PNG metadata from Automatic1111's "parameters" chunk with model, LoRA, and generation parameter extraction
- **Universal Metadata Parser**: Intelligent detection and parsing of different metadata formats based on PNG chunk keywords
- **Enhanced Model Filtering**: Improved model extraction and filtering that works across all supported AI image generation tools
- **Structured Metadata Display**: Redesigned ImageModal with organized fields for Models, LoRAs, Scheduler, Prompt, CFG Scale, Steps, Seed, and Dimensions
- **Export Functionality**: Added TXT and JSON export options for metadata with proper formatting
- **Context Menu**: Right-click image context menu for copy operations and file actions
- **Navigation Controls**: Keyboard shortcuts and UI controls for image navigation (arrow keys, fullscreen mode)
- **Improved File Operations**: Fixed "Show in Folder" functionality to use correct file paths instead of UUIDs

### Technical Improvements

- **Type-Safe Metadata Handling**: New TypeScript interfaces for Automatic1111Metadata and ComfyUIMetadata with proper type guards
- **Dynamic Metadata Extraction**: Re-extraction of models, LoRAs, and schedulers during cache reconstruction for data consistency
- **Backward Compatibility**: Maintained full compatibility with existing InvokeAI metadata and caching system
- **Cross-Format Filtering**: Unified filtering system that works seamlessly with images from different generation tools
- **Workflow Automation**: Improved GitHub Actions workflows with separate jobs for Windows, macOS, and Linux builds
- **Build System Optimization**: Cleaned up duplicate workflow configurations and ensured proper artifact generation

### Fixed

- **Model Filter Issues**: Resolved problem where InvokeAI model filters weren't working due to cache reconstruction using stale metadata
- **Cache Data Consistency**: Fixed cache loading to dynamically re-extract metadata fields instead of using potentially outdated cached values
- **File Path Handling**: Fixed "Show in Folder" and "Copy File Path" to use actual filenames instead of internal UUIDs
- **TypeScript Errors**: Added missing ImageModalProps interface definition
- **Workflow Conflicts**: Removed duplicate macOS and Linux build jobs from main workflow to prevent conflicts
- **UI Regression**: Restored enhanced ImageModal design with structured metadata fields and export functionality

## [1.7.4] - 2025-09-24

## [1.7.4] - 2025-09-24

### Fixed

- **Critical macOS Electron Bug**: Fixed "zero images found" issue on macOS by implementing robust Electron detection and cross-platform path joining
- **IPC Handler Bug**: Fixed critical bug where `listDirectoryFiles` handler wasn't returning success object, causing "Cannot read properties of undefined" errors
- **Excessive Console Logging**: Reduced thousands of repetitive "reading file" messages to essential diagnostic logs only
- **Cross-Platform Path Handling**: Fixed Windows-style path joining (`\`) that broke file access on macOS and Linux

### Added

- **macOS Auto-Updater Configuration**: Added proper entitlements, hardened runtime, and platform-specific error handling for macOS auto-updates
- **Robust Error Handling**: Enhanced validation in frontend to prevent crashes when IPC calls fail
- **Cross-Platform Build Verification**: Comprehensive testing and validation of build configuration for Windows, macOS, and Linux

### Technical Improvements

- **Electron Detection**: More robust detection using multiple checks (`window.electronAPI` + method existence)
- **Path Joining**: Cross-platform compatible path construction using `/` separator
- **Build System**: Verified and corrected electron-builder configuration for all 3 platforms
- **Code Quality**: Improved error handling and validation throughout the application

### Platforms

- **Windows**: NSIS installer with desktop/start menu shortcuts
- **macOS**: DMG packages for Intel and Apple Silicon with proper entitlements
- **Linux**: AppImage for portable distribution

## [1.7.3] - 2025-09-23

### Added

- **Click-to-Edit Pagination**: Click any page number to jump directly to that page for instant navigation
- **Smart Cache Cleanup**: Automatic removal of stale cache entries without full reindexing for faster refresh operations
- **Enhanced Refresh Folder**: Improved incremental indexing that detects new images reliably without performance degradation

### UI Improvements

- **Modern Pagination UI**: Redesigned pagination controls with better error feedback, accessibility, and user experience
- **Complete README Overhaul**: Restructured documentation to emphasize offline-first desktop application with clearer feature organization
- **Streamlined Installation**: Simplified installation instructions focusing on desktop app usage

### Technical Improvements

- **Intelligent Cache Management**: Smart cleanup system that preserves valid cache while removing stale entries for deleted files
- **Consistent PNG Filtering**: Standardized filtering logic across all file detection operations to prevent refresh issues
- **Enhanced User Experience**: Improved navigation and feedback throughout the application

### Fixed

- **Refresh Folder Reliability**: Fixed inconsistent behavior where new images weren't appearing after folder refresh
- **Cache Stale Entry Handling**: Resolved issues with cache containing references to deleted files causing performance problems

## [1.7.2] - 2025-09-23

### Fixed

- **Refresh Folder Bug**: Fixed critical issue where clicking "Refresh Folder" would return 0 results on first click due to stale cache data
- **Cache Validation**: Improved cache validation logic to detect when cached data doesn't match current folder contents
- **Cache Fallback**: Added automatic fallback to full reindexing when cache reconstruction fails but PNG files exist

### Technical Improvements

- Enhanced cache management to prevent showing empty results when folder contents change
- Improved error handling for cache reconstruction failures
- Better user feedback during folder refresh operations
- Optimized refresh logic to use incremental updates when possible instead of full reindexing

## [1.7.1] - 2025-09-20

### Added

- **Fullscreen Viewing**: Added fullscreen functionality to ImageModal with dedicated button, ESC key support, and hover controls
- **Refresh Folder**: Added incremental indexing capability with "Update" button for processing only new images without re-indexing entire collections
- **Enhanced Image Viewing**: Improved image viewing experience with fullscreen mode and clean UI controls

### Technical

- Implemented fullscreen state management in ImageModal component
- Added keyboard event handling for ESC key to exit fullscreen
- Enhanced UI with hover-based controls for better user experience
- Added handleUpdateIndexing function for incremental image processing
- Maintained responsive layout and sidebar visibility in fullscreen mode
- Preserved existing filters and pagination state during incremental updates

## [1.7.0] - 2025-09-20

### Fixed

- **Performance Issue**: Fixed infinite console logging loop that was generating thousands of log entries during file discovery
- **Electron Detection**: Corrected Electron environment detection in `getAllFileHandles` function to properly use Electron APIs instead of browser APIs
- **Caching System**: Added caching mechanism to prevent repeated file discovery calls and improve performance

### Technical

- Enhanced file discovery performance with useRef-based caching
- Reduced excessive console logging in file reading operations
- Improved Electron API detection and usage patterns
- Maintained backward compatibility with browser File System Access API

## [1.6.1] - 2025-09-19

### Added

- **Privacy-First Auto-Updates**: Enhanced auto-updater with user choice controls and manual update checks
- **User Control**: Better update notifications with skip options and user preferences

### Fixed

- **Electron Compatibility**: Fixed "UnknownError: Internal error" when selecting directories in Electron app
- **Cross-Platform File Access**: Implemented proper file system handling for both browser and desktop environments
- **IPC Communication**: Added missing preload.js functions for directory listing and file reading

### Technical

- Enhanced Electron environment detection in `getAllFileHandles` function
- Added `listDirectoryFiles` and `readFile` IPC handlers
- Improved error handling for file system operations
- Maintained backward compatibility with browser File System Access API

## [1.6.0] - 2025-09-19

### Added

- **Enhanced Auto-Updater**: Manual update check functionality with user prompts
- **Show in Folder**: Added ability to show selected images in system file explorer
- **File Explorer Integration**: Cross-platform file explorer opening functionality

### Technical

- Integrated `showItemInFolder` functionality in Electron
- Enhanced UI integration for file operations
- Improved user experience for file management

## [1.5.3] - 2025-09-18

### Added

- **Advanced Filtering**: Steps range slider for precise filtering by inference steps
- **Range Filtering**: CFG Scale and Steps range filtering components
- **Enhanced Filtering UI**: Improved filtering interface with range controls

### Fixed

- **Documentation**: Clarified privacy policies and removed duplicate content in README
- **Board Filtering**: Removed unreliable board filtering due to inconsistent metadata

### Technical

- Implemented `StepsRangeSlider` component for advanced filtering
- Enhanced filtering system with range-based controls
- Improved documentation clarity and organization

## [1.5.2] - 2025-09-17

### Added

- **Board Filtering**: Added filtering by board/workspace information
- **Navigation Controls**: Enhanced image navigation and browsing controls

### Fixed

- **Board Metadata**: Removed board filtering due to unreliable metadata availability
- **Package Dependencies**: Updated and cleaned up package dependencies

### Technical

- Enhanced image browsing functionality
- Improved metadata handling for board information
- Updated dependency management

## [1.5.1] - 2025-09-17

### Added

- **File System Access API**: Enhanced browser compatibility with File System Access API
- **Electron Integration**: Improved Electron app integration and scripts
- **Scheduler Filtering**: Added scheduler type filtering (DPMSolverMultistepScheduler, etc.)
- **Metadata Export**: TXT and JSON export functionality for image metadata

### Fixed

- **Selection Behavior**: Fixed image selection and interaction behavior
- **Documentation**: Updated documentation for new features

### Technical

- Enhanced Window interface for File System Access API support
- Updated package.json with new Electron scripts
- Improved metadata extraction and filtering systems
- Enhanced caching mechanisms and LoRA extraction

## [1.5.0] - 2025-09-17

### Added

- **Multi-Selection**: Added Ctrl+click support for selecting multiple images similar to Windows Explorer
- **Bulk Operations**: Added ability to delete multiple selected images at once from the main grid
- **Selection Toolbar**: Added selection counter and bulk action toolbar when images are selected
- **Visual Feedback**: Selected images now show blue ring and checkmark overlay

### UI Improvements

- **Simplified Modal Controls**: Redesigned image modal with cleaner interface
- **Inline File Actions**: Rename and delete buttons now appear as small icons next to filename
- **Export Dropdown**: Combined TXT and JSON export into a single dropdown menu
- **Better Visual Hierarchy**: Improved spacing and visual organization of modal elements
- **Keyboard Navigation**: Enhanced keyboard shortcuts and dropdown interactions

### User Experience

- **Windows-like Selection**: Familiar multi-selection behavior matching Windows file explorer
- **Quick Actions**: Faster access to common file operations with simplified UI
- **Bulk Management**: Efficient handling of multiple images for organization workflows
- **Cleaner Interface**: Reduced visual clutter while maintaining all functionality

## [1.4.0] - 2025-09-17

### Added

- **File Management**: Added rename and delete functionality for image files (Electron app only)
- **Rename Files**: Click rename button in image modal to change filename with validation
- **Delete Files**: Delete images with confirmation dialog, files are moved to system trash/recycle bin
- **File Operations**: Added secure IPC communication between renderer and main process for file operations

### UI Improvements

- Added rename and delete buttons in image detail modal with clear icons and colors
- Rename dialog with inline text input and validation feedback
- Confirmation dialogs for destructive operations
- Disabled state management during operations to prevent conflicts

### Technical

- Created fileOperations service for handling file management
- Enhanced Electron IPC handlers with proper file path resolution
- Added proper error handling and user feedback for file operations
- File operations are desktop-only for security reasons

## [1.3.0] - 2025-09-17

### Added

- **Metadata Export**: Added export buttons in image modal to save metadata as TXT or JSON files
- **TXT Export**: Readable text format with organized sections for models, LoRAs, scheduler, and complete metadata
- **JSON Export**: Structured JSON format with export info, extracted data, and raw metadata

### UI Improvements

- Added export buttons with distinctive icons and colors in image detail modal
- Enhanced modal layout to accommodate new export functionality

## [1.2.0] - 2025-09-17

### Added

- **Scheduler Filtering**: Added new filter option to search images by scheduler type (DPMSolverMultistepScheduler, EulerDiscreteScheduler, etc.)

### UI Improvements

- Added scheduler dropdown filter alongside model and LoRA filters
- Enhanced filter extraction system to parse scheduler metadata from images
- Improved filter layout and accessibility

## [1.1.0] - 2025-09-17

### Added

- **Intelligent Cache System**: Implemented proper incremental cache updates
- **Enhanced LoRA Extraction**: Robust parsing of complex LoRA object structures
- **Performance Optimization**: Subsequent directory loads now take ~10 seconds instead of 3-4 minutes

### Fixed

- **Cache Invalidation Bug**: Cache was being cleared on every directory selection
- **LoRA Filter Broken**: LoRAs were appearing as `[object Object]` instead of readable names
- **Unnecessary Reindexing**: Application now properly detects and processes only new images

### Changed

- **Cache Logic**: Restructured cache validation and update flow
- **Metadata Parsing**: Improved extraction of nested object properties in LoRA metadata
- **Error Handling**: Better validation of extracted metadata values

### Technical Improvements

- Incremental cache updates instead of full reindexing
- Enhanced object property traversal for complex metadata structures
- Optimized file handle management for large collections
- Improved memory efficiency during indexing

### Performance

- **Initial Load**: 3-4 minutes (unchanged)
- **Subsequent Loads**: ~10 seconds (previously 3-4 minutes)
- **New Image Detection**: Only processes new/changed files
- **Memory Usage**: Reduced memory footprint for large collections (17k+ images)

## [1.0.0] - 2025-09-17

### Added

- Initial release
- Local directory browsing with File System Access API
- PNG metadata extraction (InvokeAI format)
- Full-text search across image metadata
- Model and LoRA filtering
- Thumbnail support (WebP thumbnails)
- Responsive grid layout with pagination
- Image modal with detailed metadata view
- Basic caching system with IndexedDB
- Intermediate image filtering

### Features

- React 18 + TypeScript frontend
- Vite build system
- Browser-based file system access
- Client-side metadata parsing
- Responsive design for desktop
