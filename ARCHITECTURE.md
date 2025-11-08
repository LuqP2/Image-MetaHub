# Architecture Documentation

## Project Overview

**Image MetaHub** is a React + Electron desktop application for browsing large collections of AI generated images. The app focuses on fast indexing, rich metadata filters, and fully local processing so that libraries remain private.

### Current Version
- **Version:** 0.9.5
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

### State Management
- **Image Store (`store/useImageStore.ts`)** keeps the indexed image catalog, filter options, and folder visibility map. A `Map<string, 'checked' | 'unchecked'>` tracks which directories contribute images. Helper utilities normalize paths so the selection logic works across Windows and POSIX separators.
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

### Desktop Integration
- **Electron Main Process (`electron.mjs`)** configures the BrowserWindow title (`Image MetaHub v0.9.5`), wires IPC handlers for file operations, and manages auto-update prompts.
- **Preload Bridge (`preload.js`)** exposes a sandboxed `electronAPI` with directory listing, file stats, and shell helpers used by the directory tree.
- **CLI (`cli.ts`)** provides command-line indexing utilities with the same version stamp (`0.9.5-rc`) displayed in the desktop UI.

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

