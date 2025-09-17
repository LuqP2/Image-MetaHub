# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Responsive design for desktop and mobile