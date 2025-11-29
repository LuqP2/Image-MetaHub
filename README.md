# Image MetaHub

This project was renamed from `local-image-browser-for-invokeai` to `Image MetaHub`. All links and references have been updated.

A desktop application for browsing, searching, and organizing AI-generated images locally. Designed for performance with large collections, focusing on powerful metadata filtering and complete privacy.

All processing is performed locally on your machine. No data is sent to external services, and no internet connection is required after installation.

*For detailed changes and updates, see the [Releases page](https://github.com/LuqP2/image-metahub/releases).*


## Releases & Updates

This project uses automated release management to ensure consistent, informative release notes:

- **Cross-platform builds** for Windows, macOS, and Linux
- **Rich release notes** generated from CHANGELOG.md
- **Auto-updates** available in the desktop application
- **Release guide** available in [RELEASE-GUIDE.md](RELEASE-GUIDE.md)

For maintainers: See [RELEASE-GUIDE.md](RELEASE-GUIDE.md) for the automated release workflow.

## Key Features

**Advanced Search & Filtering**
- **Deep Metadata Search:** Full-text search across all PNG and JPEG metadata including prompts, models, and generation parameters
- **Precise Filtering:** Filter by Models, LoRAs, Schedulers, image dimensions, generation steps, CFG Scale, and date ranges
- **Multi-Format Support:** Works with InvokeAI, Automatic1111, ComfyUI, SwarmUI, Easy Diffusion, Midjourney, Niji Journey, Forge, DALL-E, Adobe Firefly, DreamStudio, and Draw Things generated images (PNG and JPEG, including sidecar JSON and C2PA manifests)

**Enhanced User Experience**
- **Right Sidebar Preview:** Hover over thumbnails to see instant preview with metadata in a collapsible right sidebar
- **Multiple Directories:** Add and manage multiple image directories simultaneously
- **Configurable Settings:** Control cache location, automatic update preferences, and cache management
- **Resizable Grid:** Adjust thumbnail sizes for optimal viewing on any display
- **Command-Line Support:** Launch with a specified directory for automation workflows
- **Developer Mode:** Access development server from local network devices
- **Persistent Directory Visibility:** Control which roots and subfolders contribute to the gallery using tri-state checkboxes
- **Tri-State Folder Selection:** Combine root folders with specific subfolders using inherited checkbox states that persist between sessions

**Performance & Large Collections**
- **Optimized for Scale:** Efficiently handles 30,000+ images without performance issues
- **Smart Caching:** Subsequent folder loads take seconds instead of minutes by processing only new files
- **Memory Efficient:** Lazy loading and background processing ensure responsive performance

**File Management**
- **Direct File Operations:** Rename and delete files within the application (Desktop version)
- **Metadata Export:** Export complete image metadata to JSON or readable TXT files
- **Fullscreen Viewer:** Distraction-free image viewing with keyboard navigation

## Installation

**Desktop Application (Recommended)**
1. Go to [**Releases**](https://github.com/LuqP2/image-metahub/releases)
2. Download the installer for your system (`.exe` for Windows, `.dmg` for macOS, `.AppImage` for Linux)
3. Run the installer and launch the application

**Run from Source**
```bash
git clone https://github.com/LuqP2/image-metahub.git
cd image-metahub
npm install

# Option 1: Run in browser only
npm run dev

# Option 2: Run Electron app with optional directory
npm run dev:app
npm run dev:app -- --dir "/path/to/images"
```

## Command-Line Usage

**Desktop Application (Production)**
```bash
# Windows
ImageMetaHub.exe --dir "C:\path\to\images"

# macOS/Linux
./ImageMetaHub --dir "/path/to/images"
```

**Development Mode**
```bash
# Start Vite dev server only (browser access)
npm run dev

# Start Electron app with Vite dev server
npm run dev:app

# Start with initial directory
npm run dev:app -- --dir "/path/to/images"
```

The dev server automatically binds to `0.0.0.0`, making it accessible from other devices on your local network. Check the console output for the network URL.

## Quick Start
1. Launch the application and click "Change Folder" to select your AI-generated images directory
2. Subfolders are indexed automatically on first run; adjust directory visibility later from the folder sidebar if needed
3. Wait for initial indexing (may take a few minutes for large collections)
4. Hover over any thumbnail to see instant preview with metadata in the right sidebar
5. Use the left sidebar to search and filter your images by metadata, models, or generation parameters
6. Click any image to view detailed metadata in fullscreen modal with management options
7. Use "Update" button to quickly index new images without re-processing the entire collection

## Technical Details

- **Frontend:** React 18 with TypeScript
- **Desktop:** Electron with integrated auto-updater
- **Storage:** IndexedDB for persistent local caching
- **File Access:** File System Access API (browser) / Node.js filesystem (desktop)
- **Directory Scanning:** Configurable recursive subfolder scanning with user preference persistence

For comprehensive technical information, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Privacy & Security

This application operates entirely offline:
- All processing happens on your local machine
- No accounts, telemetry, or network requests (except auto-updater)
- File system access requires explicit user permission
- All data remains on your device

## Contributing

Contributions are welcome! Please open an issue for major changes to discuss the approach first.

## Roadmap

**Completed ✅**
- Advanced range filters for Steps, CFG Scale, Dimensions, and Creation Date
- Virtual scrolling for large collections with ImageTable component
- Configurable subfolder scanning with user preference persistence
- Right Sidebar image preview with metadata display
- Multi-Selection support with Ctrl+Click
- Comprehensive hotkey system and keyboard navigation
- Metadata export to JSON and readable TXT formats
- Fullscreen image viewer with keyboard controls
- File operations (Show in Folder, Delete, Rename in Desktop app)

**Medium-Term**
- Custom tagging system for image organization
- Image comparison view for side-by-side analysis
- Batch operations on selected images

**Long-Term**
- Plugin architecture for extensibility
- Image similarity search powered by AI embeddings
- Optional cloud sync for tags and collections

## License

Licensed under the [MPL 2.0](LICENSE).

This is an independent project and is not affiliated with Invoke AI, Inc.
