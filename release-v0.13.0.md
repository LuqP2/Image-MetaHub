# Image MetaHub v0.13.0

## [0.13.0] - 2026-02-03

### Added

- **Video & GIF Support**: Early implementation of support for video formats (MP4, WEBM) and GIFs, allowing indexing, thumbnail display, and playback within the viewer.
- **Image Stacking Navigation**: Fully implemented stack navigation, allowing users to stack images with the same prompt, drill down into stacks, and navigate back to the main view seamlessly.
- **Subfolder Removal**: Added ability to exclude specific subfolders from the index directly from the directory tree context menu.
- **Partial Folder Refresh**: New efficient refresh mechanism for subfolders that updates only the specific directory cache without re-indexing the entire library.
- **Random Sort**: New "Random" sort order with a "Reshuffle" option.
- **UI & UX Improvements**:
  - Added "Copy Raw Metadata" to context menus.
  - Removed expansion arrows from empty folders to improve navigation clarity.

### Improved

- **Indexing Performance**: Major underlying optimization to file indexing (Phase B), significantly reducing time and UI lag for large libraries. Switched to synchronous header reads with controlled concurrency, eliminating disk contention and improving read times by ~98% (from ~800ms to ~10ms).

### Fixed

- **Thumbnail Staling**: Resolved issue where thumbnails stuck to old versions after overwriting files.
- **Prompt Library**: Fixed crashes/instability in the Prompt Library (IndexedDB errors).
- **Cache Management**: Refactored cache manager code to adhere to best practices.
- **Indexing Resiliency**: Fixed an issue where interrupted indexing operations left files with incomplete metadata (stubs) in the cache that never got re-indexed. The system now automatically detects these incomplete entries on startup/refresh and forces them to be fully enriched, eliminating the need to clear cache after an interrupted scan.

## Downloads

Choose the appropriate installer for your operating system:

###  Windows
- **Installer**: `ImageMetaHub-Setup-0.13.0.exe`
- **Format**: NSIS installer with desktop and start menu shortcuts
- **Size**: ~85MB

###  macOS
- **Intel Macs**: `ImageMetaHub-0.13.0.dmg`
- **Apple Silicon**: `ImageMetaHub-0.13.0-arm64.dmg`
- **Format**: DMG packages with proper entitlements
- **Requirements**: macOS 10.15+

###  Linux
- **Universal**: `ImageMetaHub-0.13.0.AppImage`
- **Format**: Portable AppImage (no installation required)
- **Dependencies**: None (fully self-contained)

## System Requirements

- **OS**: Windows 10+, macOS 10.15+, Ubuntu 18.04+ (or equivalent)
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 100MB for application + space for your image collections

## Documentation

- [README](https://github.com/LuqP2/image-metahub/blob/main/README.md)
- [Architecture](https://github.com/LuqP2/image-metahub/blob/main/ARCHITECTURE.md)
- [Changelog](https://github.com/LuqP2/image-metahub/blob/CHANGELOG.md)

## Known Issues

- Safari, Firefox, and Brave browsers don't support the File System Access API on macOS
- Use Chrome, Vivaldi, Edge, or the Desktop App for full functionality

## Feedback

Found a bug or have a feature request? [Open an issue](https://github.com/LuqP2/image-metahub/issues)!

---

*Released on 2026-02-03*