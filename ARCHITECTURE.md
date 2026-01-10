# Architecture Documentation

## Project Overview

**Image MetaHub** is a React + Electron desktop application for browsing large collections of AI generated images. The app focuses on fast indexing, rich metadata filters, and fully local processing so that libraries remain private.

### Current Version
- **Version:** 0.11.1
- **Frontend:** React 18 + TypeScript with Tailwind CSS 3.4
- **Desktop Shell:** Electron 38 with auto-update hooks and CLI entry point
- **State Management:** Zustand stores for both image data and application settings
- **Build Tooling:** Vite 5 for development and bundling, Vitest for unit tests, ESLint 9 for linting

### Release Highlights (v0.9.5)
- Tri-state folder tree with inherited selection rules and bulk actions in `components/DirectoryList.tsx`
- IndexedDB-backed folder visibility persistence via `services/folderSelectionStorage.ts`
- Always-on recursive scanning enforced by the welcome experience in `components/FolderSelector.tsx`
- Updated branding assets (`public/logo1.svg`, `public/icon.ico`) surfaced across the UI and Electron shell

## Runtime Architecture

### UI Layer
- **App Shell (`App.tsx`)** orchestrates data loading, sidebar layout, and modal visibility. It wires store selectors into presentation components and passes directory visibility callbacks into `DirectoryList`.
- **Sidebar (`components/Sidebar.tsx`)** hosts the directory tree, metadata filters, and provides a scroll container shared across both areas.
- **Directory Tree (`components/DirectoryList.tsx`)** renders folders with tri-state checkboxes. Each node lazily requests subfolders through the Electron preload bridge and applies inherited selection state to descendants.
- **Folder Selector (`components/FolderSelector.tsx`)** is shown before any directory is loaded. It enables recursive scanning on mount and introduces the refreshed logo artwork during onboarding.
- **Status surfaces** such as `components/Header.tsx` and `components/StatusBar.tsx` expose the unified `v0.9.5` version information for quick sanity checks.
- **Performance Patterns (v0.10.5)**: Critical components like `ImageCard` and `ImageTableRow` use `React.memo` with custom comparison functions to prevent unnecessary re-renders. Expensive operations like drag-to-select use `requestAnimationFrame` throttling, and filter inputs are debounced (300ms) to reduce computational overhead.

### State Management
- **Image Store (`store/useImageStore.ts`)** keeps the indexed image catalog, filter options, and folder visibility map. A `Map<string, 'checked' | 'unchecked'>` tracks which directories contribute images. Helper utilities normalize paths so the selection logic works across Windows and POSIX separators.
- **Performance Optimizations (v0.10.5)**: Components use granular Zustand selectors (e.g., `useImageStore(state => state.filteredImages)`) instead of mass destructuring to minimize unnecessary re-renders. This pattern reduces re-render cascades by 40-60% when unrelated store state changes.
- **Selection Rules:** `setFolderSelectionState` applies tri-state behaviour. When a folder is unchecked with `applyToDescendants`, the action propagates to every descendant path. Conversely, `clearDescendantOverrides` marks a branch as fully included. `getFolderSelectionState` falls back to treating root folders as included when no explicit preference exists.
- **Persistence:** `initializeFolderSelection` loads stored visibility preferences, while every mutation schedules `saveFolderSelection` so that IndexedDB remains in sync across restarts.
- **Settings Store (`store/useSettingsStore.ts`)** keeps secondary preferences such as image size, view mode, cache location, and auto update toggles.

### Persistence & Local Storage
- **Folder Selection Storage (`services/folderSelectionStorage.ts`)** wraps IndexedDB access with graceful fallbacks. If IndexedDB is unavailable or corrupted the module disables persistence and relies on in-memory storage to avoid blocking the UI.
- **Cache Manager (`services/cacheManager.ts`)** writes indexed metadata and thumbnails to disk for Electron builds. Cache keys incorporate the directory path plus the recursive/flat flag to prevent stale cross-contamination when folder depth preferences change.
- **Local Storage** is used for lightweight preferences (e.g., last known `scanSubfolders` value) to bootstrap Zustand state before IndexedDB hydration finishes.

### Directory Visibility Flow
1. **Onboarding** – `FolderSelector` forces `scanSubfolders` to `true`, ensuring the first indexing pass includes every nested folder.
2. **Initialization** – `initializeFolderSelection` hydrates the folder-selection map before images are filtered so that visibility settings apply immediately when directories load.
3. **Interaction** – `DirectoryList` renders each root directory and its lazily loaded descendants. The `FolderCheckbox` component computes the partial state by inspecting descendant selections and sets the HTML `indeterminate` flag for tri-state visuals.
4. **Persistence** – Calling `setFolderSelectionState` updates the in-memory map, re-filters images, and saves the map through `saveFolderSelection`.

### File Indexing Pipeline
- **Discovery (`services/fileIndexer.ts`)** walks directories either recursively or flat based on the `scanSubfolders` flag. It extracts metadata through parser modules that understand InvokeAI, Automatic1111, ComfyUI, DreamStudio, Fooocus, SD.Next, SwarmUI, Midjourney, Draw Things, and more.
- **Caching (`services/cacheManager.ts`)** persists intermediate results so subsequent launches only process new or changed files.
- **Enrichment (`hooks/useImageLoader.ts`)** coordinates indexing jobs, respects user-controlled concurrency, and updates progress indicators exposed through `useImageStore`.

### ComfyUI Parser Architecture (Recent Refactoring)
The ComfyUI parser (`services/parsers/comfyui/`) underwent major architectural improvements to separate data extraction from presentation logic:

**Core Components:**
- **traversalEngine.ts**: Graph traversal with generic accumulation system
  - `resolveFacts()`: Returns type-safe `WorkflowFacts` object with structured metadata
  - `checkIfParamNeedsAccumulation()`: Generic accumulation detection based on `accumulate: boolean` flag
  - Replaced hardcoded LoRA collection with declarative parameter rules
- **nodeRegistry.ts**: Declarative node definitions with enhanced parameter mapping
  - `WorkflowFacts` interface: Structured type for prompts, model, loras, sampling params, dimensions
  - `accumulate` flag: Mark parameters for multi-node collection (e.g., LoRAs)
- **extractors.ts**: Reusable extraction functions
  - `concatTextExtractor`, `extractLorasFromText`, `removeLoraTagsFromText`, `cleanWildcardText`, `extractLorasFromStack`, `getWildcardOrPopulatedText`
  - Reduces code duplication by 80-90% across node definitions (ttN concat: 45→5 lines, CR LoRA Stack: 40→3 lines)

**Benefits:**
- Type-safe metadata access with autocomplete and compile-time checks
- Easier addition of new nodes (just mark `accumulate: true` in registry)
- Better testability with structured outputs
- Reduced technical debt through reusable extraction patterns

### Desktop Integration
- **Electron Main Process (`electron.mjs`)** configures the BrowserWindow title (`Image MetaHub v0.9.5`), wires IPC handlers for file operations, and manages auto-update prompts.
- **Preload Bridge (`preload.js`)** exposes a sandboxed `electronAPI` with directory listing, file stats, and shell helpers used by the directory tree.
- **CLI (`cli.ts`)** provides command-line indexing utilities with the same version stamp (`0.9.5-rc`) displayed in the desktop UI.

### A1111 Integration
The application provides bidirectional workflow with Automatic1111 WebUI, enabling users to send image metadata back to A1111 for editing or quick regeneration.

**Architecture:**
- **API Client (`services/a1111ApiClient.ts`)** handles REST communication with A1111's `/sdapi/v1` endpoints (options, samplers, txt2img)
- **Formatter (`utils/a1111Formatter.ts`)** converts normalized metadata to A1111's three-line format compatible with "Read generation parameters" feature
- **React Hooks** provide two workflows:
  - `useCopyToA1111.ts`: Clipboard-based workflow for manual editing
  - `useGenerateWithA1111.ts`: Direct API generation (always autoStart)

**UI Surface:**
- Split button in `ImagePreviewSidebar.tsx` and `ImageModal.tsx` (Copy primary, Generate in dropdown)
- Context menu items in `ImageGrid.tsx` via `useContextMenu.ts`
- Settings panel in `SettingsModal.tsx` for server URL configuration and connection testing

**Configuration:**
- Settings stored in `useSettingsStore.ts`: server URL (default: `http://127.0.0.1:7860`), connection status
- User must launch A1111 with `--api` and `--cors-allow-origins` flags
- 3-minute timeout for generation requests to accommodate slower models

### Project Structure
```
.
├── App.tsx
├── components/
│   ├── DirectoryList.tsx
│   ├── FolderSelector.tsx
│   ├── Header.tsx
│   ├── Sidebar.tsx
│   └── ...
├── hooks/
│   ├── useImageLoader.ts
│   ├── useHotkeys.ts
│   └── ...
├── services/
│   ├── cacheManager.ts
│   ├── fileIndexer.ts
│   ├── folderSelectionStorage.ts
│   └── parsers/
├── store/
│   ├── useImageStore.ts
│   └── useSettingsStore.ts
├── public/
│   ├── logo1.svg
│   └── icon.ico
└── ...
```

### Testing & Tooling
- **Vitest** powers unit tests for the parser suite and utility layers.
- **ESLint** enforces consistent code style, especially across the large parser surface.
- **Pre-release scripts** (`generate-release.js`, `auto-release.js`, etc.) automate changelog syncing and release packaging.

## Version Update Guide

When updating the application version, the following files must be updated to ensure consistency across all components:

### Required Version Updates

1. **package.json** (line 6)
   - Update the `"version"` field to the new version number
   - This is the canonical version used by Electron's `app.getVersion()`

2. **components/Header.tsx** (around line 67)
   - Update the header title: `Image MetaHub v{VERSION}`
   - This displays in the main application header

3. **components/StatusBar.tsx** (around line 24)
   - Update the status bar version: `v{VERSION}`
   - Appears in the footer status bar

4. **components/FolderSelector.tsx** (around lines 20-21)
   - Update welcome screen title: `Welcome to Image MetaHub v{VERSION}`
   - Update version display: `v{VERSION}`

5. **index.html** (line 10)
   - Update page title: `<title>Image MetaHub v{VERSION}</title>`

6. **electron.mjs** (around lines 520 and 1230-1231)
   - Update window title fallback: `Image MetaHub v{VERSION}`
   - Update mockUpdateInfo version and release notes header

7. **cli.ts** (around line 15)
   - Update CLI version: `.version('{VERSION}')`

8. **CHANGELOG.md**
   - Add or update the version section header: `## [{VERSION}] - YYYY-MM-DD`
   - Document all changes in appropriate sections (Added, Changed, Fixed, etc.)

9. **components/ChangelogModal.tsx** (around lines 129-131)
   - Update "Message from the Dev" section with new version number
   - Update description text to reflect changes in the new version

10. **public/CHANGELOG.md**
    - Synchronize with main CHANGELOG.md using: `cp CHANGELOG.md public/CHANGELOG.md`
    - This file is used by the build process and GitHub releases

11. **ARCHITECTURE.md** (line 8)
    - Update "Current Version" section to reflect new version

### Version Update Checklist

- [ ] Update package.json version
- [ ] Update all UI component version displays (Header, StatusBar, FolderSelector)
- [ ] Update index.html page title
- [ ] Update electron.mjs window title and mock update info
- [ ] Update cli.ts version
- [ ] Update or add CHANGELOG.md section for new version
- [ ] Update ChangelogModal.tsx message from dev
- [ ] Synchronize public/CHANGELOG.md
- [ ] Update ARCHITECTURE.md current version
- [ ] Verify all changes with search: `grep -r "OLD_VERSION" .`

### Automated Search Command

To find all occurrences of a version number:
```bash
grep -r "0\.10\.5" . --include="*.ts" --include="*.tsx" --include="*.html" --include="*.json" --include="*.md" --include="*.mjs"
```

### Release Workflow

After updating all version references:
1. Commit changes with message: `chore: bump version to {VERSION}`
2. Create release using GitHub workflow or `npm run auto-release`
3. GitHub Actions will build binaries and create release with CHANGELOG.md content
