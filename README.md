# Local Image Browser for InvokeAI

An offline-first desktop application for browsing, searching, and organizing AI-generated images. It is designed for performance with large local collections, focusing on powerful metadata filtering and user privacy.

All processing is performed locally. The application has no built-in upload, sharing, or synchronization features; no data is sent to external services.

*For a detailed list of recent changes, please see the [Releases page](https://github.com/LuqP2/local-image-browser-for-invokeai/releases).*

## Core Features

#### Advanced Search & Filtering
*   **Deep Metadata Search:** Full-text, case-insensitive search across all PNG metadata including prompts, models, and generation settings.
*   **Precise Filtering:** Isolate images by Models, LoRAs, Schedulers, and specific image dimensions.
*   **Multi-Selection & Bulk Operations:** Use `Ctrl+Click` to select multiple images and perform bulk actions like deletion (Desktop only).
*   **Click-to-Edit Pagination:** Click any page number to jump directly to that page for instant navigation.

#### Performance & Caching
*   **Optimized for Large Collections:** Efficiently indexes and manages 18,000+ images without performance degradation.
*   **Incremental Indexing:** Subsequent loads take seconds, not minutes, by processing only new or changed files.
*   **Smart Cache Management:** Automatic cleanup of stale entries without full reindexing for faster refresh operations.
*   **Memory Efficient:** Lazy loading and background processing ensure a responsive UI at all times.

#### File Management & Utilities
*   **Direct File Operations:** Rename and delete files directly within the application (Desktop only).
*   **Metadata Export:** Export complete image metadata to structured `JSON` or readable `TXT` files.
*   **Fullscreen Viewer:** View images in a distraction-free fullscreen mode with ESC key support.
*   **Enhanced Refresh Folder:** Detects new images without full reindexing for improved workflow efficiency.

## Installation

**Prerequisites:** Node.js 16+ (LTS recommended)

### Installer (Recommended)
1.  Navigate to the [**Releases**](https://github.com/LuqP2/local-image-browser-for-invokeai/releases) page.
2.  Download the appropriate installer for your operating system (`.exe`, `.dmg`, `.AppImage`).
3.  Run the installer and launch the application.

### Run from Source
```bash
# Clone the repository
git clone https://github.com/LuqP2/local-image-browser-for-invokeai.git
cd local-image-browser-for-invokeai

# Install dependencies
npm install

# Start the development server
npm run dev
```

## Quick Start
1.  Launch the application and select the root folder containing your InvokeAI images.
2.  Allow the initial indexing to complete. This may take several minutes for large collections.
3.  Use the sidebar controls to search and filter your collection.
4.  Click any image to open a detailed view with its full metadata and management options.

## Technical Overview

*   **Frontend**: React 18 with TypeScript
*   **Desktop Wrapper**: Electron 38 with an integrated auto-updater
*   **Build Tool**: Vite
*   **Storage**: IndexedDB for persistent client-side caching
*   **File Access**: Uses the File System Access API in browsers and Node.js `fs` APIs in Electron for native file handling.

For comprehensive technical details, please see the [**ARCHITECTURE.md**](./ARCHITECTURE.md) document.

## Roadmap

### Short-Term
*   **Advanced Range Filters:** Implement sliders for Steps and CFG Scale.
*   **Virtual Scrolling:** Enhance performance for browsing exceptionally large collections.
*   **Keyboard Shortcuts:** Add hotkeys for navigation, selection, and common operations.

### Medium-Term
*   **Multi-Platform Support:** Add metadata parsers for ComfyUI and Automatic1111/WebUI.
*   **Tagging System:** Implement custom, user-defined tags for better organization.
*   **Image Comparison View:** A side-by-side view to compare selected images.

### Long-Term
*   **Plugin System:** Develop an extensible architecture for custom metadata parsers and features.
*   **Image Similarity Search:** Find visually similar images using embedding models.
*   **Optional Cloud Sync:** Offer a method for syncing cache and user data between devices.

## Privacy & Security

This application is local-only by design.
*   All file processing, metadata extraction, and caching occurs on your machine.
*   No user accounts are required, and no telemetry data is collected.
*   File system access is granted explicitly by the user for each session via the browser/OS security prompts. All data remains on the user's device.

## Contributing

Contributions are welcome. Please feel free to submit a Pull Request. For major architectural changes, please open an issue first to initiate a discussion.

## License & Disclaimer

This project is licensed under the [MIT License](LICENSE).

This is an independent, community-built tool and is not affiliated with or endorsed by Invoke AI, Inc. "InvokeAI" is a trademark of Invoke AI, Inc.
