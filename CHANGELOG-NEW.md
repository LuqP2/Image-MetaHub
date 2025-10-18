# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.2] - 2025-10-18

### Added

**User Interface:**
- **Advanced Filters**: Range filters for Steps, CFG Scale, Dimensions, and Date with collapsible sidebar UI
- **List View Mode**: Table view with sortable columns for detailed image browsing alongside grid view
- **Keyboard Shortcuts**: Comprehensive shortcuts including Shift+Click range selection, view mode switching (G/L keys), and quick actions
- **Context Menu**: Right-click support in grid and table with Copy Prompt/Seed/Model, Show in Folder, and Export Image
- **Progressive Loading**: Images appear immediately in batches while indexing continues in background
- **Indexing Controls**: Real-time progress display with pause/resume/cancel buttons and file count status ("🔄 Indexing: 200 / 21,727 files processed")
- **Feedback Button**: Quick access to GitHub issues for bug reports and feature requests

**AI Platform Support:**
- **Draw Things**: iOS/Mac AI app with XMP metadata, Flux models, and LoRA configurations
- **Adobe Firefly**: C2PA/EXIF metadata with edit history and content credentials
- **Niji Journey**: Anime-focused Midjourney variant with parameter extraction (--niji, --v, --ar)
- **DreamStudio**: Stability AI platform with style presets and model variants
- **Midjourney PNG**: PNG format support with parameter flags (--v, --ar, --q, --s, --seed)
- **Forge**: A1111-based interface with hires upscaling and Gradio integration
- **SwarmUI**: Enhanced detection and LoRA extraction
- **SD.Next**: Backend, pipeline, and hires parameters support
- **DALL-E 3**: C2PA manifest and EXIF tag extraction

**Testing & Development:**
- **Vitest Framework**: Unit testing with jsdom environment
- **ESLint Configuration**: TypeScript/React rules with practical warnings
- **Parser Test Suite**: Comprehensive tests for metadata extraction
- **CLI Tooling**: `imagemetahub-cli` command for batch processing and debugging

### Fixed
- **Indexing State**: Progress display and control buttons now properly clear on completion
- **Context Menu**: Auto-close when clicking outside menu area
- **ComfyUI JPEG**: Fixed parser detection preventing metadata extraction from JPEG files
- **Dimension Calculations**: Corrected Midjourney and Niji Journey aspect ratio parsing
- **Null Reference**: Added null checks for progress property access preventing crashes
- **Filter Persistence**: Sidebar filters no longer disappear during refresh operations

### Changed
- **Grid Performance**: Migrated from react-virtualized Masonry to react-window FixedSizeGrid for 20k+ image collections
- **Dynamic Layout**: Responsive column calculation adapts to zoom level and window size
- **File Processing**: Newest files first (sorted by modification date descending)
- **UI Safety**: Disabled destructive operations (Add/Reload/Delete/Rename) during indexing
- **Filter Sync**: Incremental filter updates as images are processed for better UX

### Technical Improvements
- **ComfyUI Parser**: Multi-layer decompression (JSON/Base64/zlib), regex fallback, advanced seed extraction (numeric/hex/derived), model hash mapping
- **Sidecar JSON**: Automatic detection and parsing of .json metadata files alongside images
- **IPC Listeners**: Real-time indexing feedback via Electron IPC (onIndexingProgress, onIndexingBatchResult, onIndexingComplete)
- **Modular Architecture**: Extended parser factory with intelligent format detection for 12+ AI platforms

---

## [0.9.1] - 2025-10-08

### Added
- **Right Sidebar**: Collapsible image preview and metadata on thumbnail hover
- **Cache Management**: "Clear All Cache" button in Settings with confirmation dialog
- **Enhanced ComfyUI**: Grouped workflow parsing with widget extraction and custom node support

### Fixed
- **ComfyUI NaN**: JSON parsing errors for workflows with invalid numeric values
- **Cache Clearing**: Proper state reset and page reload functionality
- **Grouped Workflows**: Fixed parsing of grouped nodes (e.g., "workflow>Load Model - Flux")
- **Stack Overflow**: Prevented infinite recursion in ImageModal
- **CLI Loading**: Fixed command-line directory initialization

### Changed
- **Version Numbering**: Reset to 0.9.x series for pre-1.0 beta status

### Technical
- Enhanced ComfyUI traversal engine with link following and custom extractors (ttN concat, CFGGuider)
- Better error handling and state cleanup for orphaned image references

---

## [1.9.0] - 2025-10-03

### Added
- **Multiple Directories**: Add and manage multiple image folders simultaneously
- **Settings Modal**: Configure cache location and auto-update preferences
- **Resizable Grid**: Adjustable thumbnail sizes for high-resolution displays
- **CLI Support**: Specify startup directory via command-line arguments
- **Dev Server**: Network-accessible development server

### Fixed
- Cross-platform path construction issues
- File operations reliability improvements
- Cached image loading problems

---

## [1.8.1] - 2025-09-30

### Added
- **Subfolder Scanning**: Toggle to control recursive directory scanning with checkbox in folder selector and header

---

## [1.8.0] - 2025-09-30

### Major Architectural Changes
- **Complete Refactoring**: Migrated from monolithic App.tsx to modular architecture
- **Zustand State Management**: Centralized state in useImageStore.ts
- **Parser Modularization**: Split fileIndexer into InvokeAI, A1111, ComfyUI parsers with factory pattern
- **Custom Hooks**: Extracted useImageLoader, useImageFilters, useImageSelection

### New Features
- **Automatic1111 Support**: PNG/JPEG metadata with model, LoRA, and parameters
- **ComfyUI Support**: Workflow detection and basic metadata parsing
- **JPEG Support**: EXIF metadata extraction using exifr library
- **Advanced Filters**: Range filters for Steps, CFG, Dimensions, Date
- **Context Menu**: Copy Prompt/Negative/Seed/Model in ImageModal
- **Clipboard**: Copy image files to system clipboard
- **File Operations**: "Show in Folder" and "Export Image" with cross-platform paths
- **Multi-Format**: Unified filtering across InvokeAI, A1111, ComfyUI

### Performance
- **🚀 Record Speed**: 18,000 images in 3.5 minutes (~85 images/second)
- **Async Pool**: 10 concurrent file operations with memory controls
- **Throttled Updates**: 5Hz UI refresh (200ms intervals)
- **Optimized Processing**: Eliminated duplicate reads, batch file operations
- **Memory Efficient**: File handles instead of blob storage

### Technical
- **Enhanced Detection**: Prioritizes ComfyUI workflow > InvokeAI metadata > A1111 parameters
- **Regex Parsing**: Fallback extraction for corrupted or partial metadata
- **Error Resilience**: Graceful degradation when parsers fail
- **Cross-Platform**: Unified file handling for Windows/macOS/Linux

---

## [1.7.6] - 2025-09-28

### Fixed
- **Copy Functionality**: Restored "Copy Prompt" and "Copy Negative Prompt" in ImageModal
- **Hotkey System**: Rebuilt keyboard shortcuts with proper React integration
- **Command Palette**: Fixed search and action execution

### Added
- **Hotkey Help**: `?` key opens comprehensive shortcut reference
- **Customizable Shortcuts**: Editable keybindings in Settings

---

## [1.7.5] - 2025-09-27

### Fixed
- **Model Extraction**: Corrected InvokeAI model parsing from metadata.model field
- **LoRA Detection**: Fixed extraction from loras array with proper weight parsing
- **Filter Accuracy**: Model and LoRA filters now show correct counts

---

## [1.7.4] - 2025-09-26

### Added
- **Auto-Updater**: Automatic update checks and installation (Windows/macOS)
- **Update Notifications**: In-app alerts with download progress
- **Manual Updates**: "Check for Updates" in Settings menu

### Fixed
- **Update Dialog**: Improved UX with clear action buttons
- **Error Handling**: Better feedback for failed update downloads

---

## [1.7.3] - 2025-09-25

### Fixed
- **Duplicate Images**: Eliminated duplicate thumbnails in grid
- **Cache Corruption**: Fixed IndexedDB state management
- **Refresh Logic**: Proper cache invalidation on directory reload

---

## [1.7.2] - 2025-09-24

### Added
- **Dark Mode**: System-aware theme with manual toggle
- **Theme Persistence**: Remembers user preference across sessions

### Fixed
- **UI Contrast**: Improved readability in both themes
- **Icon Visibility**: Better contrast for action buttons

---

## [1.7.1] - 2025-09-23

### Fixed
- **Pagination**: Corrected page number calculation for large collections
- **Memory Leaks**: Proper cleanup of virtual scroll references
- **Scroll Position**: Maintains position when changing pages

---

## [1.7.0] - 2025-09-22

### Added
- **Virtual Scrolling**: Masonry grid with react-virtualized for 10k+ images
- **Lazy Loading**: Thumbnails load on demand as user scrolls
- **Zoom Levels**: 5 preset sizes from tiny (100px) to huge (400px)

### Performance
- **Rendering**: Smooth 60fps with 20,000+ images
- **Memory**: ~85% reduction vs. previous implementation
- **Scroll**: Instant response with virtual cells

---

## [1.6.0] - 2025-09-20

### Added
- **InvokeAI Focus**: Primary support for InvokeAI metadata format
- **PNG Parsing**: Text chunk extraction without external dependencies
- **Metadata Display**: Full generation parameters in modal

### Technical
- **Custom Parser**: Zero-dependency PNG metadata reader
- **Type Safety**: Comprehensive TypeScript interfaces
- **Error Handling**: Graceful fallbacks for corrupted files

---

## [1.5.0] - 2025-09-18

### Added
- **First Public Release**: Windows, macOS, Linux installers
- **Core Features**: Browse, search, filter AI-generated images
- **Offline First**: No internet required, all processing local
- **File System Access**: Native folder picker with persistent permissions

---

For older releases, see [GitHub Releases](https://github.com/LuqP2/Image-MetaHub/releases).
