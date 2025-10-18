# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.2] - 2025-10-18

### Added

**User Interface:**

**AI Platform Support:**

**Testing & Development:**

### Fixed

### Changed

### Technical Improvements


## [0.9.1] - 2025-10-08
## [0.9.2] - 2025-10-18

### Changed
- Atualização de versão para 0.9.2
### Added
- **Right Sidebar**: Collapsible image preview and metadata on thumbnail hover
### Fixed
- **ComfyUI NaN**: JSON parsing errors for workflows with invalid numeric values
### Changed
- **Version Numbering**: Reset to 0.9.x series for pre-1.0 beta status
### Technical
- Enhanced ComfyUI traversal engine with link following and custom extractors (ttN concat, CFGGuider)
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
